using System.Text.Json;
using Pos.Api.Models;

namespace Pos.Api.Services;

/// <summary>
/// The "Watch demo" steps on the sign-in page, one list per kind of business: a title, a line about
/// it and a video each. The app ships its own (recorded from Cashly, under /demo-videos); what is
/// kept here, on the platform's settings, is only the kinds the platform has changed
/// (Platform → Settings → Demo videos). A kind not kept here plays the app's own.
/// </summary>
public static class DemoVideos
{
    public record Step(string? Title, string? Description, string? VideoUrl);

    /// <summary>The kinds of business registration offers (registerCatalog.ts).</summary>
    public static readonly string[] Kinds = ["restaurant", "retail", "pharmacy", "grocery"];

    public const int MaxSteps = 12;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The kinds the platform has changed, each with its steps.</summary>
    public static Dictionary<string, List<Step>> Read(PlatformSettings settings)
    {
        if (string.IsNullOrWhiteSpace(settings.DemoVideosJson)) return [];
        try
        {
            var saved = JsonSerializer.Deserialize<Dictionary<string, List<Step>>>(settings.DemoVideosJson, Json) ?? [];
            return saved.Where(k => Kinds.Contains(k.Key)).ToDictionary(k => k.Key, k => k.Value);
        }
        catch (JsonException)
        {
            return []; // an older shape: play the app's own
        }
    }

    /// <summary>Keep these steps for one kind; null puts that kind back to the app's own.</summary>
    public static string Write(PlatformSettings settings, string kind, List<Step>? steps)
    {
        var all = Read(settings);
        if (steps == null) all.Remove(kind);
        else all[kind] = steps;
        return JsonSerializer.Serialize(all, Json);
    }

    /// <summary>A video link: a full https:// address, or a file the app itself serves ("/demo-videos/…").</summary>
    private static bool LinkOk(string url) =>
        url.Length <= 500 && !url.Any(char.IsWhiteSpace) &&
        (url.StartsWith('/') ? !url.StartsWith("//")
            : Uri.TryCreate(url, UriKind.Absolute, out var link) && link.Scheme == Uri.UriSchemeHttps);

    /// <summary>The steps as given, trimmed (wholly blank rows dropped); or why they cannot be saved.</summary>
    public static (List<Step>? Steps, string? Problem) Clean(IEnumerable<Step>? given)
    {
        var steps = new List<Step>();
        foreach (var g in given ?? [])
        {
            var title = g.Title?.Trim();
            var description = string.IsNullOrWhiteSpace(g.Description) ? null : g.Description.Trim();
            var url = string.IsNullOrWhiteSpace(g.VideoUrl) ? null : g.VideoUrl.Trim();
            if (string.IsNullOrEmpty(title))
            {
                if (description == null && url == null) continue;
                return (null, $"Step {steps.Count + 1} needs a title.");
            }
            if (title.Length > 80) return (null, $"Step {steps.Count + 1}: keep the title under 80 characters.");
            if (description?.Length > 240) return (null, $"\"{title}\": keep the description under 240 characters.");
            if (url != null && !LinkOk(url))
                return (null, $"\"{title}\": the video link must be a full https:// address.");
            steps.Add(new Step(title, description, url));
        }
        if (steps.Count > MaxSteps) return (null, $"Up to {MaxSteps} steps.");
        return (steps, null);
    }
}
