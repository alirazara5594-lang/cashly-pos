using Pos.Api.Models;
using Pos.Api.Services;
using Xunit;

namespace Pos.Api.Tests;

/// <summary>
/// The arithmetic behind a sale's journal entry and its refunds (Services/SaleMath.cs). Each test is
/// a real till example: tax on top, tax inside the prices, an exempt item on a mixed bill, a
/// discount, and part of the bill paid by a gift card or loyalty points. The journal must always
/// balance — an entry that does not is refused, and the sale then never reaches the books.
/// </summary>
public class SaleMathTests
{
    private static OrderItem Line(decimal total, int quantity, TaxTreatment? treatment = null, decimal? ratePercent = null, decimal? tax = null) => new()
    {
        ProductName = "Item",
        Quantity = quantity,
        UnitPricePKR = total / quantity,
        TotalPricePKR = total,
        TaxTreatment = treatment,
        TaxRatePercent = ratePercent,
        TaxPKR = tax
    };

    private static Order Sale(decimal subTotal, decimal discount, decimal tax, decimal total, params OrderItem[] items)
    {
        var order = new Order
        {
            SubTotalPKR = subTotal, DiscountPKR = discount, TaxPKR = tax, TotalPKR = total,
            PaymentMethod = PaymentMethod.Cash, IsPaid = true
        };
        foreach (var item in items) order.Items.Add(item);
        return order;
    }

    private static void AssertBalanced(List<(string Account, decimal Debit, decimal Credit)> lines) =>
        Assert.Equal(lines.Sum(l => l.Debit), lines.Sum(l => l.Credit));

    private static decimal Amount(List<(string Account, decimal Debit, decimal Credit)> lines, string account) =>
        lines.Where(l => l.Account == account).Sum(l => l.Debit + l.Credit);

    [Fact]
    public void Tax_on_top_posts_the_bill_less_its_tax_as_revenue()
    {
        // 2 burgers × 1,000 at 16%: 2,000 + 320 tax = 2,320 in cash.
        var order = Sale(2000, 0, 320, 2320, Line(2000, 2, TaxTreatment.Standard, 16, 320));
        var lines = SaleMath.SaleJournalLines(order, 0);

        AssertBalanced(lines);
        Assert.Equal(2320, Amount(lines, "1000"));
        Assert.Equal(2000, Amount(lines, "4000"));
        Assert.Equal(320, Amount(lines, "2100"));
    }

    [Fact]
    public void Prices_that_include_tax_still_balance()
    {
        // A shampoo at 1,180 with 18% inside it: revenue 1,000, tax 180. This entry used to be refused.
        var order = Sale(1180, 0, 180, 1180, Line(1180, 1, TaxTreatment.Standard, 18, 180));
        var lines = SaleMath.SaleJournalLines(order, 0);

        Assert.True(SaleMath.TaxIncludedInPrices(order));
        AssertBalanced(lines);
        Assert.Equal(1180, Amount(lines, "1000"));
        Assert.Equal(1000, Amount(lines, "4000"));
        Assert.Equal(180, Amount(lines, "2100"));
    }

    [Fact]
    public void A_gift_card_payment_is_booked_as_a_discount_and_the_entry_balances()
    {
        // Bill 2,320; a gift card pays 500, cash 1,820.
        var order = Sale(2000, 0, 320, 1820, Line(2000, 2, TaxTreatment.Standard, 16, 320));
        order.GiftCardRedeemedPKR = 500;
        var lines = SaleMath.SaleJournalLines(order, 0);

        AssertBalanced(lines);
        Assert.Equal(1820, Amount(lines, "1000"));
        Assert.Equal(500, Amount(lines, "4900"));
        Assert.Equal(2000, Amount(lines, "4000"));
    }

    [Fact]
    public void A_bill_paid_in_full_by_points_has_no_cash_line_and_still_balances()
    {
        var order = Sale(2000, 0, 320, 0, Line(2000, 2, TaxTreatment.Standard, 16, 320));
        order.LoyaltyDiscountPKR = 2320;
        var lines = SaleMath.SaleJournalLines(order, 150);

        AssertBalanced(lines);
        Assert.DoesNotContain(lines, l => l.Account == "1000");
        Assert.Equal(2320, Amount(lines, "4900"));
        Assert.Equal(150, Amount(lines, "5000"));
    }

    [Fact]
    public void Loyalty_points_do_not_confuse_tax_inside_the_prices()
    {
        // 1,180 with tax inside, 100 paid by points: 1,080 in money.
        var order = Sale(1180, 0, 180, 1080, Line(1180, 1, TaxTreatment.Standard, 18, 180));
        order.LoyaltyDiscountPKR = 100;

        Assert.True(SaleMath.TaxIncludedInPrices(order));
        AssertBalanced(SaleMath.SaleJournalLines(order, 0));
    }

    [Fact]
    public void Returning_an_exempt_item_gives_back_no_tax()
    {
        // Panadol 100 (exempt) and shampoo 100 at 18%, tax on top: the bill is 218.
        var panadol = Line(100, 1, TaxTreatment.Exempt, 0, 0);
        var shampoo = Line(100, 1, TaxTreatment.Standard, 18, 18);
        var order = Sale(200, 0, 18, 218, panadol, shampoo);

        var (net, tax) = SaleMath.ReturnAmounts(order, new[] { (panadol, 1) });

        Assert.Equal(100, net);
        Assert.Equal(0, tax);
    }

    [Fact]
    public void Returning_one_of_two_items_with_tax_inside_gives_back_what_was_paid_for_it()
    {
        // Two shampoos at 1,180 each, 18% inside: the customer paid 1,180 for each, not 1,360.
        var shampoos = Line(2360, 2, TaxTreatment.Standard, 18, 360);
        var order = Sale(2360, 0, 360, 2360, shampoos);

        var (net, tax) = SaleMath.ReturnAmounts(order, new[] { (shampoos, 1) });

        Assert.Equal(1000, net);
        Assert.Equal(180, tax);
        Assert.Equal(1180, net + tax);
    }

    [Fact]
    public void A_return_takes_its_share_of_the_bill_discount()
    {
        // Two items at 500, 16% on top, 100 off the bill: each line is 450 + 72 tax.
        var first = Line(500, 1, TaxTreatment.Standard, 16, 72);
        var second = Line(500, 1, TaxTreatment.Standard, 16, 72);
        var order = Sale(1000, 100, 144, 1044, first, second);

        var (net, tax) = SaleMath.ReturnAmounts(order, new[] { (first, 1) });

        Assert.Equal(450, net);
        Assert.Equal(72, tax);
    }

    [Fact]
    public void A_refund_never_pays_back_more_money_than_was_paid()
    {
        // Bill 218, of which a gift card paid 100: only the 118 paid in money can come back.
        var panadol = Line(100, 1, TaxTreatment.Exempt, 0, 0);
        var shampoo = Line(100, 1, TaxTreatment.Standard, 18, 18);
        var order = Sale(200, 0, 18, 118, panadol, shampoo);
        order.GiftCardRedeemedPKR = 100;

        var (net, tax) = SaleMath.ReturnAmounts(order, new[] { (panadol, 1), (shampoo, 1) });

        Assert.Equal(118, net + tax);
        Assert.True(tax < 18);
    }

    [Fact]
    public void A_sale_from_before_per_item_tax_returns_its_share_of_the_bill_tax()
    {
        // No tax on the lines (an older sale): 2 × 500 + 16% on top.
        var line = Line(1000, 2);
        var order = Sale(1000, 0, 160, 1160, line);

        var (net, tax) = SaleMath.ReturnAmounts(order, new[] { (line, 1) });

        Assert.Equal(500, net);
        Assert.Equal(80, tax);
    }
}
