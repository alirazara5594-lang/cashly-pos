using System;

namespace Pos.Api.Models;

// ============================================================
// ORGANISATION STRUCTURE
//
//   Tenant (the subscribing business)
//     ├── Company   — legal entity: the name and tax numbers on receipts. Usually one.
//     ├── Region    — optional grouping of locations for larger chains.
//     └── Location  — a Branch row: Head Office | Branch | Warehouse, with CanSell / HoldsStock
//           └── Terminals
//
// The three shapes a business can take are configurations of this, not separate products:
//   single shop, no head office   → one Branch that sells and runs its own back office
//   single shop + head office     → a Head Office location (no till) + one Branch
//   chain + head office           → a Head Office + several Branches (+ Warehouses)
// ============================================================

/// <summary>What a location IS. It sets the defaults; CanSell and HoldsStock can then be tuned.</summary>
public enum LocationType
{
    /// <summary>A shop, restaurant or outlet: sells, and holds its own stock.</summary>
    Branch = 1,

    /// <summary>The head office: runs the back office for the whole business. No till unless it
    /// also has a showroom.</summary>
    HeadOffice = 2,

    /// <summary>A store room or distribution centre: holds stock, never sells.</summary>
    Warehouse = 3
}

/// <summary>
/// A legal entity: the name and tax registrations that go on receipts and invoices. Most businesses
/// have exactly one, created automatically; a franchise group, or a business trading through more
/// than one registered company, has several, and each location belongs to one of them.
/// </summary>
public class Company
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string LegalName { get; set; } = string.Empty;
    public string? TradeName { get; set; }

    /// <summary>National tax number (NTN in Pakistan).</summary>
    public string? TaxRegistrationNumber { get; set; }

    /// <summary>Sales tax registration (STRN in Pakistan).</summary>
    public string? SalesTaxRegistrationNumber { get; set; }

    public string? Address { get; set; }

    /// <summary>The company a location belongs to when none is named. Exactly one per tenant.</summary>
    public bool IsDefault { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// An optional grouping of locations ("North", "Lahore") for reports and for giving an area manager
/// every branch in it. Not the tax jurisdiction — that is Branch.RegionCode.
/// </summary>
public class Region
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Code { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A location a branch-based user may sign in at besides their home branch: an area manager who
/// covers several shops, a cashier who covers a second branch at weekends.
///
/// The user keeps the same role everywhere, and each sign-in is still pinned to ONE branch, so every
/// branch-scoped endpoint keeps its existing rules. Owners and other tenant-wide users do not need
/// this: they already see every location.
/// </summary>
public class UserBranchAccess
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public Guid BranchId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
