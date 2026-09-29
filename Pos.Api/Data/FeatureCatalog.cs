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
    public const string KitchenDisplays = "kitchen_displays";
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

    // --- Modules with their own switch ----------------------------------------
    public const string Loyalty = "loyalty";
    public const string Labor = "labor";
    public const string Payroll = "payroll";

    // --- Sold only as add-ons (per shop), never part of a version or the ERP ---
    public const string FiscalInvoicing = "fiscal_invoicing";
    public const string OnlinePayments = "online_payments";
    public const string OnlineOrdering = "online_ordering";

    /// <summary>
    /// Capabilities no version and no head-office ERP includes: each is bought per shop as an
    /// add-on, because each costs money to run per shop (a tax authority connection, a payment
    /// gateway, a delivery platform feed, a public ordering page).
    /// </summary>
    public static readonly IReadOnlySet<string> SoldSeparately = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        FiscalInvoicing, OnlinePayments, OnlineOrdering, Integrations, Api
    };
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
        new(FeatureCodes.Locations, "Locations", "Locations that sell. A head office that only runs the back office is not counted.", FeatureLimitType.Count, "Structure"),
        new(FeatureCodes.PosTerminals, "POS Terminals", "Tills that can take payment, per location.", FeatureLimitType.Count, "Structure"),
        new(FeatureCodes.Tablets, "Tablets", "Order-taking tablets and mPOS devices, per location.", FeatureLimitType.Count, "Structure"),
        new(FeatureCodes.KitchenDisplays, "Kitchen Screens", "Kitchen display screens, per location.", FeatureLimitType.Count, "Structure"),
        new(FeatureCodes.Users, "Back-Office Users", "Owner, manager, accountant and storekeeper logins. Cashiers, waiters and kitchen staff are not counted.", FeatureLimitType.Count, "Structure"),

        new(FeatureCodes.Inventory, "Inventory", "Stock on hand, counts and adjustments.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.Purchasing, "Purchasing", "Purchase orders and goods receipt.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.Recipes, "Recipes", "Bills of materials for made items.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.FoodCost, "Food Cost", "Cost of goods and margin per item.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.Tables, "Table Management", "Floor plan and open tabs.", FeatureLimitType.Boolean, "Operations"),
        new(FeatureCodes.Kds, "Kitchen Display", "Prep screens in the kitchen.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.StockTransfers, "Stock Transfers", "Move stock between locations.", FeatureLimitType.Level, "Operations"),
        new(FeatureCodes.DeliveryCod, "Delivery & COD", "Rider dispatch and cash-on-delivery settlement.", FeatureLimitType.Boolean, "Operations"),

        new(FeatureCodes.Accounting, "Accounting", "Chart of accounts, journals, financial statements.", FeatureLimitType.Level, "Finance"),
        new(FeatureCodes.Customers, "Customers", "Customer records and credit (khata).", FeatureLimitType.Level, "Finance"),
        new(FeatureCodes.Loyalty, "Loyalty, Gift Cards & Promos", "Loyalty points, gift cards and promo codes.", FeatureLimitType.Boolean, "Finance"),
        new(FeatureCodes.Labor, "Staff Scheduling & Time Clock", "Shift schedules, clock-in and timesheets.", FeatureLimitType.Boolean, "People"),
        new(FeatureCodes.Payroll, "Payroll & HR", "Payroll periods, payslips and leave.", FeatureLimitType.Boolean, "People"),
        new(FeatureCodes.ConsolidatedReports, "Consolidated Reporting", "Group-wide figures across branches.", FeatureLimitType.Level, "Reporting"),
        new(FeatureCodes.AdvancedReports, "Advanced Reporting", "Deeper analytics and custom ranges.", FeatureLimitType.Boolean, "Reporting"),
        new(FeatureCodes.DirectorDashboard, "Executive Dashboard", "Owner-level KPI overview across the business.", FeatureLimitType.Boolean, "Reporting"),

        new(FeatureCodes.Permissions, "Permissions", "Role and module-level access control.", FeatureLimitType.Level, "Administration"),
        new(FeatureCodes.AuditLog, "Audit Log", "Record of sensitive actions.", FeatureLimitType.Level, "Administration"),
        new(FeatureCodes.CentralizedHqControl, "Centralized HQ Control", "Push catalogue, pricing, tax and recipes from head office.", FeatureLimitType.Level, "Administration"),

        new(FeatureCodes.Api, "API Access", "Programmatic access for your own tools.", FeatureLimitType.Level, "Integrations"),
        new(FeatureCodes.Integrations, "Delivery Platform Integration", "Orders from Foodpanda-style delivery platforms straight into the till.", FeatureLimitType.Level, "Integrations"),
        new(FeatureCodes.WhatsApp, "WhatsApp Messaging", "Order updates and receipts over WhatsApp, within the monthly message allowance.", FeatureLimitType.Boolean, "Integrations"),
        new(FeatureCodes.FiscalInvoicing, "Fiscal Invoicing (FBR / PRA / SRB)", "Report every sale to the tax authority and print its fiscal invoice number and QR code.", FeatureLimitType.Boolean, "Integrations"),
        new(FeatureCodes.OnlinePayments, "Online Payments", "JazzCash, EasyPaisa, Raast and card payments through a gateway.", FeatureLimitType.Boolean, "Integrations"),
        new(FeatureCodes.OnlineOrdering, "QR & Online Ordering", "Customers order from a QR code at the table, or a pickup link.", FeatureLimitType.Boolean, "Integrations")
    };

    public static FeatureDefinition? Find(string code) =>
        All.FirstOrDefault(f => string.Equals(f.Code, code, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The capabilities that ALSO exist as a switch on the package table, keyed by feature code.
    ///
    /// The Package Pricing screen edits those switches, and the older endpoint guards read them, so
    /// for these nine the package switch is the answer and the feature code simply mirrors it. Two
    /// independent answers to "does Standard include stock transfers" is how a customer ends up
    /// with the screen unlocked and the API behind it refusing.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> PackageFlagFor =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [FeatureCodes.Kds] = nameof(SaaSPackageConfig.HasKitchenDisplay),
            [FeatureCodes.DeliveryCod] = nameof(SaaSPackageConfig.HasDeliveryCOD),
            [FeatureCodes.Inventory] = nameof(SaaSPackageConfig.HasInventoryManagement),
            [FeatureCodes.StockTransfers] = nameof(SaaSPackageConfig.HasStockTransfers),
            [FeatureCodes.DirectorDashboard] = nameof(SaaSPackageConfig.HasDirectorDashboard),
            [FeatureCodes.ConsolidatedReports] = nameof(SaaSPackageConfig.HasConsolidatedReports),
            [FeatureCodes.WhatsApp] = nameof(SaaSPackageConfig.HasWhatsAppMessaging),
            [FeatureCodes.AdvancedReports] = nameof(SaaSPackageConfig.HasAdvancedReports),
            [FeatureCodes.MultiBranch] = nameof(SaaSPackageConfig.HasMultiBranch)
        };

    /// <summary>The package quota column behind each countable feature code.</summary>
    public static readonly IReadOnlyDictionary<string, string> QuotaKeyFor =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [FeatureCodes.Locations] = nameof(SaaSPackageConfig.MaxBranches),
            [FeatureCodes.PosTerminals] = nameof(SaaSPackageConfig.MaxCounters),
            [FeatureCodes.Tablets] = nameof(SaaSPackageConfig.MaxOrderTabs),
            [FeatureCodes.KitchenDisplays] = nameof(SaaSPackageConfig.MaxKitchenDisplays),
            [FeatureCodes.Users] = nameof(SaaSPackageConfig.MaxUsers)
        };

    // ============================================================
    // THE MATRIX
    //
    // Read as: code -> (starter, standard, professional).
    // For Count features the value is a nullable int; null means unlimited.
    // For Level features it is a FeatureLevel. For Boolean, a bool.
    // ============================================================

    // ============================================================
    // THE THREE POS VERSIONS (2026-10)
    //
    // Sold per shop. Each version fully serves one kind of customer, so most never need an add-on:
    //   Starter      — takeaway, kiosk, small café, retail counter
    //   Standard     — dine-in restaurant, busy café, mart
    //   Professional — high-volume fast food, big dining hall, food court
    // For a single shop the version also decides its own back office. A business with a head
    // office gets the whole ERP instead (EntitlementService), and the version is only its tills.
    // ============================================================

    /// <summary>Boolean capabilities per plan.</summary>
    public static readonly Dictionary<string, (bool Starter, bool Standard, bool Professional)> Booleans = new()
    {
        // Opening a head office is how a shop grows into the Head Office ERP (billed separately),
        // so every version may do it. A second shop is simply another shop with its own version.
        [FeatureCodes.Hq]           = (true,  true,  true),
        [FeatureCodes.MultiBranch]  = (true,  true,  true),
        [FeatureCodes.Tables]       = (true,  true,  true),
        [FeatureCodes.AdvancedReports] = (false, true, true),
        [FeatureCodes.DirectorDashboard] = (false, true, true),
        [FeatureCodes.DeliveryCod]  = (false, true,  true),
        // Allowed on every version; how many messages go out is the monthly allowance
        // (SaaSPackageConfig.WhatsAppMessagesPerMonth) plus any message bundles bought.
        [FeatureCodes.WhatsApp]     = (true,  true,  true),
        [FeatureCodes.Loyalty]      = (false, true,  true),
        [FeatureCodes.Labor]        = (false, true,  true),
        [FeatureCodes.Payroll]      = (false, false, true),
        // Add-on only: see FeatureCodes.SoldSeparately.
        [FeatureCodes.FiscalInvoicing] = (false, false, false),
        [FeatureCodes.OnlinePayments]  = (false, false, false),
        [FeatureCodes.OnlineOrdering]  = (false, false, false)
    };

    /// <summary>Countable ceilings per plan. Null = unlimited.</summary>
    public static readonly Dictionary<string, (int? Starter, int? Standard, int? Professional)> Counts = new()
    {
        // Every shop is billed for its own version, so the number of shops is not capped.
        [FeatureCodes.Locations]       = (null, null, null),
        // Devices are per shop.
        [FeatureCodes.PosTerminals]    = (1, 3, 8),
        [FeatureCodes.Tablets]         = (2, 8, 20),
        [FeatureCodes.KitchenDisplays] = (0, 2, null),
        // Back-office logins for a single shop (cashiers, waiters and kitchen staff are free).
        [FeatureCodes.Users]           = (3, 10, null)
    };

    /// <summary>Graded capabilities per plan. The app checks on/off; the grade is descriptive.</summary>
    public static readonly Dictionary<string, (FeatureLevel Starter, FeatureLevel Standard, FeatureLevel Professional)> Levels = new()
    {
        // Inventory, recipes, suppliers and purchase orders start at Standard: a takeaway counter
        // on Starter sells what it has and does not cost recipes.
        [FeatureCodes.Inventory]            = (FeatureLevel.None,  FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.Purchasing]           = (FeatureLevel.None,  FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.Recipes]              = (FeatureLevel.None,  FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.FoodCost]             = (FeatureLevel.None,  FeatureLevel.Full,  FeatureLevel.Advanced),
        // Full books (ledger, P&L, balance sheet) are Professional, or an add-on for Standard.
        [FeatureCodes.Accounting]           = (FeatureLevel.None,  FeatureLevel.None,  FeatureLevel.Full),
        [FeatureCodes.Customers]            = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.Kds]                  = (FeatureLevel.None,  FeatureLevel.Full,  FeatureLevel.Full),
        [FeatureCodes.StockTransfers]       = (FeatureLevel.None,  FeatureLevel.None,  FeatureLevel.Advanced),
        [FeatureCodes.ConsolidatedReports]  = (FeatureLevel.None,  FeatureLevel.None,  FeatureLevel.Advanced),
        [FeatureCodes.Permissions]          = (FeatureLevel.Basic, FeatureLevel.Advanced, FeatureLevel.Advanced),
        [FeatureCodes.AuditLog]             = (FeatureLevel.Basic, FeatureLevel.Full,  FeatureLevel.Advanced),
        [FeatureCodes.CentralizedHqControl] = (FeatureLevel.None,  FeatureLevel.Full,  FeatureLevel.Advanced),
        // Add-on only (FeatureCodes.SoldSeparately).
        [FeatureCodes.Api]                  = (FeatureLevel.None,  FeatureLevel.None,  FeatureLevel.None),
        [FeatureCodes.Integrations]         = (FeatureLevel.None,  FeatureLevel.None,  FeatureLevel.None)
    };

    /// <summary>The three plans, in commercial order. Prices are the single-shop prices.</summary>
    public static readonly (string Code, string Name, string Description, decimal Monthly, decimal Yearly, int Rank)[] Plans =
    {
        ("starter", "Starter", "For a takeaway, kiosk, small café or retail counter: one till, two tablets, receipts, cash shifts and daily reports.", 5000m, 50000m, 1),
        ("standard", "Standard", "For a dine-in restaurant, busy café or mart: three tills, eight tablets, kitchen screens, delivery, loyalty, inventory and staff scheduling.", 12000m, 120000m, 2),
        ("professional", "Professional", "For high-volume fast food, big dining halls and food courts: eight tills, twenty tablets, unlimited kitchen screens, full accounting and payroll.", 25000m, 250000m, 3)
    };

    /// <summary>What one branch of a head-office business pays per month and per year for each
    /// version. Lower than the single-shop price: the branch's back office is the ERP.</summary>
    public static readonly Dictionary<string, (decimal Monthly, decimal Yearly)> BranchPrices = new(StringComparer.OrdinalIgnoreCase)
    {
        ["starter"] = (3000m, 30000m),
        ["standard"] = (6000m, 60000m),
        ["professional"] = (10000m, 100000m)
    };

    /// <summary>WhatsApp messages each version includes per month (-1 = unlimited).</summary>
    public static readonly Dictionary<string, int> IncludedWhatsAppMessages = new(StringComparer.OrdinalIgnoreCase)
    {
        ["starter"] = 0,
        ["standard"] = 500,
        ["professional"] = 2000
    };

    /// <summary>The Head Office ERP: one flat price per business with a head office.</summary>
    public const string HeadOfficeErpPriceKey = "HEAD_OFFICE_ERP";
    public const decimal HeadOfficeErpMonthly = 15000m;
    public const decimal HeadOfficeErpYearly = 150000m;
    /// <summary>WhatsApp messages the Head Office ERP includes per month, on top of nothing else.</summary>
    public const int HeadOfficeErpWhatsAppMessages = 2000;

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
            MaxKitchenDisplays = Count(FeatureCodes.KitchenDisplays, idx),
            MaxUsers = Count(FeatureCodes.Users, idx),

            BranchMonthlyPricePKR = BranchPrices.TryGetValue(code, out var branchPrice) ? branchPrice.Monthly : monthly,
            BranchYearlyPricePKR = BranchPrices.TryGetValue(code, out var branchPriceYear) ? branchPriceYear.Yearly : yearly,

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
            // how many a month the version includes. Bundles bought as add-ons come on top.
            WhatsAppMessagesPerMonth = IncludedWhatsAppMessages.TryGetValue(code, out var messages) ? messages : 0,
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
        target.MaxKitchenDisplays = src.MaxKitchenDisplays;
        target.MaxUsers = src.MaxUsers;
        target.BranchMonthlyPricePKR = src.BranchMonthlyPricePKR;
        target.BranchYearlyPricePKR = src.BranchYearlyPricePKR;
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
