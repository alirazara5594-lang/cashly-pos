namespace Pos.Api.Models;

// ============================================================
// THE PLATFORM'S OWN RECORDS
//
// Everything Cashly keeps about running Cashly itself, as opposed to a business's own data: who
// Cashly is on an invoice and how customers pay it, which renewal an invoice is for, the money that
// came in, the messages the platform sent, notes about customers and announcements to them.
// ============================================================

/// <summary>
/// Cashly's own details and the rules its billing runs by. Exactly one row (Id = 1), edited on the
/// platform's Settings page. Invoices print from here, so a customer never sees made-up bank details.
/// </summary>
public class PlatformSettings
{
    public int Id { get; set; } = 1;

    // --- Who bills: printed on every invoice ---------------------------------
    public string CompanyName { get; set; } = "Cashly";
    public string? LegalName { get; set; }
    /// <summary>National Tax Number.</summary>
    public string? Ntn { get; set; }
    /// <summary>Sales Tax Registration Number.</summary>
    public string? Strn { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Website { get; set; }

    // --- How customers pay --------------------------------------------------
    public string? BankName { get; set; }
    public string? BankAccountTitle { get; set; }
    public string? BankAccountNumber { get; set; }
    public string? BankIban { get; set; }
    public string? JazzCashNumber { get; set; }
    public string? EasypaisaNumber { get; set; }
    public string? RaastId { get; set; }
    /// <summary>Anything else a customer should know about paying ("send the receipt on WhatsApp").</summary>
    public string? PaymentInstructions { get; set; }
    public string? InvoiceFooter { get; set; }

    // --- Tax on the subscription itself (0 = none charged) ---------------------
    public string TaxLabel { get; set; } = "Sales tax";
    public decimal TaxRatePercent { get; set; }

    // --- Renewals -----------------------------------------------------------
    /// <summary>Raise each renewal's invoice by itself, <see cref="InvoiceDaysBefore"/> days ahead.</summary>
    public bool AutoInvoice { get; set; } = true;
    public int InvoiceDaysBefore { get; set; } = 7;
    /// <summary>Days after issue an invoice is due.</summary>
    public int InvoiceDueDays { get; set; } = 7;
    /// <summary>Send renewal reminders by WhatsApp and email. Off until switched on, so nothing reaches a
    /// customer before the company and bank details on this page are filled in.</summary>
    public bool AutoReminders { get; set; } = false;
    /// <summary>When reminders go out, in days relative to the renewal date: 7 and 1 before, 1 and 3 after.</summary>
    public string ReminderDays { get; set; } = "7,1,-1,-3";
    /// <summary>Stop a part that is still unpaid <see cref="StopAfterDays"/> days after it fell due —
    /// only that part: one outlet's tills, one tablet, the head office's changes, or one add-on.</summary>
    public bool AutoStopUnpaid { get; set; } = false;
    public int StopAfterDays { get; set; } = 7;

    // --- The platform's own WhatsApp line, for reminders (secrets encrypted) ---
    public string WhatsAppProvider { get; set; } = "Manual";
    public string? WhatsAppApiKey { get; set; }
    public string? WhatsAppApiSecret { get; set; }
    public string? WhatsAppPhoneNumberId { get; set; }
    public string? WhatsAppAccessToken { get; set; }
    public bool EmailReminders { get; set; } = true;

    // --- The platform team ----------------------------------------------------
    /// <summary>Named team logins must turn on 2-step sign-in before they can use the console.</summary>
    public bool RequireTwoStepForTeam { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>One renewal an invoice is for: which part, and the period it pays for.</summary>
public class SubscriptionInvoicePart
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid InvoiceId { get; set; }
    public Guid TenantId { get; set; }
    public Guid PartId { get; set; }
    public string Description { get; set; } = string.Empty;
    public DateTime PeriodStart { get; set; }
    public DateTime PeriodEnd { get; set; }
    public bool Annual { get; set; }
    public decimal AmountPKR { get; set; }
}

/// <summary>
/// Money received from (or returned to) a business. Every payment is a row of its own, so part
/// payments add up, a mistake can be voided with a reason, and "collected this month" is a sum.
/// </summary>
public class SubscriptionPayment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid? InvoiceId { get; set; }
    /// <summary>"Payment" or "Refund". A refund is money given back; it does not undo what was paid for.</summary>
    public string Kind { get; set; } = "Payment";
    public decimal AmountPKR { get; set; }
    /// <summary>Bank Transfer, JazzCash, EasyPaisa, Raast, Cash, Cheque, a gateway's name...</summary>
    public string Method { get; set; } = string.Empty;
    /// <summary>The bank or wallet transaction id, cheque number, receipt number.</summary>
    public string? Reference { get; set; }
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
    public string? Notes { get; set; }
    public Guid? RecordedByUserId { get; set; }
    public string RecordedByName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? VoidedAt { get; set; }
    public string? VoidReason { get; set; }
}

/// <summary>A WhatsApp message or email the platform sent (or tried to) — reminders, invoices, invites.</summary>
public class PlatformMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Null for a message not about one business (a test message).</summary>
    public Guid? TenantId { get; set; }
    public Guid? InvoiceId { get; set; }
    /// <summary>"whatsapp" or "email".</summary>
    public string Channel { get; set; } = "whatsapp";
    public string Recipient { get; set; } = string.Empty;
    /// <summary>reminder, invoice, payment, stopped, invite, test.</summary>
    public string Kind { get; set; } = string.Empty;
    public string? Subject { get; set; }
    public string Body { get; set; } = string.Empty;
    /// <summary>sent, failed, or skipped (nothing to send it with).</summary>
    public string Status { get; set; } = "sent";
    public string? Error { get; set; }
    public string? SentByName { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Marks one reminder as done for one part, so each goes out once.</summary>
public class SubscriptionReminderMark
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PartId { get; set; }
    /// <summary>"{offset}:{renewal date}" — the same reminder for a later renewal is a new key.</summary>
    public string Key { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Something the platform team wrote down about a customer: a call, a promise to pay, a follow-up.</summary>
public class TenantNote
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    /// <summary>Note, Call, Visit or Promise (to pay).</summary>
    public string Kind { get; set; } = "Note";
    public string Body { get; set; } = string.Empty;
    public DateTime? FollowUpAt { get; set; }
    public DateTime? DoneAt { get; set; }
    public decimal? PromisedAmountPKR { get; set; }
    public Guid? AuthorUserId { get; set; }
    public string AuthorName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A message shown inside customers' apps — maintenance tonight, a new feature, a price change.</summary>
public class PlatformAnnouncement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    /// <summary>info, warning or success.</summary>
    public string Tone { get; set; } = "info";
    public DateTime StartsAt { get; set; } = DateTime.UtcNow;
    public DateTime? EndsAt { get; set; }
    /// <summary>all, plan (AudienceValue = Starter/Standard/Professional), shape (Standalone/HeadOffice)
    /// or businesses (AudienceValue = comma-separated business ids).</summary>
    public string Audience { get; set; } = "all";
    public string? AudienceValue { get; set; }
    public bool IsActive { get; set; } = true;
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>What each platform team role may do. The owner may do everything.</summary>
public static class PlatformRoles
{
    public const string Owner = "Owner";
    public const string Billing = "Billing";
    public const string Support = "Support";
    public const string Sales = "Sales";

    public static readonly string[] All = { Owner, Billing, Support, Sales };

    // Permissions a role may hold. Reading the console is open to every role.
    public const string ManageBilling = "billing";      // invoices, payments, renewals, plans, add-ons, status
    public const string ManageSupport = "support";      // support sessions, owner passwords, devices, locations, web address
    public const string ManageSales = "sales";          // provision businesses
    public const string ExtendTrial = "trial";
    public const string WriteNotes = "notes";
    public const string ManagePlatform = "platform";    // prices, catalogue, settings, team, announcements

    public static bool Allows(string? role, string permission)
    {
        // A session from before named accounts (the setup PIN) carries no role: it is the owner.
        if (string.IsNullOrEmpty(role) || role == Owner) return true;
        return role switch
        {
            Billing => permission is ManageBilling or ExtendTrial or WriteNotes,
            Support => permission is ManageSupport or ExtendTrial or WriteNotes,
            Sales => permission is ManageSales or ExtendTrial or WriteNotes,
            _ => false
        };
    }
}
