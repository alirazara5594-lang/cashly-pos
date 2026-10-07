using Pos.Api.Data;
using Pos.Api.Models;
using Xunit;

namespace Pos.Api.Tests;

/// <summary>
/// The billing matrix is only worth anything if the parts of the product that read it agree.
///
/// These are the three ways that agreement has broken before: a countable feature whose ceiling
/// never reaches the Subscription screen, a dictionary row for a feature nobody has defined, and
/// a paid-only feature quietly baked into a plan.
/// </summary>
public class SubscriptionEnforcementTests
{
    private static List<string> CountableCodes() =>
        FeatureCatalog.All.Where(f => f.LimitType == FeatureLimitType.Count).Select(f => f.Code).ToList();

    private static List<string> AllCodes() => FeatureCatalog.All.Select(f => f.Code).ToList();

    // ---------------------------------------------------------
    // Countable features
    // ---------------------------------------------------------

    [Fact]
    public async Task Every_countable_feature_is_listed_as_a_limit_on_the_subscription_screen()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();

        var usage = await db.Subscriptions.ChangePlanAsync(db.TenantId, "starter", null, "test seed");

        var countable = CountableCodes();
        Assert.NotEmpty(countable);
        foreach (var code in countable)
            Assert.Contains(usage.Limits, l => string.Equals(l.Code, code, StringComparison.OrdinalIgnoreCase));

        // And nothing shows up as a limit that is not a countable feature.
        Assert.All(usage.Limits, l => Assert.Contains(l.Code, countable, StringComparer.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task The_kitchen_screen_ceiling_is_reported_rather_than_quietly_omitted()
    {
        using var db = new TestDatabase();
        db.SeedTenant();
        db.SeedPlans();
        db.SeedPackages();

        var starter = await db.Subscriptions.ChangePlanAsync(db.TenantId, "starter", null, "test seed");
        var starterKitchen = starter.Limits.Single(l => l.Code == FeatureCodes.KitchenDisplays);
        Assert.Equal(0, starterKitchen.Limit);
        Assert.False(starterKitchen.IsUnlimited); // zero, not "as many as you like"
        Assert.Equal(0, starterKitchen.InUse);

        var standard = await db.Subscriptions.ChangePlanAsync(db.TenantId, "standard", null, "test seed");
        var standardKitchen = standard.Limits.Single(l => l.Code == FeatureCodes.KitchenDisplays);
        Assert.Equal(2, standardKitchen.Limit);
        Assert.False(standardKitchen.IsUnlimited);
        Assert.Equal(0, standardKitchen.InUse);
        Assert.True(standardKitchen.Allowed);
    }

    // ---------------------------------------------------------
    // Matrix integrity
    // ---------------------------------------------------------

    [Fact]
    public void Every_row_in_the_catalogue_has_a_dictionary_entry_of_its_own_type()
    {
        foreach (var row in FeatureCatalog.All)
        {
            switch (row.LimitType)
            {
                case FeatureLimitType.Boolean:
                    Assert.Contains(row.Code, FeatureCatalog.Booleans.Keys);
                    break;
                case FeatureLimitType.Count:
                    Assert.Contains(row.Code, FeatureCatalog.Counts.Keys);
                    break;
                case FeatureLimitType.Level:
                    Assert.Contains(row.Code, FeatureCatalog.Levels.Keys);
                    break;
                default:
                    throw new InvalidOperationException($"Unknown limit type for '{row.Code}'.");
            }
        }
    }

    [Fact]
    public void Every_dictionary_entry_belongs_to_a_row_in_the_catalogue()
    {
        var codes = AllCodes();

        // A row nobody defines is worse than a missing one: /api/subscription lists it as a
        // capability the business may not have, when there is nothing to have or buy.
        foreach (var group in new[]
                 {
                     (IEnumerable<string>)FeatureCatalog.Booleans.Keys,
                     FeatureCatalog.Counts.Keys,
                     FeatureCatalog.Levels.Keys
                 })
            foreach (var code in group)
                Assert.Contains(code, codes, StringComparer.OrdinalIgnoreCase);

        foreach (var code in FeatureCodes.SoldSeparately)
            Assert.Contains(code, codes, StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public void No_version_includes_a_feature_that_is_sold_separately()
    {
        var missing = FeatureCodes.SoldSeparately
            .Where(code => !FeatureCatalog.Booleans.ContainsKey(code) && !FeatureCatalog.Levels.ContainsKey(code))
            .ToList();
        Assert.Empty(missing); // otherwise the check below would pass by skipping the row

        foreach (var code in FeatureCodes.SoldSeparately)
        {
            if (FeatureCatalog.Booleans.TryGetValue(code, out var flag))
            {
                Assert.False(flag.Starter, code);
                Assert.False(flag.Standard, code);
                Assert.False(flag.Professional, code);
            }

            if (FeatureCatalog.Levels.TryGetValue(code, out var level))
            {
                Assert.Equal(FeatureLevel.None, level.Starter);
                Assert.Equal(FeatureLevel.None, level.Standard);
                Assert.Equal(FeatureLevel.None, level.Professional);
            }
        }
    }
}
