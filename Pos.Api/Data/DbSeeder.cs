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
    }
}
