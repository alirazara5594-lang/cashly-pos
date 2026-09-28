using System;
using System.Collections.Generic;

namespace Pos.Api.Models;

// ============================================================
// RETURNS
//
// A void cancels a whole sale as if it never happened. A return is the everyday case: the customer
// brings back some of what they bought, days later, and gets money back for exactly that. The
// original sale is never edited — the return is its own document, with its own number, its own
// refund, its own restock and its own journal entry.
// ============================================================

public class OrderReturn
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }

    /// <summary>Where the goods came back to — normally the branch that sold them.</summary>
    public Guid BranchId { get; set; }
    public Guid OrderId { get; set; }

    /// <summary>e.g. RET-260928-0001, numbered per business like every other document.</summary>
    public string ReturnNumber { get; set; } = string.Empty;

    /// <summary>How the customer was paid back.</summary>
    public PaymentMethod RefundMethod { get; set; } = PaymentMethod.Cash;

    /// <summary>The goods' value after the sale's discount, before tax.</summary>
    public decimal SubTotalRefundedPKR { get; set; }
    public decimal TaxRefundedPKR { get; set; }
    public decimal TotalRefundedPKR { get; set; }

    /// <summary>Whether the goods went back into stock (false for damaged or opened goods).</summary>
    public bool Restocked { get; set; } = true;

    public string? Reason { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public Guid? CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<OrderReturnLine> Lines { get; set; } = new List<OrderReturnLine>();
}

public class OrderReturnLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderReturnId { get; set; }
    public OrderReturn? OrderReturn { get; set; }

    /// <summary>The sale line being returned, so the same unit cannot be returned twice.</summary>
    public Guid OrderItemId { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public int Quantity { get; set; }

    /// <summary>The price the customer paid for one, as recorded on the sale.</summary>
    public decimal UnitPricePKR { get; set; }
    public decimal TotalPKR { get; set; }
}
