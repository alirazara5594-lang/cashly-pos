using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// SELF-SERVE CHECKOUT
//
// What an owner buys for their own business without talking to anyone: a different plan, or an
// add-on. It is deliberately not the same thing as `change-plan` — an upgrade there is instant
// and free because it only ever *adds* allowance for something already running. Anything that
// costs money goes through an invoice, and an invoice only takes effect once it is paid, so the
// two paths cannot disagree about when a feature turned on.
//
// The effect a paid invoice applies lives on the invoice itself as `EffectJson`. That is what
// makes "settle" one code path whether a human marks it paid in the admin console or a gateway
// webhook does at 3am — and it means a paid invoice is a complete record of what was bought,
// not just of how much.
// ============================================================

/// <summary>What the owner asked to buy.</summary>
public sealed record CheckoutRequest(
    string Kind,             // "plan" | "addon"
    string? PlanCode = null,
    string? AddOnKey = null,
    bool Annual = false,
    int Quantity = 1,
    Guid? BranchId = null);

/// <summary>What it costs, before anything is written.</summary>
public sealed record CheckoutQuote(
    string Kind,
    string Code,
    string Description,
    int Quantity,
    decimal UnitPricePKR,
    decimal TotalPKR);

public sealed record CheckoutOutcome(bool Ok, string? Error, SubscriptionInvoice? Invoice);

public interface ISubscriptionCheckout
{
    /// <summary>Prices a purchase. Throws <see cref="InvalidOperationException"/> when it cannot
    /// be priced at all — an unknown plan, an unknown add-on, or something already owned.</summary>
    Task<CheckoutQuote> QuoteAsync(Guid tenantId, CheckoutRequest request, CancellationToken ct = default);

    /// <summary>Raises a pending invoice for the purchase. Nothing changes about the tenant's
    /// plan or add-ons until that invoice is settled.</summary>
    Task<CheckoutOutcome> CheckoutAsync(Guid tenantId, CheckoutRequest request, Guid? actingUserId, CancellationToken ct = default);

    /// <summary>
    /// Marks an invoice paid and applies what it bought. Idempotent: settling an already-paid
    /// invoice is a no-op that reports success, because a webhook and a human marking it paid
    /// will both eventually arrive for the same invoice.
    /// </summary>
    Task<bool> SettleAsync(SubscriptionInvoice invoice, string? paymentMethod, Guid? actingUserId, CancellationToken ct = default);
}

public class SubscriptionCheckout : ISubscriptionCheckout
{
    private readonly AppDbContext _db;
    private readonly ISubscriptionService _subs;
    private readonly IEntitlementService _entitlements;

    public SubscriptionCheckout(AppDbContext db, ISubscriptionService subs, IEntitlementService entitlements)
    {
        _db = db;
        _subs = subs;
        _entitlements = entitlements;
    }

    public async Task<CheckoutQuote> QuoteAsync(Guid tenantId, CheckoutRequest request, CancellationToken ct = default)
    {
        var kind = (request.Kind ?? "").Trim().ToLowerInvariant();
        return kind switch
        {
            "plan" => await QuotePlanAsync(tenantId, request, ct),
            "addon" => await QuoteAddOnAsync(tenantId, request, ct),
            _ => throw new InvalidOperationException("Choose either a plan or an add-on to buy.")
        };
    }

    public async Task<CheckoutOutcome> CheckoutAsync(
        Guid tenantId, CheckoutRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        CheckoutQuote quote;
        try
        {
            quote = await QuoteAsync(tenantId, request, ct);
        }
        catch (InvalidOperationException ex)
        {
            return new CheckoutOutcome(false, ex.Message, null);
        }

        var now = DateTime.UtcNow;
        var months = request.Annual ? 12 : 1;
        var tier = await _db.Tenants.AsNoTracking().IgnoreQueryFilters()
            .Where(t => t.Id == tenantId)
            .Select(t => t.Tier.ToString())
            .FirstOrDefaultAsync(ct) ?? "Unknown";

        var count = await _db.SubscriptionInvoices.IgnoreQueryFilters().CountAsync(ct);

        var invoice = new SubscriptionInvoice
        {
            TenantId = tenantId,
            InvoiceNumber = $"INV-{count + 1:00000}",
            Tier = tier,
            BillingPeriodStart = now,
            BillingPeriodEnd = now.AddMonths(months),
            AmountPKR = quote.TotalPKR,
            Status = SubscriptionInvoiceStatus.Pending,
            DueAt = now.AddDays(7),
            Notes = quote.Description,
            LinesJson = JsonSerializer.Serialize(new[]
            {
                new { description = quote.Description, quantity = quote.Quantity, unitPricePKR = quote.UnitPricePKR, amountPKR = quote.TotalPKR, kind = quote.Kind }
            }),
            EffectJson = BuildEffect(request, quote)
        };

        _db.SubscriptionInvoices.Add(invoice);
        await _db.SaveChangesAsync(ct);

        return new CheckoutOutcome(true, null, invoice);
    }

    public async Task<bool> SettleAsync(SubscriptionInvoice invoice, string? paymentMethod, Guid? actingUserId, CancellationToken ct = default)
    {
        if (invoice.Status == SubscriptionInvoiceStatus.Paid) return true;

        invoice.Status = SubscriptionInvoiceStatus.Paid;
        invoice.PaidAt = DateTime.UtcNow;
        invoice.PaymentMethod = paymentMethod;

        // Paying an invoice extends the tenant's paid-until date to cover the billed period.
        var tenant = await _db.Tenants.IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.Id == invoice.TenantId, ct);
        if (tenant != null && (tenant.SubscriptionPaidUntil == null || tenant.SubscriptionPaidUntil < invoice.BillingPeriodEnd))
            tenant.SubscriptionPaidUntil = invoice.BillingPeriodEnd;

        // The money has been taken; what it bought must follow. A failure here is recorded on the
        // invoice rather than thrown, because the payment is already irrevocable and losing the
        // reason it happened would leave an owner charged with nothing to show for it.
        var (applied, error) = await ApplyEffectAsync(invoice, actingUserId, ct);
        if (!applied)
            invoice.Notes = string.IsNullOrWhiteSpace(invoice.Notes)
                ? $"Paid, but not applied: {error}"
                : $"{invoice.Notes}\nPaid, but not applied: {error}";

        await _db.SaveChangesAsync(ct);
        return applied;
    }

    // ---------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------

    private async Task<CheckoutQuote> QuotePlanAsync(Guid tenantId, CheckoutRequest request, CancellationToken ct)
    {
        var code = (request.PlanCode ?? "").Trim();
        if (code.Length == 0) throw new InvalidOperationException("Choose a plan to move to.");

        var plan = await _db.Plans.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(p => p.Code == code && p.IsActive, ct)
            ?? throw new InvalidOperationException("That plan is not available.");

        // The current plan is asked by code, never by name, so a plan renamed in the admin panel
        // does not make every owner's "you are already on this" check start lying.
        var usage = await _subs.GetUsageAsync(tenantId);
        if (string.Equals(usage.PlanCode, plan.Code, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("You are already on this plan.");

        var unit = request.Annual ? plan.YearlyPricePKR : plan.MonthlyPricePKR;
        return new CheckoutQuote("plan", plan.Code, plan.Name, 1, unit, unit);
    }

    private async Task<CheckoutQuote> QuoteAddOnAsync(Guid tenantId, CheckoutRequest request, CancellationToken ct)
    {
        var key = (request.AddOnKey ?? "").Trim();
        if (key.Length == 0) throw new InvalidOperationException("Choose an add-on to buy.");

        var item = await _db.AddOnCatalogItems.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Key == key && a.IsActive, ct)
            ?? throw new InvalidOperationException("That add-on is not available.");

        var alreadyOwned = await _db.AddOnSubscriptions.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(a => a.TenantId == tenantId && a.IsActive && a.AddOnKey == key
                && (a.BranchId == null || a.BranchId == request.BranchId), ct);

        // A count add-on (extra counter, extra staff seat, message bundle) is bought again to get
        // more of it; a boolean one is either on or off, and charging twice for the same switch
        // would be a mistake the owner could not undo.
        if (alreadyOwned && !IsQuantityAddOn(key))
            throw new InvalidOperationException($"{item.DisplayName} is already active on your account.");

        var quantity = Math.Max(1, request.Quantity);
        var unit = request.Annual ? item.YearlyPricePKR : item.MonthlyPricePKR;
        var where = request.BranchId != null
            ? await _db.Branches.IgnoreQueryFilters().AsNoTracking()
                .Where(b => b.Id == request.BranchId && b.TenantId == tenantId)
                .Select(b => b.Name)
                .FirstOrDefaultAsync(ct)
            : null;

        var description = where == null ? item.DisplayName : $"{item.DisplayName} ({where})";
        return new CheckoutQuote("addon", key, description, quantity, unit, unit * quantity);
    }

    // ---------------------------------------------------------
    // The effect
    // ---------------------------------------------------------

    private static string BuildEffect(CheckoutRequest request, CheckoutQuote quote)
    {
        if (request.Kind.Trim().ToLowerInvariant() == "plan")
            return JsonSerializer.Serialize(new { kind = "plan", planCode = quote.Code });

        return JsonSerializer.Serialize(new
        {
            kind = "addon",
            addOnKey = quote.Code,
            annual = request.Annual,
            quantity = quote.Quantity,
            branchId = request.BranchId,
            // Frozen here rather than read back from the catalogue at settlement: a list price
            // raised between purchase and payment must not change what this invoice was for.
            unitPricePKR = quote.UnitPricePKR
        });
    }

    private async Task<(bool Ok, string? Error)> ApplyEffectAsync(
        SubscriptionInvoice invoice, Guid? actingUserId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(invoice.EffectJson)) return (true, null);

        JsonDocument doc;
        try { doc = JsonDocument.Parse(invoice.EffectJson); }
        catch (JsonException) { return (false, "the invoice carries no readable purchase"); }

        using (doc)
        {
            var root = doc.RootElement;
            var kind = root.TryGetProperty("kind", out var k) ? k.GetString() : null;

            try
            {
                if (kind == "plan")
                {
                    var planCode = root.GetProperty("planCode").GetString();
                    if (string.IsNullOrWhiteSpace(planCode)) return (false, "no plan named on the invoice");
                    await _subs.ChangePlanAsync(invoice.TenantId, planCode, actingUserId, "Self-serve purchase");
                }
                else if (kind == "addon")
                {
                    var key = root.GetProperty("addOnKey").GetString();
                    if (string.IsNullOrWhiteSpace(key)) return (false, "no add-on named on the invoice");

                    var quantity = root.TryGetProperty("quantity", out var q) && q.TryGetInt32(out var n)
                        ? Math.Max(1, n) : 1;
                    var annual = root.TryGetProperty("annual", out var a)
                        && a.ValueKind == JsonValueKind.True;
                    var branchId = root.TryGetProperty("branchId", out var b)
                        && b.ValueKind == JsonValueKind.String && Guid.TryParse(b.GetString(), out var parsed)
                        ? parsed : (Guid?)null;

                    // Price as at purchase, not as at settlement: a list price raised between the
                    // two must not change what this invoice was for.
                    var unit = root.TryGetProperty("unitPricePKR", out var u) && u.TryGetDecimal(out var unitPrice)
                        ? unitPrice
                        : await _db.AddOnCatalogItems.AsNoTracking()
                            .Where(x => x.Key == key)
                            .Select(x => annual ? x.YearlyPricePKR : x.MonthlyPricePKR)
                            .FirstOrDefaultAsync(ct);

                    _db.AddOnSubscriptions.Add(new AddOnSubscription
                    {
                        TenantId = invoice.TenantId,
                        AddOnKey = key,
                        Quantity = quantity,
                        PricePKR = unit,
                        BranchId = branchId,
                        IsActive = true
                    });
                    await _db.SaveChangesAsync(ct);
                }
                else
                {
                    return (false, $"unrecognised purchase kind '{kind}'");
                }
            }
            catch (InvalidOperationException ex)
            {
                // ChangePlanAsync refuses downgrades that would strand an over-limit configuration.
                return (false, ex.Message);
            }

            await _entitlements.RecomputeAsync(invoice.TenantId);
            return (true, null);
        }
    }

    /// <summary>Keys bought in multiples rather than once. Every one of these is a quantity the
    /// entitlement maths sums across rows, so a second purchase genuinely buys more.</summary>
    internal static bool IsQuantityAddOn(string key) =>
        key.StartsWith("EXTRA_", StringComparison.OrdinalIgnoreCase)
        || key.StartsWith("WHATSAPP_", StringComparison.OrdinalIgnoreCase);
}
