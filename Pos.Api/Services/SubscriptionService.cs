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
    private readonly AppDbContext _db;
    private readonly ILogger<SubscriptionService> _log;

    public SubscriptionService(AppDbContext db, ILogger<SubscriptionService> log)
    {
        _db = db;
        _log = log;
    }

    // ---------------------------------------------------------------- features

    public async Task<bool> CanUseFeatureAsync(Guid tenantId, string featureCode)
        => (await CheckFeatureAsync(tenantId, featureCode)).Allowed;

    public async Task<FeatureCheck> CheckFeatureAsync(Guid tenantId, string featureCode)
    {
        var (plan, feature) = await ResolveAsync(tenantId, featureCode);

        if (plan == null)
            // No subscription row yet. Fail OPEN rather than locking a paying customer out of
            // their own data over a provisioning gap — the billing ladder is what enforces
            // non-payment, not a missing row.
            return new FeatureCheck(featureCode, true, FeatureLevel.Full, null, null);

        if (feature == null)
            // A capability the plan has no opinion on. Anything not in the matrix is part of the
            // product, not an upsell, so an unknown code must not become an accidental paywall.
            return new FeatureCheck(featureCode, true, FeatureLevel.Full, null, null);

        var allowed = feature.LimitType switch
        {
            FeatureLimitType.Boolean => feature.Enabled,
            FeatureLimitType.Level => feature.Level != FeatureLevel.None,
            FeatureLimitType.Count => feature.LimitValue is null or > 0,
            _ => false
        };

        return new FeatureCheck(
            featureCode,
            allowed,
            feature.Level,
            feature.LimitValue,
            allowed ? null : UpgradeMessage(featureCode, plan.Name));
    }

    public async Task<FeatureLevel> GetLevelAsync(Guid tenantId, string featureCode)
    {
        var (_, feature) = await ResolveAsync(tenantId, featureCode);
        if (feature == null) return FeatureLevel.Full;
        return feature.LimitType == FeatureLimitType.Level
            ? feature.Level
            : feature.Enabled ? FeatureLevel.Full : FeatureLevel.None;
    }

    // ---------------------------------------------------------------- limits

    public async Task<LimitCheck> CheckLimitAsync(Guid tenantId, string featureCode)
    {
        var (plan, feature) = await ResolveAsync(tenantId, featureCode);
        var inUse = await CountUsageAsync(tenantId, featureCode);

        if (plan == null || feature == null)
            return new LimitCheck(featureCode, true, inUse, null, null);

        if (feature.LimitValue == null)
            return new LimitCheck(featureCode, true, inUse, null, null); // unlimited

        var limit = feature.LimitValue.Value;
        if (inUse < limit) return new LimitCheck(featureCode, true, inUse, limit, null);

        var noun = FeatureCatalog.Find(featureCode)?.DisplayName ?? featureCode;
        return new LimitCheck(featureCode, false, inUse, limit,
            $"Your {plan.Name} plan includes {limit} {noun.ToLowerInvariant()}. You are using {inUse}. " +
            "Upgrade your plan to add more.");
    }

    /// <summary>
    /// What the organisation is actually using for a countable feature.
    ///
    /// Counts LIVE configuration, not history: a retired terminal or an archived branch must not
    /// keep consuming an allowance, or a customer who tidied up would still be blocked.
    /// </summary>
    private async Task<int> CountUsageAsync(Guid tenantId, string featureCode)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddHours(-Terminal.DeviceSlotCooldownHours);

        return featureCode switch
        {
            FeatureCodes.Locations => await _db.Branches.IgnoreQueryFilters()
                .CountAsync(b => b.TenantId == tenantId),

            FeatureCodes.PosTerminals => await _db.Terminals.IgnoreQueryFilters()
                .CountAsync(t => t.TenantId == tenantId
                              && t.TerminalType == TerminalType.Counter
                              && t.RevokedAt == null
                              && (t.DeactivatedAt == null || t.DeactivatedAt > cutoff)),

            FeatureCodes.Tablets => await _db.Terminals.IgnoreQueryFilters()
                .CountAsync(t => t.TenantId == tenantId
                              && t.TerminalType == TerminalType.OrderTab
                              && t.RevokedAt == null
                              && (t.DeactivatedAt == null || t.DeactivatedAt > cutoff)),

            FeatureCodes.Users => await _db.Users.IgnoreQueryFilters()
                .CountAsync(u => u.TenantId == tenantId && u.IsActive),

            _ => 0
        };
    }

    // ---------------------------------------------------------------- usage screen

    public async Task<SubscriptionUsage> GetUsageAsync(Guid tenantId)
    {
        var sub = await GetSubscriptionAsync(tenantId);
        var plan = sub?.Plan;

        var limits = new List<LimitCheck>();
        foreach (var code in new[] { FeatureCodes.Locations, FeatureCodes.PosTerminals, FeatureCodes.Tablets, FeatureCodes.Users })
            limits.Add(await CheckLimitAsync(tenantId, code));

        var features = new Dictionary<string, FeatureCheck>(StringComparer.OrdinalIgnoreCase);
        foreach (var def in FeatureCatalog.All)
        {
            if (def.LimitType == FeatureLimitType.Count) continue; // already in limits
            features[def.Code] = await CheckFeatureAsync(tenantId, def.Code);
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

        var breaches = new List<string>();
        foreach (var code in new[] { FeatureCodes.Locations, FeatureCodes.PosTerminals, FeatureCodes.Tablets, FeatureCodes.Users })
        {
            var check = await CheckLimitAsync(tenantId, code);
            if (check.Limit != null && check.InUse > check.Limit.Value)
            {
                var noun = FeatureCatalog.Find(code)?.DisplayName ?? code;
                breaches.Add($"{noun}: {check.InUse} in use, plan allows {check.Limit}");
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

        // A downgrade may leave them over limit. Nothing is deleted — they are flagged, warned,
        // and prevented from adding more until they fit.
        await ReconcileOverLimitAsync(tenantId);

        _log.LogInformation("Subscription: tenant {TenantId} moved to {Plan} ({Reason})", tenantId, plan.Code, reason ?? "no reason given");
        return await GetUsageAsync(tenantId);
    }

    // ---------------------------------------------------------------- internals

    private async Task<OrganizationSubscription?> GetSubscriptionAsync(Guid tenantId)
    {
        var sub = await _db.OrganizationSubscriptions.IgnoreQueryFilters()
            .Include(s => s.Plan)
            .Where(s => s.TenantId == tenantId)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();

        if (sub != null) return sub;

        // Backfill on first read: tenants created before this system existed still carry a Tier,
        // which is enough to place them on the equivalent plan without anyone doing anything.
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant == null) return null;

        var plan = await _db.Plans.IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Code == tenant.Tier.ToString().ToLowerInvariant());
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

    private async Task<(Plan? Plan, PlanFeature? Feature)> ResolveAsync(Guid tenantId, string featureCode)
    {
        var sub = await GetSubscriptionAsync(tenantId);
        if (sub?.Plan == null) return (null, null);

        var feature = await _db.PlanFeatures.AsNoTracking().IgnoreQueryFilters()
            .FirstOrDefaultAsync(f => f.PlanId == sub.PlanId && f.FeatureCode == featureCode.ToLowerInvariant());

        return (sub.Plan, feature);
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
