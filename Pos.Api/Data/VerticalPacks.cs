using System;
using System.Collections.Generic;
using System.Linq;

namespace Pos.Api.Data;

// ============================================================
// VERTICAL PACKS — how one codebase serves every business sector.
//
// The old model was a BusinessType enum plus if/else scattered through the sidebar, the
// terminal and the reports, which meant every new sector cost roughly the same as the last.
// A pack instead DECLARES what it needs, and the UI and API read those declarations:
//
//   * ItemCapabilities  — what shape a product takes (variants, batches, weight, recipes...)
//   * FlowCapabilities  — how a sale is taken (tables and KOT, quick scan, appointments...)
//   * PosLayout         — which centre panel the POS terminal renders
//   * ExtraModules      — sector-specific screens that should appear in navigation
//
// Adding a sector is then: add an entry here, and implement whatever capability it names that
// does not exist yet. Nothing already shipped has to change.
// ============================================================

/// <summary>What shape a product takes in this sector.</summary>
public sealed record ItemCapabilities
{
    /// <summary>Size/colour style variants generated from an option matrix (apparel, footwear).</summary>
    public bool Variants { get; init; }
    /// <summary>Per-line add-ons and options chosen at sale time (food, drinks).</summary>
    public bool Modifiers { get; init; }
    /// <summary>Batch/lot numbers with expiry dates, enforced FEFO on issue (pharmacy, groceries).</summary>
    public bool BatchExpiry { get; init; }
    /// <summary>Per-unit serial tracking (electronics, appliances).</summary>
    public bool SerialNumbers { get; init; }
    /// <summary>Sold by weight through a scale, priced per kg/g (butchery, produce, bulk).</summary>
    public bool Weighable { get; init; }
    /// <summary>Bill of materials: the item consumes ingredients when sold (restaurant, bakery).</summary>
    public bool RecipeBom { get; init; }
    /// <summary>The item is a service occupying a time slot, not a stocked good (salon, clinic).</summary>
    public bool ServiceDuration { get; init; }
    /// <summary>Requires a controlled-substance / prescription record at point of sale (pharmacy).</summary>
    public bool PrescriptionRequired { get; init; }
    /// <summary>Price varies by customer tier and volume break (wholesale, distribution).</summary>
    public bool TieredPricing { get; init; }
}

/// <summary>How a sale is taken in this sector.</summary>
public sealed record FlowCapabilities
{
    /// <summary>Floor plan with tables, seats and open tabs.</summary>
    public bool TableService { get; init; }
    /// <summary>Kitchen order tickets routed to prep stations.</summary>
    public bool KitchenRouting { get; init; }
    /// <summary>Scan-and-go: barcode-first, minimal taps, no order lifecycle.</summary>
    public bool QuickSale { get; init; }
    /// <summary>Booked time slots against a staff member.</summary>
    public bool Appointments { get; init; }
    /// <summary>Rider dispatch and cash-on-delivery settlement.</summary>
    public bool Delivery { get; init; }
    /// <summary>Customer accounts carrying a balance and a credit limit.</summary>
    public bool CreditAccounts { get; init; }
    /// <summary>Staff commission accrued per line sold.</summary>
    public bool StaffCommission { get; init; }
    /// <summary>Goods leave on a delivery note and are invoiced later.</summary>
    public bool DeliveryNotes { get; init; }
}

/// <summary>Which centre panel the POS terminal renders by default for this sector.</summary>
public enum PosLayout
{
    /// <summary>Tile grid of products grouped by category. The general-purpose default.</summary>
    ProductGrid = 1,
    /// <summary>Floor plan of tables; tapping a table opens its tab.</summary>
    FloorPlan = 2,
    /// <summary>Search/scan box front and centre, grid secondary. For large catalogues.</summary>
    ScanFirst = 3,
    /// <summary>Day/staff calendar of bookable slots.</summary>
    AppointmentBook = 4,
    /// <summary>Line-entry sheet optimised for large multi-line orders.</summary>
    OrderSheet = 5
}

public sealed record VerticalPack
{
    public required string Key { get; init; }
    public required string DisplayName { get; init; }
    public required string Description { get; init; }
    public required PosLayout PosLayout { get; init; }
    public required ItemCapabilities Items { get; init; }
    public required FlowCapabilities Flows { get; init; }

    /// <summary>Sector-specific screens that navigation should surface when this pack is on.</summary>
    public IReadOnlyList<string> ExtraModules { get; init; } = Array.Empty<string>();

    /// <summary>What the sale-taking screen is called in this trade. "Menu" reads wrong in a pharmacy.</summary>
    public required string CatalogNoun { get; init; }
    public required string SaleNoun { get; init; }
}

public static class VerticalPacks
{
    public const string Restaurant = "restaurant";
    public const string Retail = "retail";
    public const string Grocery = "grocery";
    public const string Pharmacy = "pharmacy";
    public const string Salon = "salon";
    public const string Wholesale = "wholesale";
    public const string Apparel = "apparel";
    public const string Services = "services";

    private static readonly List<VerticalPack> All = new()
    {
        new VerticalPack
        {
            Key = Restaurant,
            DisplayName = "Restaurant & Cafe",
            Description = "Dine-in tables, kitchen tickets, modifiers, delivery and rider settlement.",
            PosLayout = PosLayout.FloorPlan,
            CatalogNoun = "Menu",
            SaleNoun = "Order",
            Items = new ItemCapabilities { Modifiers = true, RecipeBom = true },
            Flows = new FlowCapabilities { TableService = true, KitchenRouting = true, Delivery = true, StaffCommission = false },
            ExtraModules = new[] { "floors", "kitchen", "menu-engineering", "delivery" }
        },
        new VerticalPack
        {
            Key = Retail,
            DisplayName = "General Retail",
            Description = "Barcode-first checkout over a large catalogue, with variants and returns.",
            PosLayout = PosLayout.ScanFirst,
            CatalogNoun = "Catalog",
            SaleNoun = "Sale",
            Items = new ItemCapabilities { Variants = true, SerialNumbers = true },
            Flows = new FlowCapabilities { QuickSale = true, CreditAccounts = true },
            ExtraModules = new[] { "returns" }
        },
        new VerticalPack
        {
            Key = Grocery,
            DisplayName = "Grocery & Cash-and-Carry",
            Description = "Weighed items and PLU codes, batch expiry on perishables, high-throughput lanes.",
            PosLayout = PosLayout.ScanFirst,
            CatalogNoun = "Catalog",
            SaleNoun = "Sale",
            Items = new ItemCapabilities { Weighable = true, BatchExpiry = true },
            Flows = new FlowCapabilities { QuickSale = true, CreditAccounts = true },
            ExtraModules = new[] { "scale-items", "expiry-report" }
        },
        new VerticalPack
        {
            Key = Pharmacy,
            DisplayName = "Pharmacy",
            Description = "Batch and expiry tracking with FEFO issue, prescription capture, controlled-substance log.",
            PosLayout = PosLayout.ScanFirst,
            CatalogNoun = "Formulary",
            SaleNoun = "Sale",
            Items = new ItemCapabilities { BatchExpiry = true, PrescriptionRequired = true },
            Flows = new FlowCapabilities { QuickSale = true, CreditAccounts = true },
            ExtraModules = new[] { "prescriptions", "controlled-log", "expiry-report" }
        },
        new VerticalPack
        {
            Key = Salon,
            DisplayName = "Salon & Spa",
            Description = "Bookable services against staff, commission per stylist, retail products alongside.",
            PosLayout = PosLayout.AppointmentBook,
            CatalogNoun = "Services",
            SaleNoun = "Ticket",
            Items = new ItemCapabilities { ServiceDuration = true },
            Flows = new FlowCapabilities { Appointments = true, StaffCommission = true },
            ExtraModules = new[] { "appointments", "commission" }
        },
        new VerticalPack
        {
            Key = Wholesale,
            DisplayName = "Wholesale & Distribution",
            Description = "Volume pricing tiers, customer credit limits, delivery notes invoiced later.",
            PosLayout = PosLayout.OrderSheet,
            CatalogNoun = "Price List",
            SaleNoun = "Order",
            Items = new ItemCapabilities { TieredPricing = true },
            Flows = new FlowCapabilities { CreditAccounts = true, DeliveryNotes = true, Delivery = true },
            ExtraModules = new[] { "delivery-notes", "credit-control" }
        },
        new VerticalPack
        {
            Key = Apparel,
            DisplayName = "Apparel & Footwear",
            Description = "Size/colour matrix, per-variant stock, seasonal markdowns.",
            PosLayout = PosLayout.ProductGrid,
            CatalogNoun = "Catalog",
            SaleNoun = "Sale",
            Items = new ItemCapabilities { Variants = true },
            Flows = new FlowCapabilities { QuickSale = true },
            ExtraModules = new[] { "variant-matrix", "returns" }
        },
        new VerticalPack
        {
            Key = Services,
            DisplayName = "Professional Services",
            Description = "Time-based service lines, no stock, invoice-led.",
            PosLayout = PosLayout.OrderSheet,
            CatalogNoun = "Services",
            SaleNoun = "Invoice",
            Items = new ItemCapabilities { ServiceDuration = true },
            Flows = new FlowCapabilities { Appointments = true, CreditAccounts = true },
            ExtraModules = new[] { "appointments" }
        }
    };

    public static IReadOnlyList<VerticalPack> Catalog => All;

    public static VerticalPack? Find(string? key) =>
        key == null ? null : All.FirstOrDefault(p => string.Equals(p.Key, key, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Bridges the legacy <see cref="Models.BusinessType"/> enum to a pack key, so tenants that
    /// signed up before packs existed resolve to something sensible without a data migration.
    /// </summary>
    public static string FromLegacyBusinessType(Models.BusinessType businessType) => businessType switch
    {
        Models.BusinessType.Restaurant => Restaurant,
        Models.BusinessType.Retail => Retail,
        Models.BusinessType.CashAndCarry => Grocery,
        Models.BusinessType.Hybrid => Restaurant,
        _ => Retail
    };

    /// <summary>
    /// Merges several packs into one capability set — a tenant running Grocery + Restaurant
    /// (a cafe inside a store) gets the union, and the primary pack decides the POS layout.
    /// </summary>
    public static (ItemCapabilities Items, FlowCapabilities Flows, PosLayout Layout, IReadOnlyList<string> Modules) Merge(
        IEnumerable<string> packKeys, string? primaryKey)
    {
        var packs = packKeys.Select(Find).Where(p => p != null).Select(p => p!).ToList();
        if (packs.Count == 0)
        {
            var fallback = Find(Retail)!;
            return (fallback.Items, fallback.Flows, fallback.PosLayout, fallback.ExtraModules);
        }

        var items = new ItemCapabilities
        {
            Variants = packs.Any(p => p.Items.Variants),
            Modifiers = packs.Any(p => p.Items.Modifiers),
            BatchExpiry = packs.Any(p => p.Items.BatchExpiry),
            SerialNumbers = packs.Any(p => p.Items.SerialNumbers),
            Weighable = packs.Any(p => p.Items.Weighable),
            RecipeBom = packs.Any(p => p.Items.RecipeBom),
            ServiceDuration = packs.Any(p => p.Items.ServiceDuration),
            PrescriptionRequired = packs.Any(p => p.Items.PrescriptionRequired),
            TieredPricing = packs.Any(p => p.Items.TieredPricing)
        };

        var flows = new FlowCapabilities
        {
            TableService = packs.Any(p => p.Flows.TableService),
            KitchenRouting = packs.Any(p => p.Flows.KitchenRouting),
            QuickSale = packs.Any(p => p.Flows.QuickSale),
            Appointments = packs.Any(p => p.Flows.Appointments),
            Delivery = packs.Any(p => p.Flows.Delivery),
            CreditAccounts = packs.Any(p => p.Flows.CreditAccounts),
            StaffCommission = packs.Any(p => p.Flows.StaffCommission),
            DeliveryNotes = packs.Any(p => p.Flows.DeliveryNotes)
        };

        var primary = Find(primaryKey) ?? packs[0];
        var modules = packs.SelectMany(p => p.ExtraModules).Distinct().ToList();
        return (items, flows, primary.PosLayout, modules);
    }
}
