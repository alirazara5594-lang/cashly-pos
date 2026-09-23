using System;
using System.Collections.Generic;

namespace Pos.Api.Models;

// ============================================================
// EXPENSES
//
// Money going out that is not a supplier purchase: rent, utilities, salaries paid ad hoc,
// repairs, fuel, marketing. Previously the system only had "Expense" as an AccountType on the
// chart of accounts, which meant an expense could be journalled but never RECORDED — there was
// no row to attach a date, a payee, an approval or a receipt to.
// ============================================================

public enum ExpenseStatus
{
    /// <summary>Entered but not yet approved. Does not hit the books.</summary>
    Draft = 1,
    /// <summary>Approved and posted to the general ledger, but not yet paid out.</summary>
    Approved = 2,
    /// <summary>Money has actually left. Cash/bank is reduced.</summary>
    Paid = 3,
    Rejected = 4,
    Cancelled = 5
}

/// <summary>
/// One outgoing payment or accrual. Deliberately branch-scoped: a chain needs to know which
/// outlet burned the electricity, and consolidating that upward is HQ's job, not the data's.
/// </summary>
public class Expense
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }

    /// <summary>Human-facing reference, e.g. EXP-0924-0007. Generated server-side.</summary>
    public string ExpenseNumber { get; set; } = string.Empty;

    /// <summary>Free-text bucket (Rent, Utilities, Repairs, Fuel, Marketing...). Kept as text
    /// rather than its own table for the same reason Department is: most tenants never curate a
    /// list, and the ones that do can be promoted to master data later without a data migration.</summary>
    public string Category { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    /// <summary>Who was paid. Optional — a lot of small expenses have no supplier record.</summary>
    public Guid? SupplierId { get; set; }
    public string? PayeeName { get; set; }

    public decimal AmountPKR { get; set; }
    /// <summary>Input tax where it is recoverable. Zero for most small-business expenses.</summary>
    public decimal TaxPKR { get; set; }
    public decimal TotalPKR { get; set; }

    /// <summary>When the cost was incurred, which is not always when it was entered.</summary>
    public DateTime ExpenseDate { get; set; } = DateTime.UtcNow;

    public PaymentMethod PaymentMethod { get; set; } = PaymentMethod.Cash;

    // --- Ledger linkage -----------------------------------------------------
    /// <summary>The expense account this is charged to (chart of accounts).</summary>
    public Guid? ExpenseAccountId { get; set; }
    /// <summary>The cash/bank account it was paid from.</summary>
    public Guid? PaidFromAccountId { get; set; }
    /// <summary>The journal entry raised when this was approved. Null while Draft — an
    /// unapproved expense must never appear in the books.</summary>
    public Guid? JournalEntryId { get; set; }

    public ExpenseStatus Status { get; set; } = ExpenseStatus.Draft;

    public Guid? CreatedByUserId { get; set; }
    public string? CreatedByName { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public string? RejectionReason { get; set; }

    /// <summary>Bill/receipt reference or a link to a stored image. Free text so a shop can put
    /// a physical voucher number here without needing file upload configured.</summary>
    public string? ReceiptReference { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ============================================================
// SYNC LOG
//
// The record of what moved between a business host and the cloud, and when.
//
// This is the difference between "sync is broken" and "sync of 42 sales from Gulberg failed at
// 14:20 with a timeout, and the 3 attempts since have also failed". Without it, a shop that
// silently stopped syncing looks identical to a shop that had no sales.
// ============================================================

public enum SyncDirection
{
    /// <summary>Business host -> cloud. Sales, shifts, stock movements.</summary>
    Push = 1,
    /// <summary>Cloud -> business host. Catalogue, prices, entitlements, HQ instructions.</summary>
    Pull = 2
}

public enum SyncStatus
{
    Pending = 1,
    InProgress = 2,
    Success = 3,
    /// <summary>Some records landed, some did not. The failed ones stay queued.</summary>
    Partial = 4,
    Failed = 5
}

public class SyncLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid? BranchId { get; set; }

    /// <summary>Which business host or device this batch came from.</summary>
    public Guid? DeviceId { get; set; }
    public string? HostIdentifier { get; set; }

    public SyncDirection Direction { get; set; } = SyncDirection.Push;

    /// <summary>What moved: "Order", "CashShift", "StockLedgerEntry", "Catalog", "Entitlements".</summary>
    public string EntityType { get; set; } = string.Empty;

    /// <summary>Groups every row of one sync run, so a retry can be told apart from a new run.</summary>
    public string BatchId { get; set; } = string.Empty;

    public int RecordsAttempted { get; set; }
    public int RecordsSucceeded { get; set; }
    public int RecordsFailed { get; set; }

    public SyncStatus Status { get; set; } = SyncStatus.Pending;
    public string? ErrorMessage { get; set; }

    /// <summary>How many times this batch has been retried. A number that keeps climbing is the
    /// clearest early signal that a host is in trouble.</summary>
    public int AttemptCount { get; set; } = 1;

    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }

    /// <summary>Wall-clock duration, stored rather than derived so slow-sync trends survive
    /// even after old rows are pruned down to summaries.</summary>
    public int? DurationMs { get; set; }
}

// ============================================================
// BUSINESS HOST
//
// The machine that actually runs the backend and the database for one business — normally just
// a desktop PC in the shop or the office, not a server rack. Registering it gives the cloud
// something to licence, something to sync with, and something to name in a support call.
// ============================================================

public enum HostMode
{
    /// <summary>The backend runs on the customer's own PC, serving POS terminals over the LAN.</summary>
    BusinessHost = 1,
    /// <summary>The backend runs centrally; terminals reach it over the internet.</summary>
    Cloud = 2
}

public class BusinessHost
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }

    /// <summary>The location this host physically sits at — the office, or the shop itself.</summary>
    public Guid BranchId { get; set; }

    /// <summary>Short code the customer reads out when connecting a POS terminal to this host.</summary>
    public string HostCode { get; set; } = string.Empty;
    public string HostName { get; set; } = string.Empty;

    /// <summary>Last known LAN address, reported by the host itself on check-in. Advisory only —
    /// a DHCP lease can move it, which is exactly why terminals are told to re-discover rather
    /// than trust a stored address forever.</summary>
    public string? LanAddress { get; set; }
    public int Port { get; set; } = 5288;

    public string? MachineName { get; set; }
    public string? OperatingSystem { get; set; }
    public string? AppVersion { get; set; }

    public DateTime RegisteredAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;

    /// <summary>Last time this host successfully pushed to the cloud. Null means it never has.</summary>
    public DateTime? LastSyncedAt { get; set; }

    public bool IsActive { get; set; } = true;
}
