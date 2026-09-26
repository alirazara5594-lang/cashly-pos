using System;
using System.Collections.Generic;
using System.Linq;
using Pos.Api.Models;

namespace Pos.Api.Data;

// ============================================================
// FEATURE CATALOGUE
//
// Every sellable capability, and the plan matrix expressed as data.
//
// This file is the ONLY place the words "starter", "standard" and "professional" appear next to
// a capability. Nothing downstream asks "is this Professional?" — it asks "may this organisation
// use `hq`?", and the answer comes from rows seeded from here.
//
// Adding a capability: add a code below and a row per plan. No migration, no branching.
// ============================================================

/// <summary>Stable feature codes. Never rename one once shipped — API guards reference them.</summary>
public static class FeatureCodes
{
    // --- Structure ---------------------------------------------------------
    /// <summary>May the organisation run a head office with branches beneath it?
    /// A CAPABILITY, not a plan. Standard has this.</summary>
    public const string Hq = "hq";
    public const string MultiBranch = "multi_branch";
    public const string Locations = "locations";
    public const string PosTerminals = "pos_terminals";
    public const string Tablets = "tablets";
    public const string Users = "users";

    // --- Core modules (present everywhere, graded by depth) -----------------
    public const string Inventory = "inventory";
    public const string Purchasing = "purchasing";
    public const string Accounting = "accounting";
    public const string Recipes = "recipes";
    public const string FoodCost = "food_cost";
    public const string Customers = "customers";
    public const string AuditLog = "audit_log";
    public const string Permissions = "permissions";

    // --- Switchable capabilities -------------------------------------------
    public const string Kds = "kds";
    public const string Tables = "tables";
    public const string StockTransfers = "stock_transfers";
    public const string ConsolidatedReports = "consolidated_reports";
    public const string AdvancedReports = "advanced_reports";
    public const string DirectorDashboard = "director_dashboard";
    public const string CentralizedHqControl = "centralized_hq_control";
    public const string Api = "api";
    public const string Integrations = "integrations";
    public const string DeliveryCod = "delivery_cod";
    public const string WhatsApp = "whatsapp";
}

public sealed record FeatureDefinition(
    string Code,
    string DisplayName,
    string Description,
    FeatureLimitType LimitType,
    /// <summary>Grouping for the Subscription screen.</summary>
    string Group);

public static class FeatureCatalog
{
    public static readonly IReadOnlyList<FeatureDefinition> All = new List<FeatureDefinition>
    {
        new(FeatureCodes.Hq, "Head Office", "Run a central office with branches reporting into it.", FeatureLimitType.Boolean, "Structure"),
        new(FeatureCodes.MultiBranch, "Multi-Branch", "Operate more than one location.", FeatureLimitType.Boolean, "Structure"),
        new(FeatureCodes.Locations, "Locations", "Total locations, including head office.", FeatureLimitType.Count, "Structure"),
        new(FeatureCodes.PosTerminals, "POS Terminals", "Tills that can take payment.", FeatureLimitType.Count, "Structure"),
        new(FeatureCodes.Tablets, "Tablets", "Order-taking tablets and mPOS devices.", FeatureLimitType.Count, "Structure"),
        new(FeatureCodes.Users, "Users", "Staff logins.", FeatureLimitType.Count, "Structure"),

        new(FeatureCodes.Inventory, "Inventory", "Stock on hand, counts and adjustments.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.Purchasing, "Purchasing", "Purchase orders and goods receipt.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.Recipes, "Recipes", "Bills of materials for made items.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.FoodCost, "Food Cost", "Cost of goods and margin per item.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.Tables, "Table Management", "Floor plan and open tabs.", FeatureLimitType.Boolean, "Operations"),
        new(FeatureCodes.Kds, "Kitchen Display", "Prep screens in the kitchen.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.StockTransfers, "Stock Transfers", "Move stock between locations.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.DeliveryCod, "Delivery & COD", "Rider dispatch and cash-on-delivery settlement.", FeatureLimitType.Boolean, "Operations"),

        new(FeatureCodes.Accounting, "Accounting", "Chart of accounts, journals, financial statements.", FeatureLimitType.Level, "Finance"),
        new(FeatureCodes.Customers, "Customers", "Customer records, credit and loyalty.", FeatureLimitType.Level, "Finance"),
        new(FeatureCodes.ConsolidatedReports, "Consolidated Reporting", "Group-wide figures across branches.", FeatureLimitType.Level, "Reporting"),
        new(FeatureCodes.AdvancedReports, "Advanced Reporting", "Deeper analytics and custom ranges.", FeatureLimitType.Boolean, "Reporting"),
        new(FeatureCodes.DirectorDashboard, "Executive Dashboard", "Owner-level KPI overview across the business.", FeatureLimitType.Boolean, "Reporting"),

        new(FeatureCodes.Permissions, "Permissions", "Role and module-level access control.", FeatureLimitType.Level, "Administration"),
        new(FeatureCodes.AuditLog, "Audit Log", "Record of sensitive actions.", FeatureLimitType.Level, "Administration"),
        new(FeatureCodes.CentralizedHqControl, "Centralized HQ Control", "Push catalogue, pricing, tax and recipes from head office.", FeatureLimitType.Level, "Administration"),

        new(FeatureCodes.Api, "API Access", "Programmatic access for your own tools.", FeatureLimitType.Level, "Integrations"),
        new(FeatureCodes.Integrations, "Third-Party Integrations", "Delivery platforms and external services.", FeatureLimitType.Level, "Integrations"),
        new(FeatureCodes.WhatsApp, "WhatsApp Messaging", "Order updates and receipts over WhatsApp.", FeatureLimitType.Boolean, "Integrations")
    };

    public static FeatureDefinition? Find(string code) =>
        All.FirstOrDefault(f => string.Equals(f.Code, code, StringComparison.OrdinalIgnoreCase));

    // ============================================================
    // THE MATRIX
    //
    // Read as: code -> (starter, standard, professional).
    // For Count features the value is a nullable int; null means unlimited.
    // For Level features it is a FeatureLevel. For Boolean, a bool.
    // ============================================================

    /// <summary>Boolean capabilities per plan.</summary>
    public static readonly Dictionary<string, (bool Starter, bool Standard, bool Professional)> Booleans = new()
    {
        // Running a head office is a SHAPE, not a paid feature: every plan may do it, and the plan
        // governs only how many locations fit (see Counts below). A two-shop owner can therefore
        // start on Starter rather than being priced out of the product entirely — what they buy by
        // moving up is headroom and centralised control, not the right to have a second shop.
        [FeatureCodes.Hq]           = (true,  true,  true),
        [FeatureCodes.MultiBranch]  = (true,  true,  true),
        [FeatureCodes.Tables]       = (true,  true,  true),
        [FeatureCodes.AdvancedReports] = (false, true, true),
        [FeatureCodes.DirectorDashboard] = (false, true, true),
        [FeatureCodes.DeliveryCod]  = (false, true,  true),
        [FeatureCodes.WhatsApp]     = (true,  true,  true)
    };

    /// <summary>Countable ceilings per plan. Null = unlimited.</summary>
    public static readonly Dictionary<string, (int? Starter, int? Standard, int? Professional)> Counts = new()
    {
        // The location ladder IS the upgrade path, now that multi-branch itself is on every plan.
        [FeatureCodes.Locations]     = (3, 10, null),
        [FeatureCodes.PosTerminals]  = (1, 5, null),
        [FeatureCodes.Tablets]       = (3, 10, null),
        [FeatureCodes.Users]         = (5, 15, null)
    };

    /// <summary>Graded capabilities per plan.</summary>
    public static readonly Dictionary<string, (FeatureLevel Starter, FeatureLevel Standard, FeatureLevel Professional)> Levels = new()
    {
        [FeatureCodes.Inventory]            = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.Purchasing]           = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.Accounting]           = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Full),
        [FeatureCodes.Recipes]              = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.FoodCost]             = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.Customers]            = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.Kds]                  = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Full),
        // Moving stock between branches and seeing group-wide figures are the two things that make
        // a chain feel like one business rather than several. Both are held back to Professional
        // on purpose: Standard customers can RUN several shops, but they run them separately.
        [FeatureCodes.StockTransfers]       = (FeatureLevel.None,  FeatureLevel.None,  FeatureLevel.Advanced),
        [FeatureCodes.ConsolidatedReports]  = (FeatureLevel.None,  FeatureLevel.None,  FeatureLevel.Advanced),
        [FeatureCodes.Permissions]          = (FeatureLevel.Basic, FeatureLevel.Advanced, FeatureLevel.Advanced),
        [FeatureCodes.AuditLog]             = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.CentralizedHqControl] = (FeatureLevel.None,  FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.Api]                  = (FeatureLevel.None,  FeatureLevel.Basic, FeatureLevel.Advanced),
        [FeatureCodes.Integrations]         = (FeatureLevel.None,  FeatureLevel.Basic, FeatureLevel.Advanced)
    };

    /// <summary>The three plans, in commercial order.</summary>
    public static readonly (string Code, string Name, string Description, decimal Monthly, decimal Yearly, int Rank)[] Plans =
    {
        ("starter", "Starter", "Up to three locations. Everything a shop or restaurant needs to trade, with a head office over the top.", 5000m, 50000m, 1),
        ("standard", "Standard", "Up to ten locations, with full inventory, purchasing and accounting, and centralised control from head office.", 12000m, 120000m, 2),
        ("professional", "Professional", "Unlimited locations and terminals, plus inter-branch stock transfers, group-wide consolidated reporting, API and integrations.", 25000m, 250000m, 3)
    };

    /// <summary>
    /// What a Count feature's `null` (unlimited) becomes in the column-shaped
    /// <see cref="SaaSPackageConfig"/>, which cannot express "no ceiling". Large enough that
    /// nobody reaches it, small enough that arithmetic on it never overflows.
    /// </summary>
    public const int UnlimitedCount = 999;

    private static int PlanIndex(string planCode) =>
        planCode.ToLowerInvariant() switch { "starter" => 0, "standard" => 1, _ => 2 };

    private static bool Boolean(string code, int idx)
    {
        var v = Booleans[code];
        return idx == 0 ? v.Starter : idx == 1 ? v.Standard : v.Professional;
    }

    private static int Count(string code, int idx)
    {
        var v = Counts[code];
        return (idx == 0 ? v.Starter : idx == 1 ? v.Standard : v.Professional) ?? UnlimitedCount;
    }

    private static bool LevelOn(string code, int idx)
    {
        var v = Levels[code];
        return (idx == 0 ? v.Starter : idx == 1 ? v.Standard : v.Professional) != FeatureLevel.None;
    }

    /// <summary>
    /// Projects one plan from this matrix onto the column-shaped <see cref="SaaSPackageConfig"/>
    /// that <c>EntitlementService</c> reads for device quotas and licences.
    ///
    /// The two tables existed independently and disagreed — Starter was single-location in this
    /// catalogue and three-branch in the package table, Standard had stock transfers here and not
    /// there. Two answers to "what does Standard include" is a refund waiting to happen once
    /// somebody is paying for it. The catalogue above is now the only place those numbers are
    /// decided; this projection is how the older shape gets them.
    ///
    /// Graded features collapse to a boolean here: anything above None is "on". Depth still comes
    /// from the PlanFeature rows, which is where the Level actually lives.
    /// </summary>
    public static SaaSPackageConfig BuildPackageConfig(string planCode)
    {
        var idx = PlanIndex(planCode);
        var (code, name, _, monthly, yearly, _) = Plans[idx];

        return new SaaSPackageConfig
        {
            PackageKey = char.ToUpperInvariant(code[0]) + code[1..],
            DisplayName = name,
            MonthlyPricePKR = monthly,
            YearlyPricePKR = yearly,

            MaxBranches = Count(FeatureCodes.Locations, idx),
            MaxCounters = Count(FeatureCodes.PosTerminals, idx),
            MaxOrderTabs = Count(FeatureCodes.Tablets, idx),
            MaxUsers = Count(FeatureCodes.Users, idx),

            HasKitchenDisplay = LevelOn(FeatureCodes.Kds, idx),
            HasInventoryManagement = LevelOn(FeatureCodes.Inventory, idx),
            HasStockTransfers = LevelOn(FeatureCodes.StockTransfers, idx),
            HasConsolidatedReports = LevelOn(FeatureCodes.ConsolidatedReports, idx),

            HasDeliveryCOD = Boolean(FeatureCodes.DeliveryCod, idx),
            HasDirectorDashboard = Boolean(FeatureCodes.DirectorDashboard, idx),
            HasWhatsAppMessaging = Boolean(FeatureCodes.WhatsApp, idx),
            HasAdvancedReports = Boolean(FeatureCodes.AdvancedReports, idx),
            HasMultiBranch = Boolean(FeatureCodes.MultiBranch, idx),

            // Metered separately from the on/off switch: the flag says they may send, this says
            // how many. -1 is the existing sentinel for unmetered.
            WhatsAppMessagesPerMonth = Boolean(FeatureCodes.WhatsApp, idx) ? -1 : 0,
            IsActive = true,
            UpdatedAt = DateTime.UtcNow
        };
    }

    /// <summary>Overwrites an existing package row in place from the catalogue, preserving its
    /// identity so foreign keys and the admin screen's row ids survive a resync.</summary>
    public static void ApplyPackageConfig(SaaSPackageConfig target, string planCode)
    {
        var src = BuildPackageConfig(planCode);
        target.DisplayName = src.DisplayName;
        target.MonthlyPricePKR = src.MonthlyPricePKR;
        target.YearlyPricePKR = src.YearlyPricePKR;
        target.MaxBranches = src.MaxBranches;
        target.MaxCounters = src.MaxCounters;
        target.MaxOrderTabs = src.MaxOrderTabs;
        target.MaxUsers = src.MaxUsers;
        target.HasKitchenDisplay = src.HasKitchenDisplay;
        target.HasDeliveryCOD = src.HasDeliveryCOD;
        target.HasInventoryManagement = src.HasInventoryManagement;
        target.HasStockTransfers = src.HasStockTransfers;
        target.HasDirectorDashboard = src.HasDirectorDashboard;
        target.HasConsolidatedReports = src.HasConsolidatedReports;
        target.HasWhatsAppMessaging = src.HasWhatsAppMessaging;
        target.HasAdvancedReports = src.HasAdvancedReports;
        target.HasMultiBranch = src.HasMultiBranch;
        target.WhatsAppMessagesPerMonth = src.WhatsAppMessagesPerMonth;
        target.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Builds every PlanFeature row for one plan from the matrix above. Used by the seeder and by
    /// the admin endpoint that repairs a plan whose rows have drifted.
    /// </summary>
    public static List<PlanFeature> BuildFeatureRows(Guid planId, string planCode)
    {
        var rows = new List<PlanFeature>();
        var idx = planCode.ToLowerInvariant() switch { "starter" => 0, "standard" => 1, _ => 2 };

        foreach (var (code, v) in Booleans)
            rows.Add(new PlanFeature
            {
                PlanId = planId, FeatureCode = code, LimitType = FeatureLimitType.Boolean,
                Enabled = idx == 0 ? v.Starter : idx == 1 ? v.Standard : v.Professional
            });

        foreach (var (code, v) in Counts)
        {
            var limit = idx == 0 ? v.Starter : idx == 1 ? v.Standard : v.Professional;
            rows.Add(new PlanFeature
            {
                PlanId = planId, FeatureCode = code, LimitType = FeatureLimitType.Count,
                // A count of zero is genuinely "off"; null (unlimited) is very much on.
                Enabled = limit is null or > 0,
                LimitValue = limit
            });
        }

        foreach (var (code, v) in Levels)
        {
            var level = idx == 0 ? v.Starter : idx == 1 ? v.Standard : v.Professional;
            rows.Add(new PlanFeature
            {
                PlanId = planId, FeatureCode = code, LimitType = FeatureLimitType.Level,
                Level = level,
                Enabled = level != FeatureLevel.None
            });
        }

        return rows;
    }
}
