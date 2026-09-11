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
    }
}
