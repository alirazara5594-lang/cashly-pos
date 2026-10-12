namespace Pos.Api.Models;

// ============================================================
// BATCHES AND MEDICINES
//
// A product's count at a location (BranchStock.QuantityOnHand) stays the one number every screen
// and report reads. For a business whose stock carries batches and expiry dates — a pharmacy, a
// grocery — that count is broken down into batches underneath it: what was received together, under
// one batch number, expiring on one date. Stock leaves the earliest-expiring good batch first, and
// every batch movement is tied to the ledger entry that caused it, so a return or a cancelled
// transfer goes back into exactly the batches it came out of.
//
// Stock with no batch (received before batches existed, or by a business that does not use them) is
// simply the part of the count the batches do not cover.
// ============================================================

/// <summary>How a medicine may be sold. <see cref="None"/> means the product is not a medicine.</summary>
public enum MedicineSchedule
{
    None = 0,
    /// <summary>Over the counter: sold freely.</summary>
    OverTheCounter = 1,
    /// <summary>Prescription only: a prescription is recorded with the sale.</summary>
    Prescription = 2,
    /// <summary>Controlled (narcotic / psychotropic): prescription plus the controlled-medicine register.</summary>
    Controlled = 3
}

/// <summary>Stock of one product at one location received under one batch number and expiry date.</summary>
public class StockBatch
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Guid ProductId { get; set; }
    public string BatchNumber { get; set; } = string.Empty;
    /// <summary>The last day the stock may be sold (date only). Null when the supplier gave none.</summary>
    public DateTime? ExpiryDate { get; set; }
    public decimal QuantityOnHand { get; set; }
    /// <summary>Everything ever put into this batch, bonus included.</summary>
    public decimal QuantityReceived { get; set; }
    /// <summary>What one unit of this batch cost, after any bonus units.</summary>
    public decimal UnitCostPKR { get; set; }
    /// <summary>The retail price printed on the pack, when it differs from the product's price.</summary>
    public decimal? RetailPricePKR { get; set; }
    public string? SupplierName { get; set; }
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One batch's share of one stock movement (a <see cref="StockLedgerEntry"/>). A sale of 10 drawn
/// from two batches is one ledger entry and two of these.
/// </summary>
public class StockBatchMovement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BatchId { get; set; }
    public Guid StockLedgerEntryId { get; set; }
    public decimal QuantityChange { get; set; }
    /// <summary>
    /// For stock put back (a return, a cancellation): the sale or transfer it came out of, so a
    /// second partial return cannot put back more than was taken.
    /// </summary>
    public Guid? RestoresReferenceId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
