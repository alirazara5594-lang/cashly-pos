using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// THE ENTITLEMENT ENGINE
//
// Before this existed, "how many counters may this tenant run?" had three possible answers
// living in three places — SaaSPackageConfig.MaxCounters, Branch.AllowedCounters, and whatever
// EXTRA_COUNTER add-ons happened to be active — reconciled ad hoc at each call site with a
// Math.Min. Two stores that can disagree is not a limit, it is a bug waiting for a support ticket.
//
// Everything now resolves here, in one order:
//
//     plan defaults  ->  + purchased add-ons  ->  + support overrides  =  effective entitlements
//
// The result is cached in TenantEntitlementSnapshot and version-stamped. Device licences carry
// that version, so a tenant's upgrade reaches every till on its next heartbeat without a reinstall.
// ============================================================

/// <summary>Fully-resolved entitlements for one tenant. Immutable; recomputed, never patched.</summary>
public sealed record EffectiveEntitlements
{
    public required Guid TenantId { get; init; }
    public required string PlanKey { get; init; }
    public required int Version { get; init; }
    public required TenantStatus Status { get; init; }

    public required int MaxBranches { get; init; }
    public required int MaxCounters { get; init; }
    public required int MaxOrderTabs { get; init; }
    public required int MaxUsers { get; init; }

    public required IReadOnlyDictionary<string, bool> Features { get; init; }

    /// <summary>Vertical pack keys this tenant runs, primary first.</summary>
    public required IReadOnlyList<string> PackKeys { get; init; }
    public required string PrimaryPackKey { get; init; }

    /// <summary>Standalone shop, or head office with branches under it.</summary>
    public required DeploymentMode DeploymentMode { get; init; }

    public bool Has(string flagName) => Features.TryGetValue(flagName, out var on) && on;

    /// <summary>
    /// Which app surface this session should see.
    ///
    /// One rule, in one place, so the sidebar, the router, the device-activation check and the
    /// API guards cannot drift into disagreeing about whether this person gets a till.
    ///
    /// The DEVICE wins when there is one. A machine activated as a back-office workstation runs
    /// the ERP no matter where it sits — which is the whole answer to "how does the software know
    /// this PC is the office and that one is the counter?". It knows because somebody said so
    /// when they activated it, not because of the address.
    ///
    /// With no device (a plain browser login) it falls back to the org shape: head office of a
    /// chain administers, a branch sells, a standalone shop does both.
    /// </summary>
    public AppSurface SurfaceFor(bool isHeadOfficeBranch, TerminalType? deviceType = null)
    {
        if (deviceType == TerminalType.BackOffice) return AppSurface.Erp;
        if (deviceType is TerminalType.Counter or TerminalType.OrderTab or TerminalType.KitchenDisplay)
            return AppSurface.Pos;

        return DeploymentMode != DeploymentMode.HeadOffice
            ? AppSurface.Hybrid            // standalone: one app that both sells and administers
            : isHeadOfficeBranch
                ? AppSurface.Erp           // chain head office: administers, never sells
                : AppSurface.Pos;          // chain branch: sells, plus its own back office
    }

    /// <summary>
    /// True when this tenant's head office is a pure back office. Used to refuse activating a
    /// till at head office — a location that does not sell has no business holding a counter
    /// licence, and charging for one would be charging for nothing.
    /// </summary>
    public bool HeadOfficeIsErpOnly => DeploymentMode == DeploymentMode.HeadOffice;

    // --- What the tenant's lifecycle state permits ---------------------------
    // One place decides what each status actually blocks, so the API, the UI and the device
    // licence cannot drift into disagreeing about whether a suspended tenant may still sell.

    /// <summary>May the POS create new sales?</summary>
    public bool CanSell => Status is TenantStatus.Trial or TenantStatus.Active or TenantStatus.PastDue or TenantStatus.Restricted;

    /// <summary>May back-office screens (reports, settings, catalog editing, admin) be used?</summary>
    public bool CanUseBackOffice => Status is TenantStatus.Trial or TenantStatus.Active or TenantStatus.PastDue;

    /// <summary>May existing data be read and exported? True for everything short of a hard lock.</summary>
    public bool CanRead => Status != TenantStatus.Suspended && Status != TenantStatus.Cancelled;

    /// <summary>Should the app show a pay-now banner?</summary>
    public bool ShowBillingWarning => Status is TenantStatus.PastDue or TenantStatus.Restricted or TenantStatus.ReadOnly;
}

public interface IEntitlementService
{
    /// <summary>Reads the cached snapshot, recomputing it if absent or stale.</summary>
    Task<EffectiveEntitlements> GetAsync(Guid tenantId);

    /// <summary>Forces a recompute and bumps the version. Call after ANY change to plan,
    /// add-ons, overrides, status or vertical packs.</summary>
    Task<EffectiveEntitlements> RecomputeAsync(Guid tenantId);

    /// <summary>Devices of one class currently occupying a quota slot at a branch.</summary>
    Task<int> CountDevicesInUseAsync(Guid branchId, TerminalType type);

    /// <summary>Checks whether one more device of this class fits. Returns the limit either way
    /// so the caller can say "3 of 3 used" instead of just "no".</summary>
    Task<(bool Allowed, int InUse, int Limit)> CanAddDeviceAsync(Guid tenantId, Guid branchId, TerminalType type);
}

public class EntitlementService : IEntitlementService
{
    private readonly AppDbContext _db;

    /// <summary>Quota keys an override may adjust. Anything else is treated as a feature flag.</summary>
    private static readonly HashSet<string> QuotaKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        nameof(SaaSPackageConfig.MaxBranches),
        nameof(SaaSPackageConfig.MaxCounters),
        nameof(SaaSPackageConfig.MaxOrderTabs),
        nameof(SaaSPackageConfig.MaxUsers)
    };

    /// <summary>Every boolean feature the platform sells. Add a feature here and it becomes
    /// sellable through a plan, an add-on or an override with no further wiring.</summary>
    public static readonly string[] FeatureFlagNames =
    {
        nameof(SaaSPackageConfig.HasKitchenDisplay),
        nameof(SaaSPackageConfig.HasDeliveryCOD),
        nameof(SaaSPackageConfig.HasInventoryManagement),
        nameof(SaaSPackageConfig.HasStockTransfers),
        nameof(SaaSPackageConfig.HasDirectorDashboard),
        nameof(SaaSPackageConfig.HasConsolidatedReports),
        nameof(SaaSPackageConfig.HasWhatsAppMessaging),
        nameof(SaaSPackageConfig.HasAdvancedReports),
        nameof(SaaSPackageConfig.HasMultiBranch)
    };

    public EntitlementService(AppDbContext db) => _db = db;

    public async Task<EffectiveEntitlements> GetAsync(Guid tenantId)
    {
        var snapshot = await _db.TenantEntitlementSnapshots
            .AsNoTracking()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId);

        // A snapshot can go stale two ways: a time-limited override lapsed, or the trial ended.
        // Both are clock-driven rather than write-driven, so nothing would have invalidated the
        // cache — cheapest correct answer is to recompute when the cached row predates either.
        if (snapshot == null || await IsStaleAsync(tenantId, snapshot))
            return await RecomputeAsync(tenantId);

        var mode = await _db.Tenants.AsNoTracking().IgnoreQueryFilters()
            .Where(t => t.Id == tenantId).Select(t => t.DeploymentMode).FirstOrDefaultAsync();
        return Materialize(tenantId, snapshot, await GetPackKeysAsync(tenantId), mode);
    }

    private async Task<bool> IsStaleAsync(Guid tenantId, TenantEntitlementSnapshot snapshot)
    {
        var now = DateTime.UtcNow;

        // An override that expired since the snapshot was computed.
        var lapsed = await _db.TenantEntitlementOverrides
            .IgnoreQueryFilters()
            .AnyAsync(o => o.TenantId == tenantId
                        && o.IsActive
                        && o.ExpiresAt != null
                        && o.ExpiresAt <= now
                        && o.ExpiresAt > snapshot.ComputedAt);
        if (lapsed) return true;

        // A trial that ran out since the snapshot was computed.
        var tenant = await _db.Tenants.AsNoTracking().IgnoreQueryFilters()
            .Where(t => t.Id == tenantId)
            .Select(t => new { t.IsTrialActive, t.TrialEndsAt, t.Status })
            .FirstOrDefaultAsync();
        if (tenant != null && tenant.IsTrialActive && tenant.TrialEndsAt <= now && snapshot.Status == TenantStatus.Trial)
            return true;

        return tenant != null && tenant.Status != snapshot.Status;
    }

    public async Task<EffectiveEntitlements> RecomputeAsync(Guid tenantId)
    {
        var now = DateTime.UtcNow;

        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId)
            ?? throw new InvalidOperationException($"Tenant {tenantId} not found.");

        // --- 1. Plan defaults ------------------------------------------------
        var plan = await _db.SaaSPackageConfigs.AsNoTracking()
            .FirstOrDefaultAsync(p => p.PackageKey == tenant.Tier.ToString());

        var maxBranches = plan?.MaxBranches ?? 1;
        var maxCounters = plan?.MaxCounters ?? 1;
        var maxOrderTabs = plan?.MaxOrderTabs ?? 0;
        var maxUsers = plan?.MaxUsers ?? 2;

        var features = FeatureFlagNames.ToDictionary(
            name => name,
            name => plan != null && ReadPlanFlag(plan, name),
            StringComparer.OrdinalIgnoreCase);

        // --- 2. Purchased add-ons -------------------------------------------
        var addOns = await _db.AddOnSubscriptions.AsNoTracking().IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId && a.IsActive)
            .ToListAsync();

        foreach (var addOn in addOns)
        {
            switch (addOn.AddOnKey)
            {
                // Device add-ons are branch-scoped and therefore NOT folded into the tenant-wide
                // ceiling here — CanAddDeviceAsync adds them per branch. Folding them in twice
                // was part of the old double-counting problem.
                case "EXTRA_COUNTER":
                case "EXTRA_TABLET":
                    break;
                case "EXTRA_USER":
                    maxUsers += addOn.Quantity;
                    break;
                case "EXTRA_BRANCH":
                    maxBranches += addOn.Quantity;
                    break;
                default:
                    if (features.ContainsKey(addOn.AddOnKey)) features[addOn.AddOnKey] = true;
                    break;
            }
        }

        // --- 3. Support overrides -------------------------------------------
        var overrides = await _db.TenantEntitlementOverrides.AsNoTracking().IgnoreQueryFilters()
            .Where(o => o.TenantId == tenantId && o.IsActive)
            .ToListAsync();

        foreach (var ov in overrides.Where(o => o.IsInForce(now)))
        {
            if (QuotaKeys.Contains(ov.Key))
            {
                if (!int.TryParse(ov.Value, out var delta)) continue;
                switch (ov.Key.ToLowerInvariant())
                {
                    case "maxbranches": maxBranches += delta; break;
                    case "maxcounters": maxCounters += delta; break;
                    case "maxordertabs": maxOrderTabs += delta; break;
                    case "maxusers": maxUsers += delta; break;
                }
            }
            else if (features.ContainsKey(ov.Key))
            {
                features[ov.Key] = bool.TryParse(ov.Value, out var on) && on;
            }
        }

        // A quota can never go below zero however the deltas stack up.
        maxBranches = Math.Max(0, maxBranches);
        maxCounters = Math.Max(0, maxCounters);
        maxOrderTabs = Math.Max(0, maxOrderTabs);
        maxUsers = Math.Max(0, maxUsers);

        // --- 4. Lifecycle status ---------------------------------------------
        var status = ResolveStatus(tenant, now);
        if (status != tenant.Status)
        {
            tenant.Status = status;
            tenant.IsTrialActive = status == TenantStatus.Trial;
        }

        // --- 5. Persist the snapshot ------------------------------------------
        var snapshot = await _db.TenantEntitlementSnapshots.IgnoreQueryFilters()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId);

        if (snapshot == null)
        {
            snapshot = new TenantEntitlementSnapshot { TenantId = tenantId, Version = 1 };
            _db.TenantEntitlementSnapshots.Add(snapshot);
        }
        else
        {
            snapshot.Version += 1;
        }

        snapshot.PlanKey = tenant.Tier.ToString();
        snapshot.MaxBranches = maxBranches;
        snapshot.MaxCounters = maxCounters;
        snapshot.MaxOrderTabs = maxOrderTabs;
        snapshot.MaxUsers = maxUsers;
        snapshot.FeaturesJson = JsonSerializer.Serialize(features);
        snapshot.Status = status;
        snapshot.ComputedAt = now;

        await _db.SaveChangesAsync();

        return Materialize(tenantId, snapshot, await GetPackKeysAsync(tenantId, tenant.BusinessType), tenant.DeploymentMode);
    }

    /// <summary>
    /// Trial expiry is the only automatic transition. Every other move along the ladder is a
    /// deliberate act by the platform owner — software should not suspend a paying customer on
    /// its own because a webhook was late.
    /// </summary>
    private static TenantStatus ResolveStatus(Tenant tenant, DateTime now)
    {
        if (!tenant.IsActive) return TenantStatus.Suspended;
        if (tenant.Status == TenantStatus.Cancelled) return TenantStatus.Cancelled;

        if (tenant.Status == TenantStatus.Trial || tenant.IsTrialActive)
        {
            if (tenant.TrialEndsAt > now) return TenantStatus.Trial;
            // Trial is over: paid subscribers go Active, everyone else becomes past due.
            return tenant.SubscriptionPaidUntil != null && tenant.SubscriptionPaidUntil > now
                ? TenantStatus.Active
                : TenantStatus.PastDue;
        }

        return tenant.Status;
    }

    private static bool ReadPlanFlag(SaaSPackageConfig plan, string flagName) => flagName switch
    {
        nameof(SaaSPackageConfig.HasKitchenDisplay) => plan.HasKitchenDisplay,
        nameof(SaaSPackageConfig.HasDeliveryCOD) => plan.HasDeliveryCOD,
        nameof(SaaSPackageConfig.HasInventoryManagement) => plan.HasInventoryManagement,
        nameof(SaaSPackageConfig.HasStockTransfers) => plan.HasStockTransfers,
        nameof(SaaSPackageConfig.HasDirectorDashboard) => plan.HasDirectorDashboard,
        nameof(SaaSPackageConfig.HasConsolidatedReports) => plan.HasConsolidatedReports,
        nameof(SaaSPackageConfig.HasWhatsAppMessaging) => plan.HasWhatsAppMessaging,
        nameof(SaaSPackageConfig.HasAdvancedReports) => plan.HasAdvancedReports,
        nameof(SaaSPackageConfig.HasMultiBranch) => plan.HasMultiBranch,
        _ => false
    };

    private async Task<(List<string> Keys, string Primary)> GetPackKeysAsync(Guid tenantId, BusinessType? legacyFallback = null)
    {
        var rows = await _db.TenantVerticalPacks.AsNoTracking().IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId)
            .ToListAsync();

        if (rows.Count > 0)
        {
            var primary = rows.FirstOrDefault(r => r.IsPrimary)?.PackKey ?? rows[0].PackKey;
            return (rows.OrderByDescending(r => r.IsPrimary).Select(r => r.PackKey).ToList(), primary);
        }

        // No packs assigned: fall back to the legacy BusinessType so pre-pack tenants keep working.
        var businessType = legacyFallback ?? await _db.Tenants.AsNoTracking().IgnoreQueryFilters()
            .Where(t => t.Id == tenantId).Select(t => t.BusinessType).FirstOrDefaultAsync();
        var fallbackKey = VerticalPacks.FromLegacyBusinessType(businessType);
        return (new List<string> { fallbackKey }, fallbackKey);
    }

    private static EffectiveEntitlements Materialize(
        Guid tenantId, TenantEntitlementSnapshot snapshot, (List<string> Keys, string Primary) packs,
        DeploymentMode deploymentMode)
    {
        var features = JsonSerializer.Deserialize<Dictionary<string, bool>>(snapshot.FeaturesJson)
                       ?? new Dictionary<string, bool>();

        return new EffectiveEntitlements
        {
            TenantId = tenantId,
            PlanKey = snapshot.PlanKey,
            Version = snapshot.Version,
            Status = snapshot.Status,
            MaxBranches = snapshot.MaxBranches,
            MaxCounters = snapshot.MaxCounters,
            MaxOrderTabs = snapshot.MaxOrderTabs,
            MaxUsers = snapshot.MaxUsers,
            Features = new Dictionary<string, bool>(features, StringComparer.OrdinalIgnoreCase),
            PackKeys = packs.Keys,
            PrimaryPackKey = packs.Primary,
            DeploymentMode = deploymentMode
        };
    }

    public async Task<int> CountDevicesInUseAsync(Guid branchId, TerminalType type)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddHours(-Terminal.DeviceSlotCooldownHours);

        // Mirrors Terminal.OccupiesQuotaSlot, expressed so the database can evaluate it:
        // not revoked, and either live or retired within the cooldown window.
        return await _db.Terminals.IgnoreQueryFilters()
            .CountAsync(t => t.BranchId == branchId
                          && t.TerminalType == type
                          && t.RevokedAt == null
                          && (t.DeactivatedAt == null || t.DeactivatedAt > cutoff));
    }

    public async Task<(bool Allowed, int InUse, int Limit)> CanAddDeviceAsync(Guid tenantId, Guid branchId, TerminalType type)
    {
        var ent = await GetAsync(tenantId);

        // Non-selling devices are not metered. A kitchen screen and a back-office workstation
        // both cost the business money to run and earn the platform nothing per-seat; metering
        // them just pushes kitchens back to paper and accounts back into spreadsheets.
        if (type is TerminalType.KitchenDisplay or TerminalType.BackOffice)
            return (true, await CountDevicesInUseAsync(branchId, type), int.MaxValue);

        var baseLimit = type == TerminalType.OrderTab ? ent.MaxOrderTabs : ent.MaxCounters;

        // Branch-scoped device add-ons stack on top of the plan's per-branch allowance.
        var addOnKey = type == TerminalType.OrderTab ? "EXTRA_TABLET" : "EXTRA_COUNTER";
        var addOnBonus = await _db.AddOnSubscriptions.IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId && a.BranchId == branchId && a.AddOnKey == addOnKey && a.IsActive)
            .SumAsync(a => (int?)a.Quantity) ?? 0;

        var limit = baseLimit + addOnBonus;
        var inUse = await CountDevicesInUseAsync(branchId, type);
        return (inUse < limit, inUse, limit);
    }
}
