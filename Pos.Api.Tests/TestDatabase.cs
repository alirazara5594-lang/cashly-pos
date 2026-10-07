using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;
using Pos.Api.Services;

namespace Pos.Api.Tests;

/// <summary>
/// A real SQLite database that lives for one test. In-memory keeps the suite fast; keeping it
/// real (rather than mocking the context) is the point — the code under test is almost entirely
/// LINQ and SaveChanges, and both of them are exactly what breaks when a batch meets a database.
///
/// AppDbContext is built without an ITenantProvider, so CurrentTenantId is Guid.Empty and the
/// global tenant filters are off: these tests call the receiver and the mirror the way the host
/// does, with the tenant passed in by hand.
/// </summary>
public sealed class TestDatabase : IDisposable
{
    private readonly SqliteConnection _connection;

    public AppDbContext Db { get; }
    public SyncReceiver Receiver { get; }
    public HostEntitlementMirror Mirror { get; }
    public CatalogBuilder Builder { get; }
    public CatalogMirror Catalog { get; }
    public ISyncKeyAuthenticator Auth { get; }
    public IEntitlementService Entitlements { get; }
    public ISubscriptionService Subscriptions { get; }
    public ISubscriptionCheckout Checkout { get; }

    public TestDatabase()
    {
        // A named shared-cache connection would let a second connection see the same table; an
        // unnamed ":memory:" one is destroyed the moment the last handle goes. Open first, then
        // hand the still-open connection to EF, which keeps it alive for the context's lifetime.
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .Options;

        Db = new AppDbContext(options);
        Db.Database.EnsureCreated();

        Receiver = new SyncReceiver(Db);
        Mirror = new HostEntitlementMirror(Db);
        Builder = new CatalogBuilder(Db);
        Catalog = new CatalogMirror(Db);
        Auth = new SyncKeyAuthenticator(Db);
        Entitlements = new EntitlementService(Db);
        Subscriptions = new SubscriptionService(Db, Entitlements,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<SubscriptionService>.Instance);
        Checkout = new SubscriptionCheckout(Db, Subscriptions, Entitlements);
    }

    public Guid TenantId { get; private set; } = Guid.NewGuid();
    public Guid BranchId { get; private set; } = Guid.NewGuid();
    public Guid ForeignBranchId { get; private set; } = Guid.NewGuid();

    /// <summary>Seeds the tenant and two branches: one belonging to this business, one to nobody
    /// in particular (the stand-in for a record that arrived against another tenant).</summary>
    public void SeedTenant()
    {
        TenantId = Guid.NewGuid();
        BranchId = Guid.NewGuid();
        ForeignBranchId = Guid.NewGuid();

        Db.Tenants.Add(new Tenant
        {
            Id = TenantId,
            Name = "Cashly Tests",
            Slug = $"cashly-tests-{TenantId:N}",
            ContactName = "Test Owner",
            ContactEmail = "owner@example.com",
            ContactPhone = "+920000000000",
            Tier = SubscriptionTier.Starter,
            Status = TenantStatus.Trial,
            DeploymentMode = DeploymentMode.Standalone
        });
        Db.Branches.Add(new Branch
        {
            Id = BranchId, TenantId = TenantId, Name = "Main", Code = "MAIN"
        });

        // The stand-in for a record that arrived against another tenant. It needs its own tenant
        // row, not a dangling id: Branch.TenantId is a foreign key, so a branch naming no tenant
        // would fail the seed before any sync code ran.
        var otherTenantId = Guid.NewGuid();
        Db.Tenants.Add(new Tenant
        {
            Id = otherTenantId,
            Name = "Another Business",
            Slug = $"another-business-{otherTenantId:N}",
            ContactName = "Other Owner",
            ContactEmail = "other@example.com",
            ContactPhone = "+920000000001"
        });
        Db.Branches.Add(new Branch
        {
            Id = ForeignBranchId, TenantId = otherTenantId, Name = "Someone else's", Code = "OTHER"
        });

        Db.SaveChanges();
    }

    /// <summary>
    /// The sellable plans and their feature rows, built from FeatureCatalog exactly as the real
    /// seeder builds them — a hand-written matrix in a test would prove the test, not the product.
    /// </summary>
    public void SeedPlans()
    {
        foreach (var (code, name, description, monthly, yearly, rank) in FeatureCatalog.Plans)
        {
            var plan = new Plan
            {
                Code = code, Name = name, Description = description,
                MonthlyPricePKR = monthly, YearlyPricePKR = yearly, Rank = rank, IsActive = true
            };
            Db.Plans.Add(plan);
            Db.SaveChanges();
            Db.PlanFeatures.AddRange(FeatureCatalog.BuildFeatureRows(plan.Id, plan.Code));
        }
        Db.SaveChanges();
    }

    /// <summary>
    /// The per-tier package configs the real seeder writes from the same catalogue. Kitchen screen
    /// allowances are read from here rather than from the plan rows, so a test that is about device
    /// ceilings has to seed them or it would be testing an empty table.
    /// </summary>
    public void SeedPackages()
    {
        foreach (var (code, _, _, _, _, _) in FeatureCatalog.Plans)
        {
            var packageKey = char.ToUpperInvariant(code[0]) + code[1..];
            if (Db.SaaSPackageConfigs.Any(p => p.PackageKey == packageKey)) continue;
            Db.SaaSPackageConfigs.Add(FeatureCatalog.BuildPackageConfig(code));
        }
        Db.SaveChanges();
    }

    /// <summary>Something the owner can buy.</summary>
    public void SeedAddOn(string key, string displayName, decimal monthly, decimal yearly, bool active = true)
    {
        Db.AddOnCatalogItems.Add(new AddOnCatalogItem
        {
            Key = key, DisplayName = displayName, Description = displayName,
            MonthlyPricePKR = monthly, YearlyPricePKR = yearly, IsActive = active
        });
        Db.SaveChanges();
    }

    /// <summary>
    /// A registered business host. Pass null for <paramref name="syncKey"/> to get a host that
    /// was registered before sync keys existed — the case the gate must refuse rather than fall
    /// back to the HostCode.
    /// </summary>
    public BusinessHost SeedHost(string? syncKey, bool active = true, string hostCode = "AB12CD")
    {
        var host = new BusinessHost
        {
            TenantId = TenantId,
            BranchId = BranchId,
            HostCode = hostCode,
            HostName = "Test Host",
            SyncKeyHash = syncKey == null ? null : SyncKeys.Hash(syncKey),
            IsActive = active
        };
        Db.BusinessHosts.Add(host);
        Db.SaveChanges();
        return host;
    }

    /// <summary>The policy row the catalogue pull is measured against. Absent settings mean
    /// "branches may edit", which is what the rest of the app already assumes.</summary>
    public void SeedSettings(CatalogControl control, bool branchPricing = false)
    {
        Db.TenantSettings.Add(new TenantSettings
        {
            TenantId = TenantId,
            CatalogControl = control,
            BranchPricing = branchPricing
        });
        Db.SaveChanges();
    }

    /// <summary>A product row the cloud already knows about, for the "product exists" path.</summary>
    public Guid SeedProduct(string name = "Zinger Burger")
    {
        var id = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        Db.Categories.Add(new Category
        {
            Id = categoryId, TenantId = TenantId, Name = "Burgers", Icon = "burger"
        });
        Db.Products.Add(new Product
        {
            Id = id, TenantId = TenantId, CategoryId = categoryId, Name = name, SellingPricePKR = 650m
        });
        Db.SaveChanges();
        return id;
    }

    public void Dispose()
    {
        Db.Dispose();
        _connection.Dispose();
    }
}

/// <summary>Builds the wire shape: an anonymous object serialised the way the POST body arrives
/// (camelCase keys) and handed back as a detached JsonElement dictionary.</summary>
public static class Record
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static Dictionary<string, JsonElement> Of(object anon)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(anon, Options));
        var rec = doc.RootElement.EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal);
        return rec;
    }

    public static List<Dictionary<string, JsonElement>> Batch(params object[] rows) =>
        rows.Select(Of).ToList();

    public static JsonElement Payload(object anon)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(anon, Options));
        return doc.RootElement.Clone();
    }
}
