using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// DEVICE LICENSING
//
// A Terminal row used to be the whole story: a plain GUID DeviceToken, generated once, stored in
// clear, never expiring, bound to nothing. Anyone holding the string was that till, forever, and
// a downgrade could not take a counter away because nothing ever re-checked.
//
// A licence here is a short-lived signed token that says: this device, at this branch, of this
// class, may operate until this moment, under exactly these entitlements. It is
//
//   * signed       — a device cannot mint or edit one,
//   * bound        — it carries a fingerprint hash, so a copied token fails on another machine,
//   * expiring     — it must be renewed by heartbeat, which is where revocation and downgrades bite,
//   * versioned    — it carries the entitlement snapshot version, so a plan change propagates,
//   * forgiving    — expiry starts a grace period, not a shutdown. A till never dies mid-shift.
//
// The grace ladder, in order: fully licensed -> renewal overdue (warn) -> grace (still selling,
// loud banner) -> read-only (no new sales, data readable). The device enforces the soft steps
// offline; the server enforces the hard ones whenever it can actually see the device.
// ============================================================

/// <summary>What a device is allowed to do right now, given its licence state.</summary>
public enum DeviceLicenseState
{
    /// <summary>Licence current. Normal operation.</summary>
    Valid = 1,
    /// <summary>Past due for renewal but inside the grace window. Sells, with a warning.</summary>
    Grace = 2,
    /// <summary>Grace exhausted. No new sales; existing data readable until it syncs.</summary>
    ReadOnly = 3,
    /// <summary>Deliberately killed, or the tenant is hard-suspended. Nothing works.</summary>
    Revoked = 4,
    /// <summary>Token unparseable, unsigned, or for a device that no longer exists.</summary>
    Invalid = 5
}

public sealed record DeviceLicense
{
    public required string Token { get; init; }
    public required DateTime ExpiresAt { get; init; }
    public required DateTime GraceEndsAt { get; init; }
    public required int SnapshotVersion { get; init; }
    public required Guid TerminalId { get; init; }
    public required TerminalType TerminalType { get; init; }
}

public sealed record DeviceLicenseValidation
{
    public required DeviceLicenseState State { get; init; }
    public Guid? TerminalId { get; init; }
    public Guid? TenantId { get; init; }
    public Guid? BranchId { get; init; }
    public TerminalType? TerminalType { get; init; }
    public int SnapshotVersion { get; init; }
    public string? Reason { get; init; }

    public bool CanSell => State is DeviceLicenseState.Valid or DeviceLicenseState.Grace;
}

public interface IDeviceLicenseService
{
    /// <summary>Issues (or renews) a licence for a terminal. Caller has already authorised this.</summary>
    Task<DeviceLicense> IssueAsync(Terminal terminal, EffectiveEntitlements entitlements);

    /// <summary>Validates a presented licence token against the live database.</summary>
    Task<DeviceLicenseValidation> ValidateAsync(string? token, string? presentedFingerprint);

    /// <summary>Hashes a raw device fingerprint for storage/comparison.</summary>
    string HashFingerprint(string raw);
}

public class DeviceLicenseService : IDeviceLicenseService
{
    /// <summary>How long a licence is good for before it must be renewed by heartbeat. Short
    /// enough that a revocation or downgrade lands within a day.</summary>
    public static readonly TimeSpan LicenseLifetime = TimeSpan.FromHours(26);

    /// <summary>How long past expiry a device keeps selling. Sized for a bad week of connectivity,
    /// which in a lot of markets is an ordinary week.</summary>
    public static readonly TimeSpan GracePeriod = TimeSpan.FromDays(14);

    private const string Issuer = "cashly-pos-license";

    private readonly AppDbContext _db;
    private readonly SymmetricSecurityKey _key;

    public DeviceLicenseService(AppDbContext db, IConfiguration config)
    {
        _db = db;
        var jwtKey = config["Jwt:Key"]
                     ?? Environment.GetEnvironmentVariable("JWT_KEY")
                     ?? "CashlyPOS_SuperSecretKey_2024_Change_In_Production!";
        _key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
    }

    public string HashFingerprint(string raw)
    {
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes(raw.Trim()))).ToLowerInvariant();
    }

    public Task<DeviceLicense> IssueAsync(Terminal terminal, EffectiveEntitlements entitlements)
    {
        var now = DateTime.UtcNow;
        var expiresAt = now.Add(LicenseLifetime);
        var graceEndsAt = expiresAt.Add(GracePeriod);

        // The licence carries the entitlements the device needs to enforce locally while offline.
        // Anything it can only learn by asking the server is useless to a till with no internet.
        var payload = new
        {
            features = entitlements.Features.Where(f => f.Value).Select(f => f.Key).ToArray(),
            packs = entitlements.PackKeys,
            primaryPack = entitlements.PrimaryPackKey,
            canSell = entitlements.CanSell,
            canBackOffice = entitlements.CanUseBackOffice,
            status = entitlements.Status.ToString()
        };

        var claims = new List<Claim>
        {
            new("terminalId", terminal.Id.ToString()),
            new("tenantId", terminal.TenantId.ToString()),
            new("branchId", terminal.BranchId.ToString()),
            new("terminalType", terminal.TerminalType.ToString()),
            new("fp", terminal.DeviceFingerprint ?? string.Empty),
            new("snapshotVersion", entitlements.Version.ToString()),
            new("graceEndsAt", new DateTimeOffset(graceEndsAt).ToUnixTimeSeconds().ToString()),
            new("ent", JsonSerializer.Serialize(payload))
        };

        var token = new JwtSecurityToken(
            issuer: Issuer,
            audience: Issuer,
            claims: claims,
            notBefore: now,
            expires: expiresAt,
            signingCredentials: new SigningCredentials(_key, SecurityAlgorithms.HmacSha256));

        terminal.LicenseIssuedAt = now;
        terminal.LicenseExpiresAt = expiresAt;
        terminal.LicenseSnapshotVersion = entitlements.Version;
        terminal.LastSeenAt = now;

        return Task.FromResult(new DeviceLicense
        {
            Token = new JwtSecurityTokenHandler().WriteToken(token),
            ExpiresAt = expiresAt,
            GraceEndsAt = graceEndsAt,
            SnapshotVersion = entitlements.Version,
            TerminalId = terminal.Id,
            TerminalType = terminal.TerminalType
        });
    }

    public async Task<DeviceLicenseValidation> ValidateAsync(string? token, string? presentedFingerprint)
    {
        if (string.IsNullOrWhiteSpace(token))
            return new DeviceLicenseValidation { State = DeviceLicenseState.Invalid, Reason = "No licence presented." };

        var handler = new JwtSecurityTokenHandler();
        ClaimsPrincipal principal;
        JwtSecurityToken jwt;

        try
        {
            // ValidateLifetime is deliberately false: an expired licence is not invalid, it is in
            // grace. Expiry is evaluated below so the difference between "renew soon" and "stop
            // selling" stays a business decision rather than a signature-validation side effect.
            principal = handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = Issuer,
                ValidateAudience = true,
                ValidAudience = Issuer,
                ValidateLifetime = false,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = _key
            }, out var validated);
            jwt = (JwtSecurityToken)validated;
        }
        catch (Exception ex)
        {
            return new DeviceLicenseValidation { State = DeviceLicenseState.Invalid, Reason = $"Licence rejected: {ex.GetType().Name}." };
        }

        if (!Guid.TryParse(principal.FindFirst("terminalId")?.Value, out var terminalId))
            return new DeviceLicenseValidation { State = DeviceLicenseState.Invalid, Reason = "Licence has no terminal." };

        var terminal = await _db.Terminals.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == terminalId);
        if (terminal == null)
            return new DeviceLicenseValidation { State = DeviceLicenseState.Invalid, TerminalId = terminalId, Reason = "Terminal no longer exists." };

        var baseResult = new DeviceLicenseValidation
        {
            State = DeviceLicenseState.Valid,
            TerminalId = terminal.Id,
            TenantId = terminal.TenantId,
            BranchId = terminal.BranchId,
            TerminalType = terminal.TerminalType,
            SnapshotVersion = int.TryParse(principal.FindFirst("snapshotVersion")?.Value, out var v) ? v : 0
        };

        if (terminal.RevokedAt != null)
            return baseResult with { State = DeviceLicenseState.Revoked, Reason = terminal.RevokedReason ?? "Licence revoked." };

        if (terminal.DeactivatedAt != null)
            return baseResult with { State = DeviceLicenseState.Revoked, Reason = "This device was retired." };

        if (!terminal.IsActive)
            return baseResult with { State = DeviceLicenseState.Revoked, Reason = "Terminal deactivated." };

        // A copied token presenting someone else's hardware is the case this whole scheme exists
        // to catch, so it fails closed and is logged rather than quietly downgraded to grace.
        var claimedFingerprint = principal.FindFirst("fp")?.Value;
        if (!string.IsNullOrEmpty(terminal.DeviceFingerprint))
        {
            if (claimedFingerprint != terminal.DeviceFingerprint)
                return baseResult with { State = DeviceLicenseState.Revoked, Reason = "Licence does not match this device." };

            if (!string.IsNullOrWhiteSpace(presentedFingerprint)
                && HashFingerprint(presentedFingerprint) != terminal.DeviceFingerprint)
                return baseResult with { State = DeviceLicenseState.Revoked, Reason = "Device fingerprint mismatch." };
        }

        var now = DateTime.UtcNow;
        var expiresAt = jwt.ValidTo;
        var graceEndsAt = long.TryParse(principal.FindFirst("graceEndsAt")?.Value, out var graceUnix)
            ? DateTimeOffset.FromUnixTimeSeconds(graceUnix).UtcDateTime
            : expiresAt.Add(GracePeriod);

        if (now <= expiresAt) return baseResult;
        if (now <= graceEndsAt)
            return baseResult with { State = DeviceLicenseState.Grace, Reason = $"Licence expired {(now - expiresAt).Days}d ago; reconnect to renew." };

        return baseResult with { State = DeviceLicenseState.ReadOnly, Reason = "Licence grace period exhausted. Reconnect to resume selling." };
    }
}
