using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// HOST-SIDE ENTITLEMENT MIRROR
//
// A business host pulls its entitlements from head office every sync tick. Fetching them was
// never the problem — the old code issued the GET, wrote a green SyncLog line and discarded the
// response, so a shop that had been suspended at head office went on selling forever.
//
// The harder half is applying them so they STAY applied. The host's EntitlementService recomputes
// its snapshot whenever the local tenant row disagrees with it, which would immediately overwrite
// anything mirrored down unless the tenant row is brought across too. So this moves the three
// things the snapshot is derived from — tier, status and deployment shape — and then the snapshot
// itself, in one save.
//
// Head office is the authority on all three. What the host remains authority for is its own data.
// ============================================================

/// <summary>What one mirror pass did.</summary>
public sealed record EntitlementMirrorResult(bool Changed, string? SkippedBecause = null)
{
    public static EntitlementMirrorResult Unchanged() => new(false);
    public static EntitlementMirrorResult Skipped(string reason) => new(false, reason);
}

public class HostEntitlementMirror
{
    private readonly AppDbContext _db;

    public HostEntitlementMirror(AppDbContext db) => _db = db;

    /// <summary>
    /// Applies a payload shaped like GET /api/sync/entitlements to this host's database.
    ///
    /// Returns without writing when the payload is unusable or when it says exactly what the host
    /// already believes — a five-minute timer should not produce a database write every tick.
    /// </summary>
    public async Task<EntitlementMirrorResult> ApplyAsync(Guid tenantId, JsonElement root, CancellationToken ct = default)
    {
        var planKey = Str(root, "planKey");
        var statusRaw = Str(root, "status");

        if (planKey == null || statusRaw == null)
            return EntitlementMirrorResult.Skipped("payload has no planKey/status");
        if (!Enum.TryParse<SubscriptionTier>(planKey, true, out var tier))
            return EntitlementMirrorResult.Skipped($"unknown plan '{planKey}'");
        if (!Enum.TryParse<TenantStatus>(statusRaw, true, out var status))
            return EntitlementMirrorResult.Skipped($"unknown status '{statusRaw}'");

        var features = ReadBoolMap(root, "features");
        var capabilities = ReadBoolMap(root, "capabilities");
        if (features.Count == 0 && capabilities.Count == 0)
            return EntitlementMirrorResult.Skipped("payload carries no features");

        var modeRaw = Str(root, "deploymentMode");
        var mode = modeRaw != null && Enum.TryParse<DeploymentMode>(modeRaw, true, out var m)
            ? m
            : (DeploymentMode?)null;

        var tenant = await _db.Tenants.IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant == null)
            return EntitlementMirrorResult.Skipped("no such tenant on this host");

        // --- The tenant row -------------------------------------------------
        // IsStaleAsync compares the snapshot against these three, so mirroring the snapshot
        // without them would have the very next read throwing the mirror away as stale.
        var tenantChanged = false;
        if (tenant.Tier != tier) { tenant.Tier = tier; tenantChanged = true; }
        if (tenant.Status != status) { tenant.Status = status; tenantChanged = true; }
        if (mode is { } resolvedMode && tenant.DeploymentMode != resolvedMode)
        { tenant.DeploymentMode = resolvedMode; tenantChanged = true; }

        // --- The snapshot ---------------------------------------------------
        var snapshot = await _db.TenantEntitlementSnapshots.IgnoreQueryFilters()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        if (snapshot == null)
        {
            snapshot = new TenantEntitlementSnapshot { TenantId = tenantId, Version = 0 };
            _db.TenantEntitlementSnapshots.Add(snapshot);
        }

        var cloudVersion = Int(root, "version");
        var featuresJson = JsonSerializer.Serialize(Merge(features, capabilities));
        var maxBranches = Int(root, "maxBranches", snapshot.MaxBranches);
        var maxCounters = Int(root, "maxCounters", snapshot.MaxCounters);
        var maxOrderTabs = Int(root, "maxOrderTabs", snapshot.MaxOrderTabs);
        var maxUsers = Int(root, "maxUsers", snapshot.MaxUsers);

        var snapshotChanged =
            snapshot.PlanKey != planKey
            || snapshot.Status != status
            || snapshot.MaxBranches != maxBranches
            || snapshot.MaxCounters != maxCounters
            || snapshot.MaxOrderTabs != maxOrderTabs
            || snapshot.MaxUsers != maxUsers
            || snapshot.FeaturesJson != featuresJson
            // A snapshot predating the HQ blanket rule is the one case where a numerically equal
            // payload still needs the recompute guard to stop firing.
            || (mode == DeploymentMode.HeadOffice && maxBranches < FeatureCatalog.UnlimitedCount);

        if (!tenantChanged && !snapshotChanged)
            return EntitlementMirrorResult.Unchanged();

        // Devices carry this number in their licence and refresh on a mismatch, so content that
        // moved must be visible as a new version — otherwise the tills keep enforcing what head
        // office has already taken away.
        if (snapshotChanged)
            snapshot.Version = Math.Max(snapshot.Version, cloudVersion) + 1;

        snapshot.PlanKey = planKey;
        snapshot.MaxBranches = maxBranches;
        snapshot.MaxCounters = maxCounters;
        snapshot.MaxOrderTabs = maxOrderTabs;
        snapshot.MaxUsers = maxUsers;
        snapshot.FeaturesJson = featuresJson;
        snapshot.Status = status;
        snapshot.ComputedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return new EntitlementMirrorResult(true);
    }

    /// <summary>Package switches and plan feature codes share one JSON column on this side.</summary>
    private static Dictionary<string, bool> Merge(
        Dictionary<string, bool> features, Dictionary<string, bool> capabilities)
    {
        var merged = new Dictionary<string, bool>(features, StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in capabilities) merged[key] = value;
        return merged;
    }

    private static Dictionary<string, bool> ReadBoolMap(JsonElement root, string name)
    {
        var map = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        var el = Prop(root, name);
        if (el == null || el.Value.ValueKind != JsonValueKind.Object) return map;

        foreach (var property in el.Value.EnumerateObject())
        {
            if (property.Value.ValueKind is JsonValueKind.True or JsonValueKind.False)
                map[property.Name] = property.Value.GetBoolean();
        }
        return map;
    }

    private static string? Str(JsonElement root, string name) =>
        Prop(root, name) is { } el && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    private static int Int(JsonElement root, string name, int fallback = 0)
    {
        var el = Prop(root, name);
        if (el is not { } value) return fallback;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n)) return n;
        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed)) return parsed;
        return fallback;
    }

    /// <summary>Case-insensitive by scan: the payload's property names are the anonymous shape
    /// the cloud endpoint returned, and this reader must not depend on its casing policy.</summary>
    private static JsonElement? Prop(JsonElement root, string name)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        if (root.TryGetProperty(name, out var el)) return el;
        foreach (var property in root.EnumerateObject())
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                return property.Value;
        return null;
    }
}
