using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// SYNC KEY
//
// The secret a business host must present to the cloud on every push and pull.
//
// Sync endpoints run unattended at 3am with nobody logged in, so a user bearer token is the wrong
// credential — but the HostCode, which is all they used to check, is six characters the customer
// says out loud over the phone. Anyone who heard it could push orders into that shop's books or
// read its menu and prices. This is the missing half: a 256-bit key the host holds and the cloud
// only ever stores a hash of.
// ============================================================

public static class SyncKeys
{
    /// <summary>The header the host sends it in.</summary>
    public const string HeaderName = "X-Sync-Key";

    /// <summary>
    /// A fresh key. Prefixed so a leaked one is greppable as a sync credential rather than
    /// mistaken for a JWT or an API token when it turns up in a log.
    /// </summary>
    public static string NewKey() =>
        "ck_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string key) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    /// <summary>
    /// Length-independent comparison, so a wrong key takes the same time as a right one and the
    /// endpoint cannot be used to walk the key a few bits at a time.
    /// </summary>
    public static bool Matches(string storedHash, string presented)
    {
        byte[] expected;
        try { expected = Convert.FromBase64String(storedHash); }
        catch (FormatException) { return false; }

        var actual = SHA256.HashData(Encoding.UTF8.GetBytes(presented));
        return expected.Length == actual.Length
            && CryptographicOperations.FixedTimeEquals(expected, actual);
    }
}

/// <summary>Outcome of a sync authentication attempt. <see cref="Host"/> is null on any failure.</summary>
public sealed record SyncAuthResult(BusinessHost? Host, int StatusCode, string Message, string? Reason = null)
{
    public bool IsSuccess => Host != null;
    public static SyncAuthResult Ok(BusinessHost host) => new(host, StatusCodes.Status200OK, "");
    public static SyncAuthResult Fail(int statusCode, string message, string? reason = null) =>
        new(null, statusCode, message, reason);
}

public interface ISyncKeyAuthenticator
{
    /// <summary>
    /// Resolves the host behind a sync call and proves the caller is that host.
    ///
    /// <paramref name="tenantId"/> is the business the caller *claims* to be; it is only checked
    /// once the key has already proven the host, because the host's own tenant is what the claim
    /// is measured against.
    /// </summary>
    Task<SyncAuthResult> AuthenticateAsync(
        string? businessId, string? presentedKey, Guid? tenantId, CancellationToken ct = default);
}

public sealed class SyncKeyAuthenticator : ISyncKeyAuthenticator
{
    private readonly AppDbContext _db;
    private readonly ILogger<SyncKeyAuthenticator> _log;

    public SyncKeyAuthenticator(AppDbContext db, ILogger<SyncKeyAuthenticator>? log = null)
    {
        _db = db;
        _log = log ?? NullLogger<SyncKeyAuthenticator>.Instance;
    }

    public async Task<SyncAuthResult> AuthenticateAsync(
        string? businessId, string? presentedKey, Guid? tenantId, CancellationToken ct = default)
    {
        var code = (businessId ?? "").Trim().ToUpperInvariant();

        var host = code.Length == 0
            ? null
            : await _db.BusinessHosts.IgnoreQueryFilters()
                .FirstOrDefaultAsync(h => h.HostCode == code && h.IsActive, ct);

        // One message for unknown, missing and wrong. Splitting them would turn this endpoint
        // into an oracle: a caller could tell which codes name a real host without holding the
        // key, and the code is the one credential that is read aloud.
        const string failed = "Sync authentication failed.";

        if (host == null)
        {
            _log.LogWarning("Sync: rejected call for business code {Code}: no active host with that code", code);
            return SyncAuthResult.Fail(StatusCodes.Status401Unauthorized, failed);
        }

        if (host.SyncKeyHash == null)
        {
            // The only failure worth spelling out: there is no key here to guess, so saying so
            // costs nothing and tells the operator what to actually do about it.
            _log.LogWarning("Sync: rejected call for host {Code}: no sync key on file", host.HostCode);
            return SyncAuthResult.Fail(StatusCodes.Status401Unauthorized,
                "This host has no sync key on file. Register it again to issue one.",
                reason: "no-key-on-file");
        }

        if (string.IsNullOrWhiteSpace(presentedKey))
        {
            _log.LogWarning("Sync: rejected call for host {Code}: no {Header} header",
                host.HostCode, SyncKeys.HeaderName);
            return SyncAuthResult.Fail(StatusCodes.Status401Unauthorized, failed);
        }

        if (!SyncKeys.Matches(host.SyncKeyHash, presentedKey))
        {
            // Never echo the presented key or the stored one. The reason string is deliberately
            // absent here so a wrong key and no key at all are indistinguishable from outside.
            _log.LogWarning("Sync: rejected call for host {Code}: key does not match", host.HostCode);
            return SyncAuthResult.Fail(StatusCodes.Status401Unauthorized, failed);
        }

        // Past this point the caller has proven it is this host, so a tenant claim that does not
        // match is not an attack on somebody else's data — it is a misconfigured host, and it is
        // the host's own tenant it is claiming wrongly.
        if (tenantId != null && tenantId.Value != host.TenantId)
        {
            _log.LogWarning("Sync: host {Code} (tenant {Tenant}) claimed tenant {Claimed}",
                host.HostCode, host.TenantId, tenantId);
            return SyncAuthResult.Fail(StatusCodes.Status403Forbidden,
                "Host does not belong to that business.");
        }

        return SyncAuthResult.Ok(host);
    }
}

/// <summary>
/// The one shape a failed gate is returned in, so every sync endpoint answers the same way and
/// no endpoint can forget the <c>reason</c> field on the failure that carries one.
/// </summary>
public static class SyncGate
{
    public static IResult Failure(SyncAuthResult gate) =>
        Results.Json(
            gate.Reason == null
                ? new { message = gate.Message }
                : new { message = gate.Message, reason = gate.Reason },
            statusCode: gate.StatusCode);
}
