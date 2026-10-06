using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Models;
using Xunit;

namespace Pos.Api.Tests;

/// <summary>
/// What a business host does with a head-office entitlement payload. The old code fetched this,
/// wrote a green log line and threw the body away — a shop suspended at head office went on
/// selling. These tests are about the applying half: the pull only counts if the change survives
/// the next read.
/// </summary>
public class HostEntitlementMirrorTests
{
    private static JsonElement Payload(
        string planKey = "professional",
        string status = "Active",
        string deploymentMode = "Standalone",
        object? features = null,
        object? capabilities = null,
        int version = 1,
        int? maxBranches = null) =>
        Record.Payload(new
        {
            version,
            status,
            planKey,
            maxBranches = maxBranches ?? 5,
            maxCounters = 10,
            maxOrderTabs = 25,
            maxUsers = 15,
            features = features ?? (object)new { hr = true, reporting = true },
            capabilities = capabilities ?? (object)new { hq = false },
            deploymentMode
        });

    [Fact]
    public async Task It_moves_tier_status_and_the_snapshot_together()
    {
        using var db = new TestDatabase();
        db.SeedTenant(); // seeded as Starter / Trial / Standalone

        var result = await db.Mirror.ApplyAsync(db.TenantId, Payload());

        Assert.True(result.Changed);
        Assert.Null(result.SkippedBecause);

        var tenant = await db.Db.Tenants.AsNoTracking().SingleAsync(t => t.Id == db.TenantId);
        // Tier and status are what IsStaleAsync compares the snapshot against. Mirroring the
        // snapshot without them would have the very next read throwing the mirror away.
        Assert.Equal(SubscriptionTier.Professional, tenant.Tier);
        Assert.Equal(TenantStatus.Active, tenant.Status);

        var snapshot = await db.Db.TenantEntitlementSnapshots.AsNoTracking()
            .SingleAsync(s => s.TenantId == db.TenantId);
        Assert.Equal("professional", snapshot.PlanKey);
        Assert.Equal(TenantStatus.Active, snapshot.Status);
        Assert.Equal(5, snapshot.MaxBranches);
        Assert.Equal(10, snapshot.MaxCounters);
        // Above both the local version and the cloud's, so a device licence carrying either of
        // the old numbers sees a mismatch and refreshes.
        Assert.Equal(2, snapshot.Version);
        Assert.True(snapshot.ComputedAt <= DateTime.UtcNow.AddMinutes(1));
    }

    /// <summary>The cloud sends package flags and feature codes as two separate maps. Sending only
    /// the first is what made the host discard the pull on the next read — it looks for the "hq"
    /// capability specifically.</summary>
    [Fact]
    public async Task It_lands_capabilities_in_the_features_json()
    {
        using var db = new TestDatabase();
        db.SeedTenant();

        await db.Mirror.ApplyAsync(db.TenantId, Payload(
            features: new { hr = true },
            capabilities: new { hq = true, inventory = true }));

        var snapshot = await db.Db.TenantEntitlementSnapshots.AsNoTracking()
            .SingleAsync(s => s.TenantId == db.TenantId);

        using var features = JsonDocument.Parse(snapshot.FeaturesJson);
        Assert.True(features.RootElement.GetProperty("hq").GetBoolean());
        Assert.True(features.RootElement.GetProperty("inventory").GetBoolean());
        Assert.True(features.RootElement.GetProperty("hr").GetBoolean());
    }

    [Fact]
    public async Task An_identical_second_pass_writes_nothing()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var payload = Payload();

        await db.Mirror.ApplyAsync(db.TenantId, payload);
        var versionAfterFirst = (await db.Db.TenantEntitlementSnapshots.AsNoTracking()
            .SingleAsync(s => s.TenantId == db.TenantId)).Version;

        var second = await db.Mirror.ApplyAsync(db.TenantId, payload);

        Assert.False(second.Changed);
        Assert.Null(second.SkippedBecause);
        var versionAfterSecond = (await db.Db.TenantEntitlementSnapshots.AsNoTracking()
            .SingleAsync(s => s.TenantId == db.TenantId)).Version;
        Assert.Equal(versionAfterFirst, versionAfterSecond);
    }

    /// <summary>Devices carry this number in their licence and refresh on a mismatch, so content
    /// that moved has to be visible as a new version — otherwise the tills keep enforcing what
    /// head office has already taken away.</summary>
    [Fact]
    public async Task A_change_in_content_bumps_the_version()
    {
        using var db = new TestDatabase();
        db.SeedTenant();

        await db.Mirror.ApplyAsync(db.TenantId,
            Payload(features: new { hr = true }, capabilities: new { hq = true }));
        var firstVersion = (await db.Db.TenantEntitlementSnapshots.AsNoTracking()
            .SingleAsync(s => s.TenantId == db.TenantId)).Version;

        var second = await db.Mirror.ApplyAsync(db.TenantId,
            Payload(status: "ReadOnly", features: new { hr = false }, capabilities: new { hq = false }));

        Assert.True(second.Changed);
        var after = await db.Db.TenantEntitlementSnapshots.AsNoTracking()
            .SingleAsync(s => s.TenantId == db.TenantId);
        Assert.True(after.Version > firstVersion);
        Assert.Equal(TenantStatus.ReadOnly, after.Status);
        Assert.Equal(TenantStatus.ReadOnly,
            (await db.Db.Tenants.AsNoTracking().SingleAsync(t => t.Id == db.TenantId)).Status);
    }

    [Fact]
    public async Task A_payload_without_planKey_or_status_is_skipped_not_applied()
    {
        using var db = new TestDatabase();
        db.SeedTenant();

        var result = await db.Mirror.ApplyAsync(db.TenantId, Record.Payload(new { features = new { hr = true } }));

        Assert.False(result.Changed);
        Assert.NotNull(result.SkippedBecause);
        Assert.Empty(await db.Db.TenantEntitlementSnapshots.AsNoTracking().ToListAsync());
        var tenant = await db.Db.Tenants.AsNoTracking().SingleAsync(t => t.Id == db.TenantId);
        Assert.Equal(SubscriptionTier.Starter, tenant.Tier);
        Assert.Equal(TenantStatus.Trial, tenant.Status);
    }

    [Fact]
    public async Task A_tenant_this_host_does_not_own_is_skipped()
    {
        using var db = new TestDatabase();
        db.SeedTenant();

        var result = await db.Mirror.ApplyAsync(Guid.NewGuid(), Payload());

        Assert.False(result.Changed);
        Assert.Equal("no such tenant on this host", result.SkippedBecause);
    }

    [Fact]
    public async Task An_unknown_plan_or_status_is_skipped_rather_than_guessed()
    {
        using var db = new TestDatabase();
        db.SeedTenant();

        var badPlan = await db.Mirror.ApplyAsync(db.TenantId, Payload(planKey: "enterprise-gold"));
        var badStatus = await db.Mirror.ApplyAsync(db.TenantId, Payload(status: "DefinitelyFine"));

        Assert.False(badPlan.Changed);
        Assert.Contains("unknown plan", badPlan.SkippedBecause ?? string.Empty);
        Assert.False(badStatus.Changed);
        Assert.Contains("unknown status", badStatus.SkippedBecause ?? string.Empty);
        Assert.Equal(SubscriptionTier.Starter,
            (await db.Db.Tenants.AsNoTracking().SingleAsync(t => t.Id == db.TenantId)).Tier);
    }
}
