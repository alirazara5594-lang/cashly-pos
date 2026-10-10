using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// PLATFORM BILLING — one flow for the money
//
//   a part comes up for renewal  ->  an invoice for it (raised by itself, or by hand)
//   ->  payments recorded against the invoice, one by one, with method and reference
//   ->  once paid in full, each part it lists moves on to the end of the period it paid for.
//
// Around that: invoices past their due date are marked overdue, customers get reminders on
// WhatsApp and email, and — only when switched on in Settings — a part still unpaid a set number
// of days after it fell due is stopped on its own, never the rest of the business.
// ============================================================

/// <summary>Small helpers every billing path shares: settings, invoice numbers, tax, phone numbers.</summary>
public static class PlatformInvoicing
{
    /// <summary>The settings row, created with its defaults if it is not there yet.</summary>
    public static async Task<PlatformSettings> SettingsAsync(AppDbContext db)
    {
        var settings = await db.PlatformSettings.FirstOrDefaultAsync(s => s.Id == 1);
        if (settings != null) return settings;
        settings = new PlatformSettings();
        db.PlatformSettings.Add(settings);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException)
        {
            db.Entry(settings).State = EntityState.Detached;
            settings = await db.PlatformSettings.FirstAsync(s => s.Id == 1);
        }
        return settings;
    }

    /// <summary>
    /// The next invoice number, from one counter for the whole platform bumped in the database, so two
    /// invoices raised at the same moment can never share a number. The first call carries on from
    /// the highest number already issued.
    /// </summary>
    public static async Task<string> NextInvoiceNumberAsync(AppDbContext db)
    {
        const string key = "subscription-invoice";
        var platform = Guid.Empty;
        var bumped = await db.Database.SqlQuery<long>($@"
            UPDATE ""DocumentSequences"" SET ""LastValue"" = ""LastValue"" + 1, ""UpdatedAt"" = now()
            WHERE ""TenantId"" = {platform} AND ""SequenceKey"" = {key}
            RETURNING ""LastValue"" AS ""Value""").ToListAsync();
        if (bumped.Count > 0) return $"INV-{bumped[0]:00000}";

        var numbers = await db.SubscriptionInvoices.IgnoreQueryFilters().Select(i => i.InvoiceNumber).ToListAsync();
        var highest = numbers
            .Select(n => new string(n.Reverse().TakeWhile(char.IsDigit).Reverse().ToArray()))
            .Select(d => long.TryParse(d, out var v) ? v : 0)
            .DefaultIfEmpty(0).Max();
        var inserted = await db.Database.SqlQuery<long>($@"
            INSERT INTO ""DocumentSequences"" (""TenantId"", ""SequenceKey"", ""LastValue"", ""UpdatedAt"")
            VALUES ({platform}, {key}, {highest + 1}, now())
            ON CONFLICT (""TenantId"", ""SequenceKey"")
            DO UPDATE SET ""LastValue"" = ""DocumentSequences"".""LastValue"" + 1, ""UpdatedAt"" = now()
            RETURNING ""LastValue"" AS ""Value""").ToListAsync();
        return $"INV-{inserted[0]:00000}";
    }

    /// <summary>Tax on a subtotal at the platform's rate, rounded to whole rupees.</summary>
    public static decimal TaxOn(decimal subtotal, PlatformSettings settings) =>
        settings.TaxRatePercent <= 0 ? 0 : Math.Round(subtotal * settings.TaxRatePercent / 100m, 0, MidpointRounding.AwayFromZero);

    /// <summary>A mobile number as WhatsApp wants it: digits with the country code (0300… becomes 92300…).</summary>
    public static string? WhatsAppNumber(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.Length < 10) return null;
        if (digits.StartsWith("00")) digits = digits[2..];
        else if (digits.StartsWith("0")) digits = "92" + digits[1..];
        return digits;
    }

    public static string Money(decimal amount) => $"PKR {Math.Round(amount, 0):N0}";

    /// <summary>How to pay, as plain lines for a message or an invoice.</summary>
    public static List<string> PaymentLines(PlatformSettings s)
    {
        var lines = new List<string>();
        if (!string.IsNullOrWhiteSpace(s.BankName) || !string.IsNullOrWhiteSpace(s.BankIban) || !string.IsNullOrWhiteSpace(s.BankAccountNumber))
        {
            var bank = string.Join(", ", new[] { s.BankName, s.BankAccountTitle }.Where(x => !string.IsNullOrWhiteSpace(x)));
            var account = !string.IsNullOrWhiteSpace(s.BankIban) ? $"IBAN {s.BankIban}" : $"Account {s.BankAccountNumber}";
            lines.Add($"Bank: {bank} — {account}");
        }
        if (!string.IsNullOrWhiteSpace(s.JazzCashNumber)) lines.Add($"JazzCash: {s.JazzCashNumber}");
        if (!string.IsNullOrWhiteSpace(s.EasypaisaNumber)) lines.Add($"Easypaisa: {s.EasypaisaNumber}");
        if (!string.IsNullOrWhiteSpace(s.RaastId)) lines.Add($"Raast: {s.RaastId}");
        if (!string.IsNullOrWhiteSpace(s.PaymentInstructions)) lines.Add(s.PaymentInstructions.Trim());
        return lines;
    }
}

/// <summary>One part to put on an invoice: how many periods, and monthly or yearly (null = as it renews now).</summary>
public sealed record PartRenewal(Guid PartId, int Periods = 1, bool? Annual = null);

public sealed record AutomationReport(int InvoicesRaised, int MarkedOverdue, int RemindersSent, int PartsStopped, DateTime RanAt, List<string> Notes);

public interface IPlatformBilling
{
    /// <summary>Raises one invoice for the given parts, each from the end of what it already covers.</summary>
    Task<SubscriptionInvoice> InvoicePartsAsync(Guid tenantId, IReadOnlyList<PartRenewal> parts, Guid? actorId, string actorName,
        bool automatic = false, decimal? agreedSubtotal = null, string? notes = null);

    /// <summary>Records money received. Paid in full, the invoice settles and what it was for moves on.</summary>
    Task<(SubscriptionInvoice Invoice, SubscriptionPayment Payment)> RecordPaymentAsync(Guid invoiceId, decimal amount, string method,
        string? reference, DateTime? receivedAt, string? notes, Guid? actorId, string actorName);

    /// <summary>Records money given back. It does not undo what was paid for.</summary>
    Task<SubscriptionPayment> RecordRefundAsync(Guid invoiceId, decimal amount, string method, string? reference, string? notes, Guid? actorId, string actorName);

    /// <summary>Takes back a payment recorded by mistake.</summary>
    Task<SubscriptionInvoice> VoidPaymentAsync(Guid paymentId, string reason, Guid? actorId, string actorName);

    Task<SubscriptionInvoice> CancelInvoiceAsync(Guid invoiceId, string? reason, Guid? actorId, string actorName);

    /// <summary>Raise due invoices, mark overdue ones, send reminders, stop parts left unpaid.</summary>
    Task<AutomationReport> RunAutomationAsync();

    /// <summary>A message to a business's owner on WhatsApp and email, logged either way.</summary>
    Task<(int Sent, int NotSent)> SendToBusinessAsync(Guid tenantId, string kind, string subject, string text, Guid? invoiceId, string? sentBy);

    /// <summary>Tries the platform's WhatsApp line and email with a test message.</summary>
    Task<List<PlatformMessage>> SendTestAsync(string? phone, string? email, string sentBy);
}

public class PlatformBillingService : IPlatformBilling
{
    private static readonly SemaphoreSlim AutomationGate = new(1, 1);

    private readonly AppDbContext _db;
    private readonly ISubscriptionPartsService _parts;
    private readonly ISubscriptionCheckout _checkout;
    private readonly IEntitlementService _entitlements;
    private readonly IWhatsAppSenderResolver _whatsApp;
    private readonly IEmailSender _email;
    private readonly SecretProtector _protector;

    public PlatformBillingService(AppDbContext db, ISubscriptionPartsService parts, ISubscriptionCheckout checkout,
        IEntitlementService entitlements, IWhatsAppSenderResolver whatsApp, IEmailSender email, SecretProtector protector)
    {
        _db = db;
        _parts = parts;
        _checkout = checkout;
        _entitlements = entitlements;
        _whatsApp = whatsApp;
        _email = email;
        _protector = protector;
    }

    private static readonly SubscriptionInvoiceStatus[] OpenStatuses =
        { SubscriptionInvoiceStatus.Pending, SubscriptionInvoiceStatus.Overdue, SubscriptionInvoiceStatus.PartiallyPaid };

    private void Audit(Guid tenantId, Guid? actorId, string actorName, string action, string entityType, Guid? entityId, string? oldValue, string? newValue) =>
        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId, UserId = actorId ?? Guid.Empty, UserName = actorName, Action = action,
            EntityType = entityType, EntityId = entityId, OldValue = oldValue, NewValue = newValue, CreatedAt = DateTime.UtcNow
        });

    // ---------------------------------------------------------
    // Invoices
    // ---------------------------------------------------------

    public async Task<SubscriptionInvoice> InvoicePartsAsync(Guid tenantId, IReadOnlyList<PartRenewal> requests, Guid? actorId, string actorName,
        bool automatic = false, decimal? agreedSubtotal = null, string? notes = null)
    {
        if (requests.Count == 0) throw new InvalidOperationException("Pick at least one thing to invoice.");
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId)
            ?? throw new InvalidOperationException("That business was not found.");
        if (!automatic) await _parts.SyncAsync(tenantId);

        var settings = await PlatformInvoicing.SettingsAsync(_db);
        var ids = requests.Select(r => r.PartId).Distinct().ToList();
        var parts = await _db.SubscriptionParts.IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId && ids.Contains(p.Id)).ToListAsync();
        if (parts.Count != ids.Count) throw new InvalidOperationException("One of those parts does not belong to this business.");

        var open = await (from line in _db.SubscriptionInvoiceParts.IgnoreQueryFilters()
                          join inv in _db.SubscriptionInvoices.IgnoreQueryFilters() on line.InvoiceId equals inv.Id
                          where ids.Contains(line.PartId) && OpenStatuses.Contains(inv.Status)
                          select new { line.PartId, inv.InvoiceNumber }).ToListAsync();

        var now = DateTime.UtcNow;
        var lines = new List<SubscriptionInvoicePart>();
        foreach (var request in requests)
        {
            var part = parts.First(p => p.Id == request.PartId);
            if (!part.IsActive) throw new InvalidOperationException($"{part.Name} is no longer in use, so it does not renew.");
            if (part.InstalledAt == null) throw new InvalidOperationException($"{part.Name} has no till yet, so there is nothing to bill.");
            var already = open.FirstOrDefault(o => o.PartId == part.Id);
            if (already != null) throw new InvalidOperationException($"{part.Name} is already on {already.InvoiceNumber}, which is not paid yet.");

            var annual = request.Annual ?? part.Annual;
            var periods = Math.Clamp(request.Periods, 1, 36);
            var start = SubscriptionPartsService.NextPeriodStart(part)!.Value;
            var end = annual ? start.AddYears(periods) : start.AddMonths(periods);
            var unit = annual ? part.YearlyPricePKR : part.MonthlyPricePKR;
            if (unit <= 0) unit = part.PricePKR;
            lines.Add(new SubscriptionInvoicePart
            {
                TenantId = tenantId, PartId = part.Id, PeriodStart = start, PeriodEnd = end, Annual = annual,
                AmountPKR = unit * periods,
                Description = $"{part.Name} — {(annual ? "yearly" : "monthly")}{(periods > 1 ? $" × {periods}" : "")}, {start:d MMM yyyy} to {end:d MMM yyyy}"
            });
        }

        var listTotal = lines.Sum(l => l.AmountPKR);
        var subtotal = agreedSubtotal ?? listTotal;
        if (subtotal < 0) throw new InvalidOperationException("The amount cannot be negative.");
        var tax = PlatformInvoicing.TaxOn(subtotal, settings);

        var invoiceLines = lines.Select(l => (object)new
        {
            description = l.Description, quantity = 1, unitPricePKR = l.AmountPKR, amountPKR = l.AmountPKR, kind = "part", partId = l.PartId
        }).ToList();
        if (agreedSubtotal != null && agreedSubtotal.Value != listTotal)
            invoiceLines.Add(new { description = "Agreed price adjustment", quantity = 1, unitPricePKR = agreedSubtotal.Value - listTotal, amountPKR = agreedSubtotal.Value - listTotal, kind = "adjustment" });
        if (tax > 0)
            invoiceLines.Add(new { description = $"{settings.TaxLabel} {settings.TaxRatePercent:0.##}%", quantity = 1, unitPricePKR = tax, amountPKR = tax, kind = "tax" });

        var firstStart = lines.Min(l => l.PeriodStart);
        var invoice = new SubscriptionInvoice
        {
            TenantId = tenantId,
            InvoiceNumber = await PlatformInvoicing.NextInvoiceNumberAsync(_db),
            Tier = lines.Count == 1 ? parts.First(p => p.Id == lines[0].PartId).Name : $"{lines.Count} renewals",
            BillingPeriodStart = firstStart,
            BillingPeriodEnd = lines.Max(l => l.PeriodEnd),
            SubtotalPKR = subtotal,
            TaxPKR = tax,
            TaxRatePercent = settings.TaxRatePercent,
            AmountPKR = subtotal + tax,
            Status = SubscriptionInvoiceStatus.Pending,
            IssuedAt = now,
            // Due on the renewal date when that is still ahead; otherwise a few days from today.
            DueAt = firstStart > now.AddDays(1) ? firstStart : now.AddDays(Math.Max(1, settings.InvoiceDueDays)),
            Notes = notes,
            Kind = "renewal",
            LinesJson = JsonSerializer.Serialize(invoiceLines)
        };
        _db.SubscriptionInvoices.Add(invoice);
        foreach (var line in lines) line.InvoiceId = invoice.Id;
        _db.SubscriptionInvoiceParts.AddRange(lines);
        Audit(tenantId, actorId, actorName, "SubscriptionInvoiceIssued", "SubscriptionInvoice", invoice.Id, null,
            $"{invoice.InvoiceNumber}: {PlatformInvoicing.Money(invoice.AmountPKR)}{(automatic ? " (raised automatically)" : "")}");
        await _db.SaveChangesAsync();
        return invoice;
    }

    // ---------------------------------------------------------
    // Payments
    // ---------------------------------------------------------

    public async Task<(SubscriptionInvoice Invoice, SubscriptionPayment Payment)> RecordPaymentAsync(Guid invoiceId, decimal amount, string method,
        string? reference, DateTime? receivedAt, string? notes, Guid? actorId, string actorName)
    {
        var invoice = await _db.SubscriptionInvoices.IgnoreQueryFilters().FirstOrDefaultAsync(i => i.Id == invoiceId)
            ?? throw new InvalidOperationException("That invoice was not found.");
        if (invoice.Status == SubscriptionInvoiceStatus.Cancelled) throw new InvalidOperationException("This invoice was cancelled.");
        if (invoice.Status == SubscriptionInvoiceStatus.Paid) throw new InvalidOperationException("This invoice is already paid.");
        if (amount <= 0) throw new InvalidOperationException("Enter the amount received.");
        if (string.IsNullOrWhiteSpace(method)) throw new InvalidOperationException("Say how it was paid.");

        var payment = new SubscriptionPayment
        {
            TenantId = invoice.TenantId, InvoiceId = invoice.Id, Kind = "Payment", AmountPKR = amount,
            Method = method.Trim(), Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim(),
            ReceivedAt = receivedAt.HasValue ? DateTime.SpecifyKind(receivedAt.Value, DateTimeKind.Utc) : DateTime.UtcNow,
            Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(),
            RecordedByUserId = actorId, RecordedByName = actorName
        };
        _db.SubscriptionPayments.Add(payment);
        invoice.PaidPKR += amount;
        invoice.PaymentMethod = payment.Method;
        Audit(invoice.TenantId, actorId, actorName, "SubscriptionPaymentRecorded", "SubscriptionInvoice", invoice.Id, null,
            $"{invoice.InvoiceNumber}: {PlatformInvoicing.Money(amount)} by {payment.Method}{(payment.Reference != null ? $" (ref {payment.Reference})" : "")}");

        // Within a rupee of the total counts as paid in full (rounding on the customer's side).
        if (invoice.PaidPKR >= invoice.AmountPKR - 1m)
        {
            await _db.SaveChangesAsync();
            await _checkout.SettleAsync(invoice, payment.Method, actorId);
        }
        else
        {
            invoice.Status = SubscriptionInvoiceStatus.PartiallyPaid;
            await _db.SaveChangesAsync();
        }

        var settings = await PlatformInvoicing.SettingsAsync(_db);
        if (settings.AutoReminders)
        {
            var left = invoice.AmountPKR - invoice.PaidPKR;
            var text = left > 1m
                ? $"Thank you — we received {PlatformInvoicing.Money(amount)} for invoice {invoice.InvoiceNumber}. {PlatformInvoicing.Money(left)} is still due."
                : $"Thank you — we received {PlatformInvoicing.Money(amount)} and invoice {invoice.InvoiceNumber} is now paid in full.";
            try { await SendToBusinessAsync(invoice.TenantId, "payment", $"Payment received — {invoice.InvoiceNumber}", text, invoice.Id, actorName); }
            catch (Exception ex) { Console.WriteLine($"[Billing] Receipt message failed: {ex.Message}"); }
        }
        return (invoice, payment);
    }

    public async Task<SubscriptionPayment> RecordRefundAsync(Guid invoiceId, decimal amount, string method, string? reference, string? notes, Guid? actorId, string actorName)
    {
        var invoice = await _db.SubscriptionInvoices.IgnoreQueryFilters().FirstOrDefaultAsync(i => i.Id == invoiceId)
            ?? throw new InvalidOperationException("That invoice was not found.");
        if (amount <= 0) throw new InvalidOperationException("Enter the amount given back.");
        var received = await _db.SubscriptionPayments.IgnoreQueryFilters()
            .Where(p => p.InvoiceId == invoiceId && p.VoidedAt == null)
            .SumAsync(p => p.Kind == "Refund" ? -p.AmountPKR : p.AmountPKR);
        if (amount > received) throw new InvalidOperationException($"Only {PlatformInvoicing.Money(received)} was received on this invoice.");

        var refund = new SubscriptionPayment
        {
            TenantId = invoice.TenantId, InvoiceId = invoice.Id, Kind = "Refund", AmountPKR = amount,
            Method = string.IsNullOrWhiteSpace(method) ? "Refund" : method.Trim(),
            Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim(),
            Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(),
            RecordedByUserId = actorId, RecordedByName = actorName
        };
        _db.SubscriptionPayments.Add(refund);
        Audit(invoice.TenantId, actorId, actorName, "SubscriptionRefundRecorded", "SubscriptionInvoice", invoice.Id, null,
            $"{invoice.InvoiceNumber}: {PlatformInvoicing.Money(amount)} given back{(refund.Notes != null ? $" — {refund.Notes}" : "")}");
        await _db.SaveChangesAsync();
        return refund;
    }

    public async Task<SubscriptionInvoice> VoidPaymentAsync(Guid paymentId, string reason, Guid? actorId, string actorName)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw new InvalidOperationException("Say why this payment is being taken back.");
        var payment = await _db.SubscriptionPayments.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == paymentId)
            ?? throw new InvalidOperationException("That payment was not found.");
        if (payment.VoidedAt != null) throw new InvalidOperationException("This payment was already taken back.");
        var invoice = payment.InvoiceId == null ? null
            : await _db.SubscriptionInvoices.IgnoreQueryFilters().FirstOrDefaultAsync(i => i.Id == payment.InvoiceId);
        if (invoice == null) throw new InvalidOperationException("This payment is not on an invoice.");

        if (payment.Kind == "Payment" && invoice.Status == SubscriptionInvoiceStatus.Paid)
        {
            if (!string.IsNullOrWhiteSpace(invoice.EffectJson))
                throw new InvalidOperationException("What this invoice bought is already switched on. Record a refund instead.");

            // The parts this invoice moved go back to where they were, unless paid further since.
            var lines = await _db.SubscriptionInvoiceParts.IgnoreQueryFilters().Where(l => l.InvoiceId == invoice.Id).ToListAsync();
            var partIds = lines.Select(l => l.PartId).ToList();
            var parts = await _db.SubscriptionParts.IgnoreQueryFilters().Where(p => partIds.Contains(p.Id)).ToListAsync();
            foreach (var line in lines)
            {
                var part = parts.FirstOrDefault(p => p.Id == line.PartId);
                if (part != null && part.PaidUntil == line.PeriodEnd)
                    part.PaidUntil = line.PeriodStart > (part.TrialEndsAt ?? DateTime.MinValue) ? line.PeriodStart : null;
            }
            invoice.PaidAt = null;
        }

        payment.VoidedAt = DateTime.UtcNow;
        payment.VoidReason = reason.Trim();
        if (payment.Kind == "Payment")
        {
            invoice.PaidPKR = Math.Max(0, invoice.PaidPKR - payment.AmountPKR);
            invoice.Status = invoice.PaidPKR > 0 ? SubscriptionInvoiceStatus.PartiallyPaid
                : invoice.DueAt < DateTime.UtcNow ? SubscriptionInvoiceStatus.Overdue : SubscriptionInvoiceStatus.Pending;
        }
        Audit(invoice.TenantId, actorId, actorName, "SubscriptionPaymentVoided", "SubscriptionInvoice", invoice.Id,
            PlatformInvoicing.Money(payment.AmountPKR), reason.Trim());
        await _db.SaveChangesAsync();
        await _entitlements.RecomputeAsync(invoice.TenantId);
        return invoice;
    }

    public async Task<SubscriptionInvoice> CancelInvoiceAsync(Guid invoiceId, string? reason, Guid? actorId, string actorName)
    {
        var invoice = await _db.SubscriptionInvoices.IgnoreQueryFilters().FirstOrDefaultAsync(i => i.Id == invoiceId)
            ?? throw new InvalidOperationException("That invoice was not found.");
        if (invoice.Status == SubscriptionInvoiceStatus.Paid) throw new InvalidOperationException("A paid invoice cannot be cancelled.");
        if (invoice.PaidPKR > 0) throw new InvalidOperationException("Money was already received on this invoice. Take the payment back first.");
        invoice.Status = SubscriptionInvoiceStatus.Cancelled;
        Audit(invoice.TenantId, actorId, actorName, "SubscriptionInvoiceCancelled", "SubscriptionInvoice", invoice.Id, null,
            $"{invoice.InvoiceNumber}{(string.IsNullOrWhiteSpace(reason) ? "" : $" — {reason.Trim()}")}");
        await _db.SaveChangesAsync();
        return invoice;
    }

    // ---------------------------------------------------------
    // Automation
    // ---------------------------------------------------------

    public async Task<AutomationReport> RunAutomationAsync()
    {
        if (!await AutomationGate.WaitAsync(TimeSpan.FromSeconds(1)))
            return new AutomationReport(0, 0, 0, 0, DateTime.UtcNow, new List<string> { "Already running — try again in a minute." });
        try
        {
            var notes = new List<string>();
            await _parts.SyncAllNowAsync();
            var settings = await PlatformInvoicing.SettingsAsync(_db);
            var raised = settings.AutoInvoice ? await RaiseDueInvoicesAsync(settings, notes) : 0;
            var overdue = await MarkOverdueAsync();
            var reminded = settings.AutoReminders ? await SendRemindersAsync(settings, notes) : 0;
            var stopped = settings.AutoStopUnpaid ? await StopUnpaidPartsAsync(settings, notes) : 0;
            return new AutomationReport(raised, overdue, reminded, stopped, DateTime.UtcNow, notes);
        }
        finally
        {
            AutomationGate.Release();
        }
    }

    /// <summary>Businesses whose parts are billed: not closed, not switched off.</summary>
    private IQueryable<Guid> BilledTenantIds() =>
        _db.Tenants.IgnoreQueryFilters()
            .Where(t => t.IsActive && t.Status != TenantStatus.Cancelled && t.Status != TenantStatus.Suspended)
            .Select(t => t.Id);

    private async Task<List<SubscriptionPart>> BillablePartsAsync() =>
        await _db.SubscriptionParts.IgnoreQueryFilters()
            .Where(p => p.IsActive && p.InstalledAt != null && (p.MonthlyPricePKR > 0 || p.YearlyPricePKR > 0 || p.PricePKR > 0)
                        && BilledTenantIds().Contains(p.TenantId))
            .ToListAsync();

    private async Task<int> RaiseDueInvoicesAsync(PlatformSettings settings, List<string> notes)
    {
        var horizon = DateTime.UtcNow.AddDays(Math.Max(0, settings.InvoiceDaysBefore));
        var parts = (await BillablePartsAsync())
            .Where(p => SubscriptionPartsService.NextPeriodStart(p) is DateTime start && start <= horizon)
            .ToList();
        if (parts.Count == 0) return 0;

        var partIds = parts.Select(p => p.Id).ToList();
        var onOpenInvoice = (await (from line in _db.SubscriptionInvoiceParts.IgnoreQueryFilters()
                                    join inv in _db.SubscriptionInvoices.IgnoreQueryFilters() on line.InvoiceId equals inv.Id
                                    where partIds.Contains(line.PartId) && OpenStatuses.Contains(inv.Status)
                                    select line.PartId).ToListAsync()).ToHashSet();

        var raised = 0;
        // Parts of one business renewing on the same day share an invoice; each other date gets its own.
        foreach (var group in parts.Where(p => !onOpenInvoice.Contains(p.Id))
                     .GroupBy(p => new { p.TenantId, Day = SubscriptionPartsService.NextPeriodStart(p)!.Value.Date }))
        {
            try
            {
                var invoice = await InvoicePartsAsync(group.Key.TenantId,
                    group.Select(p => new PartRenewal(p.Id, 1, p.Annual)).ToList(), null, "Cashly (automatic)", automatic: true);
                raised++;
                await SendInvoiceMessageAsync(invoice, settings);
            }
            catch (Exception ex)
            {
                _db.ChangeTracker.Clear();
                notes.Add($"Could not invoice business {group.Key.TenantId}: {ex.Message}");
            }
        }
        return raised;
    }

    private async Task<int> MarkOverdueAsync()
    {
        var now = DateTime.UtcNow;
        var late = await _db.SubscriptionInvoices.IgnoreQueryFilters()
            .Where(i => (i.Status == SubscriptionInvoiceStatus.Pending || i.Status == SubscriptionInvoiceStatus.PartiallyPaid) && i.DueAt < now)
            .ToListAsync();
        foreach (var invoice in late) invoice.Status = SubscriptionInvoiceStatus.Overdue;
        if (late.Count > 0) await _db.SaveChangesAsync();
        return late.Count;
    }

    private static List<int> ReminderOffsets(PlatformSettings settings) =>
        (settings.ReminderDays ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var n) ? (int?)n : null)
            .Where(n => n != null && n.Value is >= -60 and <= 60)
            .Select(n => n!.Value)
            .Distinct()
            .OrderByDescending(n => n)
            .ToList();

    private async Task<int> SendRemindersAsync(PlatformSettings settings, List<string> notes)
    {
        var offsets = ReminderOffsets(settings);
        if (offsets.Count == 0) return 0;
        var today = DateTime.UtcNow.Date;
        var parts = await BillablePartsAsync();
        var partIds = parts.Select(p => p.Id).ToList();
        var marks = (await _db.SubscriptionReminderMarks.AsNoTracking()
                .Where(m => partIds.Contains(m.PartId)).Select(m => new { m.PartId, m.Key }).ToListAsync())
            .Select(m => $"{m.PartId}|{m.Key}").ToHashSet();

        // For each part, the latest reminder now due that has not gone out. Several missed at once
        // (the server was off) send one message, not a burst.
        var due = new List<(SubscriptionPart Part, int Offset, DateTime RenewsAt)>();
        foreach (var part in parts)
        {
            var renewsAt = SubscriptionPartsService.NextPeriodStart(part);
            if (renewsAt == null) continue;
            var daysTo = (renewsAt.Value.Date - today).Days;
            var applicable = offsets.Where(o => daysTo <= o).ToList();
            if (applicable.Count == 0) continue;
            var keys = applicable.Select(o => $"{o}:{renewsAt.Value:yyyyMMdd}").ToList();
            if (keys.All(k => marks.Contains($"{part.Id}|{k}"))) continue;
            foreach (var key in keys.Where(k => !marks.Contains($"{part.Id}|{k}")))
                _db.SubscriptionReminderMarks.Add(new SubscriptionReminderMark { PartId = part.Id, Key = key });
            due.Add((part, applicable.Min(), renewsAt.Value));
        }
        if (due.Count == 0) return 0;
        await _db.SaveChangesAsync();

        var sent = 0;
        foreach (var business in due.GroupBy(d => d.Part.TenantId))
        {
            var openInvoices = await _db.SubscriptionInvoices.IgnoreQueryFilters()
                .Where(i => i.TenantId == business.Key && OpenStatuses.Contains(i.Status))
                .OrderBy(i => i.DueAt).ToListAsync();
            var text = new StringBuilder();
            foreach (var (part, _, renewsAt) in business.OrderBy(d => d.RenewsAt))
            {
                var daysTo = (renewsAt.Date - today).Days;
                text.AppendLine(daysTo > 0
                    ? $"• {part.Name} renews on {renewsAt:d MMM yyyy} ({daysTo} day{(daysTo == 1 ? "" : "s")} left) — {PlatformInvoicing.Money(part.PricePKR)}"
                    : daysTo == 0
                        ? $"• {part.Name} renews today — {PlatformInvoicing.Money(part.PricePKR)}"
                        : $"• {part.Name} was due on {renewsAt:d MMM yyyy} ({-daysTo} day{(daysTo == -1 ? "" : "s")} ago) — {PlatformInvoicing.Money(part.PricePKR)}");
            }
            foreach (var invoice in openInvoices)
                text.AppendLine($"Invoice {invoice.InvoiceNumber}: {PlatformInvoicing.Money(invoice.AmountPKR - invoice.PaidPKR)} due by {invoice.DueAt:d MMM yyyy}.");
            if (settings.AutoStopUnpaid && business.Any(d => (d.RenewsAt.Date - today).Days < 0))
                text.AppendLine($"Anything still unpaid {settings.StopAfterDays} days after its date is paused until it is paid.");

            try
            {
                var (delivered, _) = await SendToBusinessAsync(business.Key, "reminder", "Your Cashly renewal", text.ToString().TrimEnd(), openInvoices.FirstOrDefault()?.Id, "Cashly (automatic)");
                if (delivered > 0) sent++;
            }
            catch (Exception ex) { notes.Add($"Reminder to business {business.Key} failed: {ex.Message}"); }
        }
        return sent;
    }

    private async Task<int> StopUnpaidPartsAsync(PlatformSettings settings, List<string> notes)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(-Math.Max(0, settings.StopAfterDays));
        var lapsed = (await BillablePartsAsync())
            .Where(p => p.StoppedAt == null && SubscriptionPartsService.NextPeriodStart(p) is DateTime start && start <= cutoff)
            .ToList();
        if (lapsed.Count == 0) return 0;

        // A promise to pay with a date still ahead holds the stop for that business.
        var tenantIds = lapsed.Select(p => p.TenantId).Distinct().ToList();
        var held = (await _db.TenantNotes.IgnoreQueryFilters()
                .Where(n => tenantIds.Contains(n.TenantId) && n.Kind == "Promise" && n.DoneAt == null && n.FollowUpAt > now)
                .Select(n => n.TenantId).ToListAsync()).ToHashSet();

        var stopped = 0;
        foreach (var business in lapsed.Where(p => !held.Contains(p.TenantId)).GroupBy(p => p.TenantId))
        {
            foreach (var part in business)
            {
                part.StoppedAt = now;
                Audit(part.TenantId, null, "Cashly (automatic)", "SubscriptionPartStopped", "SubscriptionPart", part.Id, null,
                    $"{part.Name} — unpaid {settings.StopAfterDays}+ days after it fell due");
                stopped++;
            }
            await _db.SaveChangesAsync();
            await _entitlements.RecomputeAsync(business.Key);

            var text = "These are paused until they are paid:\n" + string.Join("\n", business.Select(p => $"• {p.Name}"))
                       + "\nEverything else keeps working. Renew from Plan & Add-ons, or pay the open invoice and we will switch them back on.";
            try { await SendToBusinessAsync(business.Key, "stopped", "Paused for non-payment", text, null, "Cashly (automatic)"); }
            catch (Exception ex) { notes.Add($"Stop notice to business {business.Key} failed: {ex.Message}"); }
        }
        if (held.Count > 0) notes.Add($"{held.Count} business(es) not stopped: they promised to pay by a date still ahead.");
        return stopped;
    }

    private async Task SendInvoiceMessageAsync(SubscriptionInvoice invoice, PlatformSettings settings)
    {
        if (!settings.AutoReminders) return;
        var lines = await _db.SubscriptionInvoiceParts.IgnoreQueryFilters().Where(l => l.InvoiceId == invoice.Id).ToListAsync();
        var text = new StringBuilder();
        text.AppendLine($"Invoice {invoice.InvoiceNumber} for {PlatformInvoicing.Money(invoice.AmountPKR)}, due by {invoice.DueAt:d MMM yyyy}:");
        foreach (var line in lines) text.AppendLine($"• {line.Description} — {PlatformInvoicing.Money(line.AmountPKR)}");
        if (invoice.TaxPKR > 0) text.AppendLine($"• {settings.TaxLabel}: {PlatformInvoicing.Money(invoice.TaxPKR)}");
        try { await SendToBusinessAsync(invoice.TenantId, "invoice", $"Invoice {invoice.InvoiceNumber}", text.ToString().TrimEnd(), invoice.Id, "Cashly (automatic)"); }
        catch (Exception ex) { Console.WriteLine($"[Billing] Invoice message failed: {ex.Message}"); }
    }

    // ---------------------------------------------------------
    // Messages
    // ---------------------------------------------------------

    private WhatsAppConfig PlatformWhatsApp(PlatformSettings s) => new()
    {
        TenantId = Guid.Empty,
        Provider = s.WhatsAppProvider,
        ApiKey = _protector.Unprotect(s.WhatsAppApiKey),
        ApiSecret = _protector.Unprotect(s.WhatsAppApiSecret),
        PhoneNumberId = s.WhatsAppPhoneNumberId,
        AccessToken = _protector.Unprotect(s.WhatsAppAccessToken),
        IsEnabled = true
    };

    private async Task<PlatformMessage> SendWhatsAppAsync(PlatformSettings settings, Guid? tenantId, Guid? invoiceId, string? phone, string kind, string body, string? sentBy)
    {
        var message = new PlatformMessage
        {
            TenantId = tenantId, InvoiceId = invoiceId, Channel = "whatsapp", Recipient = phone ?? "",
            Kind = kind, Body = body, SentByName = sentBy
        };
        var number = PlatformInvoicing.WhatsAppNumber(phone);
        var sender = _whatsApp.Resolve(settings.WhatsAppProvider);
        if (number == null)
        {
            message.Status = "skipped";
            message.Error = "No mobile number on file.";
        }
        else if (sender == null || string.Equals(settings.WhatsAppProvider, "Manual", StringComparison.OrdinalIgnoreCase))
        {
            message.Status = "skipped";
            message.Error = "No WhatsApp line is connected (Platform Settings → Messages).";
        }
        else
        {
            var result = await sender.SendAsync(PlatformWhatsApp(settings), number, body);
            message.Status = result.Success ? "sent" : "failed";
            message.Error = result.ErrorMessage;
        }
        _db.PlatformMessages.Add(message);
        return message;
    }

    private async Task<PlatformMessage> SendEmailAsync(PlatformSettings settings, Guid? tenantId, Guid? invoiceId, string? address, string kind, string subject, string body, string? sentBy)
    {
        var message = new PlatformMessage
        {
            TenantId = tenantId, InvoiceId = invoiceId, Channel = "email", Recipient = address ?? "",
            Kind = kind, Subject = subject, Body = body, SentByName = sentBy
        };
        if (string.IsNullOrWhiteSpace(address) || !address.Contains('@'))
        {
            message.Status = "skipped";
            message.Error = "No email address on file.";
        }
        else if (!settings.EmailReminders || !_email.CanSend)
        {
            message.Status = "skipped";
            message.Error = _email.CanSend ? "Email messages are switched off in Platform Settings." : "Email is not set up on the server.";
        }
        else
        {
            try
            {
                var html = "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.6\">"
                           + string.Join("<br>", body.Split('\n').Select(System.Net.WebUtility.HtmlEncode)) + "</div>";
                await _email.SendAsync(address, subject, html, body);
                message.Status = "sent";
            }
            catch (Exception ex)
            {
                message.Status = "failed";
                message.Error = ex.Message;
            }
        }
        _db.PlatformMessages.Add(message);
        return message;
    }

    public async Task<(int Sent, int NotSent)> SendToBusinessAsync(Guid tenantId, string kind, string subject, string text, Guid? invoiceId, string? sentBy)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant == null) return (0, 0);
        var settings = await PlatformInvoicing.SettingsAsync(_db);

        var greeting = string.IsNullOrWhiteSpace(tenant.ContactName) ? "Assalam o Alaikum," : $"Assalam o Alaikum {tenant.ContactName.Trim()},";
        var pay = kind is "reminder" or "invoice" or "stopped" ? PlatformInvoicing.PaymentLines(settings) : new List<string>();
        var body = new StringBuilder()
            .AppendLine(greeting)
            .AppendLine($"This is {settings.CompanyName} about {tenant.Name}.")
            .AppendLine()
            .AppendLine(text);
        if (pay.Count > 0)
        {
            body.AppendLine().AppendLine("How to pay:");
            foreach (var line in pay) body.AppendLine(line);
        }
        body.AppendLine().Append("Thank you!");
        var full = body.ToString();

        var phone = tenant.ContactMobile ?? tenant.ContactPhone;
        var results = new List<PlatformMessage>
        {
            await SendWhatsAppAsync(settings, tenantId, invoiceId, phone, kind, full, sentBy),
            await SendEmailAsync(settings, tenantId, invoiceId, tenant.ContactEmail, kind, $"{subject} — {tenant.Name}", full, sentBy)
        };
        await _db.SaveChangesAsync();
        var sent = results.Count(r => r.Status == "sent");
        return (sent, results.Count - sent);
    }

    public async Task<List<PlatformMessage>> SendTestAsync(string? phone, string? email, string sentBy)
    {
        var settings = await PlatformInvoicing.SettingsAsync(_db);
        var text = $"This is a test message from {settings.CompanyName}. If you can read this, reminders will reach your customers.";
        var results = new List<PlatformMessage>();
        if (!string.IsNullOrWhiteSpace(phone)) results.Add(await SendWhatsAppAsync(settings, null, null, phone, "test", text, sentBy));
        if (!string.IsNullOrWhiteSpace(email)) results.Add(await SendEmailAsync(settings, null, null, email, "test", $"Test from {settings.CompanyName}", text, sentBy));
        await _db.SaveChangesAsync();
        return results;
    }
}

/// <summary>Runs the billing automation every hour, starting a couple of minutes after the server starts.</summary>
public class BillingAutomationWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;

    public BillingAutomationWorker(IServiceScopeFactory scopes) => _scopes = scopes;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); }
        catch (TaskCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var billing = scope.ServiceProvider.GetRequiredService<IPlatformBilling>();
                var report = await billing.RunAutomationAsync();
                if (report.InvoicesRaised + report.MarkedOverdue + report.RemindersSent + report.PartsStopped > 0)
                    Console.WriteLine($"[Billing] Raised {report.InvoicesRaised} invoice(s), {report.MarkedOverdue} now overdue, "
                                      + $"{report.RemindersSent} reminder(s) sent, {report.PartsStopped} part(s) stopped.");
                foreach (var note in report.Notes) Console.WriteLine($"[Billing] {note}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Billing] Automation run failed: {ex.Message}");
            }

            try { await Task.Delay(TimeSpan.FromHours(1), stoppingToken); }
            catch (TaskCanceledException) { return; }
        }
    }
}
