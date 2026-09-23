using System;
using System.Collections.Generic;

namespace Pos.Api.Models;

// ============================================================
// SUBSCRIPTION / ENTITLEMENT SYSTEM
//
// Three concepts that must never be conflated:
//
//   ORGANISATION STRUCTURE   HQ, branches, departments, terminals — what the business IS
//   INSTALLATION TYPE        ERP / POS / ERP+POS — what a given COMPUTER is for
//   SUBSCRIPTION PLAN        Starter / Standard / Professional — what they PAY for
//
// The commercially important consequence: HQ is a capability, not a plan. A Standard customer
// can absolutely run a head office with branches beneath it. Professional is not "the HQ plan";
// it is the plan for higher limits and more advanced HQ controls.
//
// Features live in ROWS, not columns. The previous design had one boolean column per feature on
// the plan table, which meant every new sellable thing needed a schema migration and a deploy.
// Here a feature is data: a code, a switch, a number, or a level.
// ============================================================

/// <summary>How a feature's allowance is expressed.</summary>
public enum FeatureLimitType
{
    /// <summary>On or off. "hq", "api", "stock_transfers".</summary>
    Boolean = 1,
    /// <summary>A countable ceiling. "locations" = 3, "pos_terminals" = 5. Null means unlimited.</summary>
    Count = 2,
    /// <summary>Graded depth of the same feature. "inventory" = Basic | Full | Advanced.</summary>
    Level = 3
}

/// <summary>
/// Depth of a feature, for the many capabilities that are not simply present or absent.
/// Inventory exists on every plan; what differs is how much of it you get.
/// </summary>
public enum FeatureLevel
{
    None = 0,
    Basic = 1,
    Full = 2,
    Advanced = 3
}

/// <summary>
/// A sellable plan. Replaces the hard-coded SubscriptionTier enum as the source of truth, so
/// adding a fourth plan is an INSERT rather than a code change plus a migration.
/// </summary>
public class Plan
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Stable machine key: "starter", "standard", "professional".</summary>
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    public decimal MonthlyPricePKR { get; set; }
    public decimal YearlyPricePKR { get; set; }

    /// <summary>Display order in the plan picker, and the comparison order used to decide
    /// whether a plan change is an upgrade or a downgrade.</summary>
    public int Rank { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<PlanFeature> Features { get; set; } = new List<PlanFeature>();
}

/// <summary>
/// One capability of one plan. The whole feature matrix is rows of this.
/// </summary>
public class PlanFeature
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PlanId { get; set; }
    public Plan? Plan { get; set; }

    /// <summary>See <see cref="Data.FeatureCodes"/>. Stable string, never renamed once shipped —
    /// it is what the API guards reference.</summary>
    public string FeatureCode { get; set; } = string.Empty;

    public FeatureLimitType LimitType { get; set; } = FeatureLimitType.Boolean;

    /// <summary>For Boolean features. For Count/Level this is derived and kept in step.</summary>
    public bool Enabled { get; set; }

    /// <summary>For Count features. NULL means unlimited — deliberately not a large sentinel
    /// number, so "unlimited" never accidentally becomes a ceiling somebody hits.</summary>
    public int? LimitValue { get; set; }

    /// <summary>For Level features.</summary>
    public FeatureLevel Level { get; set; } = FeatureLevel.None;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public enum SubscriptionStatus
{
    Trialing = 1,
    Active = 2,
    PastDue = 3,
    /// <summary>
    /// The organisation is inside its plan commercially, but its CONFIGURATION exceeds what the
    /// plan allows — almost always after a downgrade. Everything keeps working and nothing is
    /// deleted; they simply cannot add more until they are back within limits.
    /// </summary>
    OverPlanLimit = 4,
    Suspended = 5,
    Cancelled = 6
}

/// <summary>
/// The organisation's subscription. Belongs to the ORGANISATION, never to a terminal or a
/// location — a business has one commercial relationship regardless of how many tills it runs.
/// </summary>
public class OrganizationSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The organisation. Named TenantId because that is what the rest of this codebase
    /// calls an organisation; renaming it would touch 200 endpoints for no functional gain.</summary>
    public Guid TenantId { get; set; }

    public Guid PlanId { get; set; }
    public Plan? Plan { get; set; }

    public SubscriptionStatus Status { get; set; } = SubscriptionStatus.Trialing;

    public DateTime StartDate { get; set; } = DateTime.UtcNow;
    /// <summary>Null for an open-ended subscription.</summary>
    public DateTime? EndDate { get; set; }
    public DateTime? TrialEndsAt { get; set; }

    /// <summary>Set when a downgrade left the organisation over its new limits, so the warning
    /// can say what happened and when rather than just that something is wrong.</summary>
    public DateTime? OverLimitSince { get; set; }
    public string? OverLimitReason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public bool IsCurrent => Status is SubscriptionStatus.Trialing or SubscriptionStatus.Active
                                     or SubscriptionStatus.PastDue or SubscriptionStatus.OverPlanLimit;
}
