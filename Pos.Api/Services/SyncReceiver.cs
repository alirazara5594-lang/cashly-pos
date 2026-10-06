using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// CLOUD-SIDE SYNC RECEIVER
//
// The other end of SyncService. A business host pushes batches here and this writes them into
// the head-office database.
//
// Before this existed the endpoint counted records, logged a success and threw the payload away —
// a shop could sync for a month, see "Sync: ok" every five minutes, and head office would have
// nothing. Everything here is written for that failure mode:
//
//   * IDEMPOTENT — a host that pushed successfully but lost the response sends the same batch
//     again. Duplicates are recognised by id, by ClientLocalId and by order number, and skipped.
//   * TENANT-FORCED — the tenant always comes from the registered host, never from the record.
//     A leaked sync key must not be able to write into another business's books.
//   * NEVER WEDGES — a record the cloud cannot resolve (an unknown branch, say) is REJECTED and
//     reported rather than retried forever. The host's watermark is allowed to move past it and
//     the reason lands in the sync log where support can read it.
//
// A sale is history. Totals, prices and timestamps arrive exactly as the customer was charged and
// are stored verbatim — re-pricing here would silently rewrite what somebody already paid.
// ============================================================

/// <summary>Outcome of one pushed batch. Counts are per record, not per entity.</summary>
public sealed record SyncBatchResult(int NewRecords, int Duplicates, int Rejected, IReadOnlyList<string> Reasons)
{
    /// <summary>Records the cloud now holds — new plus already-had. What the host's watermark counts on.</summary>
    public int Accepted => NewRecords + Duplicates;

    public string? RejectionSummary => Reasons.Count == 0 ? null : string.Join("; ", Reasons.Take(5));
}

public interface ISyncReceiver
{
    Task<SyncBatchResult> ReceiveAsync(
        Guid tenantId,
        string? entityType,
        IReadOnlyList<Dictionary<string, JsonElement>> records,
        CancellationToken ct = default);
}

public class SyncReceiver : ISyncReceiver
{
    private readonly AppDbContext _db;

    public SyncReceiver(AppDbContext db) => _db = db;

    public async Task<SyncBatchResult> ReceiveAsync(
        Guid tenantId,
        string? entityType,
        IReadOnlyList<Dictionary<string, JsonElement>> records,
        CancellationToken ct = default)
    {
        if (records.Count == 0) return new SyncBatchResult(0, 0, 0, Array.Empty<string>());

        return (entityType ?? "Unknown") switch
        {
            "Order" => await ReceiveOrdersAsync(tenantId, records, ct),
            "Expense" => await ReceiveExpensesAsync(tenantId, records, ct),
            "CashShift" => await ReceiveCashShiftsAsync(tenantId, records, ct),
            "StockLedgerEntry" => await ReceiveStockLedgerAsync(tenantId, records, ct),
            // An entity type this build does not understand yet is ACCEPTED, not rejected. A newer
            // host must never wedge retrying a batch this cloud has no table for.
            _ => new SyncBatchResult(records.Count, 0, 0, Array.Empty<string>())
        };
    }

    // ============================================================
    // ORDERS
    // ============================================================

    private async Task<SyncBatchResult> ReceiveOrdersAsync(
        Guid tenantId, IReadOnlyList<Dictionary<string, JsonElement>> records, CancellationToken ct)
    {
        var added = 0;
        var duplicates = 0;
        var reasons = new List<string>();

        var ids = CollectGuids(records, "id");
        var existingIds = await ExistingIdsAsync(_db.Orders.IgnoreQueryFilters().Select(o => o.Id), ids, ct);

        var clientLocalIds = records
            .Select(r => Str(r, "clientLocalId"))
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s!.Trim())
            .ToHashSet(StringComparer.Ordinal);
        var existingClientIds = clientLocalIds.Count == 0
            ? new HashSet<string>(StringComparer.Ordinal)
            : (await _db.Orders.IgnoreQueryFilters().AsNoTracking()
                   .Where(o => o.TenantId == tenantId && clientLocalIds.Contains(o.ClientLocalId!))
                   .Select(o => o.ClientLocalId!)
                   .ToListAsync(ct))
              .ToHashSet(StringComparer.Ordinal);

        var branchSet = await ValidBranchesAsync(tenantId, records, ct);
        var customerSet = await ValidCustomersAsync(
            tenantId, records.Select(r => GuidOf(r, "customerId")), ct);

        // Order numbers are unique per tenant. The host numbers its own sales and so does this
        // database, so the first branch sale of the day very often wants a number this tenant
        // already has. Those get renumbered here rather than rejected: losing a sale over a
        // duplicate reference number would be absurd.
        var claimedNumbers = records
            .Select(r => Str(r, "orderNumber"))
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s!.Trim())
            .ToHashSet(StringComparer.Ordinal);
        var numberOwners = claimedNumbers.Count == 0
            ? new Dictionary<string, Guid>(StringComparer.Ordinal)
            : (await _db.Orders.IgnoreQueryFilters().AsNoTracking()
                   .Where(o => o.TenantId == tenantId && claimedNumbers.Contains(o.OrderNumber))
                   .Select(o => new { o.Id, o.OrderNumber })
                   .ToListAsync(ct))
              .ToDictionary(x => x.OrderNumber, x => x.Id, StringComparer.Ordinal);

        var productIds = records
            .SelectMany(r => Arr(r, "items"))
            .Select(i => GuidOf(i, "productId"))
            .Where(g => g != null)
            .Select(g => g!.Value)
            .ToHashSet();
        var productSet = await MatchingProductIdsAsync(tenantId, productIds, ct);

        var placeholders = new PlaceholderCatalog(_db, tenantId);
        var stagedNumbers = new HashSet<string>(StringComparer.Ordinal);

        foreach (var rec in records)
        {
            var id = GuidOf(rec, "id");
            if (id == null) { reasons.Add("order with no id"); continue; }

            if (existingIds.Contains(id.Value)) { duplicates++; continue; }

            var clientLocalId = Str(rec, "clientLocalId")?.Trim();
            if (!string.IsNullOrWhiteSpace(clientLocalId) && existingClientIds.Contains(clientLocalId))
            { duplicates++; continue; }

            var branchId = GuidOf(rec, "branchId");
            if (branchId == null || !branchSet.Contains(branchId.Value))
            { reasons.Add($"{id}: branch not in this business"); continue; }

            var orderNumber = Str(rec, "orderNumber")?.Trim();
            if (string.IsNullOrEmpty(orderNumber)
                || stagedNumbers.Contains(orderNumber)
                || (numberOwners.TryGetValue(orderNumber, out var owner) && owner != id.Value))
            {
                orderNumber = await AllocateOrderNumberAsync(tenantId, stagedNumbers, ct);
            }
            stagedNumbers.Add(orderNumber);

            // Customer linkage is a convenience, not money. If the record the cloud holds does not
            // match, drop the link and keep the sale.
            var customerId = GuidOf(rec, "customerId");
            if (customerId != null && !customerSet.Contains(customerId.Value)) customerId = null;

            var order = new Order
            {
                Id = id.Value,
                // Forced. The record's own tenant id is ignored: the host vouched for this tenant,
                // and that is the only say it gets.
                TenantId = tenantId,
                BranchId = branchId.Value,
                OrderNumber = orderNumber,
                OrderType = EnumOf(rec, "orderType", OrderType.DineIn),
                Status = EnumOf(rec, "status", OrderStatus.New),
                TableNumber = Str(rec, "tableNumber"),
                SubTotalPKR = Dec(rec, "subTotalPKR"),
                DiscountPKR = Dec(rec, "discountPKR"),
                TaxPKR = Dec(rec, "taxPKR"),
                TotalPKR = Dec(rec, "totalPKR"),
                PaymentMethod = EnumOf(rec, "paymentMethod", PaymentMethod.Cash),
                AmountPaidPKR = Dec(rec, "amountPaidPKR"),
                ChangeDuePKR = Dec(rec, "changeDuePKR"),
                IsPaid = Bool(rec, "isPaid"),
                CashierName = Str(rec, "cashierName"),
                CreatedByRole = Str(rec, "createdByRole"),
                CreatedAt = Date(rec, "createdAt") ?? DateTime.UtcNow,
                CompletedAt = Date(rec, "completedAt"),
                ClientLocalId = clientLocalId,
                IsOfflineOrigin = Bool(rec, "isOfflineOrigin"),
                CapturedAt = Date(rec, "capturedAt"),
                DeviceReportedTotalPKR = DecOrNull(rec, "deviceReportedTotalPKR"),
                PriceVariancePKR = Dec(rec, "priceVariancePKR"),
                HasPriceVariance = Bool(rec, "hasPriceVariance"),
                CustomerId = customerId,
                CustomerName = Str(rec, "customerName"),
                CustomerPhone = Str(rec, "customerPhone")
            };

            foreach (var line in Arr(rec, "items"))
            {
                var productId = GuidOf(line, "productId");
                if (productId == null || !productSet.Contains(productId.Value))
                    productId = await placeholders.ResolveAsync(line, ct);

                order.Items.Add(new OrderItem
                {
                    Id = GuidOf(line, "id") ?? Guid.NewGuid(),
                    ProductId = productId.Value,
                    ProductName = Str(line, "productName") ?? string.Empty,
                    Quantity = (int)Dec(line, "quantity", 1),
                    UnitPricePKR = Dec(line, "unitPricePKR"),
                    TotalPricePKR = Dec(line, "totalPricePKR"),
                    ModifiersSummary = Str(line, "modifiersSummary"),
                    DeviceReportedUnitPricePKR = DecOrNull(line, "deviceReportedUnitPricePKR")
                });
            }

            _db.Orders.Add(order);
            // Closed out so a second copy of the same sale inside one batch is a duplicate too.
            existingIds.Add(order.Id);
            added++;
        }

        await SaveAsync(ct);
        return new SyncBatchResult(added, duplicates, reasons.Count, reasons);
    }

    // ============================================================
    // EXPENSES
    // ============================================================

    private async Task<SyncBatchResult> ReceiveExpensesAsync(
        Guid tenantId, IReadOnlyList<Dictionary<string, JsonElement>> records, CancellationToken ct)
    {
        var added = 0;
        var duplicates = 0;
        var reasons = new List<string>();

        var ids = CollectGuids(records, "id");
        var existingIds = await ExistingIdsAsync(_db.Expenses.IgnoreQueryFilters().Select(e => e.Id), ids, ct);
        var branchSet = await ValidBranchesAsync(tenantId, records, ct);

        foreach (var rec in records)
        {
            var id = GuidOf(rec, "id");
            if (id == null) { reasons.Add("expense with no id"); continue; }
            if (existingIds.Contains(id.Value)) { duplicates++; continue; }

            var branchId = GuidOf(rec, "branchId");
            if (branchId == null || !branchSet.Contains(branchId.Value))
            { reasons.Add($"{id}: branch not in this business"); continue; }

            var supplierId = GuidOf(rec, "supplierId");
            if (supplierId != null
                && !await _db.Suppliers.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(s => s.TenantId == tenantId && s.Id == supplierId.Value, ct))
                supplierId = null;

            _db.Expenses.Add(new Expense
            {
                Id = id.Value,
                TenantId = tenantId,
                BranchId = branchId.Value,
                ExpenseNumber = Str(rec, "expenseNumber") ?? string.Empty,
                Category = Str(rec, "category") ?? string.Empty,
                Description = Str(rec, "description") ?? string.Empty,
                SupplierId = supplierId,
                PayeeName = Str(rec, "payeeName"),
                AmountPKR = Dec(rec, "amountPKR"),
                TaxPKR = Dec(rec, "taxPKR"),
                TotalPKR = Dec(rec, "totalPKR"),
                ExpenseDate = Date(rec, "expenseDate") ?? DateTime.UtcNow,
                PaymentMethod = EnumOf(rec, "paymentMethod", PaymentMethod.Cash),
                ExpenseAccountId = GuidOf(rec, "expenseAccountId"),
                PaidFromAccountId = GuidOf(rec, "paidFromAccountId"),
                JournalEntryId = GuidOf(rec, "journalEntryId"),
                Status = EnumOf(rec, "status", ExpenseStatus.Draft),
                CreatedByName = Str(rec, "createdByName"),
                ApprovedAt = Date(rec, "approvedAt"),
                PaidAt = Date(rec, "paidAt"),
                ReceiptReference = Str(rec, "receiptReference"),
                CreatedAt = Date(rec, "createdAt") ?? DateTime.UtcNow
            });

            existingIds.Add(id.Value);
            added++;
        }

        await SaveAsync(ct);
        return new SyncBatchResult(added, duplicates, reasons.Count, reasons);
    }

    // ============================================================
    // CASH SHIFTS
    // ============================================================

    private async Task<SyncBatchResult> ReceiveCashShiftsAsync(
        Guid tenantId, IReadOnlyList<Dictionary<string, JsonElement>> records, CancellationToken ct)
    {
        var added = 0;
        var duplicates = 0;
        var reasons = new List<string>();

        var ids = CollectGuids(records, "id");
        var existingIds = await ExistingIdsAsync(_db.CashShifts.IgnoreQueryFilters().Select(s => s.Id), ids, ct);
        var branchSet = await ValidBranchesAsync(tenantId, records, ct);

        foreach (var rec in records)
        {
            var id = GuidOf(rec, "id");
            if (id == null) { reasons.Add("cash shift with no id"); continue; }
            if (existingIds.Contains(id.Value)) { duplicates++; continue; }

            // CashShift carries no TenantId of its own — the branch is its only claim on a
            // business, so the branch is what gets checked.
            var branchId = GuidOf(rec, "branchId");
            if (branchId == null || !branchSet.Contains(branchId.Value))
            { reasons.Add($"{id}: branch not in this business"); continue; }

            _db.CashShifts.Add(new CashShift
            {
                Id = id.Value,
                BranchId = branchId.Value,
                TerminalName = Str(rec, "terminalName") ?? string.Empty,
                CashierName = Str(rec, "cashierName") ?? string.Empty,
                OpenedAt = Date(rec, "openedAt") ?? DateTime.UtcNow,
                ClosedAt = Date(rec, "closedAt"),
                OpeningFloatPKR = Dec(rec, "openingFloatPKR"),
                CashSalesPKR = Dec(rec, "cashSalesPKR"),
                CashReceivedPKR = Dec(rec, "cashReceivedPKR"),
                CashPaidOutPKR = Dec(rec, "cashPaidOutPKR"),
                ExpectedCashPKR = Dec(rec, "expectedCashPKR"),
                ActualCashCountedPKR = Dec(rec, "actualCashCountedPKR"),
                VariancePKR = Dec(rec, "variancePKR"),
                Notes = Str(rec, "notes"),
                // The host only ever pushes closed shifts: an open drawer's numbers are still
                // moving, and half-counted cash at head office is wrong by design.
                IsClosed = true
            });

            existingIds.Add(id.Value);
            added++;
        }

        await SaveAsync(ct);
        return new SyncBatchResult(added, duplicates, reasons.Count, reasons);
    }

    // ============================================================
    // STOCK LEDGER
    // ============================================================

    private async Task<SyncBatchResult> ReceiveStockLedgerAsync(
        Guid tenantId, IReadOnlyList<Dictionary<string, JsonElement>> records, CancellationToken ct)
    {
        var added = 0;
        var duplicates = 0;
        var reasons = new List<string>();

        var ids = CollectGuids(records, "id");
        var existingIds = await ExistingIdsAsync(_db.StockLedgerEntries.IgnoreQueryFilters().Select(s => s.Id), ids, ct);
        var branchSet = await ValidBranchesAsync(tenantId, records, ct);
        var ingredientSet = await ValidIngredientsAsync(
            tenantId, records.Select(r => GuidOf(r, "ingredientId")), ct);

        foreach (var rec in records)
        {
            var id = GuidOf(rec, "id");
            if (id == null) { reasons.Add("stock entry with no id"); continue; }
            if (existingIds.Contains(id.Value)) { duplicates++; continue; }

            var branchId = GuidOf(rec, "branchId");
            if (branchId == null || !branchSet.Contains(branchId.Value))
            { reasons.Add($"{id}: branch not in this business"); continue; }

            var ingredientId = GuidOf(rec, "ingredientId");
            var notes = Str(rec, "notes");
            if (ingredientId != null && !ingredientSet.Contains(ingredientId.Value))
            {
                // The movement itself is the fact; the link to an ingredient the head office has
                // never heard of is not. Keep the numbers, record what was dropped.
                notes = string.IsNullOrEmpty(notes)
                    ? $"[sync: ingredient {ingredientId} unknown]"
                    : $"{notes} [sync: ingredient {ingredientId} unknown]";
                ingredientId = null;
            }

            _db.StockLedgerEntries.Add(new StockLedgerEntry
            {
                Id = id.Value,
                TenantId = tenantId,
                BranchId = branchId.Value,
                IngredientId = ingredientId,
                MovementType = EnumOf(rec, "movementType", StockMovementType.Adjustment),
                QuantityChange = Dec(rec, "quantityChange"),
                UnitCostPKR = Dec(rec, "unitCostPKR"),
                BalanceAfter = Dec(rec, "balanceAfter"),
                ReferenceType = Str(rec, "referenceType"),
                ReferenceId = GuidOf(rec, "referenceId"),
                Notes = notes,
                CreatedBy = Str(rec, "createdBy") ?? string.Empty,
                CreatedAt = Date(rec, "createdAt") ?? DateTime.UtcNow
            });

            existingIds.Add(id.Value);
            added++;
        }

        await SaveAsync(ct);
        return new SyncBatchResult(added, duplicates, reasons.Count, reasons);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    /// <summary>One SaveChanges per batch: the whole batch lands or none of it does, so a
    /// mid-batch failure can never leave an order without its lines.</summary>
    private Task SaveAsync(CancellationToken ct) => _db.SaveChangesAsync(ct);

    private async Task<HashSet<Guid>> ExistingIdsAsync(IQueryable<Guid> query, HashSet<Guid> wanted, CancellationToken ct)
    {
        if (wanted.Count == 0) return new HashSet<Guid>();
        return (await query.Where(x => wanted.Contains(x)).ToListAsync(ct)).ToHashSet();
    }

    /// <summary>Branch ids in this batch that belong to this tenant.</summary>
    private async Task<HashSet<Guid>> ValidBranchesAsync(
        Guid tenantId, IReadOnlyList<Dictionary<string, JsonElement>> records, CancellationToken ct)
    {
        var wanted = records.Select(r => GuidOf(r, "branchId")).Where(g => g != null).Select(g => g!.Value).ToHashSet();
        if (wanted.Count == 0) return wanted;

        return (await _db.Branches.IgnoreQueryFilters().AsNoTracking()
                .Where(b => b.TenantId == tenantId && wanted.Contains(b.Id))
                .Select(b => b.Id)
                .ToListAsync(ct))
            .ToHashSet();
    }

    /// <summary>Which of these candidate customer ids exist under this tenant.</summary>
    private async Task<HashSet<Guid>> ValidCustomersAsync(Guid tenantId, IEnumerable<Guid?> candidates, CancellationToken ct)
    {
        var wanted = candidates.Where(g => g != null).Select(g => g!.Value).ToHashSet();
        if (wanted.Count == 0) return wanted;
        return (await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                .Where(c => c.TenantId == tenantId && wanted.Contains(c.Id))
                .Select(c => c.Id).ToListAsync(ct)).ToHashSet();
    }

    /// <summary>Which of these candidate ingredient ids exist under this tenant.</summary>
    private async Task<HashSet<Guid>> ValidIngredientsAsync(Guid tenantId, IEnumerable<Guid?> candidates, CancellationToken ct)
    {
        var wanted = candidates.Where(g => g != null).Select(g => g!.Value).ToHashSet();
        if (wanted.Count == 0) return wanted;
        return (await _db.Ingredients.IgnoreQueryFilters().AsNoTracking()
                .Where(i => i.TenantId == tenantId && wanted.Contains(i.Id))
                .Select(i => i.Id).ToListAsync(ct)).ToHashSet();
    }

    private async Task<HashSet<Guid>> MatchingProductIdsAsync(Guid tenantId, HashSet<Guid> wanted, CancellationToken ct)
    {
        if (wanted.Count == 0) return wanted;
        return (await _db.Products.IgnoreQueryFilters().AsNoTracking()
                .Where(p => p.TenantId == tenantId && wanted.Contains(p.Id))
                .Select(p => p.Id).ToListAsync(ct)).ToHashSet();
    }

    /// <summary>
    /// A product the head-office catalogue does not have, referenced by a synced sale.
    ///
    /// The sale is not negotiable — a customer paid for that line — so a placeholder is created
    /// under a "Synced items" category rather than the line being thrown away. Products are
    /// matched by name first, so the thousandth sale of the same unknown item reuses one
    /// placeholder instead of growing a new one each time.
    ///
    /// Nothing here is saved. The batch commits in a single SaveChanges, ordered by EF so the
    /// category lands before the product and the product before the sale line.
    /// </summary>
    private sealed class PlaceholderCatalog
    {
        private const string CategoryName = "Synced items";

        private readonly AppDbContext _db;
        private readonly Guid _tenantId;
        private readonly Dictionary<string, Product> _staged = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _lookedUp = new(StringComparer.OrdinalIgnoreCase);
        private Category? _category;

        public PlaceholderCatalog(AppDbContext db, Guid tenantId)
        {
            _db = db;
            _tenantId = tenantId;
        }

        public async Task<Guid> ResolveAsync(Dictionary<string, JsonElement> line, CancellationToken ct)
        {
            var name = SyncReceiver.Str(line, "productName") ?? "(synced item)";

            if (_staged.TryGetValue(name, out var staged)) return staged.Id;
            if (!_lookedUp.Contains(name))
            {
                var persisted = await _db.Products.IgnoreQueryFilters().AsNoTracking()
                    .FirstOrDefaultAsync(p => p.TenantId == _tenantId && p.Name == name, ct);
                _lookedUp.Add(name);
                if (persisted != null) return persisted.Id;
            }

            var product = new Product
            {
                TenantId = _tenantId,
                Category = await CategoryAsync(ct),
                Name = name,
                Description = "Imported by head-office sync — catalogue not yet reconciled.",
                SellingPricePKR = SyncReceiver.Dec(line, "unitPricePKR"),
                CostPricePKR = 0
            };

            _db.Products.Add(product);
            _staged[name] = product;
            return product.Id;
        }

        private async Task<Category> CategoryAsync(CancellationToken ct)
        {
            if (_category != null) return _category;

            _category = await _db.Categories.IgnoreQueryFilters().AsNoTracking()
                            .FirstOrDefaultAsync(c => c.TenantId == _tenantId && c.Name == CategoryName, ct)
                        ?? _db.Categories.Local
                            .FirstOrDefault(c => c.TenantId == _tenantId && c.Name == CategoryName);

            if (_category != null) return _category;

            _category = new Category { TenantId = _tenantId, Name = CategoryName, Icon = "utensils" };
            _db.Categories.Add(_category);
            return _category;
        }
    }

    /// <summary>
    /// The next free ORD-yyMMdd-nnnn for this tenant.
    ///
    /// Only ever called on a collision — the common path keeps the number the branch printed on
    /// the customer's receipt. Deliberately a query rather than the DocumentSequences counter:
    /// a batch from a branch must not consume head office's numbering, and this reads whatever
    /// the cloud actually holds.
    /// </summary>
    private async Task<string> AllocateOrderNumberAsync(Guid tenantId, ISet<string> staged, CancellationToken ct)
    {
        var series = $"ORD-{DateTime.UtcNow:yyMMdd}";
        var existing = await _db.Orders.IgnoreQueryFilters().AsNoTracking()
            .Where(o => o.TenantId == tenantId && o.OrderNumber.StartsWith(series + "-"))
            .Select(o => o.OrderNumber)
            .ToListAsync(ct);

        long highest = 0;
        foreach (var number in existing.Concat(staged))
        {
            var dash = number.LastIndexOf('-');
            if (dash >= 0 && long.TryParse(number[(dash + 1)..], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
                && value > highest)
                highest = value;
        }

        string candidate;
        do { highest++; candidate = $"{series}-{highest:D4}"; }
        while (staged.Contains(candidate));

        return candidate;
    }

    // --- Loosely-typed record access ------------------------------------------
    // The wire format is an anonymous object serialised with the web naming policy, so keys
    // arrive camelCase. Every read accepts either casing: the sender and this reader must not
    // have to agree on capitalisation for a sale to land.

    private static bool TryGet(Dictionary<string, JsonElement> rec, string key, out JsonElement el)
    {
        if (rec.TryGetValue(key, out el)) return true;
        return rec.TryGetValue(char.ToUpperInvariant(key[0]) + key[1..], out el);
    }

    private static HashSet<Guid> CollectGuids(IReadOnlyList<Dictionary<string, JsonElement>> records, string key)
    {
        var set = new HashSet<Guid>();
        foreach (var rec in records)
            if (GuidOf(rec, key) is { } g)
                set.Add(g);
        return set;
    }

    private static Guid? GuidOf(Dictionary<string, JsonElement> rec, string key)
    {
        if (!TryGet(rec, key, out var el)) return null;
        return el.ValueKind == JsonValueKind.String && Guid.TryParse(el.GetString(), out var g) ? g : null;
    }

    private static string? Str(Dictionary<string, JsonElement> rec, string key) =>
        TryGet(rec, key, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    private static decimal Dec(Dictionary<string, JsonElement> rec, string key, decimal fallback = 0)
    {
        if (!TryGet(rec, key, out var el)) return fallback;
        return el.ValueKind switch
        {
            JsonValueKind.Number => el.GetDecimal(),
            JsonValueKind.String => decimal.TryParse(el.GetString(), NumberStyles.Number,
                CultureInfo.InvariantCulture, out var d) ? d : fallback,
            _ => fallback
        };
    }

    private static decimal? DecOrNull(Dictionary<string, JsonElement> rec, string key) =>
        TryGet(rec, key, out var el) && el.ValueKind is JsonValueKind.Number or JsonValueKind.String
            ? Dec(rec, key)
            : null;

    private static bool Bool(Dictionary<string, JsonElement> rec, string key, bool fallback = false)
    {
        if (!TryGet(rec, key, out var el)) return fallback;
        return el.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => bool.TryParse(el.GetString(), out var b) ? b : fallback,
            _ => fallback
        };
    }

    /// <summary>Always UTC: Postgres timestamptz rejects a local-kind DateTime, and a sale's
    /// moment must not move because of where the server that stored it happens to sit.</summary>
    private static DateTime? Date(Dictionary<string, JsonElement> rec, string key)
    {
        if (!TryGet(rec, key, out var el)) return null;
        if (el.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(el.GetString(), CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out var dto))
            return dto.UtcDateTime;
        return null;
    }

    private static TEnum EnumOf<TEnum>(Dictionary<string, JsonElement> rec, string key, TEnum fallback)
        where TEnum : struct, Enum
    {
        var raw = Str(rec, key);
        return raw != null && Enum.TryParse<TEnum>(raw, true, out var parsed) ? parsed : fallback;
    }

    private static List<Dictionary<string, JsonElement>> Arr(Dictionary<string, JsonElement> rec, string key)
    {
        if (!TryGet(rec, key, out var el) || el.ValueKind != JsonValueKind.Array) return new();

        var list = new List<Dictionary<string, JsonElement>>();
        foreach (var item in el.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            var map = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
            foreach (var prop in item.EnumerateObject()) map[prop.Name] = prop.Value;
            list.Add(map);
        }
        return list;
    }
}
