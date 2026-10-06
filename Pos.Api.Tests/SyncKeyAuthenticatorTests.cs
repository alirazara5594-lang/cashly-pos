using Pos.Api.Services;
using Xunit;

namespace Pos.Api.Tests;

/// <summary>
/// The gate on every unattended sync endpoint.
///
/// What is being tested is not that a key is checked — it is that the *answers* are shaped so
/// the endpoint cannot be used to find out things it should not: a missing key and a wrong key
/// must be indistinguishable, and an invented business code must answer exactly as a real one
/// does when its key is wrong.
/// </summary>
public class SyncKeyAuthenticatorTests
{
    private const string HostCode = "AB12CD";
    private const string Key = "ck_5nQ0Z1tR8vJ7hG2fD4sA6wY3xU9mB0pL2kE1oI8qR5";

    [Fact]
    public async Task The_right_key_resolves_the_host_it_belongs_to()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        var expected = db.SeedHost(Key);

        var result = await db.Auth.AuthenticateAsync(HostCode, Key, db.TenantId);

        Assert.True(result.IsSuccess);
        Assert.Equal(expected.Id, result.Host!.Id);
        Assert.Equal(db.TenantId, result.Host.TenantId);
    }

    [Fact]
    public async Task A_host_with_no_key_header_is_turned_away()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(Key);

        var result = await db.Auth.AuthenticateAsync(HostCode, null, db.TenantId);

        Assert.False(result.IsSuccess);
        Assert.Equal(401, result.StatusCode);
        Assert.Null(result.Host);
    }

    [Fact]
    public async Task A_wrong_key_gets_exactly_the_same_answer_as_no_key_at_all()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(Key);

        var wrong = await db.Auth.AuthenticateAsync(HostCode, Key + "x", db.TenantId);
        var none = await db.Auth.AuthenticateAsync(HostCode, "", db.TenantId);

        Assert.Equal(401, wrong.StatusCode);
        Assert.Equal(401, none.StatusCode);
        Assert.Equal(wrong.Message, none.Message);
        // Neither carries a reason, so neither tells a caller *why* — which is the difference
        // between "you were close" and "keep trying".
        Assert.Null(wrong.Reason);
        Assert.Null(none.Reason);
    }

    [Fact]
    public async Task An_invented_business_code_gets_the_same_answer_as_a_bad_key()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(Key);

        var invented = await db.Auth.AuthenticateAsync("QQ99QQ", Key, db.TenantId);
        var wrongKey = await db.Auth.AuthenticateAsync(HostCode, "ck_not_the_key", db.TenantId);

        Assert.Equal(401, invented.StatusCode);
        Assert.Equal(wrongKey.Message, invented.Message);
        Assert.Null(invented.Reason);
    }

    [Fact]
    public async Task A_key_that_never_existed_says_nothing_about_the_host()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(Key);

        var result = await db.Auth.AuthenticateAsync(HostCode, "ck_totally_made_up", db.TenantId);

        Assert.False(result.IsSuccess);
        Assert.Equal(401, result.StatusCode);
        // Deliberately unadorned. The one hint this endpoint gives — "no key on file" — is only
        // ever shown for a host that genuinely has none; a host with a key gets this same bare
        // failure whether its code was right and the key wrong, or the code was invented.
        Assert.Null(result.Reason);
    }

    [Fact]
    public async Task A_host_registered_before_keys_existed_says_what_to_do_about_it()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(syncKey: null);

        var result = await db.Auth.AuthenticateAsync(HostCode, Key, db.TenantId);

        Assert.False(result.IsSuccess);
        Assert.Equal(401, result.StatusCode);
        Assert.Equal("no-key-on-file", result.Reason);
        Assert.Contains("Register it again", result.Message);
    }

    [Fact]
    public async Task A_key_only_opens_the_host_it_was_issued_to()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(Key, hostCode: "AAAAAA");
        db.SeedHost("ck_another_hosts_entirely_different_key", hostCode: "BBBBBB");

        var result = await db.Auth.AuthenticateAsync(
            "BBBBBB", Key, db.TenantId);

        Assert.False(result.IsSuccess);
        Assert.Equal(401, result.StatusCode);
        Assert.Null(result.Reason);
    }

    [Fact]
    public async Task A_host_may_only_speak_for_its_own_business()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(Key);

        var result = await db.Auth.AuthenticateAsync(HostCode, Key, Guid.NewGuid());

        Assert.False(result.IsSuccess);
        Assert.Equal(403, result.StatusCode);
        Assert.Contains("does not belong", result.Message);
    }

    [Fact]
    public async Task An_inactive_host_is_an_unknown_host()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(Key, active: false);

        var result = await db.Auth.AuthenticateAsync(HostCode, Key, db.TenantId);

        Assert.False(result.IsSuccess);
        Assert.Equal(401, result.StatusCode);
        Assert.Null(result.Reason);
    }

    [Fact]
    public async Task Check_in_makes_no_tenant_claim_and_needs_one()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedHost(Key);

        var result = await db.Auth.AuthenticateAsync(HostCode, Key, tenantId: null);

        Assert.True(result.IsSuccess);
    }

    // ---------------------------------------------------------
    // The key material itself
    // ---------------------------------------------------------

    [Fact]
    public void A_generated_key_round_trips_and_stores_nothing_readable()
    {
        var key = SyncKeys.NewKey();
        var hash = SyncKeys.Hash(key);

        Assert.StartsWith("ck_", key);
        Assert.True(key.Length > 30);
        Assert.DoesNotContain(key, hash);
        Assert.True(SyncKeys.Matches(hash, key));
        Assert.False(SyncKeys.Matches(hash, key + "x"));
        Assert.False(SyncKeys.Matches(hash, key.ToLowerInvariant()));
    }

    [Fact]
    public void A_corrupt_hash_is_a_miss_not_an_exception()
    {
        Assert.False(SyncKeys.Matches("not base64 at all!", SyncKeys.NewKey()));
        Assert.False(SyncKeys.Matches("", SyncKeys.NewKey()));
    }

    [Fact]
    public void Two_generated_keys_are_not_the_same_key()
    {
        Assert.NotEqual(SyncKeys.NewKey(), SyncKeys.NewKey());
    }
}
