using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// RENEWALS PER PART
//
// A business pays for several things, and each renews on its own date counted from when it went in:
//   • the Head Office ERP — from registration;
//   • each selling location's POS version — from its first till (an outlet with no till yet bills nothing);
//   • each waiter tablet beyond what its location's POS version includes — from its activation;
//   • every other add-on — from when it was added.
// Anything installed during the business's free trial is covered until the trial ends; anything
// installed afterwards starts its own period from its installation date.
//
// The parts are kept in step with the real setup (SyncAsync) rather than written by every screen
// that adds an outlet or a tablet: activation dates come from the devices themselves, so a part
// noticed late still carries the day it really went in.
//
// Until per-part enforcement exists, the business-level paid-until date follows the LATEST paid
// part, so recording one part's payment never locks the business out by accident.
// ============================================================

/// <summary>Where a part stands today.</summary>
public enum PartStatus
{
    NotInstalled,     // an outlet with no till yet: nothing to bill
    Trial,            // covered by the business's free trial
    Active,           // paid, more than 14 days left
    Expiring,         // paid or trial, 14 days or fewer left
    PaymentDue,       // installed after the trial and never paid
    Expired,          // its covered period has ended
    Ended             // no longer in use (outlet stopped selling, tablet revoked, add-on removed)
}

public sealed record PartState(PartStatus Status, DateTime? RenewsAt, int? DaysLeft, bool InTrial);

public interface ISubscriptionPartsService
{
    /// <summary>Brings one business's parts in line with its outlets, tablets and add-ons.</summary>
    Task SyncAsync(Guid tenantId);

    /// <summary>Every business, at most once a minute — for the platform's renewal views.</summary>
    Task SyncAllAsync();

    /// <summary>Records <paramref name="periods"/> paid periods, counted on from the part's own anniversary.</summary>
    Task<SubscriptionPart> MarkPaidAsync(Guid partId, bool annual, int periods);

    /// <summary>Sets the date a part is paid up to, for a correction or a free period.</summary>
    Task<SubscriptionPart> SetPaidUntilAsync(Guid partId, DateTime paidUntil);
}

public class SubscriptionPartsService : ISubscriptionPartsService
{
    /// <summary>Days before a renewal it counts as expiring.</summary>
    public const int ExpiringWithinDays = 14;

    private static DateTime _lastSyncAll = DateTime.MinValue;
    private static readonly object SyncAllGate = new();

    private readonly AppDbContext _db;
    private readonly IBillingService _billing;
    private readonly IEntitlementService _entitlements;

    public SubscriptionPartsService(AppDbContext db, IBillingService billing, IEntitlementService entitlements)
    {
        _db = db;
        _billing = billing;
        _entitlements = entitlements;
    }

    /// <summary>A part's status, renewal date and days left, as of <paramref name="now"/>.</summary>
    public static PartState StateOf(SubscriptionPart part, DateTime now)
    {
        if (!part.IsActive) return new PartState(PartStatus.Ended, part.EndedAt, null, false);
        if (part.InstalledAt == null) return new PartState(PartStatus.NotInstalled, null, null, false);

        // Covered until the later of its trial and what has been paid.
        DateTime? covered = (part.TrialEndsAt, part.PaidUntil) switch
        {
            (null, var paid) => paid,
            (var trial, null) => trial,
            (var trial, var paid) => trial > paid ? trial : paid
        };
        var inTrial = part.TrialEndsAt != null && (part.PaidUntil == null || part.PaidUntil < part.TrialEndsAt);
        if (covered == null)
        {
            // Installed after the trial and never paid: due from the day it went in.
            var overdue = (int)Math.Floor((now - part.InstalledAt.Value).TotalDays);
            return new PartState(PartStatus.PaymentDue, part.InstalledAt, -overdue, false);
        }

        var daysLeft = (int)Math.Ceiling((covered.Value - now).TotalDays);
        var status = covered.Value <= now ? PartStatus.Expired
            : daysLeft <= ExpiringWithinDays ? PartStatus.Expiring
            : inTrial ? PartStatus.Trial
            : PartStatus.Active;
        return new PartState(status, covered, daysLeft, inTrial);
    }

    private static string EditionLabel(SubscriptionTier edition) =>
        edition == SubscriptionTier.Professional ? "Enterprise" : edition.ToString();

    private sealed record WantedPart(string Key, SubscriptionPartKind Kind, string Name, Guid? BranchId, Guid? TerminalId,
        Guid? AddOnSubscriptionId, DateTime? InstalledAt, decimal MonthlyPrice, decimal YearlyPrice);

    public async Task SyncAsync(Guid tenantId)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant == null) return;
        var now = DateTime.UtcNow;

        var monthly = await _billing.QuoteAsync(tenantId, annual: false);
        var yearly = await _billing.QuoteAsync(tenantId, annual: true);
        decimal PriceOf(BillingQuote quote, string kind, Guid? branchId) =>
            quote.Lines.FirstOrDefault(l => l.Kind == kind && (branchId == null || l.BranchId == branchId))?.UnitPricePKR ?? 0;

        var branches = await _db.Branches.IgnoreQueryFilters().AsNoTracking()
            .Where(b => b.TenantId == tenantId)
            .Select(b => new { b.Id, b.Name, b.CanSell, b.PosEdition })
            .ToListAsync();
        var devices = await _db.Terminals.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.TenantId == tenantId && (t.TerminalType == TerminalType.Counter || t.TerminalType == TerminalType.OrderTab))
            .Select(t => new { t.Id, t.BranchId, t.TerminalType, t.TerminalName, t.ActivatedAt, t.IsActive, t.RevokedAt, t.DeactivatedAt })
            .ToListAsync();
        var addOns = await _db.AddOnSubscriptions.IgnoreQueryFilters().AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.IsActive)
            .ToListAsync();
        var catalogue = await _db.AddOnCatalogItems.AsNoTracking().ToListAsync();
        var allowances = await _entitlements.GetBranchAllowancesAsync(tenantId);
        var ent = await _entitlements.GetAsync(tenantId);

        var wanted = new List<WantedPart>();

        // The ERP, from registration.
        if (tenant.DeploymentMode == DeploymentMode.HeadOffice)
            wanted.Add(new WantedPart("erp", SubscriptionPartKind.Erp, "Head Office ERP", null, null, null, tenant.CreatedAt,
                PriceOf(monthly, "erp", null), PriceOf(yearly, "erp", null)));

        var tabletCatalogue = catalogue.FirstOrDefault(c => c.Key == "EXTRA_TABLET");
        foreach (var shop in branches.Where(b => b.CanSell).OrderBy(b => b.Name))
        {
            // The location's POS, from the first till ever connected there — when they started using it.
            var firstTill = devices.Where(d => d.BranchId == shop.Id && d.ActivatedAt != null)
                .Min(d => d.ActivatedAt);
            var edition = shop.PosEdition ?? tenant.Tier;
            wanted.Add(new WantedPart($"pos:{shop.Id}", SubscriptionPartKind.Pos, $"{shop.Name} POS ({EditionLabel(edition)})",
                shop.Id, null, null, firstTill, PriceOf(monthly, "pos", shop.Id), PriceOf(yearly, "pos", shop.Id)));

            // Tablets beyond what the POS version includes, each from its own activation, oldest first.
            allowances.TryGetValue(shop.Id, out var allowance);
            var included = allowance?.MaxOrderTabs ?? ent.MaxOrderTabs;
            if (included >= FeatureCatalog.UnlimitedCount) continue;
            var tablets = devices
                .Where(d => d.BranchId == shop.Id && d.TerminalType == TerminalType.OrderTab
                            && d.IsActive && d.RevokedAt == null && d.DeactivatedAt == null && d.ActivatedAt != null)
                .OrderBy(d => d.ActivatedAt)
                .Skip(Math.Max(0, included));
            // The price agreed when the extra tablets were bought for this shop, else the list price.
            var agreed = addOns.FirstOrDefault(a => a.AddOnKey == "EXTRA_TABLET" && a.BranchId == shop.Id)?.PricePKR;
            var tabletMonthly = agreed ?? tabletCatalogue?.MonthlyPricePKR ?? 0;
            var tabletYearly = agreed != null && agreed != tabletCatalogue?.MonthlyPricePKR ? agreed.Value * 10 : tabletCatalogue?.YearlyPricePKR ?? tabletMonthly * 10;
            foreach (var tablet in tablets)
                wanted.Add(new WantedPart($"tablet:{tablet.Id}", SubscriptionPartKind.Tablet,
                    $"{shop.Name} · {(string.IsNullOrWhiteSpace(tablet.TerminalName) ? "Tablet" : tablet.TerminalName)} (extra tablet)",
                    shop.Id, tablet.Id, null, tablet.ActivatedAt, tabletMonthly, tabletYearly));
        }

        // Every other add-on. Extra tablets are billed per tablet above, not per purchase.
        var shopNames = branches.ToDictionary(b => b.Id, b => b.Name);
        foreach (var addOn in addOns.Where(a => a.AddOnKey != "EXTRA_TABLET"))
        {
            var item = catalogue.FirstOrDefault(c => c.Key == addOn.AddOnKey);
            var quantity = Math.Max(1, addOn.Quantity);
            var where = addOn.BranchId != null && shopNames.TryGetValue(addOn.BranchId.Value, out var shopName) ? $" ({shopName})" : "";
            var unitYearly = item != null && addOn.PricePKR == item.MonthlyPricePKR ? item.YearlyPricePKR : addOn.PricePKR * 10;
            wanted.Add(new WantedPart($"addon:{addOn.Id}", SubscriptionPartKind.AddOn,
                $"{item?.DisplayName ?? addOn.AddOnKey}{(quantity > 1 ? $" × {quantity}" : "")}{where}",
                addOn.BranchId, null, addOn.Id, null, addOn.PricePKR * quantity, unitYearly * quantity));
        }

        var existing = await _db.SubscriptionParts.IgnoreQueryFilters().Where(p => p.TenantId == tenantId).ToListAsync();
        // The first time a business's parts are made, an existing paid-up business keeps its
        // current date on every part — nothing it already paid for changes overnight.
        var firstSync = existing.Count == 0;

        void StartCoverage(SubscriptionPart part)
        {
            if (part.InstalledAt == null) return;
            if (tenant.IsTrialActive && part.InstalledAt <= tenant.TrialEndsAt)
                part.TrialEndsAt = tenant.TrialEndsAt;
            else if (firstSync && tenant.SubscriptionPaidUntil != null)
                part.PaidUntil = tenant.SubscriptionPaidUntil;
        }

        foreach (var w in wanted)
        {
            var part = existing.FirstOrDefault(p => p.Key == w.Key);
            if (part == null)
            {
                part = new SubscriptionPart
                {
                    TenantId = tenantId, Key = w.Key, Kind = w.Kind,
                    // An add-on has no installation record of its own: it counts from when it was first seen.
                    InstalledAt = w.Kind == SubscriptionPartKind.AddOn ? now : w.InstalledAt
                };
                StartCoverage(part);
                _db.SubscriptionParts.Add(part);
                existing.Add(part);
            }
            else if (!part.IsActive)
            {
                part.IsActive = true;
                part.EndedAt = null;
            }

            // An outlet's first till arrived since the part was made: its billing starts now.
            if (part.InstalledAt == null && w.InstalledAt != null)
            {
                part.InstalledAt = w.InstalledAt;
                StartCoverage(part);
            }

            part.Name = w.Name;
            part.BranchId = w.BranchId;
            part.TerminalId = w.TerminalId;
            part.AddOnSubscriptionId = w.AddOnSubscriptionId;
            part.PricePKR = part.Annual ? w.YearlyPrice : w.MonthlyPrice;
        }

        // What is no longer there stops renewing; its history stays.
        var wantedKeys = wanted.Select(w => w.Key).ToHashSet();
        foreach (var gone in existing.Where(p => p.IsActive && !wantedKeys.Contains(p.Key)))
        {
            gone.IsActive = false;
            gone.EndedAt = now;
        }

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Another request brought the same business up to date at the same moment (two screens
            // opening together); its rows stand, and the next look picks up anything missed.
            foreach (var entry in _db.ChangeTracker.Entries<SubscriptionPart>().ToList())
                entry.State = EntityState.Detached;
        }
    }

    public Task SyncAllAsync()
    {
        lock (SyncAllGate)
        {
            // Screens that open together (the dashboard asks three ways at once) wait for the one
            // pass already under way rather than reading the table half done.
            if (_syncAllRun is { IsCompleted: false }) return _syncAllRun;
            if (DateTime.UtcNow - _lastSyncAll < TimeSpan.FromMinutes(1)) return Task.CompletedTask;
            _lastSyncAll = DateTime.UtcNow;
            _syncAllRun = RunSyncAllAsync();
            return _syncAllRun;
        }
    }

    private static Task? _syncAllRun;

    private async Task RunSyncAllAsync()
    {
        var tenantIds = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Status != TenantStatus.Cancelled)
            .Select(t => t.Id)
            .ToListAsync();
        foreach (var id in tenantIds)
        {
            try { await SyncAsync(id); }
            catch (Exception ex) { Console.WriteLine($"[Renewals] Could not bring tenant {id} up to date: {ex.Message}"); }
        }
    }

    public async Task<SubscriptionPart> MarkPaidAsync(Guid partId, bool annual, int periods)
    {
        var part = await _db.SubscriptionParts.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == partId)
            ?? throw new InvalidOperationException("That part was not found.");
        if (!part.IsActive) throw new InvalidOperationException("This part is no longer in use, so it does not renew.");
        if (part.InstalledAt == null) throw new InvalidOperationException("This outlet has no till yet, so there is nothing to bill.");
        periods = Math.Clamp(periods, 1, 36);

        // On from its own anniversary: the end of what is already paid, else the end of its trial,
        // else the day it was installed.
        var from = part.PaidUntil ?? part.TrialEndsAt ?? part.InstalledAt.Value;
        part.Annual = annual;
        part.PaidUntil = annual ? from.AddYears(periods) : from.AddMonths(periods);

        await FollowOnBusinessAsync(part);
        await _db.SaveChangesAsync();
        await _entitlements.RecomputeAsync(part.TenantId);
        return part;
    }

    public async Task<SubscriptionPart> SetPaidUntilAsync(Guid partId, DateTime paidUntil)
    {
        var part = await _db.SubscriptionParts.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == partId)
            ?? throw new InvalidOperationException("That part was not found.");
        if (!part.IsActive) throw new InvalidOperationException("This part is no longer in use, so it does not renew.");
        part.PaidUntil = DateTime.SpecifyKind(paidUntil, DateTimeKind.Utc);

        await FollowOnBusinessAsync(part);
        await _db.SaveChangesAsync();
        await _entitlements.RecomputeAsync(part.TenantId);
        return part;
    }

    /// <summary>
    /// The business stays open while anything it pays for is paid up: its own date follows the
    /// latest paid part. Stopping only the part that lapsed is a later step.
    /// </summary>
    private async Task FollowOnBusinessAsync(SubscriptionPart part)
    {
        if (part.PaidUntil == null) return;
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == part.TenantId);
        if (tenant == null) return;
        if (tenant.SubscriptionPaidUntil == null || tenant.SubscriptionPaidUntil < part.PaidUntil)
            tenant.SubscriptionPaidUntil = part.PaidUntil;
        // A business that fell past due after its trial is back in good standing once paid. Other
        // states (restricted, read-only, suspended) are support decisions and stay as they are.
        if (tenant.Status == TenantStatus.PastDue && part.PaidUntil > DateTime.UtcNow)
        {
            tenant.Status = TenantStatus.Active;
            tenant.IsTrialActive = false;
        }
    }
}
