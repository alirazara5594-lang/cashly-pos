using System;

namespace Pos.Api.Models;

/// <summary>
/// How far a business host has got pushing one kind of record up to the cloud.
///
/// Sync needs a watermark or it has only two options, both bad: re-send everything every time,
/// or lose whatever happened while it was offline. This row is the "everything before here is
/// confirmed landed" mark, kept per entity type so a failure pushing stock does not stall sales.
/// </summary>
public class SyncCursor
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }

    /// <summary>"Order", "Expense", "CashShift", "StockLedgerEntry".</summary>
    public string EntityType { get; set; } = string.Empty;

    /// <summary>
    /// Everything created at or before this instant is confirmed on the cloud.
    ///
    /// Deliberately a timestamp rather than a row id: ids are GUIDs here, which have no ordering,
    /// and a host that was offline for a week needs to resume by time, not by position.
    /// </summary>
    public DateTime LastSyncedAt { get; set; } = DateTime.UnixEpoch;

    /// <summary>Last row actually confirmed, so a batch that half-succeeded can be resumed at the
    /// exact record rather than re-sending the whole second.</summary>
    public Guid? LastSyncedRecordId { get; set; }

    public int ConsecutiveFailures { get; set; }
    public DateTime? LastAttemptAt { get; set; }
    public string? LastError { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Exponential backoff, capped at an hour. A host that cannot reach the cloud should not
    /// hammer it every thirty seconds — and the shop must not notice, because none of this
    /// affects whether the till can sell.
    /// </summary>
    public DateTime NextAttemptAfter(DateTime now) =>
        ConsecutiveFailures == 0
            ? now
            : now.AddSeconds(Math.Min(3600, 30 * Math.Pow(2, Math.Min(ConsecutiveFailures, 7))));
}
