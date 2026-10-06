using Microsoft.EntityFrameworkCore;
using Pos.Api.Models;
using Pos.Api.Services;
using Xunit;

namespace Pos.Api.Tests;

/// <summary>
/// The head-office half of catalogue sync: what the cloud hands a branch till, and what the till
/// does with it. The two rules under test are the ones that can lose money — a pull that overwrites
/// a menu the branch owns, and a "reconcile" that blanks an entire catalogue from an empty payload.
/// </summary>
public class CatalogSyncTests
{
    private static CatalogSnapshot Snap(
        List<CatalogCategoryDto>? categories = null,
        List<CatalogProductDto>? products = null,
        List<CatalogModifierDto>? modifiers = null,
        List<CatalogBranchPriceDto>? branchPrices = null,
        string catalogControl = "HeadOfficeOnly",
        bool branchPricing = false,
        string version = "v1") =>
        new(version, catalogControl, branchPricing,
            categories ?? new(), products ?? new(), modifiers ?? new(), branchPrices ?? new());

    private static CatalogProductDto Product(Guid id, Guid categoryId, string name, decimal price) =>
        new(id, categoryId, "", "", name, null, "", price, "Piece", null, "MainKitchen", true, false);

    // ---------------------------------------------------------
    // CLOUD SIDE
    // ---------------------------------------------------------

    [Fact]
    public async Task The_snapshot_only_reaches_this_tenant_and_this_branch()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);

        db.SeedProduct("Our item");
        var ours = await db.Db.Products.AsNoTracking().SingleAsync(p => p.Name == "Our item");

        // A different shop's price override, and a different shop's item: neither is this host's
        // to read, even though both live in the same database.
        db.Db.BranchProductPrices.Add(new BranchProductPrice
        {
            TenantId = db.TenantId, BranchId = Guid.NewGuid(), ProductId = ours.Id,
            SellingPricePKR = 1m
        });
        var otherTenantId = Guid.NewGuid();
        var otherCategoryId = Guid.NewGuid();
        db.Db.Tenants.Add(new Tenant
        {
            Id = otherTenantId, Name = "Other Business", Slug = $"other-business-{otherTenantId:N}"
        });
        db.Db.Categories.Add(new Category
        {
            Id = otherCategoryId, TenantId = otherTenantId, Name = "Other menu"
        });
        db.Db.Products.Add(new Product
        {
            TenantId = otherTenantId, CategoryId = otherCategoryId, Name = "Someone else's item"
        });
        db.Db.SaveChanges();

        var snapshot = await db.Builder.BuildAsync(db.TenantId, db.BranchId);

        Assert.Contains(snapshot.Products, p => p.Name == "Our item");
        Assert.DoesNotContain(snapshot.Products, p => p.Name == "Someone else's item");
        Assert.Empty(snapshot.BranchPrices);
        Assert.Equal("HeadOfficeOnly", snapshot.CatalogControl);
        Assert.False(snapshot.BranchPricing);
    }

    [Fact]
    public async Task The_version_is_stable_until_something_actually_changes()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);
        db.SeedProduct("Zinger Burger");
        var product = await db.Db.Products.SingleAsync(p => p.Name == "Zinger Burger");

        var first = await db.Builder.BuildAsync(db.TenantId, db.BranchId);
        var again = await db.Builder.BuildAsync(db.TenantId, db.BranchId);

        Assert.Equal(first.CatalogVersion, again.CatalogVersion);
        Assert.NotEqual(first.CatalogVersion, string.Empty);

        product.SellingPricePKR = 999m;
        await db.Db.SaveChangesAsync();

        var changed = await db.Builder.BuildAsync(db.TenantId, db.BranchId);
        Assert.NotEqual(first.CatalogVersion, changed.CatalogVersion);
    }

    // ---------------------------------------------------------
    // HOST SIDE — the two refusals
    // ---------------------------------------------------------

    [Fact]
    public async Task A_host_whose_branches_edit_their_own_menu_refuses_the_pull()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.BranchesMayEdit);
        var categoryId = Guid.NewGuid();
        var productId = Guid.NewGuid();

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap(
            new() { new(categoryId, "Burgers", null, "burger", 1, false) },
            new() { Product(productId, categoryId, "Zinger Burger", 650m) }));

        Assert.False(result.Applied);
        Assert.Contains("edited locally", result.SkippedBecause ?? string.Empty);
        Assert.Empty(await db.Db.Products.AsNoTracking().ToListAsync());
        Assert.Empty(await db.Db.Categories.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task An_empty_head_office_catalogue_never_retires_a_working_menu()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);
        db.SeedProduct("Zinger Burger");

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap());

        Assert.False(result.Applied);
        Assert.Contains("refusing", result.SkippedBecause ?? string.Empty);
        Assert.True((await db.Db.Products.AsNoTracking().SingleAsync()).IsActive);
    }

    // ---------------------------------------------------------
    // HOST SIDE — the happy path
    // ---------------------------------------------------------

    [Fact]
    public async Task An_empty_host_wakes_up_with_a_complete_menu()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);

        var categoryId = Guid.NewGuid();
        var productId = Guid.NewGuid();
        var modifierId = Guid.NewGuid();

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap(
            new() { new(categoryId, "Burgers", "برگرز", "burger", 1, false) },
            new() { Product(productId, categoryId, "Zinger Burger", 650m) },
            new() { new(modifierId, productId, "Extra Cheese", 50m, null, null) }));

        Assert.True(result.Applied);
        Assert.Equal(1, result.CategoriesWritten);
        Assert.Equal(1, result.ProductsWritten);
        Assert.Empty(result.Reasons);

        var product = await db.Db.Products.AsNoTracking().Include(p => p.Modifiers).SingleAsync();
        Assert.Equal("Zinger Burger", product.Name);
        Assert.Equal(650m, product.SellingPricePKR);
        Assert.Equal(categoryId, product.CategoryId);

        var category = await db.Db.Categories.AsNoTracking().SingleAsync();
        Assert.Equal(db.TenantId, category.TenantId);
        Assert.Equal("برگرز", category.LocalName);

        Assert.Equal("Extra Cheese", (await db.Db.ProductModifiers.AsNoTracking().SingleAsync()).Name);
    }

    [Fact]
    public async Task A_price_change_at_head_office_reaches_the_till()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);
        db.SeedProduct("Zinger Burger");
        var local = await db.Db.Products.SingleAsync(p => p.Name == "Zinger Burger");
        var categoryId = local.CategoryId;

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap(
            new() { new(categoryId, "Burgers", null, "burger", 1, false) },
            new() { Product(local.Id, categoryId, "Zinger Burger", 750m) }));

        Assert.True(result.Applied);
        Assert.Equal(750m, (await db.Db.Products.AsNoTracking().SingleAsync()).SellingPricePKR);
        Assert.Equal(0, result.ProductsRetired);
    }

    // ---------------------------------------------------------
    // HOST SIDE — reconciliation
    // ---------------------------------------------------------

    [Fact]
    public async Task An_item_head_office_dropped_is_retired_not_deleted()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);
        db.SeedProduct("Old Burger");
        var old = await db.Db.Products.SingleAsync(p => p.Name == "Old Burger");

        var categoryId = Guid.NewGuid();
        var newId = Guid.NewGuid();

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap(
            new() { new(categoryId, "Burgers", null, "burger", 1, false) },
            new() { Product(newId, categoryId, "New Burger", 650m) }));

        Assert.True(result.Applied);
        Assert.Equal(1, result.ProductsRetired);

        // Retirement, because OrderItem rows still point at it. Deleting would either fail the
        // foreign key or quietly take a past sale's line item with it.
        var survivors = await db.Db.Products.AsNoTracking().ToListAsync();
        Assert.Equal(2, survivors.Count);
        Assert.False(survivors.Single(p => p.Id == old.Id).IsActive);
        Assert.True(survivors.Single(p => p.Id == newId).IsActive);
    }

    [Fact]
    public async Task A_category_head_office_dropped_is_kept_while_it_still_holds_items()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);
        db.SeedProduct("Zinger Burger"); // creates the "Burgers" category and fills it

        var categoryId = (await db.Db.Categories.AsNoTracking().SingleAsync()).Id;
        var productId = (await db.Db.Products.AsNoTracking().SingleAsync()).Id;

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap(
            products: new() { Product(productId, categoryId, "Zinger Burger", 650m) }));

        Assert.True(result.Applied);
        Assert.Contains("still holds items", result.ReasonSummary ?? string.Empty);
        Assert.Single(await db.Db.Categories.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task A_category_head_office_dropped_is_removed_when_nothing_points_at_it()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);
        db.Db.Categories.Add(new Category { TenantId = db.TenantId, Name = "Empty", Icon = "utensils" });
        await db.Db.SaveChangesAsync();

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap());

        Assert.True(result.Applied);
        Assert.Empty(await db.Db.Categories.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task A_product_whose_category_did_not_arrive_is_skipped_but_not_retired()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);

        var orphanCategoryId = Guid.NewGuid();
        var productId = Guid.NewGuid();

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap(
            products: new() { Product(productId, orphanCategoryId, "Orphan", 650m) }));

        Assert.True(result.Applied);
        Assert.Equal(0, result.ProductsWritten);
        Assert.Contains("references a category", result.ReasonSummary ?? string.Empty);
        // Present at head office, so it must not be retired — it simply could not be written.
        Assert.Equal(0, result.ProductsRetired);
        Assert.Empty(await db.Db.Products.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task An_ingredient_this_host_never_heard_of_is_unlinked_rather_than_blocking()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);

        var categoryId = Guid.NewGuid();
        var productId = Guid.NewGuid();
        var modifierId = Guid.NewGuid();

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId, Snap(
            new() { new(categoryId, "Burgers", null, "burger", 1, false) },
            new() { Product(productId, categoryId, "Zinger Burger", 650m) },
            new() { new(modifierId, productId, "Extra Cheese", 50m, Guid.NewGuid(), 1m) }));

        Assert.True(result.Applied);
        var modifier = await db.Db.ProductModifiers.AsNoTracking().SingleAsync();
        Assert.Null(modifier.IngredientId);
        Assert.Equal(50m, modifier.PricePKR);
        Assert.Contains("unknown here", result.ReasonSummary ?? string.Empty);
    }

    // ---------------------------------------------------------
    // HOST SIDE — per-branch prices
    // ---------------------------------------------------------

    [Fact]
    public async Task Branch_set_prices_are_left_alone_when_the_branch_owns_them()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly, branchPricing: true);

        var localPriceId = Guid.NewGuid();
        db.Db.BranchProductPrices.Add(new BranchProductPrice
        {
            TenantId = db.TenantId, BranchId = db.BranchId,
            ProductId = Guid.NewGuid(), SellingPricePKR = 100m
        });
        await db.Db.SaveChangesAsync();

        var incoming = new CatalogBranchPriceDto(Guid.NewGuid(), Guid.NewGuid(), 999m, true, DateTime.UtcNow);

        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId,
            Snap(branchPrices: new() { incoming }, branchPricing: false));

        Assert.True(result.Applied);
        var prices = await db.Db.BranchProductPrices.AsNoTracking().ToListAsync();
        Assert.Single(prices);
        Assert.Equal(100m, prices[0].SellingPricePKR);
        Assert.Contains("prices were left alone", result.ReasonSummary ?? string.Empty);
    }

    [Fact]
    public async Task When_head_office_sets_prices_the_local_overrides_are_replaced_outright()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly, branchPricing: false);

        db.Db.BranchProductPrices.Add(new BranchProductPrice
        {
            Id = Guid.NewGuid(), TenantId = db.TenantId, BranchId = db.BranchId,
            ProductId = Guid.NewGuid(), SellingPricePKR = 100m
        });
        await db.Db.SaveChangesAsync();

        var incomingId = Guid.NewGuid();
        var result = await db.Catalog.ApplyAsync(db.TenantId, db.BranchId,
            Snap(branchPrices: new() { new(incomingId, Guid.NewGuid(), 999m, true, DateTime.UtcNow) }));

        Assert.True(result.Applied);
        var prices = await db.Db.BranchProductPrices.AsNoTracking().ToListAsync();
        Assert.Single(prices);
        Assert.Equal(incomingId, prices[0].Id);
        Assert.Equal(999m, prices[0].SellingPricePKR);
        Assert.Equal(db.BranchId, prices[0].BranchId);
    }

    [Fact]
    public async Task Without_a_branch_id_per_branch_prices_are_reported_and_untouched()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedSettings(CatalogControl.HeadOfficeOnly);

        db.Db.BranchProductPrices.Add(new BranchProductPrice
        {
            TenantId = db.TenantId, BranchId = db.BranchId,
            ProductId = Guid.NewGuid(), SellingPricePKR = 100m
        });
        await db.Db.SaveChangesAsync();

        var result = await db.Catalog.ApplyAsync(db.TenantId, branchId: null,
            Snap(branchPrices: new() { new(Guid.NewGuid(), Guid.NewGuid(), 999m, true, DateTime.UtcNow) }));

        Assert.True(result.Applied);
        Assert.Contains("branch is unknown", result.ReasonSummary ?? string.Empty);
        Assert.Equal(100m, (await db.Db.BranchProductPrices.AsNoTracking().SingleAsync()).SellingPricePKR);
    }
}
