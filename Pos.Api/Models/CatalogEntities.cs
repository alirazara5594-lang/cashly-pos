using System;

namespace Pos.Api.Models;

// ============================================================
// COMPANY-WIDE MASTER DATA WITH PER-LOCATION DETAIL
//
// Items are defined once for the whole business; each location keeps only what genuinely differs
// there — its own stock of an ingredient, its own price for a product when the business lets
// branches price for themselves.
// ============================================================

/// <summary>
/// The company-wide definition of a raw ingredient. Each location that stocks it has its own
/// Ingredient row (its stock, its cost) pointing here, so a recipe, a transfer or a purchase at one
/// branch means the same ingredient at every other branch — by identity, not by a name that
/// someone might one day rename.
/// </summary>
public class IngredientMaster
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = "General";
    public string Unit { get; set; } = "Piece";

    /// <summary>The cost a new location's stock row starts from; each location then tracks its own.</summary>
    public decimal DefaultCostPKR { get; set; }

    public decimal MinAlertLevel { get; set; } = 20;
    public string? SupplierName { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// What is different about a product at one location: whether it is sold there at all, and — when
/// the business lets branches set their own prices (TenantSettings.BranchPricing) — its price there.
/// No row means the company-wide product as it is.
/// </summary>
public class BranchProductPrice
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Guid ProductId { get; set; }

    /// <summary>The price at this location. Null means the company-wide price.</summary>
    public decimal? SellingPricePKR { get; set; }

    /// <summary>False when this location does not sell the product (the till hides it).</summary>
    public bool IsAvailable { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
