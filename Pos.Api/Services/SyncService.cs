using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// SYNC
//
// Moves what happened on a business host up to the cloud, and brings entitlements back down.
//
// The governing rule: SYNC MUST NEVER BE ABLE TO STOP A SHOP SELLING. Every failure path here
// ends in "log it, back off, try later" — never in an exception that reaches a till. A shop with
// no internet for a week should notice nothing except a banner, and should find all seven days of
// sales waiting at head office when the line comes back.
//
// Ordering matters and is deliberate:
//   1. Orders      — the money. If only one thing syncs, this is it.
//   2. Expenses    — money out.
//   3. CashShifts  — reconciliation, useless without the orders it reconciles.
//   4. Stock       — largest volume, least urgent; safe to lag.
// ============================================================

public sealed record SyncOutcome(string EntityType, int Attempted, int Succeeded, bool Ok, string? Error)
{
    public static SyncOutcome Nothing(string entityType) => new(entityType, 0, 0, true, null);
}

public interface ISyncService
{
    /// <summary>Pushes every pending entity type for one tenant, newest cursor first.</summary>
    Task<IReadOnlyList<SyncOutcome>> PushAllAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Pulls entitlements down so a host learns about a plan change or a suspension.</summary>
    Task<SyncOutcome> PullEntitlementsAsync(Guid tenantId, CancellationToken ct = default);
}

public class SyncService : ISyncService
{
    /// <summary>Kept small on purpose: a shop on a bad connection is far better served by twenty
    /// batches of 100 that mostly land than by one batch of 2,000 that times out every time.</summary>
    private const int BatchSize = 100;

    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<SyncService> _log;

    public SyncService(AppDbContext db, IHttpClientFactory httpFactory, IConfiguration config, ILogger<SyncService> log)
    {
        _db = db;
        _httpFactory = httpFactory;
        _config = config;
        _log = log;
    }

    private string? CloudUrl => _config["Host:CloudUrl"] ?? Environment.GetEnvironmentVariable("CLOUD_URL");
    private string? BusinessId => _config["Host:BusinessId"] ?? Environment.GetEnvironmentVariable("BUSINESS_ID");
    private string? SyncKey => _config["Host:SyncKey"] ?? Environment.GetEnvironmentVariable("SYNC_KEY");

    public async Task<IReadOnlyList<SyncOutcome>> PushAllAsync(Guid tenantId, CancellationToken ct = default)
    {
        var results = new List<SyncOutcome>();
        if (string.IsNullOrWhiteSpace(CloudUrl))
            return results; // standalone host with no cloud configured: nothing to do, not an error

        // Money first. If the connection dies halfway through, the shop's sales are already up.
        foreach (var entityType in new[] { "Order", "Expense", "CashShift", "StockLedgerEntry" })
        {
            ct.ThrowIfCancellationRequested();
            var cursor = await GetCursorAsync(tenantId, entityType);

            // Respect backoff: a host that has failed six times running should not try every tick.
            if (cursor.ConsecutiveFailures > 0 && cursor.NextAttemptAfter(cursor.LastAttemptAt ?? DateTime.UtcNow) > DateTime.UtcNow)
                continue;

            var outcome = await PushEntityAsync(tenantId, entityType, cursor, ct);
            results.Add(outcome);

            // One entity type failing must not stop the rest — stock timing out should never
            // hold up tomorrow's sales.
        }
        return results;
    }

    private async Task<SyncOutcome> PushEntityAsync(Guid tenantId, string entityType, SyncCursor cursor, CancellationToken ct)
    {
        var batchId = Guid.NewGuid().ToString("N");
        var startedAt = DateTime.UtcNow;

        List<object> payload;
        DateTime? newWatermark;
        Guid? lastId;

        try
        {
            (payload, newWatermark, lastId) = await CollectAsync(tenantId, entityType, cursor.LastSyncedAt, ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Sync: could not read pending {EntityType} for tenant {TenantId}", entityType, tenantId);
            return new SyncOutcome(entityType, 0, 0, false, ex.Message);
        }

        if (payload.Count == 0) return SyncOutcome.Nothing(entityType);

        var log = new SyncLog
        {
            TenantId = tenantId,
            HostIdentifier = BusinessId,
            Direction = SyncDirection.Push,
            EntityType = entityType,
            BatchId = batchId,
            RecordsAttempted = payload.Count,
            Status = SyncStatus.InProgress,
            StartedAt = startedAt
        };
        _db.SyncLogs.Add(log);
        await _db.SaveChangesAsync(ct);

        try
        {
            var client = _httpFactory.CreateClient("cloud-sync");
            client.Timeout = TimeSpan.FromSeconds(60);

            var request = new HttpRequestMessage(HttpMethod.Post, $"{CloudUrl!.TrimEnd('/')}/api/sync/receive")
            {
                Content = JsonContent.Create(new
                {
                    businessId = BusinessId,
                    tenantId,
                    entityType,
                    batchId,
                    records = payload
                })
            };
            if (!string.IsNullOrWhiteSpace(SyncKey))
                request.Headers.Add("X-Sync-Key", SyncKey);

            var response = await client.SendAsync(request, ct);
            var body = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"Cloud returned {(int)response.StatusCode}: {Truncate(body, 300)}");

            // The cloud reports how many it actually accepted. Trusting our own count would let a
            // partial accept silently advance the watermark past records that never landed.
            var accepted = payload.Count;
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("accepted", out var acc) && acc.TryGetInt32(out var n))
                    accepted = n;
            }
            catch (JsonException) { /* non-JSON 200 — treat as full accept */ }

            log.RecordsSucceeded = accepted;
            log.RecordsFailed = payload.Count - accepted;
            log.Status = log.RecordsFailed == 0 ? SyncStatus.Success : SyncStatus.Partial;
            log.CompletedAt = DateTime.UtcNow;
            log.DurationMs = (int)(log.CompletedAt.Value - startedAt).TotalMilliseconds;

            // Only advance the watermark on a clean batch. A partial one is retried whole, which
            // is safe because every receiver is idempotent — re-sending a sale the cloud already
            // has is a no-op there, whereas skipping one loses it permanently.
            if (log.Status == SyncStatus.Success && newWatermark.HasValue)
            {
                cursor.LastSyncedAt = newWatermark.Value;
                cursor.LastSyncedRecordId = lastId;
                cursor.ConsecutiveFailures = 0;
                cursor.LastError = null;
            }
            cursor.LastAttemptAt = DateTime.UtcNow;
            cursor.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);
            return new SyncOutcome(entityType, payload.Count, accepted, log.Status == SyncStatus.Success, null);
        }
        catch (Exception ex)
        {
            log.Status = SyncStatus.Failed;
            log.ErrorMessage = Truncate(ex.Message, 500);
            log.CompletedAt = DateTime.UtcNow;
            log.DurationMs = (int)(log.CompletedAt.Value - startedAt).TotalMilliseconds;

            cursor.ConsecutiveFailures += 1;
            cursor.LastAttemptAt = DateTime.UtcNow;
            cursor.LastError = Truncate(ex.Message, 500);
            cursor.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(CancellationToken.None);
            _log.LogWarning("Sync: {EntityType} batch {BatchId} failed ({Failures} in a row): {Error}",
                entityType, batchId, cursor.ConsecutiveFailures, ex.Message);

            return new SyncOutcome(entityType, payload.Count, 0, false, ex.Message);
        }
    }

    /// <summary>
    /// Reads one batch of records created after the watermark.
    ///
    /// Everything is projected to a flat anonymous shape rather than sent as EF entities: the
    /// wire format must not change just because a navigation property was added.
    /// </summary>
    private async Task<(List<object> Records, DateTime? Watermark, Guid? LastId)> CollectAsync(
        Guid tenantId, string entityType, DateTime after, CancellationToken ct)
    {
        switch (entityType)
        {
            case "Order":
            {
                var rows = await _db.Orders.IgnoreQueryFilters().AsNoTracking()
                    .Where(o => o.TenantId == tenantId && o.CreatedAt > after)
                    .OrderBy(o => o.CreatedAt)
                    .Take(BatchSize)
                    .Include(o => o.Items)
                    .ToListAsync(ct);
                if (rows.Count == 0) return (new List<object>(), null, null);

                var records = rows.Select(o => (object)new
                {
                    o.Id, o.TenantId, o.BranchId, o.OrderNumber,
                    orderType = o.OrderType.ToString(), status = o.Status.ToString(),
                    o.SubTotalPKR, o.DiscountPKR, o.TaxPKR, o.TotalPKR,
                    paymentMethod = o.PaymentMethod.ToString(),
                    o.AmountPaidPKR, o.ChangeDuePKR, o.IsPaid,
                    o.CashierName, o.CreatedByRole, o.CreatedAt, o.CompletedAt,
                    // Provenance travels with the sale so the cloud can reconcile an offline
                    // capture against the price the catalogue would give today.
                    o.ClientLocalId, o.IsOfflineOrigin, o.CapturedAt,
                    o.DeviceReportedTotalPKR, o.PriceVariancePKR, o.HasPriceVariance,
                    o.CustomerId, o.CustomerName, o.CustomerPhone,
                    items = o.Items.Select(i => new
                    {
                        i.Id, i.ProductId, i.ProductName, i.Quantity,
                        i.UnitPricePKR, i.TotalPricePKR, i.ModifiersSummary,
                        i.DeviceReportedUnitPricePKR
                    })
                }).ToList();
                return (records, rows[^1].CreatedAt, rows[^1].Id);
            }

            case "Expense":
            {
                var rows = await _db.Expenses.IgnoreQueryFilters().AsNoTracking()
                    .Where(e => e.TenantId == tenantId && e.CreatedAt > after)
                    .OrderBy(e => e.CreatedAt).Take(BatchSize).ToListAsync(ct);
                if (rows.Count == 0) return (new List<object>(), null, null);

                var records = rows.Select(e => (object)new
                {
                    e.Id, e.TenantId, e.BranchId, e.ExpenseNumber, e.Category, e.Description,
                    e.PayeeName, e.SupplierId, e.AmountPKR, e.TaxPKR, e.TotalPKR, e.ExpenseDate,
                    paymentMethod = e.PaymentMethod.ToString(), status = e.Status.ToString(),
                    e.ExpenseAccountId, e.PaidFromAccountId, e.JournalEntryId,
                    e.CreatedByName, e.ApprovedAt, e.PaidAt, e.ReceiptReference, e.CreatedAt
                }).ToList();
                return (records, rows[^1].CreatedAt, rows[^1].Id);
            }

            case "CashShift":
            {
                // Only closed shifts. An open shift's numbers are still moving, and syncing a
                // half-counted drawer would put a figure at head office that is wrong by design.
                var rows = await _db.CashShifts.IgnoreQueryFilters().AsNoTracking()
                    .Where(s => s.IsClosed && s.ClosedAt != null && s.ClosedAt > after)
                    .OrderBy(s => s.ClosedAt).Take(BatchSize).ToListAsync(ct);
                if (rows.Count == 0) return (new List<object>(), null, null);

                var records = rows.Select(s => (object)new
                {
                    s.Id, s.BranchId, s.TerminalName, s.CashierName, s.OpenedAt, s.ClosedAt,
                    s.OpeningFloatPKR, s.CashSalesPKR, s.CashReceivedPKR, s.CashPaidOutPKR,
                    s.ExpectedCashPKR, s.ActualCashCountedPKR, s.VariancePKR, s.Notes
                }).ToList();
                return (records, rows[^1].ClosedAt, rows[^1].Id);
            }

            case "StockLedgerEntry":
            {
                var rows = await _db.StockLedgerEntries.IgnoreQueryFilters().AsNoTracking()
                    .Where(s => s.TenantId == tenantId && s.CreatedAt > after)
                    .OrderBy(s => s.CreatedAt).Take(BatchSize).ToListAsync(ct);
                if (rows.Count == 0) return (new List<object>(), null, null);

                var records = rows.Select(s => (object)new
                {
                    s.Id, s.TenantId, s.BranchId, s.IngredientId,
                    movementType = s.MovementType.ToString(),
                    s.QuantityChange, s.UnitCostPKR, s.BalanceAfter,
                    s.ReferenceType, s.ReferenceId, s.Notes, s.CreatedBy, s.CreatedAt
                }).ToList();
                return (records, rows[^1].CreatedAt, rows[^1].Id);
            }

            default:
                return (new List<object>(), null, null);
        }
    }

    public async Task<SyncOutcome> PullEntitlementsAsync(Guid tenantId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(CloudUrl)) return SyncOutcome.Nothing("Entitlements");

        var startedAt = DateTime.UtcNow;
        try
        {
            var client = _httpFactory.CreateClient("cloud-sync");
            client.Timeout = TimeSpan.FromSeconds(30);

            var request = new HttpRequestMessage(HttpMethod.Get,
                $"{CloudUrl!.TrimEnd('/')}/api/sync/entitlements?businessId={BusinessId}&tenantId={tenantId}");
            if (!string.IsNullOrWhiteSpace(SyncKey)) request.Headers.Add("X-Sync-Key", SyncKey);

            var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"Cloud returned {(int)response.StatusCode}");

            _db.SyncLogs.Add(new SyncLog
            {
                TenantId = tenantId, HostIdentifier = BusinessId,
                Direction = SyncDirection.Pull, EntityType = "Entitlements",
                BatchId = Guid.NewGuid().ToString("N"),
                RecordsAttempted = 1, RecordsSucceeded = 1,
                Status = SyncStatus.Success, StartedAt = startedAt, CompletedAt = DateTime.UtcNow,
                DurationMs = (int)(DateTime.UtcNow - startedAt).TotalMilliseconds
            });
            await _db.SaveChangesAsync(ct);
            return new SyncOutcome("Entitlements", 1, 1, true, null);
        }
        catch (Exception ex)
        {
            _db.SyncLogs.Add(new SyncLog
            {
                TenantId = tenantId, HostIdentifier = BusinessId,
                Direction = SyncDirection.Pull, EntityType = "Entitlements",
                BatchId = Guid.NewGuid().ToString("N"),
                RecordsAttempted = 1, RecordsSucceeded = 0, RecordsFailed = 1,
                Status = SyncStatus.Failed, ErrorMessage = Truncate(ex.Message, 500),
                StartedAt = startedAt, CompletedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync(CancellationToken.None);
            return new SyncOutcome("Entitlements", 1, 0, false, ex.Message);
        }
    }

    private async Task<SyncCursor> GetCursorAsync(Guid tenantId, string entityType)
    {
        var cursor = await _db.SyncCursors.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.EntityType == entityType);
        if (cursor != null) return cursor;

        cursor = new SyncCursor { TenantId = tenantId, EntityType = entityType };
        _db.SyncCursors.Add(cursor);
        await _db.SaveChangesAsync();
        return cursor;
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
