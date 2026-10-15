using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// SALE ARITHMETIC — what a saved sale comes to, for the books, refunds and tax reports.
//
// A sale's tax is either inside its prices or added on top (TenantSettings.PricesIncludeTax), and
// part of it may be paid by a gift card or loyalty points after tax. The journal, a refund and a
// tax report each used to redo that arithmetic their own way, assuming tax on top and money for the
// whole bill. These are the one way to do it, worked out from the sale as saved.
// ============================================================

public static class SaleMath
{
    /// <summary>What the bill came to before a gift card or loyalty points paid part of it.</summary>
    public static decimal BillBeforeCredits(Order order) =>
        order.TotalPKR + order.GiftCardRedeemedPKR + order.LoyaltyDiscountPKR;

    /// <summary>
    /// Whether the sale's prices already held its tax. Read from the sale itself: with tax on top
    /// the bill is the discounted subtotal plus the tax; with tax inside it is the discounted
    /// subtotal alone. A sale with no tax reads as tax on top, where both come to the same.
    /// </summary>
    public static bool TaxIncludedInPrices(Order order)
    {
        if (order.TaxPKR <= 0) return false;
        var bill = BillBeforeCredits(order);
        var net = order.SubTotalPKR - order.DiscountPKR;
        return Math.Abs(bill - net) < Math.Abs(bill - (net + order.TaxPKR));
    }

    /// <summary>The ledger account a payment lands in, and a refund leaves from.</summary>
    public static string SettlementAccount(PaymentMethod method) => method switch
    {
        PaymentMethod.Cash => "1000",
        PaymentMethod.Card or PaymentMethod.JazzCash or PaymentMethod.EasyPaisa or PaymentMethod.Raast => "1020",
        _ => "1100" // Split / CustomerKhata: receivable, as it is not settled in full in cash
    };

    /// <summary>
    /// The sale's journal lines. The money received is debited to where it was paid; what a gift
    /// card or loyalty points covered is a discount (4900), as a card is given out without money
    /// being booked. Revenue is the bill less its tax, so the entry balances whether the tax was
    /// inside the prices or on top. Cost of sale moves stock out of inventory.
    /// </summary>
    public static List<(string Account, decimal Debit, decimal Credit)> SaleJournalLines(Order order, decimal costOfSale)
    {
        var credits = order.GiftCardRedeemedPKR + order.LoyaltyDiscountPKR;
        var revenue = BillBeforeCredits(order) - order.TaxPKR;
        var lines = new List<(string, decimal, decimal)>();
        if (order.TotalPKR > 0) lines.Add((SettlementAccount(order.PaymentMethod), order.TotalPKR, 0m));
        if (credits > 0) lines.Add(("4900", credits, 0m));
        if (revenue != 0) lines.Add(("4000", 0m, revenue));
        if (order.TaxPKR > 0) lines.Add(("2100", 0m, order.TaxPKR));
        if (costOfSale > 0)
        {
            lines.Add(("5000", costOfSale, 0m));
            lines.Add(("1200", 0m, costOfSale));
        }
        return lines;
    }

    /// <summary>
    /// What part of one sale line comes to, excluding tax, after the line's share of the bill's
    /// discount — and the tax on it. A line from before tax was worked out per item takes its share
    /// of the bill's tax instead.
    /// </summary>
    public static (decimal Net, decimal Tax) LineValue(Order order, OrderItem item, decimal quantity)
    {
        if (item.Quantity <= 0 || quantity <= 0) return (0m, 0m);
        var fraction = quantity / item.Quantity;
        var discountShare = order.SubTotalPKR > 0 ? order.DiscountPKR / order.SubTotalPKR : 0m;
        var afterDiscount = item.TotalPricePKR * (1 - discountShare) * fraction;
        var inclusive = TaxIncludedInPrices(order);

        decimal tax;
        if (item.TaxPKR is decimal lineTax)
            tax = lineTax * fraction;
        else
        {
            var taxable = order.SubTotalPKR - order.DiscountPKR;
            tax = taxable > 0 ? afterDiscount * order.TaxPKR / taxable : 0m;
        }
        return (inclusive ? afterDiscount - tax : afterDiscount, tax);
    }

    /// <summary>
    /// What goes back to the customer for the lines returned: their value and the tax on them, each
    /// line at its own tax, and never more than is still refundable on the sale (what was paid in
    /// money, less earlier refunds).
    /// </summary>
    public static (decimal Net, decimal Tax) ReturnAmounts(Order order, IEnumerable<(OrderItem Item, int Quantity)> lines)
    {
        decimal net = 0, tax = 0;
        foreach (var (item, quantity) in lines)
        {
            var (lineNet, lineTax) = LineValue(order, item, quantity);
            net += lineNet;
            tax += lineTax;
        }
        net = Math.Round(net, 2);
        tax = Math.Round(tax, 2);

        var stillRefundable = Math.Max(0, order.TotalPKR - order.RefundedPKR);
        if (net + tax > stillRefundable)
        {
            // Part of the bill was paid by a gift card or points, or most of it is already refunded:
            // the money back stops at what is left, the tax first in proportion.
            var scale = net + tax > 0 ? stillRefundable / (net + tax) : 0m;
            tax = Math.Round(tax * scale, 2);
            net = stillRefundable - tax;
        }
        return (net, tax);
    }
}
