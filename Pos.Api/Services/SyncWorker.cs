using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

/// <summary>
/// Drives sync on a timer, on a business host only.
///
/// Runs in-process rather than as a separate service because the thing it syncs is the database
/// this process already owns: a shop that has to keep two Windows services alive has twice as
/// many ways to end up silently not syncing, and no one to notice.
///
/// It is deliberately unexciting — it wakes, pushes what is pending, and goes back to sleep.
/// Every failure is swallowed into a log and a backoff. Nothing it does can reach a till.
/// </summary>
public class SyncWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly HostLink _link;
    private readonly IHttpClientFactory _clients;
    private readonly ILogger<SyncWorker> _log;

    public SyncWorker(IServiceScopeFactory scopeFactory, IConfiguration config, HostLink link, IHttpClientFactory clients, ILogger<SyncWorker> log)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _link = link;
        _clients = clients;
        _log = log;
    }

    private bool IsBusinessHost =>
        string.Equals(_config["Host:Mode"] ?? Environment.GetEnvironmentVariable("HOST_MODE"),
                      "BusinessHost", StringComparison.OrdinalIgnoreCase);

    private TimeSpan Interval
    {
        get
        {
            var raw = _config["Host:SyncIntervalMinutes"] ?? Environment.GetEnvironmentVariable("SYNC_INTERVAL_MINUTES");
            // Five minutes is frequent enough that head office sees today's trading as it happens,
            // and rare enough that a shop on a phone tether is not paying for constant chatter.
            return int.TryParse(raw, out var m) && m >= 1 ? TimeSpan.FromMinutes(m) : TimeSpan.FromMinutes(5);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!IsBusinessHost)
        {
            _log.LogInformation("Sync worker idle: this instance is not a business host.");
            return;
        }

        // A short settle before the first run: at startup the database may still be applying
        // schema changes, and an immediate sync would just fail and start a backoff for nothing.
        try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (_link.Linked) await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break; // shutting down
            }
            catch (Exception ex)
            {
                // Catch-all on purpose. An unhandled exception here would kill the worker for the
                // lifetime of the process, and the shop would never know it had stopped syncing.
                _log.LogError(ex, "Sync run failed; will retry next interval.");
            }

            try { await Task.Delay(_link.Linked ? Interval : TimeSpan.FromSeconds(10), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        _log.LogInformation("Sync worker stopped.");
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var sync = scope.ServiceProvider.GetRequiredService<ISyncService>();

        // A business host normally holds exactly one tenant. Iterating handles the case of a
        // shared host and costs nothing when there is only one.
        var tenantIds = await db.Tenants.IgnoreQueryFilters()
            .Where(t => t.IsActive)
            .Select(t => t.Id)
            .ToListAsync(ct);

        foreach (var tenantId in tenantIds)
        {
            ct.ThrowIfCancellationRequested();

            var results = await sync.PushAllAsync(tenantId, ct);
            var pushed = results.Sum(r => r.Succeeded);
            var failed = results.Where(r => !r.Ok).ToList();

            if (pushed > 0)
                _log.LogInformation("Sync: pushed {Count} records for tenant {TenantId}", pushed, tenantId);
            foreach (var f in failed)
                _log.LogWarning("Sync: {EntityType} failed — {Error}", f.EntityType, f.Error);

            // Pull last: a suspension or plan change arriving before the shop's sales went up
            // would be the wrong order — get their data safe first, then apply our rules.
            await sync.PullEntitlementsAsync(tenantId, ct);

            // Then the menu. After entitlements so a shop that has just been suspended is not
            // handed a fresh catalogue it may no longer be entitled to sell from; after the
            // pushes so a new item never delays a sale reaching head office.
            var catalog = await sync.PullCatalogAsync(tenantId, ct);
            if (!catalog.Ok)
                _log.LogWarning("Sync: catalogue pull failed — {Error}", catalog.Error);

            await CheckInAsync(ct);
        }
    }

    /// <summary>Records that this host is alive and when it last synced, so the console can show
    /// a shop as healthy rather than simply unheard-from.</summary>
    private async Task CheckInAsync(CancellationToken ct)
    {
        if (_link.CloudUrl is not string cloud || _link.BusinessId is not string id || _link.SyncKey is not string key)
            return;
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{cloud.TrimEnd('/')}/api/host/checkin")
        {
            Content = System.Net.Http.Json.JsonContent.Create(new { businessId = id })
        };
        request.Headers.Add(SyncKeys.HeaderName, key);
        using var response = await _clients.CreateClient("host-enrollment").SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
            _log.LogWarning("Headquarters refused the host check-in ({Status}).", response.StatusCode);
    }
}
