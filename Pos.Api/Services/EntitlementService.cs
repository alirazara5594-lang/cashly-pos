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

    /// <summary>
    /// Plan-matrix capabilities by feature code ("hq", "stock_transfers", "accounting" ...), with
    /// add-ons and support overrides already applied. The nine codes that also exist as package
    /// switches mirror <see cref="Features"/> exactly — see FeatureCatalog.PackageFlagFor.
    /// </summary>
    public required IReadOnlyDictionary<string, bool> Capabilities { get; init; }

    /// <summary>Vertical pack keys this tenant runs, primary first.</summary>
    public required IReadOnlyList<string> PackKeys { get; init; }
    public required string PrimaryPackKey { get; init; }

    /// <summary>Standalone shop, or head office with branches under it.</summary>
    public required DeploymentMode DeploymentMode { get; init; }

    /// <summary>True when a package flag ("HasStockTransfers") or a feature code ("stock_transfers") is on.</summary>
    public bool Has(string flagName) =>
        (Features.TryGetValue(flagName, out var on) || Capabilities.TryGetValue(flagName, out on)) && on;

    /// <summary>A capability by feature code, or null when the plan matrix has no opinion on it.</summary>
    public bool? Capability(string featureCode) =>
        Capabilities.TryGetValue(featureCode, out var on) ? on : null;

    /// <summary>
    /// The effective ceiling for a countable feature code, or null for unlimited. Device ceilings
    /// (pos_terminals, tablets) are PER LOCATION: each shop gets its own tills, which is how
    /// <see cref="IEntitlementService.CanAddDeviceAsync"/> has always enforced them.
    /// </summary>
    public int? LimitFor(string featureCode)
    {
        int? raw = featureCode.ToLowerInvariant() switch
        {
            FeatureCodes.Locations => MaxBranches,
            FeatureCodes.PosTerminals => MaxCounters,
            FeatureCodes.Tablets => MaxOrderTabs,
            FeatureCodes.Users => MaxUsers,
            _ => null
        };
        return raw >= FeatureCatalog.UnlimitedCount ? null : raw;
    }

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
    /// With no device (a plain browser login) it falls back to the location: one that does not
    /// sell (a head office that only runs the back office, a warehouse) gets the ERP; a branch of a
    /// chain sells; a standalone shop does both.
    /// </summary>
    public AppSurface SurfaceFor(bool locationSells, TerminalType? deviceType = null)
    {
        if (deviceType == TerminalType.BackOffice) return AppSurface.Erp;
        if (deviceType is TerminalType.Counter or TerminalType.OrderTab or TerminalType.KitchenDisplay)
            return AppSurface.Pos;

        if (!locationSells) return AppSurface.Erp;   // head office or warehouse: back office only
        return DeploymentMode != DeploymentMode.HeadOffice
            ? AppSurface.Hybrid                       // standalone: one app that both sells and administers
            : AppSurface.Pos;                         // chain branch: sells, plus its own back office
    }

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

/// <summary>
/// What one location's POS version allows. With a head office the ERP is the same for everyone and
/// the POS side is sold per branch, so device ceilings are answered per location from here.
/// </summary>
/// <param name="Edition">The POS version in force at the location.</param>
/// <param name="IsOwnEdition">False when the location has no version of its own and follows the business's plan.</param>
public sealed record BranchPosAllowance(
    Guid BranchId, SubscriptionTier Edition, bool IsOwnEdition, int MaxCounters, int MaxOrderTabs, int MaxKitchenDisplays)
{
    /// <summary>Whether the location may run kitchen screens at all.</summary>
    public bool KitchenDisplay => MaxKitchenDisplays > 0;

    /// <summary>A device ceiling, or null for unlimited.</summary>
    public int? LimitFor(TerminalType type)
    {
        var raw = type switch
        {
            TerminalType.OrderTab => MaxOrderTabs,
            TerminalType.KitchenDisplay => MaxKitchenDisplays,
            _ => MaxCounters
        };
        return raw >= FeatureCatalog.UnlimitedCount ? null : raw;
    }
}

/// <summary>A business's WhatsApp messages this calendar month.</summary>
/// <param name="Allowance">Messages it may send this month, or null for unlimited.</param>
public sealed record WhatsAppAllowance(int? Allowance, int Included, int Bundles, int Used)
{
    public bool CanSend => Allowance == null || Used < Allowance.Value;
    public int? Remaining => Allowance == null ? null : Math.Max(0, Allowance.Value - Used);
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

    /// <summary>What each of the business's locations may run under its POS version, by location id.</summary>
    Task<Dictionary<Guid, BranchPosAllowance>> GetBranchAllowancesAsync(Guid tenantId);

    /// <summary>
    /// Whether one location may use a per-shop capability — fiscal invoicing, online payments, QR
    /// ordering, the delivery platform feed. Those are bought per shop: an add-on for that shop,
    /// one bought for every shop, or a support grant.
    /// </summary>
    Task<bool> BranchHasFeatureAsync(Guid tenantId, Guid branchId, string featureCode);

    /// <summary>WhatsApp messages allowed and used this month.</summary>
    Task<WhatsAppAllowance> GetWhatsAppAllowanceAsync(Guid tenantId);
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

    /// <summary>
    /// What a module add-on brings with it besides its own switch. Inventory is not much use
    /// without the recipes that consume it or the purchase orders that fill it.
    /// </summary>
    private static readonly Dictionary<string, string[]> AddOnIncludes = new(StringComparer.OrdinalIgnoreCase)
    {
        [nameof(SaaSPackageConfig.HasInventoryManagement)] = new[] { FeatureCodes.Purchasing, FeatureCodes.Recipes, FeatureCodes.FoodCost },
        [nameof(SaaSPackageConfig.HasKitchenDisplay)] = new[] { FeatureCodes.Kds }
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
            .Select(t => new { t.IsTrialActive, t.TrialEndsAt, t.Status, t.Tier, t.DeploymentMode })
            .FirstOrDefaultAsync();
        if (tenant == null) return false;
        if (tenant.IsTrialActive && tenant.TrialEndsAt <= now && snapshot.Status == TenantStatus.Trial)
            return true;
        if (tenant.Status != snapshot.Status) return true;

        // A head-office business gets the whole ERP with no location ceiling (see RecomputeAsync).
        // A snapshot taken before that rule, or before the business opened its head office, is stale.
        if (tenant.DeploymentMode == DeploymentMode.HeadOffice && snapshot.MaxBranches < FeatureCatalog.UnlimitedCount)
            return true;

        // The plan moved without a recompute (the platform console writes Tenant.Tier directly), the
        // snapshot predates feature codes being cached beside the package switches, or the package
        // row was edited on the Package Pricing screen after this snapshot was taken.
        var planKey = tenant.Tier.ToString();
        if (snapshot.PlanKey != planKey) return true;
        if (!snapshot.FeaturesJson.Contains($"\"{FeatureCodes.Hq}\"", StringComparison.Ordinal)) return true;
        return await _db.SaaSPackageConfigs.AsNoTracking()
            .AnyAsync(p => p.PackageKey == planKey && p.UpdatedAt > snapshot.ComputedAt);
    }

    public async Task<EffectiveEntitlements> RecomputeAsync(Guid tenantId)
    {
        var now = DateTime.UtcNow;

        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId)
            ?? throw new InvalidOperationException($"Tenant {tenantId} not found.");

        // --- 1. Plan defaults ------------------------------------------------
        // Quotas and the nine package switches come from the plan's package row: the price list the
        // Package Pricing screen edits. Every other capability (hq, accounting depth, api ...) comes
        // from the plan's feature rows. Both land in this one result, which every guard reads.
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

        var capabilities = await LoadPlanCapabilitiesAsync(tenant.Tier);

        // An add-on or override may name a package flag ("HasStockTransfers") or a feature code
        // ("stock_transfers"). Whichever it uses, both names move together.
        void SetSwitch(string key, bool on)
        {
            if (features.ContainsKey(key)) features[key] = on;
            else if (FeatureCatalog.PackageFlagFor.TryGetValue(key, out var flag)) features[flag] = on;
            else if (capabilities.ContainsKey(key)) capabilities[key] = on;
        }

        // --- 2. Purchased add-ons -------------------------------------------
        var addOns = await LiveAddOnsAsync(tenantId);

        foreach (var addOn in addOns)
        {
            switch (addOn.AddOnKey)
            {
                // Device add-ons are branch-scoped and therefore NOT folded into the tenant-wide
                // ceiling here — CanAddDeviceAsync adds them per branch. Folding them in twice
                // was part of the old double-counting problem.
                case "EXTRA_COUNTER":
                case "EXTRA_TABLET":
                case "EXTRA_KDS":
                    break;
                // Message bundles raise the monthly allowance (GetWhatsAppAllowanceAsync).
                case "WHATSAPP_1000":
                    break;
                case "EXTRA_USER":
                    maxUsers += addOn.Quantity;
                    break;
                case "EXTRA_BRANCH":
                    maxBranches += addOn.Quantity;
                    break;
                default:
                    SetSwitch(addOn.AddOnKey, true);
                    // A module add-on is the whole module: inventory comes with its recipes,
                    // suppliers and purchase orders, not just the stock screen.
                    if (AddOnIncludes.TryGetValue(addOn.AddOnKey, out var alsoIncluded))
                        foreach (var code in alsoIncluded) SetSwitch(code, true);
                    break;
            }
        }

        // --- 3. Support overrides -------------------------------------------
        var overrides = await _db.TenantEntitlementOverrides.AsNoTracking().IgnoreQueryFilters()
            .Where(o => o.TenantId == tenantId && o.IsActive)
            .ToListAsync();

        foreach (var ov in overrides.Where(o => o.IsInForce(now)))
        {
            // A quota may be named by its package column ("MaxBranches") or its feature code ("locations").
            var quotaKey = FeatureCatalog.QuotaKeyFor.TryGetValue(ov.Key, out var column) ? column : ov.Key;
            if (QuotaKeys.Contains(quotaKey))
            {
                if (!int.TryParse(ov.Value, out var delta)) continue;
                switch (quotaKey.ToLowerInvariant())
                {
                    case "maxbranches": maxBranches += delta; break;
                    case "maxcounters": maxCounters += delta; break;
                    case "maxordertabs": maxOrderTabs += delta; break;
                    case "maxusers": maxUsers += delta; break;
                }
            }
            else
            {
                SetSwitch(ov.Key, bool.TryParse(ov.Value, out var on) && on);
            }
        }

        // --- 3b. One ERP for every head-office business ---------------------
        // With a head office, the back office is the same product for everyone: every ERP
        // capability, any number of locations and back-office logins. What differs, and what is
        // paid for, is each branch's POS version — tills, tablets and kitchen screens per branch
        // (Branch.PosEdition, enforced in CanAddDeviceAsync). The two till-side switches are on
        // when at least one branch's version includes them, so their screens exist where needed.
        if (tenant.DeploymentMode == DeploymentMode.HeadOffice)
        {
            // Everything except what is sold per shop to every customer (fiscal invoicing, online
            // payments, QR ordering, the delivery platform feed, API): those stay as bought.
            foreach (var def in FeatureCatalog.All.Where(d => d.LimitType != FeatureLimitType.Count
                                                            && !FeatureCodes.SoldSeparately.Contains(d.Code)))
                capabilities[def.Code] = true;
            foreach (var name in FeatureFlagNames)
                features[name] = true;

            var allowances = (await GetBranchAllowancesCoreAsync(tenantId, tenant.Tier, tenant.DeploymentMode, maxCounters, maxOrderTabs, features, addOns))
                .Values.ToList();
            var kdsSomewhere = allowances.Any(a => a.KitchenDisplay);
            var editions = allowances.Select(a => a.Edition).Distinct().Select(e => e.ToString()).ToList();
            var codSomewhere = await _db.SaaSPackageConfigs.AsNoTracking()
                .AnyAsync(p => editions.Contains(p.PackageKey) && p.HasDeliveryCOD);
            features[nameof(SaaSPackageConfig.HasKitchenDisplay)] = kdsSomewhere || addOns.Any(a => a.AddOnKey == nameof(SaaSPackageConfig.HasKitchenDisplay));
            features[nameof(SaaSPackageConfig.HasDeliveryCOD)] = codSomewhere || addOns.Any(a => a.AddOnKey == nameof(SaaSPackageConfig.HasDeliveryCOD));

            maxBranches = FeatureCatalog.UnlimitedCount;
            maxUsers = FeatureCatalog.UnlimitedCount;
        }

        // The mirrored nine follow their package switch, whichever name the grant used.
        foreach (var (code, flag) in FeatureCatalog.PackageFlagFor)
            capabilities[code] = features.TryGetValue(flag, out var on) && on;

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
        // Package flags and feature codes share one JSON column; the two name sets never overlap
        // ("HasX" versus snake_case), and Materialize splits them back apart.
        snapshot.FeaturesJson = JsonSerializer.Serialize(
            features.Concat(capabilities).ToDictionary(kv => kv.Key, kv => kv.Value));
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

    /// <summary>
    /// The business's add-ons in force: active, and not stopped for being left unpaid. A stopped
    /// add-on switches off on its own; nothing else the business has changes. Should the renewals
    /// table not be readable yet (a brand-new database mid-start), nothing counts as stopped.
    /// </summary>
    private async Task<List<AddOnSubscription>> LiveAddOnsAsync(Guid tenantId)
    {
        var rows = await _db.AddOnSubscriptions.AsNoTracking().IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId && a.IsActive)
            .ToListAsync();
        if (rows.Count == 0) return rows;
        try
        {
            var stopped = await _db.SubscriptionParts.IgnoreQueryFilters().AsNoTracking()
                .Where(p => p.TenantId == tenantId && p.IsActive && p.StoppedAt != null && p.AddOnSubscriptionId != null)
                .Select(p => p.AddOnSubscriptionId!.Value)
                .ToListAsync();
            return stopped.Count == 0 ? rows : rows.Where(a => !stopped.Contains(a.Id)).ToList();
        }
        catch (Npgsql.PostgresException)
        {
            return rows;
        }
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

    /// <summary>
    /// The plan's on/off answer for each capability in its feature rows. Countable rows are skipped:
    /// quotas come from the package row. A plan whose rows are missing falls back to the catalogue's
    /// own matrix rather than to "nothing", which would quietly lock a paying customer out.
    /// </summary>
    private async Task<Dictionary<string, bool>> LoadPlanCapabilitiesAsync(SubscriptionTier tier)
    {
        var planCode = tier.ToString().ToLowerInvariant();
        var rows = await _db.PlanFeatures.AsNoTracking().IgnoreQueryFilters()
            .Where(f => f.Plan != null && f.Plan.Code == planCode)
            .ToListAsync();
        if (rows.Count == 0) rows = FeatureCatalog.BuildFeatureRows(Guid.Empty, planCode);

        var capabilities = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows.Where(r => r.LimitType != FeatureLimitType.Count))
            capabilities[row.FeatureCode] = row.LimitType == FeatureLimitType.Level
                ? row.Level != FeatureLevel.None
                : row.Enabled;
        return capabilities;
    }

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
        var stored = JsonSerializer.Deserialize<Dictionary<string, bool>>(snapshot.FeaturesJson)
                     ?? new Dictionary<string, bool>();

        // Features keeps exactly the package flags it always carried: devices and the platform
        // console list it wholesale. Everything else is a feature code.
        var flagNames = new HashSet<string>(FeatureFlagNames, StringComparer.OrdinalIgnoreCase);

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
            Features = stored.Where(kv => flagNames.Contains(kv.Key))
                .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.OrdinalIgnoreCase),
            Capabilities = stored.Where(kv => !flagNames.Contains(kv.Key))
                .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.OrdinalIgnoreCase),
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

    public async Task<Dictionary<Guid, BranchPosAllowance>> GetBranchAllowancesAsync(Guid tenantId)
    {
        var ent = await GetAsync(tenantId);
        var tier = Enum.TryParse<SubscriptionTier>(ent.PlanKey, true, out var parsed) ? parsed : SubscriptionTier.Starter;
        return await GetBranchAllowancesCoreAsync(tenantId, tier, ent.DeploymentMode, ent.MaxCounters, ent.MaxOrderTabs, ent.Features, null);
    }

    /// <summary>
    /// Each location's POS allowance. A location with a version of its own gets that version's
    /// package figures. One without follows the business's plan — its per-location device figures
    /// with add-ons and overrides applied, exactly what every location had before branches carried
    /// a version. Kitchen screens then add what was bought for the location: the Kitchen display
    /// add-on gives a location on Starter a screen, and each Extra kitchen screen adds one.
    /// </summary>
    private async Task<Dictionary<Guid, BranchPosAllowance>> GetBranchAllowancesCoreAsync(
        Guid tenantId, SubscriptionTier tenantTier, DeploymentMode mode, int planCounters, int planTablets,
        IReadOnlyDictionary<string, bool> planFeatures, IReadOnlyList<AddOnSubscription>? addOns)
    {
        var branches = await _db.Branches.AsNoTracking().IgnoreQueryFilters()
            .Where(b => b.TenantId == tenantId)
            .Select(b => new { b.Id, b.PosEdition })
            .ToListAsync();
        var packages = await _db.SaaSPackageConfigs.AsNoTracking().ToListAsync();
        SaaSPackageConfig? PackageFor(SubscriptionTier tier) =>
            packages.FirstOrDefault(p => string.Equals(p.PackageKey, tier.ToString(), StringComparison.OrdinalIgnoreCase));

        addOns ??= await LiveAddOnsAsync(tenantId);
        var kdsKey = nameof(SaaSPackageConfig.HasKitchenDisplay);

        var result = new Dictionary<Guid, BranchPosAllowance>();
        foreach (var branch in branches)
        {
            var edition = branch.PosEdition ?? tenantTier;
            var package = PackageFor(edition);
            var counters = branch.PosEdition != null ? package?.MaxCounters ?? planCounters : planCounters;
            var tablets = branch.PosEdition != null ? package?.MaxOrderTabs ?? planTablets : planTablets;

            var screens = package?.MaxKitchenDisplays ?? 0;
            // A single shop whose plan was given kitchen screens by a support grant.
            if (screens == 0 && branch.PosEdition == null && mode != DeploymentMode.HeadOffice
                && planFeatures.TryGetValue(kdsKey, out var granted) && granted
                && !addOns.Any(a => a.AddOnKey == kdsKey))
                screens = 1;
            // The Kitchen display add-on: one screen per add-on, for this shop or for every shop.
            if (screens == 0)
                screens = addOns.Where(a => a.AddOnKey == kdsKey && (a.BranchId == null || a.BranchId == branch.Id)).Sum(a => a.Quantity);
            // Extra kitchen screens bought for this shop.
            if (screens > 0 && screens < FeatureCatalog.UnlimitedCount)
                screens += addOns.Where(a => a.AddOnKey == "EXTRA_KDS" && a.BranchId == branch.Id).Sum(a => a.Quantity);

            result[branch.Id] = new BranchPosAllowance(branch.Id, edition, branch.PosEdition != null, counters, tablets, screens);
        }
        return result;
    }

    public async Task<bool> BranchHasFeatureAsync(Guid tenantId, Guid branchId, string featureCode)
    {
        var ent = await GetAsync(tenantId);
        if (ent.Capability(featureCode) != true) return false;           // not bought in any form
        if (!FeatureCodes.SoldSeparately.Contains(featureCode)) return true; // a business-wide capability

        // Sold per shop: an add-on for this shop, one bought for every shop, or — when no add-on
        // exists at all — a support grant, which covers the whole business.
        var bought = (await LiveAddOnsAsync(tenantId))
            .Where(a => a.AddOnKey == featureCode)
            .Select(a => a.BranchId)
            .ToList();
        return bought.Count == 0 || bought.Any(b => b == null || b == branchId);
    }

    public async Task<WhatsAppAllowance> GetWhatsAppAllowanceAsync(Guid tenantId)
    {
        var ent = await GetAsync(tenantId);

        // What the plan includes: the Head Office ERP's allowance for a head-office business, the
        // version's for a single shop. -1 on a version means unlimited.
        int? included;
        if (ent.DeploymentMode == DeploymentMode.HeadOffice)
        {
            var erp = await _db.PlatformPrices.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Key == FeatureCatalog.HeadOfficeErpPriceKey);
            included = erp?.IncludedWhatsAppMessages ?? FeatureCatalog.HeadOfficeErpWhatsAppMessages;
        }
        else
        {
            var perMonth = await _db.SaaSPackageConfigs.AsNoTracking()
                .Where(p => p.PackageKey == ent.PlanKey)
                .Select(p => (int?)p.WhatsAppMessagesPerMonth)
                .FirstOrDefaultAsync() ?? 0;
            included = perMonth < 0 ? null : perMonth;
        }

        var bundles = (await LiveAddOnsAsync(tenantId))
            .Where(a => a.AddOnKey == "WHATSAPP_1000")
            .Sum(a => a.Quantity);

        var monthStart = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var used = await _db.NotificationLogs.AsNoTracking().IgnoreQueryFilters()
            .CountAsync(n => n.TenantId == tenantId && n.Channel == "whatsapp" && n.SentAt >= monthStart
                          && (n.Status == "sent" || n.Status == "delivered" || n.Status == "queued"));

        var allowance = included == null ? (int?)null : included.Value + bundles * 1000;
        return new WhatsAppAllowance(allowance, included ?? -1, bundles, used);
    }

    public async Task<(bool Allowed, int InUse, int Limit)> CanAddDeviceAsync(Guid tenantId, Guid branchId, TerminalType type)
    {
        var ent = await GetAsync(tenantId);

        // A back-office workstation is not metered: it earns the platform nothing per seat, and
        // metering it just pushes the accounts back into spreadsheets.
        if (type == TerminalType.BackOffice)
            return (true, await CountDevicesInUseAsync(branchId, type), int.MaxValue);

        (await GetBranchAllowancesAsync(tenantId)).TryGetValue(branchId, out var allowance);

        // Kitchen screens come with the POS version (none on Starter, two on Standard, unlimited
        // on Professional) plus any bought for the shop. Screens already running are never cut
        // off; this only decides whether one more may connect.
        if (type == TerminalType.KitchenDisplay)
        {
            var screens = await CountDevicesInUseAsync(branchId, type);
            if (allowance == null) return (true, screens, int.MaxValue);
            var screenLimit = allowance.LimitFor(TerminalType.KitchenDisplay);
            return screenLimit == null ? (true, screens, int.MaxValue) : (screens < screenLimit.Value, screens, screenLimit.Value);
        }

        // The location's own POS version when it has one; otherwise the business's plan.
        var baseLimit = allowance != null
            ? (type == TerminalType.OrderTab ? allowance.MaxOrderTabs : allowance.MaxCounters)
            : (type == TerminalType.OrderTab ? ent.MaxOrderTabs : ent.MaxCounters);

        // Branch-scoped device add-ons stack on top of the plan's per-branch allowance.
        var addOnKey = type == TerminalType.OrderTab ? "EXTRA_TABLET" : "EXTRA_COUNTER";
        var addOnBonus = (await LiveAddOnsAsync(tenantId))
            .Where(a => a.BranchId == branchId && a.AddOnKey == addOnKey)
            .Sum(a => a.Quantity);

        var limit = baseLimit + addOnBonus;
        var inUse = await CountDevicesInUseAsync(branchId, type);
        return (inUse < limit, inUse, limit);
    }
}
