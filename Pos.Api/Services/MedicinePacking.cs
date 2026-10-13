using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// MEDICINE PACKING — selling loose
//
// A box of Panadol holds 10 strips of 10 tablets, and a pharmacy sells the box, a strip or one tablet.
// A product with packing (Product.PackUnits) has its stock counted in the smallest unit, tablets:
// a box of 30 makes one tablet 0.0333 of a box, and a count in boxes would never come out even.
// Its price and cost stay per box, as they are printed and invoiced; a strip and a tablet sell at
// their share of the box unless the business sets its own loose price.
//
// Purchase orders and stock receipts are in boxes, as a distributor sells them. Stock counts, the
// ledger, batches and transfers are in tablets. A product without packing is untouched: one sold is
// one off the count, exactly as before.
// ============================================================

public static class MedicinePacking
{
    /// <summary>Whether the product sells loose, its stock counted in the smallest unit.</summary>
    public static bool IsPacked(Product p) => p.PackUnits is > 1;

    /// <summary>How many of the stock's own unit one box is: the pack size, or 1 when not packed.</summary>
    public static int UnitsPerBox(Product p) => IsPacked(p) ? p.PackUnits!.Value : 1;

    /// <summary>Whether the box comes in strips that sell on their own.</summary>
    public static bool HasStrips(Product p) =>
        IsPacked(p) && p.StripUnits is > 1 && p.StripUnits < p.PackUnits && p.PackUnits % p.StripUnits == 0;

    /// <summary>What one of the smallest unit is called, from the medicine's form.</summary>
    public static string LooseUnitName(Product p) => LooseUnitName(p.DosageForm);

    public static string LooseUnitName(string? dosageForm) => (dosageForm ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "tablet" => "Tablet",
        "capsule" => "Capsule",
        "injection" => "Ampoule",
        "sachet" => "Sachet",
        _ => "Unit"
    };

    /// <summary>
    /// The sale unit a line really is: none for a product that is not packed, the box when none was
    /// given (an older till), and the box when strips are asked of a box that has none.
    /// </summary>
    public static SaleUnit? Resolve(Product p, SaleUnit? asked) =>
        !IsPacked(p) ? null
        : asked == SaleUnit.Strip && !HasStrips(p) ? SaleUnit.Pack
        : asked ?? SaleUnit.Pack;

    /// <summary>How much of the stock one of a (resolved) sale unit takes.</summary>
    public static decimal UnitsPer(Product p, SaleUnit? unit) => unit switch
    {
        SaleUnit.Pack => UnitsPerBox(p),
        SaleUnit.Strip => p.StripUnits ?? 1,
        _ => 1
    };

    /// <summary>The price of one of a (resolved) sale unit, from the box's price at this branch.</summary>
    public static decimal PriceOf(Product p, decimal boxPrice, SaleUnit? unit) => unit switch
    {
        SaleUnit.Strip => p.StripPricePKR is > 0 ? p.StripPricePKR.Value : Share(boxPrice, p.StripUnits ?? 1, UnitsPerBox(p)),
        SaleUnit.Unit => p.LooseUnitPricePKR is > 0 ? p.LooseUnitPricePKR.Value : Share(boxPrice, 1, UnitsPerBox(p)),
        _ => boxPrice
    };

    // Half away from zero, as the till rounds, so the price it shows is the price charged.
    private static decimal Share(decimal boxPrice, int units, int perBox) =>
        Math.Round(boxPrice * units / perBox, 2, MidpointRounding.AwayFromZero);

    /// <summary>"Box", "Strip", "Tablet" — what a line's name carries, so a receipt or a return says it.</summary>
    public static string Label(Product p, SaleUnit? unit) => unit switch
    {
        SaleUnit.Pack => "Box",
        SaleUnit.Strip => "Strip",
        SaleUnit.Unit => LooseUnitName(p),
        _ => string.Empty
    };

    /// <summary>The catalogue cost of one of the stock's own unit (the product's cost is per box).</summary>
    public static decimal BaseCost(Product p) => p.CostPricePKR / UnitsPerBox(p);

    /// <summary>Packing as entered, checked. Null when it is fine.</summary>
    public static string? Validate(int? packUnits, int? stripUnits)
    {
        if (packUnits is null or <= 1)
            return stripUnits is > 1 ? "Enter how many the box holds before its strips." : null;
        if (packUnits > 10000) return "A box cannot hold more than 10,000.";
        if (stripUnits is null or <= 1) return null;
        if (stripUnits >= packUnits) return $"A strip must hold fewer than the box ({packUnits}).";
        if (packUnits % stripUnits != 0)
            return $"A box of {packUnits} cannot be made of strips of {stripUnits}: the strips must fill the box exactly.";
        return null;
    }

    /// <summary>
    /// The number of new stock units in one old one when packing changes: the pack size when a count
    /// in boxes becomes a count in tablets, its inverse the other way, and 1 when the count's unit
    /// does not change (a new pack size still counts tablets).
    /// </summary>
    public static decimal RebaseFactor(int? oldPackUnits, int? newPackUnits)
    {
        var wasPacked = oldPackUnits is > 1;
        var isPacked = newPackUnits is > 1;
        if (wasPacked == isPacked) return 1m;
        return isPacked ? newPackUnits!.Value : 1m / oldPackUnits!.Value;
    }

    /// <summary>
    /// Rescales everything that counts this product's stock by <paramref name="factor"/>: the counts at
    /// every location, the batches, the ledger and its batch movements, transfers, and the sales that
    /// took it. Values stay the same — a quantity is multiplied and the cost of one divided — so it is
    /// as if the product had always been counted this way, and a return or a cancelled transfer from
    /// before puts back exactly what it took. Purchase orders stay in boxes.
    /// Writes immediately: run it in the same transaction as the change to the product's packing.
    /// </summary>
    public static async Task RebaseStockAsync(AppDbContext db, Guid productId, decimal factor, bool nowPacked)
    {
        if (factor == 1m || factor <= 0m) return;

        await db.BranchStocks.IgnoreQueryFilters().Where(s => s.ProductId == productId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.QuantityOnHand, x => x.QuantityOnHand * factor)
                .SetProperty(x => x.MinAlertLevel, x => x.MinAlertLevel * factor)
                .SetProperty(x => x.AverageCostPKR, x => x.AverageCostPKR / factor));

        var batchIds = db.StockBatches.IgnoreQueryFilters().Where(b => b.ProductId == productId).Select(b => b.Id);
        await db.StockBatchMovements.IgnoreQueryFilters().Where(m => batchIds.Contains(m.BatchId))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.QuantityChange, x => x.QuantityChange * factor));
        await db.StockBatches.IgnoreQueryFilters().Where(b => b.ProductId == productId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.QuantityOnHand, x => x.QuantityOnHand * factor)
                .SetProperty(x => x.QuantityReceived, x => x.QuantityReceived * factor)
                .SetProperty(x => x.UnitCostPKR, x => x.UnitCostPKR / factor));

        await db.StockLedgerEntries.IgnoreQueryFilters().Where(e => e.ProductId == productId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.QuantityChange, x => x.QuantityChange * factor)
                .SetProperty(x => x.BalanceAfter, x => x.BalanceAfter * factor)
                .SetProperty(x => x.UnitCostPKR, x => x.UnitCostPKR / factor));

        await db.StockTransferItems.IgnoreQueryFilters().Where(i => i.ProductId == productId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.QuantityRequested, x => x.QuantityRequested * factor)
                .SetProperty(x => x.QuantityDispatched, x => x.QuantityDispatched * factor)
                .SetProperty(x => x.QuantityReceived, x => x.QuantityReceived * factor)
                .SetProperty(x => x.UnitCostPKR, x => x.UnitCostPKR / factor));

        // A sale from before was of whole boxes: say so, now that the product also sells loose.
        await db.OrderItems.IgnoreQueryFilters().Where(i => i.ProductId == productId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.UnitsPerSaleUnit, x => x.UnitsPerSaleUnit * factor));
        if (nowPacked)
            await db.OrderItems.IgnoreQueryFilters().Where(i => i.ProductId == productId && i.SaleUnit == null)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.SaleUnit, SaleUnit.Pack));
    }
}
