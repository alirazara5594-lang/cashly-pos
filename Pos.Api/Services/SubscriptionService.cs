using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// SUBSCRIPTION SERVICE
//
// The single place that answers "may this organisation do this?".
//
// Nothing anywhere else compares a plan name. The rule is: ask for the CAPABILITY, never the
// plan. `canUseFeature(org, "hq")` survives a pricing change; `if (tier == Professional)` does
// not, and scatters the decision across files nobody remembers to update.
//
// It no longer resolves entitlements itself. It used to read plan rows directly, so it could not
// see purchased add-ons or support grants while the entitlement engine (which the device and
// package guards use) could: a customer who bought an extra branch was refused one here and
// allowed it there. Every answer now comes from IEntitlementService, so the two cannot disagree.
// What stays here is counting usage and keeping the subscription record.
// ============================================================

public sealed record FeatureCheck(
    string Code,
    bool Allowed,
    FeatureLevel Level,
    int? Limit,
    string? Reason)
{
    public bool IsUnlimited => Limit == null;
}

public sealed record LimitCheck(
    string Code,
    bool Allowed,
    int InUse,
    int? Limit,
    string? Reason)
{
    public bool IsUnlimited => Limit == null;
    /// <summary>How much headroom is left, for the "4 of 5 used" warnings.</summary>
    public int? Remaining => Limit == null ? null : Math.Max(0, Limit.Value - InUse);
    public bool IsNearLimit => Limit != null && Limit > 0 && InUse >= Limit.Value - 1 && InUse < Limit.Value;
}

public sealed record SubscriptionUsage(
    string PlanCode,
    string PlanName,
    SubscriptionStatus Status,
    DateTime? TrialEndsAt,
    DateTime? EndDate,
    bool IsOverPlanLimit,
    string? OverLimitReason,
    IReadOnlyList<LimitCheck> Limits,
    IReadOnlyDictionary<string, FeatureCheck> Features);

public interface ISubscriptionService
{
    Task<bool> CanUseFeatureAsync(Guid tenantId, string featureCode);
    Task<FeatureCheck> CheckFeatureAsync(Guid tenantId, string featureCode);
    Task<FeatureLevel> GetLevelAsync(Guid tenantId, string featureCode);

    /// <summary>Can one more of this thing be created right now?</summary>
    Task<LimitCheck> CheckLimitAsync(Guid tenantId, string featureCode);

    /// <summary>Everything the Subscription &amp; Plan screen needs, in one round trip.</summary>
    Task<SubscriptionUsage> GetUsageAsync(Guid tenantId);

    /// <summary>
    /// Re-evaluates whether the organisation's configuration fits its plan, and flips the
    /// subscription into or out of OverPlanLimit. Called after any plan change.
    /// </summary>
    Task<SubscriptionStatus> ReconcileOverLimitAsync(Guid tenantId);

    /// <summary>Moves an organisation onto a plan. Never deletes anything.</summary>
    Task<SubscriptionUsage> ChangePlanAsync(Guid tenantId, string planCode, Guid? actingUserId, string? reason);
}

public class SubscriptionService : ISubscriptionService
{
    private static readonly string[] LimitCodes =
        { FeatureCodes.Locations, FeatureCodes.PosTerminals, FeatureCodes.Tablets, FeatureCodes.Users };

    private readonly AppDbContext _db;
    private readonly IEntitlementService _entitlements;
    private readonly ILogger<SubscriptionService> _log;

    public SubscriptionService(AppDbContext db, IEntitlementService entitlements, ILogger<SubscriptionService> log)
    {
        _db = db;
        _entitlements = entitlements;
        _log = log;
    }

    /// <summary>
    /// Whether a login counts against the plan's user allowance. Only back-office logins do. The
    /// people at the till, the pass and the tables are unlimited: charging per cashier makes a shop
    /// share one PIN, and a shared PIN empties the audit log and the per-cashier reports.
    /// </summary>
    public static bool CountsAsBackOfficeUser(UserRole role) =>
        role is not (UserRole.Cashier or UserRole.Waiter or UserRole.KitchenChef or UserRole.SuperAdmin);

    // ---------------------------------------------------------------- features

    public async Task<bool> CanUseFeatureAsync(Guid tenantId, string featureCode)
        => (await CheckFeatureAsync(tenantId, featureCode)).Allowed;

    public async Task<FeatureCheck> CheckFeatureAsync(Guid tenantId, string featureCode)
    {
        var ent = await TryGetEntitlementsAsync(tenantId);
        if (ent == null)
            // No such organisation. Fail OPEN rather than locking a paying customer out of their
            // own data over a provisioning gap — the billing ladder is what enforces non-payment.
            return new FeatureCheck(featureCode, true, FeatureLevel.Full, null, null);

        return BuildFeatureCheck(ent, featureCode, await PlanRowsAsync(ent.PlanKey));
    }

    public async Task<FeatureLevel> GetLevelAsync(Guid tenantId, string featureCode)
        => (await CheckFeatureAsync(tenantId, featureCode)).Level;

    private static FeatureCheck BuildFeatureCheck(EffectiveEntitlements ent, string featureCode, IReadOnlyList<PlanFeature> planRows)
    {
        if (FeatureCatalog.Find(featureCode)?.LimitType == FeatureLimitType.Count)
        {
            var limit = ent.LimitFor(featureCode);
            var hasAny = limit is null or > 0;
            return new FeatureCheck(featureCode, hasAny, hasAny ? FeatureLevel.Full : FeatureLevel.None, limit,
                hasAny ? null : UpgradeMessage(featureCode, ent.PlanKey));
        }

        var on = ent.Capability(featureCode);
        if (on == null)
            // A capability the plan has no opinion on. Anything not in the matrix is part of the
            // product, not an upsell, so an unknown code must not become an accidental paywall.
            return new FeatureCheck(featureCode, true, FeatureLevel.Full, null, null);

        if (!on.Value)
            return new FeatureCheck(featureCode, false, FeatureLevel.None, null, UpgradeMessage(featureCode, ent.PlanKey));

        // Depth is display only. A capability an add-on or support grant switched on, on a plan that
        // does not include it, counts as Full.
        var row = planRows.FirstOrDefault(r => string.Equals(r.FeatureCode, featureCode, StringComparison.OrdinalIgnoreCase));
        var level = row is { LimitType: FeatureLimitType.Level, Level: not FeatureLevel.None } ? row.Level : FeatureLevel.Full;
        return new FeatureCheck(featureCode, true, level, null, null);
    }

    private Task<List<PlanFeature>> PlanRowsAsync(string planKey)
    {
        var planCode = planKey.ToLowerInvariant();
        return _db.PlanFeatures.AsNoTracking().IgnoreQueryFilters()
            .Where(f => f.Plan != null && f.Plan.Code == planCode)
            .ToListAsync();
    }

    // ---------------------------------------------------------------- limits

    public async Task<LimitCheck> CheckLimitAsync(Guid tenantId, string featureCode)
    {
        var ent = await TryGetEntitlementsAsync(tenantId);
        return ent == null
            ? new LimitCheck(featureCode, true, 0, null, null)
            : await CheckLimitCoreAsync(ent, featureCode);
    }

    private async Task<LimitCheck> CheckLimitCoreAsync(EffectiveEntitlements ent, string featureCode)
    {
        var code = featureCode.ToLowerInvariant();
        if (code is FeatureCodes.PosTerminals or FeatureCodes.Tablets)
            return AggregateDeviceLimit(featureCode, ent.PlanKey, await DeviceUsageAsync(ent, DeviceTypeFor(code)));

        var limit = ent.LimitFor(code);
        var inUse = await CountUsageAsync(ent, code);

        if (limit == null) return new LimitCheck(featureCode, true, inUse, null, null); // unlimited
        if (inUse < limit.Value) return new LimitCheck(featureCode, true, inUse, limit, null);

        return new LimitCheck(featureCode, false, inUse, limit,
            $"Your {ent.PlanKey} plan includes {limit} {Noun(code).ToLowerInvariant()}. You are using {inUse}. " +
            "Upgrade your plan to add more.");
    }

    /// <summary>
    /// What the organisation is actually using for a countable feature.
    ///
    /// Counts LIVE configuration, not history: a retired terminal or an archived branch must not
    /// keep consuming an allowance, or a customer who tidied up would still be blocked.
    /// </summary>
    private async Task<int> CountUsageAsync(EffectiveEntitlements ent, string featureCode) => featureCode switch
    {
        FeatureCodes.Locations => await SellingBranches(ent).CountAsync(),

        // Only back-office logins are metered; see CountsAsBackOfficeUser.
        FeatureCodes.Users => await _db.Users.IgnoreQueryFilters()
            .CountAsync(u => u.TenantId == ent.TenantId && u.IsActive
                          && u.Role != UserRole.Cashier && u.Role != UserRole.Waiter
                          && u.Role != UserRole.KitchenChef && u.Role != UserRole.SuperAdmin),

        _ => 0
    };

    /// <summary>
    /// The locations that sell. A head office that only runs the back office, and every warehouse,
    /// cannot hold a till, so they are not locations the customer pays for.
    /// </summary>
    private IQueryable<Branch> SellingBranches(EffectiveEntitlements ent) =>
        _db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == ent.TenantId && b.CanSell);

    private sealed record BranchDeviceUsage(Guid BranchId, string BranchName, int InUse, int? Limit);

    private static TerminalType DeviceTypeFor(string code) =>
        code == FeatureCodes.Tablets ? TerminalType.OrderTab : TerminalType.Counter;

    /// <summary>
    /// Devices of one class at each selling location, against that location's own allowance: the
    /// plan's per-location figure plus any extra-device add-ons bought for that location. The same
    /// rule IEntitlementService.CanAddDeviceAsync applies when a device is activated, read for every
    /// location at once instead of one location at a time.
    /// </summary>
    private async Task<List<BranchDeviceUsage>> DeviceUsageAsync(EffectiveEntitlements ent, TerminalType type)
    {
        var branches = await SellingBranches(ent).Select(b => new { b.Id, b.Name }).ToListAsync();
        var cutoff = DateTime.UtcNow.AddHours(-Terminal.DeviceSlotCooldownHours);

        // Mirrors Terminal.OccupiesQuotaSlot: not revoked, and either live or retired within the cooldown.
        var inUse = await _db.Terminals.IgnoreQueryFilters()
            .Where(t => t.TenantId == ent.TenantId && t.TerminalType == type && t.RevokedAt == null
                     && (t.DeactivatedAt == null || t.DeactivatedAt > cutoff))
            .GroupBy(t => t.BranchId)
            .Select(g => new { BranchId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.BranchId, x => x.Count);

        var addOnKey = type == TerminalType.OrderTab ? "EXTRA_TABLET" : "EXTRA_COUNTER";
        var extras = await _db.AddOnSubscriptions.IgnoreQueryFilters()
            .Where(a => a.TenantId == ent.TenantId && a.AddOnKey == addOnKey && a.IsActive && a.BranchId != null)
            .GroupBy(a => a.BranchId!.Value)
            .Select(g => new { BranchId = g.Key, Quantity = g.Sum(a => a.Quantity) })
            .ToDictionaryAsync(x => x.BranchId, x => x.Quantity);

        var perLocation = ent.LimitFor(type == TerminalType.OrderTab ? FeatureCodes.Tablets : FeatureCodes.PosTerminals);
        return branches.Select(b => new BranchDeviceUsage(
                b.Id,
                b.Name,
                inUse.GetValueOrDefault(b.Id),
                perLocation == null ? null : perLocation.Value + extras.GetValueOrDefault(b.Id)))
            .ToList();
    }

    /// <summary>
    /// The business-wide view of a per-location allowance, for the Subscription screen: devices in
    /// use across every selling location against the sum of their allowances. Activation itself is
    /// still checked per location, so "allowed" means some location has room.
    /// </summary>
    private static LimitCheck AggregateDeviceLimit(string code, string planKey, List<BranchDeviceUsage> usage)
    {
        var inUse = usage.Sum(u => u.InUse);
        if (usage.Any(u => u.Limit == null)) return new LimitCheck(code, true, inUse, null, null); // unlimited

        var limit = usage.Sum(u => u.Limit ?? 0);
        var allowed = usage.Count == 0 || usage.Any(u => u.InUse < (u.Limit ?? 0));
        return new LimitCheck(code, allowed, inUse, limit, allowed ? null :
            $"Every location is using all the {Noun(code).ToLowerInvariant()} your {planKey} plan includes " +
            $"({inUse} of {limit}). Add an extra device for a location, or upgrade your plan.");
    }

    private static string Noun(string code) => FeatureCatalog.Find(code)?.DisplayName ?? code;

    private async Task<EffectiveEntitlements?> TryGetEntitlementsAsync(Guid tenantId)
    {
        try
        {
            return await _entitlements.GetAsync(tenantId);
        }
        catch (InvalidOperationException)
        {
            return null; // no such organisation
        }
    }

    // ---------------------------------------------------------------- usage screen

    public async Task<SubscriptionUsage> GetUsageAsync(Guid tenantId)
    {
        var sub = await GetSubscriptionAsync(tenantId);
        var plan = sub?.Plan;
        var ent = await TryGetEntitlementsAsync(tenantId);

        var limits = new List<LimitCheck>();
        var features = new Dictionary<string, FeatureCheck>(StringComparer.OrdinalIgnoreCase);
        if (ent != null)
        {
            foreach (var code in LimitCodes)
                limits.Add(await CheckLimitCoreAsync(ent, code));

            var planRows = await PlanRowsAsync(ent.PlanKey);
            foreach (var def in FeatureCatalog.All)
            {
                if (def.LimitType == FeatureLimitType.Count) continue; // already in limits
                features[def.Code] = BuildFeatureCheck(ent, def.Code, planRows);
            }
        }

        return new SubscriptionUsage(
            plan?.Code ?? "unknown",
            plan?.Name ?? "No plan",
            sub?.Status ?? SubscriptionStatus.Active,
            sub?.TrialEndsAt,
            sub?.EndDate,
            sub?.Status == SubscriptionStatus.OverPlanLimit,
            sub?.OverLimitReason,
            limits,
            features);
    }

    // ---------------------------------------------------------------- plan changes

    public async Task<SubscriptionStatus> ReconcileOverLimitAsync(Guid tenantId)
    {
        var sub = await GetSubscriptionAsync(tenantId);
        if (sub == null) return SubscriptionStatus.Active;

        var ent = await TryGetEntitlementsAsync(tenantId);
        if (ent == null) return sub.Status;

        var breaches = new List<string>();
        foreach (var code in new[] { FeatureCodes.Locations, FeatureCodes.Users })
        {
            var check = await CheckLimitCoreAsync(ent, code);
            if (check.Limit != null && check.InUse > check.Limit.Value)
                breaches.Add($"{Noun(code)}: {check.InUse} in use, plan allows {check.Limit}");
        }

        // Device allowances are per location, so an overage is reported per location: "Gulberg: 3 POS
        // terminals in use, plan allows 2" says what to retire; a business-wide total does not.
        foreach (var code in new[] { FeatureCodes.PosTerminals, FeatureCodes.Tablets })
        {
            foreach (var branch in await DeviceUsageAsync(ent, DeviceTypeFor(code)))
            {
                if (branch.Limit != null && branch.InUse > branch.Limit.Value)
                    breaches.Add($"{branch.BranchName}: {branch.InUse} {Noun(code).ToLowerInvariant()} in use, plan allows {branch.Limit}");
            }
        }

        if (breaches.Count > 0)
        {
            // Over limit is a WARNING state, never a destructive one. Existing locations, tills
            // and history all keep working; the only consequence is that nothing new can be added.
            if (sub.Status != SubscriptionStatus.OverPlanLimit)
            {
                sub.OverLimitSince = DateTime.UtcNow;
                sub.Status = SubscriptionStatus.OverPlanLimit;
            }
            sub.OverLimitReason = string.Join("; ", breaches);
        }
        else if (sub.Status == SubscriptionStatus.OverPlanLimit)
        {
            // They came back within limits, either by tidying up or by upgrading again.
            sub.Status = sub.TrialEndsAt != null && sub.TrialEndsAt > DateTime.UtcNow
                ? SubscriptionStatus.Trialing
                : SubscriptionStatus.Active;
            sub.OverLimitSince = null;
            sub.OverLimitReason = null;
        }

        sub.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return sub.Status;
    }

    public async Task<SubscriptionUsage> ChangePlanAsync(Guid tenantId, string planCode, Guid? actingUserId, string? reason)
    {
        var plan = await _db.Plans.IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Code == planCode.ToLowerInvariant() && p.IsActive)
            ?? throw new InvalidOperationException($"No active plan with code '{planCode}'.");

        var sub = await GetSubscriptionAsync(tenantId);
        if (sub == null)
        {
            sub = new OrganizationSubscription { TenantId = tenantId, PlanId = plan.Id, Status = SubscriptionStatus.Active };
            _db.OrganizationSubscriptions.Add(sub);
        }
        else
        {
            sub.PlanId = plan.Id;
            sub.Plan = plan;
            if (sub.Status is SubscriptionStatus.Suspended or SubscriptionStatus.Cancelled)
                sub.Status = SubscriptionStatus.Active;
        }
        sub.UpdatedAt = DateTime.UtcNow;

        // Keep the legacy Tenant.Tier in step so the older endpoints that still read it agree
        // with the new system. One source of truth, two readers.
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant != null && Enum.TryParse<SubscriptionTier>(plan.Code, true, out var tier))
            tenant.Tier = tier;

        await _db.SaveChangesAsync();

        // The limits checked below must be the NEW plan's, so the engine recomputes first.
        await _entitlements.RecomputeAsync(tenantId);

        // A downgrade may leave them over limit. Nothing is deleted — they are flagged, warned,
        // and prevented from adding more until they fit.
        await ReconcileOverLimitAsync(tenantId);

        _log.LogInformation("Subscription: tenant {TenantId} moved to {Plan} ({Reason})", tenantId, plan.Code, reason ?? "no reason given");
        return await GetUsageAsync(tenantId);
    }

    // ---------------------------------------------------------------- internals

    private async Task<OrganizationSubscription?> GetSubscriptionAsync(Guid tenantId)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant == null) return null;
        var tierCode = tenant.Tier.ToString().ToLowerInvariant();

        var sub = await _db.OrganizationSubscriptions.IgnoreQueryFilters()
            .Include(s => s.Plan)
            .Where(s => s.TenantId == tenantId)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();

        if (sub != null)
        {
            // The platform console moves a tenant between plans by writing Tenant.Tier, which is also
            // what the entitlement engine reads. Follow it here, or the Subscription screen names one
            // plan while the limits being enforced belong to another.
            if (sub.Plan?.Code != tierCode)
            {
                var current = await _db.Plans.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Code == tierCode);
                if (current != null)
                {
                    sub.PlanId = current.Id;
                    sub.Plan = current;
                    sub.UpdatedAt = DateTime.UtcNow;
                    await _db.SaveChangesAsync();
                }
            }
            return sub;
        }

        // Backfill on first read: tenants created before this system existed still carry a Tier,
        // which is enough to place them on the equivalent plan without anyone doing anything.
        var plan = await _db.Plans.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Code == tierCode);
        if (plan == null) return null;

        sub = new OrganizationSubscription
        {
            TenantId = tenantId,
            PlanId = plan.Id,
            Plan = plan,
            Status = tenant.IsTrialActive && tenant.TrialEndsAt > DateTime.UtcNow
                ? SubscriptionStatus.Trialing
                : SubscriptionStatus.Active,
            TrialEndsAt = tenant.IsTrialActive ? tenant.TrialEndsAt : null,
            StartDate = tenant.CreatedAt
        };
        _db.OrganizationSubscriptions.Add(sub);
        await _db.SaveChangesAsync();
        return sub;
    }

    private static string UpgradeMessage(string featureCode, string planName)
    {
        var def = FeatureCatalog.Find(featureCode);
        var name = def?.DisplayName ?? featureCode;

        // Name the SMALLEST plan that unlocks it. Telling a Starter customer to buy Professional
        // for head office would be both wrong and expensive — Standard has it.
        var unlockedBy = UnlockedBy(featureCode);
        return unlockedBy == null
            ? $"{name} is not included in the {planName} plan."
            : $"{name} is not available on the {planName} plan. Upgrade to {unlockedBy} to use it.";
    }

    private static string? UnlockedBy(string featureCode)
    {
        if (FeatureCatalog.Booleans.TryGetValue(featureCode, out var b))
            return b.Standard ? "Standard" : b.Professional ? "Professional" : null;
        if (FeatureCatalog.Levels.TryGetValue(featureCode, out var l))
            return l.Standard != FeatureLevel.None ? "Standard" : l.Professional != FeatureLevel.None ? "Professional" : null;
        return "Standard or Professional";
    }
}
