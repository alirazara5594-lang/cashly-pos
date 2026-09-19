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
                    MaxBranches = 1,
                    MaxCounters = 1,
                    MaxOrderTabs = 3,
                    MaxUsers = 5,
                    HasKitchenDisplay = false,
                    HasDeliveryCOD = false,
                    HasInventoryManagement = false,
                    HasStockTransfers = false,
                    HasDirectorDashboard = false,
                    HasConsolidatedReports = false,
                    HasWhatsAppMessaging = true,
                    HasAdvancedReports = false,
                    HasMultiBranch = false,
                    WhatsAppMessagesPerMonth = -1,
                    IsActive = true
                },
                new SaaSPackageConfig
                {
                    PackageKey = "Standard",
                    DisplayName = "Standard",
                    MonthlyPricePKR = 12000,
                    YearlyPricePKR = 120000,
                    MaxBranches = 3,
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

        // Seed default Pakistan provincial tax jurisdictions.
        // NOTE: these are EDITABLE DEFAULTS for convenience, not verified legal/tax advice.
        // Owners must confirm current rates with their provincial authority and edit via
        // Settings -> Tax Jurisdictions.
        if (!await db.TaxJurisdictions.AnyAsync())
        {
            db.TaxJurisdictions.AddRange(
                new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-PB", AuthorityName = "PRA (Punjab)", CashTaxRate = 16, DigitalTaxRate = 16, IsActive = true },
                new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-SD", AuthorityName = "SRB (Sindh)", CashTaxRate = 15, DigitalTaxRate = 15, IsActive = true },
                new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-KP", AuthorityName = "KPRA (Khyber Pakhtunkhwa)", CashTaxRate = 15, DigitalTaxRate = 15, IsActive = true },
                new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-BA", AuthorityName = "BRA (Balochistan)", CashTaxRate = 15, DigitalTaxRate = 15, IsActive = true },
                new TaxJurisdiction { CountryCode = "PK", RegionCode = "PK-ICT", AuthorityName = "FBR (Islamabad Capital Territory)", CashTaxRate = 16, DigitalTaxRate = 16, IsActive = true }
            );
            await db.SaveChangesAsync();
        }
    }
}
