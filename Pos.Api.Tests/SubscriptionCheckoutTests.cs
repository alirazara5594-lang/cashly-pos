using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;
using Pos.Api.Services;
using Xunit;

namespace Pos.Api.Tests;

/// <summary>
/// The self-serve purchase path: price it, raise an invoice, and only then change anything.
///
/// The invariant under test throughout is that an unpaid checkout grants nothing. If that ever
/// stops holding, a business gets a feature it has not paid for and the invoice becomes a
/// receipt for something it did not buy.
/// </summary>
public class SubscriptionCheckoutTests
{
    private static readonly CheckoutRequest PlanRequest =
        new("plan", PlanCode: "standard", AddOnKey: null, Annual: false);

    private static async Task<SubscriptionInvoice> CheckoutPlanAsync(TestDatabase db, string planCode = "standard")
    {
        var outcome = await db.Checkout.CheckoutAsync(db.TenantId,
            new CheckoutRequest("plan", planCode, null, Annual: false), actingUserId: null);
        Assert.True(outcome.Ok, outcome.Error);
        return outcome.Invoice!;
    }

    // ---------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------

    [Fact]
    public async Task A_plan_costs_what_the_plan_list_says()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();

        var quote = await db.Checkout.QuoteAsync(db.TenantId, PlanRequest);

        var standard = db.Db.Plans.IgnoreQueryFilters().Single(p => p.Code == "standard");
        Assert.Equal("plan", quote.Kind);
        Assert.Equal("standard", quote.Code);
        Assert.Equal(1, quote.Quantity);
        Assert.Equal(standard.MonthlyPricePKR, quote.UnitPricePKR);
        Assert.Equal(standard.MonthlyPricePKR, quote.TotalPKR);
    }

    [Fact]
    public async Task Annual_billing_uses_the_annual_price()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();

        var quote = await db.Checkout.QuoteAsync(db.TenantId, PlanRequest with { Annual = true });

        var standard = db.Db.Plans.IgnoreQueryFilters().Single(p => p.Code == "standard");
        Assert.Equal(standard.YearlyPricePKR, quote.TotalPKR);
        Assert.NotEqual(standard.MonthlyPricePKR, quote.TotalPKR);
    }

    [Fact]
    public async Task Buying_the_plan_you_already_have_is_refused()
    {
        using var db = new TestDatabase();
        db.SeedTenant();   // seeded as Starter
        db.SeedPlans();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            db.Checkout.QuoteAsync(db.TenantId, new CheckoutRequest("plan", "starter", null)));

        Assert.Contains("already on this plan", ex.Message);
    }

    [Fact]
    public async Task An_unknown_plan_or_add_on_is_refused_rather_than_priced_at_zero()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();

        var plan = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            db.Checkout.QuoteAsync(db.TenantId, new CheckoutRequest("plan", "enterprise", null)));
        Assert.Contains("not available", plan.Message);

        var addOn = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            db.Checkout.QuoteAsync(db.TenantId, new CheckoutRequest("addon", null, "NOT_A_REAL_ADDON")));
        Assert.Contains("not available", addOn.Message);
    }

    // ---------------------------------------------------------
    // Checkout — the invoice is raised, nothing is granted
    // ---------------------------------------------------------

    [Fact]
    public async Task Checkout_raises_an_unpaid_invoice_and_grants_nothing()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();

        var invoice = await CheckoutPlanAsync(db);

        Assert.Equal(SubscriptionInvoiceStatus.Pending, invoice.Status);
        Assert.Null(invoice.PaidAt);
        Assert.Equal(db.TenantId, invoice.TenantId);
        Assert.True(invoice.AmountPKR > 0);
        Assert.False(string.IsNullOrWhiteSpace(invoice.EffectJson));
        Assert.Contains("standard", invoice.EffectJson);

        // The whole point: the plan has not moved, and no entitlement has been recomputed into
        // something the tenant has not paid for.
        Assert.Equal(SubscriptionTier.Starter, db.Db.Tenants.IgnoreQueryFilters().Single(t => t.Id == db.TenantId).Tier);
        var standardPlan = db.Db.Plans.IgnoreQueryFilters().Single(p => p.Code == "standard");
        Assert.DoesNotContain(db.Db.OrganizationSubscriptions.IgnoreQueryFilters().ToList(),
            s => s.TenantId == db.TenantId && s.PlanId == standardPlan.Id);

        // And the invoice says what it is for, so a receipt is readable on its own.
        Assert.Contains("Standard", invoice.LinesJson);
    }

    [Fact]
    public async Task An_add_on_checkout_grants_nothing_until_it_is_settled()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        db.SeedAddOn("HasKitchenDisplay", "Kitchen Display System", 2000, 20000);
        await db.Db.SaveChangesAsync();

        var outcome = await db.Checkout.CheckoutAsync(db.TenantId,
            new CheckoutRequest("addon", null, "HasKitchenDisplay"), actingUserId: null);

        Assert.True(outcome.Ok, outcome.Error);
        Assert.Empty(db.Db.AddOnSubscriptions.IgnoreQueryFilters().ToList());
        Assert.Equal(SubscriptionInvoiceStatus.Pending, outcome.Invoice!.Status);
    }

    // ---------------------------------------------------------
    // Settlement — one path, whether by webhook or by hand
    // ---------------------------------------------------------

    [Fact]
    public async Task Settling_the_invoice_moves_the_business_to_the_new_plan()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        var invoice = await CheckoutPlanAsync(db);

        var applied = await db.Checkout.SettleAsync(invoice, "JazzCash", actingUserId: null);

        Assert.True(applied);
        Assert.Equal(SubscriptionInvoiceStatus.Paid, invoice.Status);
        Assert.Equal("JazzCash", invoice.PaymentMethod);
        Assert.Equal(SubscriptionTier.Standard, db.Db.Tenants.IgnoreQueryFilters().Single(t => t.Id == db.TenantId).Tier);
        Assert.Single(db.Db.OrganizationSubscriptions.IgnoreQueryFilters().ToList());
    }

    [Fact]
    public async Task Paying_extends_the_paid_until_date_to_cover_the_billed_period()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        var invoice = await CheckoutPlanAsync(db);

        await db.Checkout.SettleAsync(invoice, null, actingUserId: null);

        var tenant = db.Db.Tenants.IgnoreQueryFilters().Single(t => t.Id == db.TenantId);
        Assert.Equal(invoice.BillingPeriodEnd, tenant.SubscriptionPaidUntil);
    }

    [Fact]
    public async Task Settling_the_same_invoice_twice_is_harmless()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        db.SeedAddOn("EXTRA_USER", "Extra Staff Account", 500, 5000);
        await db.Db.SaveChangesAsync();

        var outcome = await db.Checkout.CheckoutAsync(db.TenantId,
            new CheckoutRequest("addon", null, "EXTRA_USER", Quantity: 2), actingUserId: null);
        var invoice = outcome.Invoice!;

        Assert.True(await db.Checkout.SettleAsync(invoice, "Bank Transfer", actingUserId: null));
        var paidAt = invoice.PaidAt;

        // A webhook and a human pressing Mark Paid will both eventually arrive for the same
        // invoice. The second must not buy a second copy.
        Assert.True(await db.Checkout.SettleAsync(invoice, "JazzCash", actingUserId: null));

        Assert.Single(db.Db.AddOnSubscriptions.IgnoreQueryFilters().ToList());
        Assert.Equal(paidAt, invoice.PaidAt);
        Assert.Equal("Bank Transfer", invoice.PaymentMethod);
    }

    [Fact]
    public async Task An_add_on_is_priced_at_purchase_not_at_settlement()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        db.SeedAddOn("HasInventoryManagement", "Inventory Management", 3000, 30000);
        await db.Db.SaveChangesAsync();

        var outcome = await db.Checkout.CheckoutAsync(db.TenantId,
            new CheckoutRequest("addon", null, "HasInventoryManagement"), actingUserId: null);
        var invoice = outcome.Invoice!;

        // The list price goes up between the owner clicking Buy and the money arriving.
        var item = db.Db.AddOnCatalogItems.Single();
        item.MonthlyPricePKR = 9999;
        await db.Db.SaveChangesAsync();

        await db.Checkout.SettleAsync(invoice, null, actingUserId: null);

        Assert.Equal(3000m, db.Db.AddOnSubscriptions.IgnoreQueryFilters().Single().PricePKR);
    }

    [Fact]
    public async Task A_purchase_that_cannot_be_applied_still_says_it_was_paid_and_why()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();

        // The shape an invoice takes when the thing it bought was retired between purchase and
        // payment — the money is already gone, so the record must survive with the reason.
        var invoice = new SubscriptionInvoice
        {
            TenantId = db.TenantId,
            InvoiceNumber = "INV-99999",
            Tier = "Starter",
            BillingPeriodStart = DateTime.UtcNow,
            BillingPeriodEnd = DateTime.UtcNow.AddMonths(1),
            AmountPKR = 1000,
            Status = SubscriptionInvoiceStatus.Pending,
            DueAt = DateTime.UtcNow.AddDays(7),
            EffectJson = """{"kind":"plan","planCode":"a-plan-that-was-retired"}"""
        };
        db.Db.SubscriptionInvoices.Add(invoice);
        await db.Db.SaveChangesAsync();

        var applied = await db.Checkout.SettleAsync(invoice, null, actingUserId: null);

        Assert.False(applied);
        Assert.Equal(SubscriptionInvoiceStatus.Paid, invoice.Status);
        Assert.Contains("not applied", invoice.Notes);
        Assert.Contains("No active plan", invoice.Notes);
        Assert.Equal(SubscriptionTier.Starter, db.Db.Tenants.IgnoreQueryFilters().Single(t => t.Id == db.TenantId).Tier);
    }

    // ---------------------------------------------------------
    // Add-on rules
    // ---------------------------------------------------------

    [Fact]
    public async Task A_boolean_add_on_bought_twice_is_refused()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        db.SeedAddOn("HasDirectorDashboard", "Director Dashboard", 1500, 15000);
        await db.Db.SaveChangesAsync();

        var first = await db.Checkout.CheckoutAsync(db.TenantId,
            new CheckoutRequest("addon", null, "HasDirectorDashboard"), actingUserId: null);
        await db.Checkout.SettleAsync(first.Invoice!, null, actingUserId: null);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            db.Checkout.QuoteAsync(db.TenantId, new CheckoutRequest("addon", null, "HasDirectorDashboard")));

        Assert.Contains("already active", ex.Message);
    }

    [Fact]
    public async Task A_quantity_add_on_can_be_bought_again_to_get_more()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        db.SeedAddOn("EXTRA_USER", "Extra Staff Account", 500, 5000);
        await db.Db.SaveChangesAsync();

        var first = await db.Checkout.CheckoutAsync(db.TenantId,
            new CheckoutRequest("addon", null, "EXTRA_USER", Quantity: 1), actingUserId: null);
        await db.Checkout.SettleAsync(first.Invoice!, null, actingUserId: null);

        var second = await db.Checkout.CheckoutAsync(db.TenantId,
            new CheckoutRequest("addon", null, "EXTRA_USER", Quantity: 3), actingUserId: null);
        await db.Checkout.SettleAsync(second.Invoice!, null, actingUserId: null);

        var rows = db.Db.AddOnSubscriptions.IgnoreQueryFilters().ToList();
        Assert.Equal(2, rows.Count);
        Assert.Equal(4, rows.Sum(r => r.Quantity));
        Assert.Equal(500m * 4, rows.Sum(r => r.PricePKR * r.Quantity));
    }

    [Fact]
    public async Task The_invoice_records_what_it_sold_as_a_readable_snapshot()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        db.SeedAddOn("HasMultiBranch", "Multi-Branch Support", 4000, 40000);
        await db.Db.SaveChangesAsync();

        var outcome = await db.Checkout.CheckoutAsync(db.TenantId,
            new CheckoutRequest("addon", null, "HasMultiBranch", Annual: true), actingUserId: null);
        var invoice = outcome.Invoice!;

        Assert.Contains("Multi-Branch Support", invoice.LinesJson);
        Assert.Contains("40000", invoice.LinesJson);
        Assert.Contains("addon", invoice.EffectJson);
        Assert.Equal(40000m, invoice.AmountPKR);
    }
}
