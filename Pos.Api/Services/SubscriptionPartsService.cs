using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// RENEWALS PER PART
//
// A business pays for several things, and each renews on its own date counted from when it went in:
//   • the Head Office ERP — from registration;
//   • each selling location's POS version — from its first till (an outlet with no till yet bills nothing);
//   • each waiter tablet beyond what its location's POS version includes — from its activation;
//   • every other add-on — from when it was added.
// Anything installed during the business's free trial is covered until the trial ends; anything
// installed afterwards starts its own period from its installation date.
//
// The parts are kept in step with the real setup (SyncAsync) rather than written by every screen
// that adds an outlet or a tablet: activation dates come from the devices themselves, so a part
// noticed late still carries the day it really went in.
//
// Money moves a part's date only through a paid invoice (CoverInvoiceAsync). When a part stays
// unpaid, only that part stops (StoppedAt): one outlet's tills, one tablet, the head office's
// changes, or one add-on — never the whole business.
// ============================================================

/// <summary>Where a part stands today.</summary>
public enum PartStatus
{
    NotInstalled,     // an outlet with no till yet: nothing to bill
    Trial,            // covered by the business's free trial
    Active,           // paid, more than 14 days left
    Expiring,         // paid or trial, 14 days or fewer left
    PaymentDue,       // installed after the trial and never paid
    Expired,          // its covered period has ended
    Stopped,          // left unpaid, so this part alone was stopped
    Ended             // no longer in use (outlet stopped selling, tablet revoked, add-on removed)
}

public sealed record PartState(PartStatus Status, DateTime? RenewsAt, int? DaysLeft, bool InTrial);

/// <summary>What is stopped for one business because it was not paid.</summary>
public sealed record StoppedParts(bool ErpStopped, bool Standalone, IReadOnlySet<Guid> PosBranches, IReadOnlySet<Guid> Tablets, IReadOnlySet<Guid> AddOns)
{
    public static readonly StoppedParts None = new(false, false, new HashSet<Guid>(), new HashSet<Guid>(), new HashSet<Guid>());

    /// <summary>The head office's changes pause — or, for a single shop, its own POS (which is its back office too).</summary>
    public bool StopsBackOffice => ErpStopped || (Standalone && PosBranches.Count > 0);

    public bool StopsSellingAt(Guid branchId) => PosBranches.Contains(branchId);

    public bool StopsDevice(Guid branchId, Guid terminalId) => PosBranches.Contains(branchId) || Tablets.Contains(terminalId);
}

public interface ISubscriptionPartsService
{
    /// <summary>Brings one business's parts in line with its outlets, tablets and add-ons.</summary>
    Task SyncAsync(Guid tenantId);

    /// <summary>Every business, at most once a minute — for the platform's renewal views.</summary>
    Task SyncAllAsync();

    /// <summary>Every business, now — for the billing automation.</summary>
    Task SyncAllNowAsync();

    /// <summary>Sets the date a part is paid up to, for a correction or a free period. No money is recorded.</summary>
    Task<SubscriptionPart> SetPaidUntilAsync(Guid partId, DateTime paidUntil);

    /// <summary>A paid invoice covers what it was for: its parts, a purchase, or (older invoices) the whole business.</summary>
    Task CoverInvoiceAsync(SubscriptionInvoice invoice, Guid? purchasedAddOnId, bool purchasedPlan, bool purchaseAnnual);

    /// <summary>Stops one part for not being paid, or lets it run again.</summary>
    Task<SubscriptionPart> SetStoppedAsync(Guid partId, bool stopped);
}

public class SubscriptionPartsService : ISubscriptionPartsService
{
    /// <summary>Days before a renewal it counts as expiring.</summary>
    public const int ExpiringWithinDays = 14;

    private static DateTime _lastSyncAll = DateTime.MinValue;
    private static readonly object SyncAllGate = new();

    private readonly AppDbContext _db;
    private readonly IBillingService _billing;
    private readonly IEntitlementService _entitlements;

    public SubscriptionPartsService(AppDbContext db, IBillingService billing, IEntitlementService entitlements)
    {
        _db = db;
        _billing = billing;
        _entitlements = entitlements;
    }

    /// <summary>The end of what a part is covered for — the later of its trial and what was paid — or null.</summary>
    public static DateTime? CoveredUntil(SubscriptionPart part) => (part.TrialEndsAt, part.PaidUntil) switch
    {
        (null, var paid) => paid,
        (var trial, null) => trial,
        (var trial, var paid) => trial > paid ? trial : paid
    };

    /// <summary>When the next period starts: the end of what is covered, else the day it went in.</summary>
    public static DateTime? NextPeriodStart(SubscriptionPart part) => CoveredUntil(part) ?? part.InstalledAt;

    /// <summary>A part's status, renewal date and days left, as of <paramref name="now"/>.</summary>
    public static PartState StateOf(SubscriptionPart part, DateTime now)
    {
        if (!part.IsActive) return new PartState(PartStatus.Ended, part.EndedAt, null, false);
        if (part.InstalledAt == null) return new PartState(PartStatus.NotInstalled, null, null, false);

        var covered = CoveredUntil(part);
        var inTrial = part.TrialEndsAt != null && (part.PaidUntil == null || part.PaidUntil < part.TrialEndsAt);
        if (covered == null)
        {
            // Installed after the trial and never paid: due from the day it went in.
            var overdue = (int)Math.Floor((now - part.InstalledAt.Value).TotalDays);
            return new PartState(part.StoppedAt != null ? PartStatus.Stopped : PartStatus.PaymentDue, part.InstalledAt, -overdue, false);
        }

        var daysLeft = (int)Math.Ceiling((covered.Value - now).TotalDays);
        if (part.StoppedAt != null && covered.Value <= now)
            return new PartState(PartStatus.Stopped, covered, daysLeft, false);
        var status = covered.Value <= now ? PartStatus.Expired
            : daysLeft <= ExpiringWithinDays ? PartStatus.Expiring
            : inTrial ? PartStatus.Trial
            : PartStatus.Active;
        return new PartState(status, covered, daysLeft, inTrial);
    }

    /// <summary>What is stopped at one business. Cheap: one indexed read of its stopped parts.</summary>
    public static async Task<StoppedParts> StoppedPartsAsync(AppDbContext db, Guid tenantId)
    {
        // Fails open: a till must never stop selling because this table could not be read.
        List<(SubscriptionPartKind Kind, Guid? BranchId, Guid? TerminalId, Guid? AddOnSubscriptionId)> stopped;
        try
        {
            stopped = (await db.SubscriptionParts.IgnoreQueryFilters().AsNoTracking()
                    .Where(p => p.TenantId == tenantId && p.IsActive && p.StoppedAt != null)
                    .Select(p => new { p.Kind, p.BranchId, p.TerminalId, p.AddOnSubscriptionId })
                    .ToListAsync())
                .Select(p => (p.Kind, p.BranchId, p.TerminalId, p.AddOnSubscriptionId)).ToList();
        }
        catch (Npgsql.PostgresException)
        {
            return StoppedParts.None;
        }
        if (stopped.Count == 0) return StoppedParts.None;

        var standalone = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.DeploymentMode).FirstOrDefaultAsync() != DeploymentMode.HeadOffice;
        return new StoppedParts(
            stopped.Any(p => p.Kind == SubscriptionPartKind.Erp),
            standalone,
            stopped.Where(p => p.Kind == SubscriptionPartKind.Pos && p.BranchId != null).Select(p => p.BranchId!.Value).ToHashSet(),
            stopped.Where(p => p.Kind == SubscriptionPartKind.Tablet && p.TerminalId != null).Select(p => p.TerminalId!.Value).ToHashSet(),
            stopped.Where(p => p.Kind == SubscriptionPartKind.AddOn && p.AddOnSubscriptionId != null).Select(p => p.AddOnSubscriptionId!.Value).ToHashSet());
    }

    private static string EditionLabel(SubscriptionTier edition) =>
        edition == SubscriptionTier.Professional ? "Enterprise" : edition.ToString();

    private sealed record WantedPart(string Key, SubscriptionPartKind Kind, string Name, Guid? BranchId, Guid? TerminalId,
        Guid? AddOnSubscriptionId, DateTime? InstalledAt, decimal MonthlyPrice, decimal YearlyPrice, DateTime? PaidUpTo = null);

    public async Task SyncAsync(Guid tenantId)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant == null) return;
        var now = DateTime.UtcNow;

        var monthly = await _billing.QuoteAsync(tenantId, annual: false);
        var yearly = await _billing.QuoteAsync(tenantId, annual: true);
        decimal PriceOf(BillingQuote quote, string kind, Guid? branchId) =>
            quote.Lines.FirstOrDefault(l => l.Kind == kind && (branchId == null || l.BranchId == branchId))?.UnitPricePKR ?? 0;

        var branches = await _db.Branches.IgnoreQueryFilters().AsNoTracking()
            .Where(b => b.TenantId == tenantId)
            .Select(b => new { b.Id, b.Name, b.CanSell, b.PosEdition })
            .ToListAsync();
        var devices = await _db.Terminals.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.TenantId == tenantId && (t.TerminalType == TerminalType.Counter || t.TerminalType == TerminalType.OrderTab))
            .Select(t => new { t.Id, t.BranchId, t.TerminalType, t.TerminalName, t.ActivatedAt, t.IsActive, t.RevokedAt, t.DeactivatedAt })
            .ToListAsync();
        var addOns = await _db.AddOnSubscriptions.IgnoreQueryFilters().AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.IsActive)
            .ToListAsync();
        var catalogue = await _db.AddOnCatalogItems.AsNoTracking().ToListAsync();
        var allowances = await _entitlements.GetBranchAllowancesAsync(tenantId);
        var ent = await _entitlements.GetAsync(tenantId);

        var wanted = new List<WantedPart>();

        // The ERP, from registration.
        if (tenant.DeploymentMode == DeploymentMode.HeadOffice)
            wanted.Add(new WantedPart("erp", SubscriptionPartKind.Erp, "Head Office ERP", null, null, null, tenant.CreatedAt,
                PriceOf(monthly, "erp", null), PriceOf(yearly, "erp", null)));

        var tabletCatalogue = catalogue.FirstOrDefault(c => c.Key == "EXTRA_TABLET");
        foreach (var shop in branches.Where(b => b.CanSell).OrderBy(b => b.Name))
        {
            // The location's POS, from the first till ever connected there — when they started using it.
            var firstTill = devices.Where(d => d.BranchId == shop.Id && d.ActivatedAt != null)
                .Min(d => d.ActivatedAt);
            var edition = shop.PosEdition ?? tenant.Tier;
            wanted.Add(new WantedPart($"pos:{shop.Id}", SubscriptionPartKind.Pos, $"{shop.Name} POS ({EditionLabel(edition)})",
                shop.Id, null, null, firstTill, PriceOf(monthly, "pos", shop.Id), PriceOf(yearly, "pos", shop.Id)));

            // Tablets beyond what the POS version includes, each from its own activation, oldest first.
            allowances.TryGetValue(shop.Id, out var allowance);
            var included = allowance?.MaxOrderTabs ?? ent.MaxOrderTabs;
            if (included >= FeatureCatalog.UnlimitedCount) continue;
            var tablets = devices
                .Where(d => d.BranchId == shop.Id && d.TerminalType == TerminalType.OrderTab
                            && d.IsActive && d.RevokedAt == null && d.DeactivatedAt == null && d.ActivatedAt != null)
                .OrderBy(d => d.ActivatedAt)
                .Skip(Math.Max(0, included));
            // The price agreed when the extra tablets were bought for this shop, else the list price.
            var purchase = addOns.FirstOrDefault(a => a.AddOnKey == "EXTRA_TABLET" && a.BranchId == shop.Id);
            var agreed = purchase?.PricePKR;
            var tabletMonthly = agreed ?? tabletCatalogue?.MonthlyPricePKR ?? 0;
            var tabletYearly = agreed != null && agreed != tabletCatalogue?.MonthlyPricePKR ? agreed.Value * 10 : tabletCatalogue?.YearlyPricePKR ?? tabletMonthly * 10;
            foreach (var tablet in tablets)
                wanted.Add(new WantedPart($"tablet:{tablet.Id}", SubscriptionPartKind.Tablet,
                    $"{shop.Name} · {(string.IsNullOrWhiteSpace(tablet.TerminalName) ? "Tablet" : tablet.TerminalName)} (extra tablet)",
                    shop.Id, tablet.Id, null, tablet.ActivatedAt, tabletMonthly, tabletYearly, purchase?.CoveredUntil));
        }

        // Every other add-on. Extra tablets are billed per tablet above, not per purchase.
        var shopNames = branches.ToDictionary(b => b.Id, b => b.Name);
        foreach (var addOn in addOns.Where(a => a.AddOnKey != "EXTRA_TABLET"))
        {
            var item = catalogue.FirstOrDefault(c => c.Key == addOn.AddOnKey);
            var quantity = Math.Max(1, addOn.Quantity);
            var where = addOn.BranchId != null && shopNames.TryGetValue(addOn.BranchId.Value, out var shopName) ? $" ({shopName})" : "";
            var unitYearly = item != null && addOn.PricePKR == item.MonthlyPricePKR ? item.YearlyPricePKR : addOn.PricePKR * 10;
            wanted.Add(new WantedPart($"addon:{addOn.Id}", SubscriptionPartKind.AddOn,
                $"{item?.DisplayName ?? addOn.AddOnKey}{(quantity > 1 ? $" × {quantity}" : "")}{where}",
                addOn.BranchId, null, addOn.Id, null, addOn.PricePKR * quantity, unitYearly * quantity, addOn.CoveredUntil));
        }

        var existing = await _db.SubscriptionParts.IgnoreQueryFilters().Where(p => p.TenantId == tenantId).ToListAsync();
        // The first time a business's parts are made, an existing paid-up business keeps its
        // current date on every part — nothing it already paid for changes overnight.
        var firstSync = existing.Count == 0;

        void StartCoverage(SubscriptionPart part, DateTime? paidUpTo)
        {
            if (part.InstalledAt == null) return;
            if (tenant.IsTrialActive && part.InstalledAt <= tenant.TrialEndsAt)
                part.TrialEndsAt = tenant.TrialEndsAt;
            else if (firstSync && tenant.SubscriptionPaidUntil != null)
                part.PaidUntil = tenant.SubscriptionPaidUntil;
            // Bought and paid through an invoice before it was installed (an extra tablet, an add-on).
            if (paidUpTo != null && paidUpTo > (part.PaidUntil ?? DateTime.MinValue))
                part.PaidUntil = paidUpTo;
        }

        var resumed = false;
        foreach (var w in wanted)
        {
            var part = existing.FirstOrDefault(p => p.Key == w.Key);
            if (part == null)
            {
                part = new SubscriptionPart
                {
                    TenantId = tenantId, Key = w.Key, Kind = w.Kind,
                    // An add-on has no installation record of its own: it counts from when it was first seen.
                    InstalledAt = w.Kind == SubscriptionPartKind.AddOn ? now : w.InstalledAt
                };
                StartCoverage(part, w.PaidUpTo);
                _db.SubscriptionParts.Add(part);
                existing.Add(part);
            }
            else if (!part.IsActive)
            {
                part.IsActive = true;
                part.EndedAt = null;
            }

            // An outlet's first till arrived since the part was made: its billing starts now.
            if (part.InstalledAt == null && w.InstalledAt != null)
            {
                part.InstalledAt = w.InstalledAt;
                StartCoverage(part, w.PaidUpTo);
            }

            // The trial was extended since the part was made: the part rides along with it, so a
            // business still on its trial is never invoiced, reminded or stopped for it.
            if (tenant.IsTrialActive && part.InstalledAt != null && part.InstalledAt <= tenant.TrialEndsAt
                && (part.TrialEndsAt == null || part.TrialEndsAt < tenant.TrialEndsAt))
                part.TrialEndsAt = tenant.TrialEndsAt;

            // Covered again (trial extended, or a date set) — whatever was stopped runs again.
            if (part.StoppedAt != null && CoveredUntil(part) > now)
            {
                part.StoppedAt = null;
                resumed = true;
            }

            part.Name = w.Name;
            part.BranchId = w.BranchId;
            part.TerminalId = w.TerminalId;
            part.AddOnSubscriptionId = w.AddOnSubscriptionId;
            part.MonthlyPricePKR = w.MonthlyPrice;
            part.YearlyPricePKR = w.YearlyPrice;
            part.PricePKR = part.Annual ? w.YearlyPrice : w.MonthlyPrice;
        }

        // What is no longer there stops renewing; its history stays.
        var wantedKeys = wanted.Select(w => w.Key).ToHashSet();
        foreach (var gone in existing.Where(p => p.IsActive && !wantedKeys.Contains(p.Key)))
        {
            gone.IsActive = false;
            gone.EndedAt = now;
            gone.StoppedAt = null;
        }

        try
        {
            await _db.SaveChangesAsync();
            // A stopped add-on that runs again must switch back on at the tills.
            if (resumed) await _entitlements.RecomputeAsync(tenantId);
        }
        catch (DbUpdateException)
        {
            // Another request brought the same business up to date at the same moment (two screens
            // opening together); its rows stand, and the next look picks up anything missed.
            foreach (var entry in _db.ChangeTracker.Entries<SubscriptionPart>().ToList())
                entry.State = EntityState.Detached;
        }
    }

    public Task SyncAllAsync()
    {
        lock (SyncAllGate)
        {
            // Screens that open together (the dashboard asks three ways at once) wait for the one
            // pass already under way rather than reading the table half done.
            if (_syncAllRun is { IsCompleted: false }) return _syncAllRun;
            if (DateTime.UtcNow - _lastSyncAll < TimeSpan.FromMinutes(1)) return Task.CompletedTask;
            _lastSyncAll = DateTime.UtcNow;
            _syncAllRun = RunSyncAllAsync();
            return _syncAllRun;
        }
    }

    public Task SyncAllNowAsync()
    {
        lock (SyncAllGate)
        {
            if (_syncAllRun is { IsCompleted: false }) return _syncAllRun;
            _lastSyncAll = DateTime.UtcNow;
            _syncAllRun = RunSyncAllAsync();
            return _syncAllRun;
        }
    }

    private static Task? _syncAllRun;

    private async Task RunSyncAllAsync()
    {
        var tenantIds = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Status != TenantStatus.Cancelled)
            .Select(t => t.Id)
            .ToListAsync();
        foreach (var id in tenantIds)
        {
            try { await SyncAsync(id); }
            catch (Exception ex) { Console.WriteLine($"[Renewals] Could not bring tenant {id} up to date: {ex.Message}"); }
        }
    }

    public async Task<SubscriptionPart> SetPaidUntilAsync(Guid partId, DateTime paidUntil)
    {
        var part = await _db.SubscriptionParts.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == partId)
            ?? throw new InvalidOperationException("That part was not found.");
        if (!part.IsActive) throw new InvalidOperationException("This part is no longer in use, so it does not renew.");
        part.PaidUntil = DateTime.SpecifyKind(paidUntil, DateTimeKind.Utc);
        if (part.PaidUntil > DateTime.UtcNow) part.StoppedAt = null;

        await _db.SaveChangesAsync();
        await FollowOnBusinessAsync(part.TenantId);
        await _db.SaveChangesAsync();
        await _entitlements.RecomputeAsync(part.TenantId);
        return part;
    }

    public async Task CoverInvoiceAsync(SubscriptionInvoice invoice, Guid? purchasedAddOnId, bool purchasedPlan, bool purchaseAnnual)
    {
        await SyncAsync(invoice.TenantId);
        var parts = await _db.SubscriptionParts.IgnoreQueryFilters()
            .Where(p => p.TenantId == invoice.TenantId && p.IsActive)
            .ToListAsync();

        void Cover(SubscriptionPart part, DateTime until, bool? annual)
        {
            if (part.PaidUntil == null || part.PaidUntil < until) part.PaidUntil = until;
            if (annual != null)
            {
                part.Annual = annual.Value;
                part.PricePKR = annual.Value ? part.YearlyPricePKR : part.MonthlyPricePKR;
            }
            if (part.PaidUntil > DateTime.UtcNow) part.StoppedAt = null;
        }

        var lines = await _db.SubscriptionInvoiceParts.IgnoreQueryFilters()
            .Where(l => l.InvoiceId == invoice.Id).ToListAsync();
        if (lines.Count > 0)
        {
            // A renewal invoice: each part it lists, to the end of the period it paid for.
            foreach (var line in lines)
            {
                var part = parts.FirstOrDefault(p => p.Id == line.PartId);
                if (part != null) Cover(part, line.PeriodEnd, line.Annual);
            }
        }
        else if (purchasedAddOnId != null)
        {
            // An add-on bought and paid: its own part, from today to the end of what was paid.
            var addOn = await _db.AddOnSubscriptions.IgnoreQueryFilters().FirstOrDefaultAsync(a => a.Id == purchasedAddOnId);
            if (addOn != null) addOn.CoveredUntil = invoice.BillingPeriodEnd;
            var part = parts.FirstOrDefault(p => p.AddOnSubscriptionId == purchasedAddOnId);
            if (part != null) Cover(part, invoice.BillingPeriodEnd, purchaseAnnual);
        }
        else if (purchasedPlan)
        {
            // A plan bought and paid: the POS of every location that follows the business's plan.
            var followers = await _db.Branches.IgnoreQueryFilters()
                .Where(b => b.TenantId == invoice.TenantId && b.CanSell && b.PosEdition == null)
                .Select(b => b.Id).ToListAsync();
            var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == invoice.TenantId);
            foreach (var part in parts.Where(p => p.Kind == SubscriptionPartKind.Pos && p.BranchId != null
                         && (followers.Contains(p.BranchId.Value) || tenant?.DeploymentMode != DeploymentMode.HeadOffice)))
                Cover(part, invoice.BillingPeriodEnd, purchaseAnnual);
        }
        else if (string.IsNullOrWhiteSpace(invoice.EffectJson))
        {
            // An invoice from before invoices named their parts billed the whole business.
            foreach (var part in parts.Where(p => p.InstalledAt != null))
                Cover(part, invoice.BillingPeriodEnd, null);
        }

        await _db.SaveChangesAsync();
        await FollowOnBusinessAsync(invoice.TenantId);
        await _db.SaveChangesAsync();
    }

    public async Task<SubscriptionPart> SetStoppedAsync(Guid partId, bool stopped)
    {
        var part = await _db.SubscriptionParts.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == partId)
            ?? throw new InvalidOperationException("That part was not found.");
        if (!part.IsActive) throw new InvalidOperationException("This part is no longer in use.");
        part.StoppedAt = stopped ? part.StoppedAt ?? DateTime.UtcNow : null;
        await _db.SaveChangesAsync();
        await _entitlements.RecomputeAsync(part.TenantId);
        return part;
    }

    /// <summary>
    /// The business's own paid-until date is the latest paid part, and a business that fell past due
    /// is back in good standing once something it uses is paid. Restricted, read-only and suspended
    /// are support decisions and stay as they are.
    /// </summary>
    private async Task FollowOnBusinessAsync(Guid tenantId)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant == null) return;
        var latest = await _db.SubscriptionParts.IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId && p.IsActive && p.PaidUntil != null)
            .MaxAsync(p => (DateTime?)p.PaidUntil);
        if (latest == null) return;
        if (tenant.SubscriptionPaidUntil == null || tenant.SubscriptionPaidUntil < latest)
            tenant.SubscriptionPaidUntil = latest;
        if (tenant.Status == TenantStatus.PastDue && latest > DateTime.UtcNow)
        {
            tenant.Status = TenantStatus.Active;
            tenant.IsTrialActive = false;
        }
    }
}
