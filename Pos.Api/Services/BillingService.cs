using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// BILLING
//
// What a business pays, line by line:
//   • the Head Office ERP — one flat price, only for a business with a head office;
//   • every shop that sells, at its POS version's price — the single-shop price for a shop
//     without a head office (its version also runs its back office), the lower branch price for
//     a branch of a head-office business (its back office is the ERP);
//   • every add-on, at the price agreed when it was added, times its quantity.
// Warehouses and the head office itself hold no till and cost nothing.
// ============================================================

public sealed record BillingLine(
    string Kind,             // "erp" | "pos" | "addon"
    string Description,
    int Quantity,
    decimal UnitPricePKR,
    decimal AmountPKR,
    Guid? BranchId = null,
    string? Code = null);

public sealed record BillingQuote(Guid TenantId, bool Annual, bool HasHeadOffice, IReadOnlyList<BillingLine> Lines)
{
    public decimal TotalPKR => Lines.Sum(l => l.AmountPKR);
}

public interface IBillingService
{
    /// <summary>What the business pays for one month (or one year) at today's prices.</summary>
    Task<BillingQuote> QuoteAsync(Guid tenantId, bool annual = false);
}

public class BillingService : IBillingService
{
    private readonly AppDbContext _db;

    public BillingService(AppDbContext db) => _db = db;

    public async Task<BillingQuote> QuoteAsync(Guid tenantId, bool annual = false)
    {
        var tenant = await _db.Tenants.AsNoTracking().IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId)
            ?? throw new InvalidOperationException($"Tenant {tenantId} not found.");
        var hasHeadOffice = tenant.DeploymentMode == DeploymentMode.HeadOffice;

        var packages = await _db.SaaSPackageConfigs.AsNoTracking().ToListAsync();
        SaaSPackageConfig? PackageFor(SubscriptionTier tier) =>
            packages.FirstOrDefault(p => string.Equals(p.PackageKey, tier.ToString(), StringComparison.OrdinalIgnoreCase));

        var lines = new List<BillingLine>();

        // 1. The Head Office ERP.
        if (hasHeadOffice)
        {
            var erp = await _db.PlatformPrices.AsNoTracking().FirstOrDefaultAsync(p => p.Key == FeatureCatalog.HeadOfficeErpPriceKey);
            var price = annual ? erp?.YearlyPricePKR ?? FeatureCatalog.HeadOfficeErpYearly : erp?.MonthlyPricePKR ?? FeatureCatalog.HeadOfficeErpMonthly;
            lines.Add(new BillingLine("erp", erp?.DisplayName ?? "Head Office ERP", 1, price, price, Code: FeatureCatalog.HeadOfficeErpPriceKey));
        }

        // 2. Every shop that sells, at its own POS version.
        var shops = await _db.Branches.AsNoTracking().IgnoreQueryFilters()
            .Where(b => b.TenantId == tenantId && b.CanSell)
            .OrderBy(b => b.Name)
            .Select(b => new { b.Id, b.Name, b.PosEdition })
            .ToListAsync();
        foreach (var shop in shops)
        {
            var edition = shop.PosEdition ?? tenant.Tier;
            var price = PosPrice(PackageFor(edition), edition, branchOfHeadOffice: hasHeadOffice, annual);
            lines.Add(new BillingLine("pos", $"{shop.Name}: {edition} POS{(hasHeadOffice ? " (branch)" : "")}", 1, price, price,
                shop.Id, edition.ToString()));
        }
        // A single shop is billed for its version even before its location exists.
        if (!hasHeadOffice && shops.Count == 0)
        {
            var price = PosPrice(PackageFor(tenant.Tier), tenant.Tier, branchOfHeadOffice: false, annual);
            lines.Add(new BillingLine("pos", $"{tenant.Name}: {tenant.Tier} POS", 1, price, price, Code: tenant.Tier.ToString()));
        }

        // 3. Add-ons, at the price agreed when each was added.
        var addOns = await _db.AddOnSubscriptions.AsNoTracking().IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId && a.IsActive)
            .ToListAsync();
        if (addOns.Count > 0)
        {
            var catalogue = await _db.AddOnCatalogItems.AsNoTracking().ToListAsync();
            var shopNames = await _db.Branches.AsNoTracking().IgnoreQueryFilters()
                .Where(b => b.TenantId == tenantId)
                .ToDictionaryAsync(b => b.Id, b => b.Name);
            foreach (var addOn in addOns.OrderBy(a => a.AddOnKey))
            {
                var item = catalogue.FirstOrDefault(c => c.Key == addOn.AddOnKey);
                // A yearly bill uses the catalogue's yearly price when the add-on was sold at the
                // list price; a specially agreed monthly price is simply taken ten times.
                var unit = !annual
                    ? addOn.PricePKR
                    : item != null && addOn.PricePKR == item.MonthlyPricePKR ? item.YearlyPricePKR : addOn.PricePKR * 10;
                var where = addOn.BranchId != null && shopNames.TryGetValue(addOn.BranchId.Value, out var shopName) ? $" ({shopName})" : "";
                var quantity = Math.Max(1, addOn.Quantity);
                lines.Add(new BillingLine("addon", $"{item?.DisplayName ?? addOn.AddOnKey}{where}", quantity, unit, unit * quantity,
                    addOn.BranchId, addOn.AddOnKey));
            }
        }

        return new BillingQuote(tenantId, annual, hasHeadOffice, lines);
    }

    private static decimal PosPrice(SaaSPackageConfig? package, SubscriptionTier edition, bool branchOfHeadOffice, bool annual)
    {
        if (!branchOfHeadOffice)
            return annual ? package?.YearlyPricePKR ?? 0 : package?.MonthlyPricePKR ?? 0;

        // Branch price; a package row from before branch prices existed falls back to the catalogue.
        var configured = annual ? package?.BranchYearlyPricePKR ?? 0 : package?.BranchMonthlyPricePKR ?? 0;
        if (configured > 0) return configured;
        return FeatureCatalog.BranchPrices.TryGetValue(edition.ToString(), out var list)
            ? annual ? list.Yearly : list.Monthly
            : 0;
    }
}
