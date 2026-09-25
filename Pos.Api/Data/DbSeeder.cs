using System;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Models;

namespace Pos.Api.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        // --- Plans and their feature rows -----------------------------------
        // Seeded from FeatureCatalog so the matrix has exactly one definition. Feature rows are
        // reconciled on every start: adding a capability to the catalogue makes it appear on the
        // existing plans without a migration, which is the whole reason features are rows.
        foreach (var (code, name, description, monthly, yearly, rank) in FeatureCatalog.Plans)
        {
            var plan = await db.Plans.FirstOrDefaultAsync(p => p.Code == code);
            if (plan == null)
            {
                plan = new Plan
                {
                    Code = code, Name = name, Description = description,
                    MonthlyPricePKR = monthly, YearlyPricePKR = yearly, Rank = rank, IsActive = true
                };
                db.Plans.Add(plan);
                await db.SaveChangesAsync();
            }

            var existingCodes = await db.PlanFeatures
                .Where(f => f.PlanId == plan.Id)
                .Select(f => f.FeatureCode)
                .ToListAsync();

            // Only ADD missing rows. An operator who deliberately raised a limit for a plan must
            // not have that overwritten every time the service restarts.
            var missing = FeatureCatalog.BuildFeatureRows(plan.Id, plan.Code)
                .Where(r => !existingCodes.Contains(r.FeatureCode))
                .ToList();

            if (missing.Count > 0)
            {
                db.PlanFeatures.AddRange(missing);
                await db.SaveChangesAsync();
            }
        }

        // Only seed super admin — everything else is created by the user
        if (!await db.Users.AnyAsync(u => u.Role == UserRole.SuperAdmin))
        {
            var superAdmin = new AppUser
            {
                Id = Guid.NewGuid(),
                TenantId = Guid.Empty,
                BranchId = null,
                FullName = "Platform Super Admin",
                Username = "superadmin",
                PinCodeHash = BCrypt.Net.BCrypt.HashPassword("999999"),
                Role = UserRole.SuperAdmin,
                IsActive = true,
                CanViewFinancialReports = true,
                CanManageInventory = true,
                CanManageMenuAndTax = true,
                CanGiveDiscounts = true,
                CanVoidOrders = true
            };
            db.Users.Add(superAdmin);
            await db.SaveChangesAsync();
        }

        // Seed default SaaS package configs
        if (!await db.SaaSPackageConfigs.AnyAsync())
        {
            db.SaaSPackageConfigs.AddRange(
                new SaaSPackageConfig
                {
                    PackageKey = "Starter",
                    DisplayName = "Starter",
                    MonthlyPricePKR = 5000,
                    YearlyPricePKR = 50000,
                    MaxBranches = 3,
                    MaxCounters = 1,
                    MaxOrderTabs = 3,
                    MaxUsers = 5,
                    HasKitchenDisplay = false,
                    HasDeliveryCOD = false,
                    HasInventoryManagement = false,
                    HasStockTransfers = false,
                    HasDirectorDashboard = false,
                    HasConsolidatedReports = false,
                    // WhatsApp is the flagship sell-up from Starter: not included, but one
                    // grant (or one plan move) away — see the add-on catalog below.
                    HasWhatsAppMessaging = false,
                    HasAdvancedReports = false,
                    HasMultiBranch = true,
                    WhatsAppMessagesPerMonth = 0,
                    IsActive = true
                },
                new SaaSPackageConfig
                {
                    PackageKey = "Standard",
                    DisplayName = "Standard",
                    MonthlyPricePKR = 12000,
                    YearlyPricePKR = 120000,
                    MaxBranches = 10,
                    MaxCounters = 3,
                    MaxOrderTabs = 10,
                    MaxUsers = 20,
                    HasKitchenDisplay = true,
                    HasDeliveryCOD = true,
                    HasInventoryManagement = true,
                    HasStockTransfers = false,
                    HasDirectorDashboard = true,
                    HasConsolidatedReports = false,
                    HasWhatsAppMessaging = true,
                    HasAdvancedReports = true,
                    HasMultiBranch = true,
                    WhatsAppMessagesPerMonth = -1,
                    IsActive = true
                },
                new SaaSPackageConfig
                {
                    PackageKey = "Professional",
                    DisplayName = "Professional",
                    MonthlyPricePKR = 25000,
                    YearlyPricePKR = 250000,
                    MaxBranches = 999,
                    MaxCounters = 10,
                    MaxOrderTabs = 25,
                    MaxUsers = 999,
                    HasKitchenDisplay = true,
                    HasDeliveryCOD = true,
                    HasInventoryManagement = true,
                    HasStockTransfers = true,
                    HasDirectorDashboard = true,
                    HasConsolidatedReports = true,
                    HasWhatsAppMessaging = true,
                    HasAdvancedReports = true,
                    HasMultiBranch = true,
                    WhatsAppMessagesPerMonth = -1,
                    IsActive = true
                }
            );
            await db.SaveChangesAsync();
        }

        // Seed the add-on catalog — the same tier-gated features above, sellable standalone to a
        // tenant on a lower tier that doesn't want a full upgrade. Prices are editable defaults.
        if (!await db.AddOnCatalogItems.AnyAsync())
        {
            db.AddOnCatalogItems.AddRange(
                new AddOnCatalogItem { Key = nameof(SaaSPackageConfig.HasKitchenDisplay), DisplayName = "Kitchen Display System", Description = "Live kitchen ticket screen with per-station routing.", MonthlyPricePKR = 2000, YearlyPricePKR = 20000 },
                new AddOnCatalogItem { Key = nameof(SaaSPackageConfig.HasDeliveryCOD), DisplayName = "Delivery & COD Settlement", Description = "Delivery board, rider assignment, cash-on-delivery reconciliation.", MonthlyPricePKR = 2000, YearlyPricePKR = 20000 },
                new AddOnCatalogItem { Key = nameof(SaaSPackageConfig.HasInventoryManagement), DisplayName = "Inventory Management", Description = "Raw ingredient stock, recipes, and stock-level tracking.", MonthlyPricePKR = 3000, YearlyPricePKR = 30000 },
                new AddOnCatalogItem { Key = nameof(SaaSPackageConfig.HasStockTransfers), DisplayName = "Inter-Branch Stock Transfers", Description = "Move stock between branches with a request/dispatch/receive workflow.", MonthlyPricePKR = 2500, YearlyPricePKR = 25000 },
                new AddOnCatalogItem { Key = nameof(SaaSPackageConfig.HasDirectorDashboard), DisplayName = "Director Dashboard", Description = "Executive KPI overview across the business.", MonthlyPricePKR = 1500, YearlyPricePKR = 15000 },
                new AddOnCatalogItem { Key = nameof(SaaSPackageConfig.HasConsolidatedReports), DisplayName = "Consolidated Multi-Branch Reports", Description = "Chain-wide rollup reporting across all branches.", MonthlyPricePKR = 3000, YearlyPricePKR = 30000 },
                new AddOnCatalogItem { Key = nameof(SaaSPackageConfig.HasAdvancedReports), DisplayName = "Advanced Reports", Description = "Deeper sales, category, and payment-tender analytics.", MonthlyPricePKR = 2000, YearlyPricePKR = 20000 },
                new AddOnCatalogItem { Key = nameof(SaaSPackageConfig.HasMultiBranch), DisplayName = "Multi-Branch Support", Description = "Operate and switch between more than one outlet.", MonthlyPricePKR = 4000, YearlyPricePKR = 40000 }
            );
            await db.SaveChangesAsync();
        }

        // WhatsApp gets its own existence check: installs that already have a catalog skip the
        // block above, and this is the row older catalogs are missing — the one support sells.
        if (!await db.AddOnCatalogItems.AnyAsync(a => a.Key == nameof(SaaSPackageConfig.HasWhatsAppMessaging)))
        {
            db.AddOnCatalogItems.Add(new AddOnCatalogItem
            {
                Key = nameof(SaaSPackageConfig.HasWhatsAppMessaging),
                DisplayName = "WhatsApp Notifications",
                Description = "Order updates and receipts on WhatsApp, straight from the till.",
                MonthlyPricePKR = 2500,
                YearlyPricePKR = 25000
            });
            await db.SaveChangesAsync();
        }

        // Quantity add-ons (raise a numeric limit rather than flip a feature on/off) — added
        // separately from the block above since that one only runs against an empty table and
        // these were introduced later, against databases that already had the first 8 rows.
        var quantityAddOnKeys = new[] { "EXTRA_COUNTER", "EXTRA_TABLET", "EXTRA_USER" };
        var existingKeys = await db.AddOnCatalogItems.Where(a => quantityAddOnKeys.Contains(a.Key)).Select(a => a.Key).ToListAsync();
        var missingQuantityAddOns = new List<AddOnCatalogItem>();
        if (!existingKeys.Contains("EXTRA_COUNTER"))
            missingQuantityAddOns.Add(new AddOnCatalogItem { Key = "EXTRA_COUNTER", DisplayName = "Extra Counter", Description = "+1 counter/register device for one branch, above your plan's included limit.", MonthlyPricePKR = 1000, YearlyPricePKR = 10000 });
        if (!existingKeys.Contains("EXTRA_TABLET"))
            missingQuantityAddOns.Add(new AddOnCatalogItem { Key = "EXTRA_TABLET", DisplayName = "Extra Tablet / Order Tab", Description = "+1 waiter tablet (order-tab device) for one branch, above your plan's included limit.", MonthlyPricePKR = 800, YearlyPricePKR = 8000 });
        if (!existingKeys.Contains("EXTRA_USER"))
            missingQuantityAddOns.Add(new AddOnCatalogItem { Key = "EXTRA_USER", DisplayName = "Extra Staff Account", Description = "+1 staff login for the whole restaurant, above your plan's included limit.", MonthlyPricePKR = 500, YearlyPricePKR = 5000 });
        if (missingQuantityAddOns.Count > 0)
        {
            db.AddOnCatalogItems.AddRange(missingQuantityAddOns);
            await db.SaveChangesAsync();
        }

        // Seed default Pakistan provincial tax jurisdictions.
        // NOTE: these are EDITABLE DEFAULTS for convenience, not verified legal/tax advice.
        // Owners must confirm current rates with their provincial authority and edit via
        // Settings -> Tax Jurisdictions.
        var pkJurisdictions = await db.TaxJurisdictions.Where(j => j.CountryCode == "PK").ToListAsync();
        var defaultRows = new[]
        {
            new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-PB", AuthorityName = "PRA (Punjab)", CashTaxRate = 16, DigitalTaxRate = 5, IsActive = true },
            new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-SD", AuthorityName = "SRB (Sindh)", CashTaxRate = 15, DigitalTaxRate = 8, IsActive = true },
            new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-KP", AuthorityName = "KPRA (Khyber Pakhtunkhwa)", CashTaxRate = 15, DigitalTaxRate = 5, IsActive = true },
            new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-BA", AuthorityName = "BRA (Balochistan)", CashTaxRate = 15, DigitalTaxRate = 15, IsActive = true },
            new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-ICT", AuthorityName = "FBR (Islamabad Capital Territory)", CashTaxRate = 15, DigitalTaxRate = 5, IsActive = true }
        };

        if (pkJurisdictions.Count == 0)
        {
            db.TaxJurisdictions.AddRange(defaultRows);
            await db.SaveChangesAsync();
        }
        else
        {
            bool modified = false;
            foreach (var def in defaultRows)
            {
                var existing = pkJurisdictions.FirstOrDefault(j => j.RegionCode == def.RegionCode);
                if (existing != null)
                {
                    // Correct legacy un-discounted digital rates if they matched the old 16/16 or 15/15 defaults
                    if (existing.RegionCode == "PK-PB" && existing.DigitalTaxRate == 16) { existing.DigitalTaxRate = 5; modified = true; }
                    if (existing.RegionCode == "PK-SD" && existing.DigitalTaxRate == 15) { existing.DigitalTaxRate = 8; modified = true; }
                    if (existing.RegionCode == "PK-KP" && existing.DigitalTaxRate == 15) { existing.DigitalTaxRate = 5; modified = true; }
                    if (existing.RegionCode == "PK-ICT" && (existing.CashTaxRate == 16 || existing.DigitalTaxRate == 16)) { existing.CashTaxRate = 15; existing.DigitalTaxRate = 5; modified = true; }
                }
                else
                {
                    db.TaxJurisdictions.Add(def);
                    modified = true;
                }
            }
            if (modified)
            {
                await db.SaveChangesAsync();
            }
        }
    }
}
