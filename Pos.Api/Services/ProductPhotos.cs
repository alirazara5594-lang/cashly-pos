using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// AI PRODUCT PHOTOS
//
// An item saved without a photo gets one: a realistic picture made by AI from its name, category
// and description — a plated dish for a restaurant, a packshot for a shop, a plain unbranded pack
// for a pharmacy. The owner can also upload their own photo, or ask for a new AI one.
//
// Three decisions shape everything below.
//
// 1. THE KEY NEVER LEAVES THE CLOUD. Photos are made with Cashly's own OpenAI account, set in
//    Platform → Settings. A shop's own computer (a business host) never holds that key: it asks the
//    cloud over the sync link it already has (/api/sync/ai-photo) and keeps the photo it gets back.
//
// 2. SAVING NEVER WAITS FOR A PHOTO. A photo takes ten to thirty seconds, so the item is saved at
//    once and marked "pending"; a background worker makes the photo and puts it on the item. The
//    queue lives in the Products table itself, so a restart picks up where it left off.
//
// 3. PHOTOS ARE FILES THIS SERVER SERVES (/media/...), kept outside the database and outside the
//    install folder. A host fetches the cloud's photos for head office's items onto its own disk,
//    so the till still shows them with the internet down.
// ============================================================

/// <summary>Where an item is in getting its AI photo. Null: nothing to do.</summary>
public static class ProductPhotoStatus
{
    public const string Pending = "pending";
    public const string Making = "making";
    public const string Failed = "failed";
}

/// <summary>Where an item's photo came from. Null: none, or a link typed in.</summary>
public static class ProductPhotoSource
{
    public const string Ai = "ai";
    public const string Upload = "upload";
}

/// <summary>What a photo is made from.</summary>
public sealed record PhotoRequest(
    string Name, string? Category, string? Description,
    string? GenericName = null, string? Strength = null, string? DosageForm = null)
{
    public static PhotoRequest From(Product p) =>
        new(p.Name, p.Category?.Name, p.Description, p.GenericName, p.Strength, p.DosageForm);
}

public enum AiPhotoProblem
{
    None,
    /// <summary>AI photos are switched off, or no key is set.</summary>
    NotSetUp,
    /// <summary>OpenAI refused the key, the model or the account (not verified, no billing).</summary>
    Account,
    /// <summary>OpenAI would not draw this one (its safety filter). Trying again will not help.</summary>
    Blocked,
    /// <summary>Too many at once: wait and try again.</summary>
    Busy,
    /// <summary>A timeout, a network fault or an error on OpenAI's side: try again later.</summary>
    Failed
}

public sealed record AiPhotoOutcome(byte[]? Image, AiPhotoProblem Problem, string? Message, TimeSpan? RetryAfter = null)
{
    public static AiPhotoOutcome Made(byte[] image) => new(image, AiPhotoProblem.None, null);
    public static AiPhotoOutcome Fail(AiPhotoProblem problem, string message, TimeSpan? retryAfter = null) =>
        new(null, problem, message, retryAfter);

    /// <summary>A problem with the set-up rather than with this item: stop and wait for it to be fixed.</summary>
    public bool StopsTheQueue => Problem is AiPhotoProblem.NotSetUp or AiPhotoProblem.Account;
}

/// <summary>Recognises the image files a photo may be: JPEG, PNG and WebP only (never SVG, which can carry script).</summary>
public static class ImageBytes
{
    public static string? Extension(ReadOnlySpan<byte> b)
    {
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "jpg";
        if (b.Length >= 8 && b[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return "png";
        if (b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8)) return "webp";
        return null;
    }
}

// --- Files --------------------------------------------------------------------

/// <summary>
/// The folder photos are kept in, served at /media. Media:Path (or MEDIA_PATH) when set; otherwise
/// ProgramData\Cashly\media on Windows, so a reinstall or an update of the program folder never takes
/// the photos with it, and media/ beside the app elsewhere (a Docker volume).
/// </summary>
public sealed class MediaStore
{
    public const string UrlPrefix = "/media/";
    private static readonly Regex Segment = new("^[a-z0-9-]{1,64}(\\.(jpg|png|webp))?$", RegexOptions.Compiled);

    public string Root { get; }

    public MediaStore(IConfiguration config, IHostEnvironment env)
    {
        var configured = config["Media:Path"] ?? Environment.GetEnvironmentVariable("MEDIA_PATH");
        Root = Path.GetFullPath(!string.IsNullOrWhiteSpace(configured) ? configured
            : OperatingSystem.IsWindows()
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Cashly", "media")
                : Path.Combine(env.ContentRootPath, "media"));
    }

    public static bool IsOurs(string? url) => url != null && url.StartsWith(UrlPrefix, StringComparison.Ordinal);

    /// <summary>The file behind one of our URLs; null for anything else, including any attempt to climb out of the folder.</summary>
    public string? LocalPath(string? url)
    {
        if (!IsOurs(url)) return null;
        var parts = url![UrlPrefix.Length..].Split('/');
        if (parts.Length is < 1 or > 4 || parts.Any(p => !Segment.IsMatch(p))) return null;
        var path = Path.GetFullPath(Path.Combine(new[] { Root }.Concat(parts).ToArray()));
        return path.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? path : null;
    }

    public bool Exists(string? url) => LocalPath(url) is { } path && File.Exists(path);

    /// <summary>Keeps a new photo for an item under a name of its own, so a browser never shows an old one from its cache.</summary>
    public async Task<string> SaveProductPhotoAsync(Guid tenantId, Guid productId, byte[] image, CancellationToken ct = default)
    {
        var ext = ImageBytes.Extension(image) ?? throw new InvalidDataException("Not a JPEG, PNG or WebP image.");
        var token = Convert.ToHexString(Guid.NewGuid().ToByteArray().AsSpan(0, 4)).ToLowerInvariant();
        var url = $"{UrlPrefix}products/{tenantId:N}/{productId:N}-{token}.{ext}";
        await SaveAtAsync(url, image, ct);
        return url;
    }

    /// <summary>Writes a file at one of our URLs (a host keeping its copy of a cloud photo). Written aside, then moved, so a half-written photo is never served.</summary>
    public async Task SaveAtAsync(string url, byte[] image, CancellationToken ct = default)
    {
        var path = LocalPath(url) ?? throw new ArgumentException("Not a media address.", nameof(url));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".part";
        await File.WriteAllBytesAsync(temp, image, ct);
        File.Move(temp, path, overwrite: true);
    }

    /// <summary>Removes a photo this server keeps. A link to somewhere else is left alone.</summary>
    public void DeleteIfOurs(string? url)
    {
        if (LocalPath(url) is not { } path) return;
        try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

// --- The words the photo is made from ---------------------------------------------

public static class PhotoPrompt
{
    private static string Clean(string? text, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var flat = Regex.Replace(text, "[\\r\\n\\t\"]+", " ").Trim();
        return flat.Length <= max ? flat : flat[..max].TrimEnd();
    }

    /// <summary>
    /// The prompt for one item, by the kind of business (its primary vertical pack). Packaged goods are
    /// asked for in plain, unbranded packaging: AI draws real brands' labels wrong, and a made-up label
    /// on a medicine could be taken for the real thing.
    /// </summary>
    public static string For(string? packKey, PhotoRequest r)
    {
        var name = Clean(r.Name, 120);
        var category = Clean(r.Category, 60);
        var description = Clean(r.Description, 300);
        var about = (category.Length > 0 ? $" (category: {category})" : "") + (description.Length > 0 ? $". About it: {description}" : "");

        switch (packKey)
        {
            case VerticalPacks.Pharmacy:
            {
                var medicine = string.Join(" ", new[] { Clean(r.GenericName, 60), Clean(r.Strength, 30) }.Where(s => s.Length > 0));
                var form = Clean(r.DosageForm, 30);
                return $"A realistic product photo of a medicine: \"{name}\"" +
                       (medicine.Length > 0 ? $", {medicine}" : "") + (form.Length > 0 ? $", {form.ToLowerInvariant()}" : "") + ". " +
                       "Show plain, generic, unbranded pharmacy packaging that suits it: a white carton with a blister strip beside it for tablets or capsules, " +
                       "an amber bottle for a syrup or suspension, a small dropper bottle for drops, a tube for a cream, a vial for an injection. " +
                       "Centred on a plain white background, soft even studio light, a gentle shadow. " +
                       "No brand names, no logos, no readable text, no loose pills, no people, no hands, no watermark.";
            }
            case VerticalPacks.Retail or VerticalPacks.Grocery or VerticalPacks.Wholesale or VerticalPacks.Apparel:
                return $"A realistic e-commerce product photo of \"{name}\"{about}. " +
                       "One product only, centred and filling most of the frame, on a plain light grey studio background, bright even light, a soft shadow. " +
                       "It must look like a real photograph, not an illustration. " +
                       "If it comes in a package, show plain generic packaging in colours that suit it, with no brand names, no logos and no readable text. " +
                       "No people, no hands, no watermark.";
            case VerticalPacks.Salon or VerticalPacks.Services:
                return $"A bright, realistic photo that represents the service \"{name}\"{about} at a clean, modern salon or studio. " +
                       "Show the setting, the tools or the finished result, not a person's face. " +
                       "Soft natural light, calm and professional. No text, no logos, no watermark.";
            default:
                return $"A realistic, appetising, professional food photograph of \"{name}\"{about}. " +
                       "Served the way a good restaurant in Pakistan would serve it, on a plate, bowl, glass or tray that suits it, on a restaurant table. " +
                       "Seen from a 45-degree angle, the food in sharp focus and filling most of the frame, shallow depth of field, soft natural light from the side. " +
                       "It must look like a real photograph taken with a good camera, not an illustration. " +
                       "No text, no words, no logos, no menu card, no people, no hands, no watermark.";
        }
    }
}

// --- Making a photo ----------------------------------------------------------------

/// <summary>Anything that can make a photo for an item: OpenAI directly (the cloud), or the cloud (a business host).</summary>
public interface IAiPhotoSource
{
    /// <summary>Whether photos can be made here at all; an item is only queued when they can.</summary>
    Task<bool> AvailableAsync(CancellationToken ct = default);
    Task<AiPhotoOutcome> MakeAsync(Guid tenantId, PhotoRequest request, CancellationToken ct = default);
}

/// <summary>Makes photos with Cashly's own OpenAI account. Used by the cloud, and by any server not linked to one.</summary>
public sealed class OpenAiPhotoMaker
{
    public const string DefaultModel = "gpt-image-2";
    public static readonly string[] Models = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"];
    public static readonly string[] Qualities = ["low", "medium", "high"];

    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;
    private readonly SecretProtector _protector;
    private readonly IEntitlementService _entitlements;
    private readonly ILogger<OpenAiPhotoMaker> _log;

    public OpenAiPhotoMaker(AppDbContext db, IHttpClientFactory http, IConfiguration config, SecretProtector protector,
        IEntitlementService entitlements, ILogger<OpenAiPhotoMaker> log)
    {
        _db = db; _http = http; _config = config; _protector = protector; _entitlements = entitlements; _log = log;
    }

    /// <summary>The key set on this server (OpenAI:ApiKey / OPENAI_API_KEY), which the one in Platform Settings overrides.</summary>
    public string? ServerKey => _config["OpenAI:ApiKey"] ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY");

    public async Task<(bool Enabled, string? Key, string Model, string Quality)> SettingsAsync()
    {
        var s = await PlatformInvoicing.SettingsAsync(_db);
        var key = _protector.Unprotect(s.OpenAiApiKey) ?? ServerKey;
        return (s.AiPhotosEnabled, string.IsNullOrWhiteSpace(key) ? null : key.Trim(),
            Models.Contains(s.AiPhotoModel) ? s.AiPhotoModel! : DefaultModel,
            Qualities.Contains(s.AiPhotoQuality) ? s.AiPhotoQuality! : "medium");
    }

    public async Task<bool> AvailableAsync()
    {
        var (enabled, key, _, _) = await SettingsAsync();
        return enabled && key != null;
    }

    private async Task<string?> PackOfAsync(Guid tenantId)
    {
        if (tenantId == Guid.Empty) return null;
        try { return (await _entitlements.GetAsync(tenantId)).PrimaryPackKey; }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "AI photos: no vertical pack for tenant {TenantId}; using the food prompt", tenantId);
            return null;
        }
    }

    /// <summary>One photo for an item of this business. <paramref name="packKey"/> overrides the business's own kind (the platform's test).</summary>
    public async Task<AiPhotoOutcome> MakeAsync(Guid tenantId, PhotoRequest request, CancellationToken ct = default, string? packKey = null)
    {
        var (enabled, key, model, quality) = await SettingsAsync();
        if (!enabled) return AiPhotoOutcome.Fail(AiPhotoProblem.NotSetUp, "AI photos are switched off in Platform → Settings.");
        if (key == null) return AiPhotoOutcome.Fail(AiPhotoProblem.NotSetUp, "No OpenAI key is set in Platform → Settings.");

        var prompt = PhotoPrompt.For(packKey ?? await PackOfAsync(tenantId), request);
        try
        {
            var client = _http.CreateClient("openai");
            // A high-quality photo can take a minute; a slow answer is still worth having.
            client.Timeout = TimeSpan.FromSeconds(180);
            using var message = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/images/generations")
            {
                Content = JsonContent.Create(new
                {
                    model, prompt, n = 1, size = "1024x1024", quality,
                    output_format = "jpeg", output_compression = 85
                })
            };
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);

            using var response = await client.SendAsync(message, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode) return Refused(response, body);

            using var json = JsonDocument.Parse(body);
            var first = json.RootElement.GetProperty("data")[0];
            if (first.TryGetProperty("b64_json", out var b64) && b64.GetString() is { Length: > 0 } data)
                return Checked(Convert.FromBase64String(data));
            // Older models answer with a link instead.
            if (first.TryGetProperty("url", out var link) && link.GetString() is { Length: > 0 } url)
                return Checked(await client.GetByteArrayAsync(url, ct));
            return AiPhotoOutcome.Fail(AiPhotoProblem.Failed, "OpenAI answered without a photo.");
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return AiPhotoOutcome.Fail(AiPhotoProblem.Failed, "OpenAI took too long to answer.");
        }
        catch (HttpRequestException ex)
        {
            return AiPhotoOutcome.Fail(AiPhotoProblem.Failed, $"Could not reach OpenAI: {ex.Message}");
        }
        catch (Exception ex) when (ex is JsonException or FormatException or KeyNotFoundException or IndexOutOfRangeException or InvalidOperationException)
        {
            return AiPhotoOutcome.Fail(AiPhotoProblem.Failed, "OpenAI's answer could not be read.");
        }
    }

    private static AiPhotoOutcome Checked(byte[] image) =>
        ImageBytes.Extension(image) != null ? AiPhotoOutcome.Made(image)
            : AiPhotoOutcome.Fail(AiPhotoProblem.Failed, "OpenAI sent something that is not a photo.");

    /// <summary>OpenAI's refusal, sorted into what to do about it.</summary>
    private static AiPhotoOutcome Refused(HttpResponseMessage response, string body)
    {
        string? text = null, code = null;
        try
        {
            using var json = JsonDocument.Parse(body);
            if (json.RootElement.TryGetProperty("error", out var error))
            {
                text = error.TryGetProperty("message", out var m) ? m.GetString() : null;
                code = error.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
            }
        }
        catch (JsonException) { }
        var said = string.IsNullOrWhiteSpace(text) ? $"OpenAI answered {(int)response.StatusCode}." : $"OpenAI: {text}";

        return (int)response.StatusCode switch
        {
            401 => AiPhotoOutcome.Fail(AiPhotoProblem.Account, "OpenAI did not accept the key. Check it in Platform → Settings."),
            429 when code == "insufficient_quota" =>
                AiPhotoOutcome.Fail(AiPhotoProblem.Account, "The OpenAI account has no credit left. Add credit at platform.openai.com → Billing."),
            429 => AiPhotoOutcome.Fail(AiPhotoProblem.Busy, said, response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(60)),
            400 when code is "moderation_blocked" or "content_policy_violation" =>
                AiPhotoOutcome.Fail(AiPhotoProblem.Blocked, "OpenAI would not draw this item. Upload your own photo instead."),
            >= 500 => AiPhotoOutcome.Fail(AiPhotoProblem.Failed, said),
            // 400, 403 (the organisation must be verified), 404 (no such model): the set-up, not this item.
            _ => AiPhotoOutcome.Fail(AiPhotoProblem.Account, said)
        };
    }
}

/// <summary>The source on a server with no cloud link: makes photos itself.</summary>
public sealed class LocalAiPhotoSource : IAiPhotoSource
{
    private readonly OpenAiPhotoMaker _maker;
    public LocalAiPhotoSource(OpenAiPhotoMaker maker) => _maker = maker;
    public Task<bool> AvailableAsync(CancellationToken ct = default) => _maker.AvailableAsync();
    public Task<AiPhotoOutcome> MakeAsync(Guid tenantId, PhotoRequest request, CancellationToken ct = default) =>
        _maker.MakeAsync(tenantId, request, ct);
}

/// <summary>The source on a business host linked to the cloud: asks the cloud, which holds the key.</summary>
public sealed class CloudAiPhotoSource : IAiPhotoSource
{
    private readonly IHttpClientFactory _http;
    private readonly HostLink _link;

    public CloudAiPhotoSource(IHttpClientFactory http, HostLink link) { _http = http; _link = link; }

    // Whether the cloud has AI photos on is the cloud's to say; it answers when asked for one.
    public Task<bool> AvailableAsync(CancellationToken ct = default) => Task.FromResult(true);

    public async Task<AiPhotoOutcome> MakeAsync(Guid tenantId, PhotoRequest request, CancellationToken ct = default)
    {
        try
        {
            var client = _http.CreateClient("cloud-sync");
            client.Timeout = TimeSpan.FromSeconds(200);
            using var message = new HttpRequestMessage(HttpMethod.Post,
                $"{_link.CloudUrl!.TrimEnd('/')}/api/sync/ai-photo?businessId={Uri.EscapeDataString(_link.BusinessId ?? "")}&tenantId={tenantId}")
            {
                Content = JsonContent.Create(request)
            };
            if (!string.IsNullOrWhiteSpace(_link.SyncKey)) message.Headers.Add(SyncKeys.HeaderName, _link.SyncKey);

            using var response = await client.SendAsync(message, ct);
            if (response.IsSuccessStatusCode)
            {
                var image = await response.Content.ReadAsByteArrayAsync(ct);
                return ImageBytes.Extension(image) != null ? AiPhotoOutcome.Made(image)
                    : AiPhotoOutcome.Fail(AiPhotoProblem.Failed, "The Cashly server sent something that is not a photo.");
            }

            var body = await response.Content.ReadAsStringAsync(ct);
            string? text = null;
            try { using var json = JsonDocument.Parse(body); text = json.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null; }
            catch (JsonException) { }
            text ??= $"The Cashly server answered {(int)response.StatusCode}.";

            return response.StatusCode switch
            {
                HttpStatusCode.ServiceUnavailable or HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound =>
                    AiPhotoOutcome.Fail(AiPhotoProblem.Account, text),
                HttpStatusCode.UnprocessableEntity => AiPhotoOutcome.Fail(AiPhotoProblem.Blocked, text),
                HttpStatusCode.TooManyRequests => AiPhotoOutcome.Fail(AiPhotoProblem.Busy, text, response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(60)),
                _ => AiPhotoOutcome.Fail(AiPhotoProblem.Failed, text)
            };
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return AiPhotoOutcome.Fail(AiPhotoProblem.Failed, "The Cashly server took too long to answer.");
        }
        catch (HttpRequestException ex)
        {
            return AiPhotoOutcome.Fail(AiPhotoProblem.Failed, $"Could not reach the Cashly server: {ex.Message}");
        }
    }
}

/// <summary>This server's link to the cloud, when it is a business host that has one.</summary>
public sealed class HostLink
{
    public string? CloudUrl { get; }
    public string? BusinessId { get; }
    public string? SyncKey { get; }
    public bool Linked => !string.IsNullOrWhiteSpace(CloudUrl);

    public HostLink(IConfiguration config)
    {
        CloudUrl = config["Host:CloudUrl"] ?? Environment.GetEnvironmentVariable("CLOUD_URL");
        BusinessId = config["Host:BusinessId"] ?? Environment.GetEnvironmentVariable("BUSINESS_ID");
        SyncKey = config["Host:SyncKey"] ?? Environment.GetEnvironmentVariable("SYNC_KEY");
    }
}

// --- The queue ---------------------------------------------------------------------

/// <summary>
/// Wakes the worker when an item is queued, and holds what the platform should know: the problem
/// that stopped the queue (a wrong key, no credit), and until when it waits before trying again.
/// </summary>
public sealed class ProductPhotoQueue
{
    private readonly SemaphoreSlim _signal = new(0, 1);
    private readonly object _gate = new();
    private DateTime _pausedUntil = DateTime.MinValue;

    public string? Problem { get; private set; }
    public DateTime? ProblemAt { get; private set; }
    public DateTime PausedUntil { get { lock (_gate) return _pausedUntil; } }

    public void Nudge()
    {
        try { _signal.Release(); } catch (SemaphoreFullException) { }
    }

    /// <summary>Settings changed: try again now rather than at the end of the pause.</summary>
    public void Resume()
    {
        lock (_gate) { _pausedUntil = DateTime.MinValue; Problem = null; ProblemAt = null; }
        Nudge();
    }

    public void Pause(TimeSpan wait, string? problem)
    {
        lock (_gate)
        {
            _pausedUntil = DateTime.UtcNow + wait;
            if (problem != null) { Problem = problem; ProblemAt = DateTime.UtcNow; }
        }
    }

    public void Worked()
    {
        lock (_gate) { Problem = null; ProblemAt = null; }
    }

    public Task<bool> WaitAsync(TimeSpan timeout, CancellationToken ct) => _signal.WaitAsync(timeout, ct);
}

/// <summary>Queues items for a photo. Used when an item is saved, and by "make a new photo" / "photos for all".</summary>
public static class ProductPhotos
{
    /// <summary>Marks an item to get an AI photo; the caller saves.</summary>
    public static void Queue(Product product)
    {
        product.PhotoStatus = ProductPhotoStatus.Pending;
        product.PhotoAttempts = 0;
        product.PhotoNextTryAt = null;
        product.PhotoError = null;
    }

    /// <summary>The item's photo is now this one (or none): anything queued for it is called off.</summary>
    public static void Settle(Product product, string? imageUrl, string? source)
    {
        product.ImageUrl = imageUrl;
        product.PhotoSource = source;
        product.PhotoStatus = null;
        product.PhotoAttempts = 0;
        product.PhotoNextTryAt = null;
        product.PhotoError = null;
    }

    /// <summary>How long a photo that failed for a passing reason waits before its next try; null when it has had enough tries.</summary>
    public static TimeSpan? Backoff(int attempts) => attempts switch
    {
        1 => TimeSpan.FromMinutes(1),
        2 => TimeSpan.FromMinutes(5),
        3 => TimeSpan.FromMinutes(15),
        4 => TimeSpan.FromHours(1),
        5 => TimeSpan.FromHours(3),
        _ => null
    };
}

/// <summary>
/// Makes the queued photos, a few at a time, and on a business host keeps its own copy of the cloud's
/// photos. Every failure ends in "log it, try later" — nothing here can stop a shop selling.
/// </summary>
public sealed class ProductPhotoWorker : BackgroundService
{
    /// <summary>Photos made at once. OpenAI limits images per minute on new accounts; three is well inside.</summary>
    private const int AtOnce = 3;
    private static readonly TimeSpan SetUpWait = TimeSpan.FromMinutes(10);

    private readonly IServiceScopeFactory _scopes;
    private readonly ProductPhotoQueue _queue;
    private readonly MediaStore _media;
    private readonly HostLink _link;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ProductPhotoWorker> _log;

    public ProductPhotoWorker(IServiceScopeFactory scopes, ProductPhotoQueue queue, MediaStore media, HostLink link,
        IHttpClientFactory http, ILogger<ProductPhotoWorker> log)
    {
        _scopes = scopes; _queue = queue; _media = media; _link = link; _http = http; _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        // Let the startup schema steps add the photo columns before the first look at them.
        try { await Task.Delay(TimeSpan.FromSeconds(20), stop); }
        catch (OperationCanceledException) { return; }

        await ResetInterruptedAsync(stop);
        var nextMirror = DateTime.MinValue;

        while (!stop.IsCancellationRequested)
        {
            var more = false;
            try
            {
                if (_link.Linked && DateTime.UtcNow >= nextMirror)
                {
                    await MirrorCloudPhotosAsync(stop);
                    nextMirror = DateTime.UtcNow.AddMinutes(5);
                }
                if (DateTime.UtcNow >= _queue.PausedUntil) more = await MakeDueAsync(stop);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _log.LogError(ex, "AI photos: a run failed; trying again shortly.");
            }

            if (more) continue;
            try { await _queue.WaitAsync(TimeSpan.FromSeconds(15), stop); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>Photos the server was making when it stopped go back in the queue.</summary>
    private async Task ResetInterruptedAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Products.IgnoreQueryFilters()
                .Where(p => p.PhotoStatus == ProductPhotoStatus.Making)
                .ExecuteUpdateAsync(u => u.SetProperty(p => p.PhotoStatus, ProductPhotoStatus.Pending), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "AI photos: could not put interrupted photos back in the queue.");
        }
    }

    /// <summary>Makes the next few photos due; true when there may be more waiting. (Public for the tests.)</summary>
    public async Task<bool> MakeDueAsync(CancellationToken ct)
    {
        List<Guid> due;
        using (var scope = _scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var now = DateTime.UtcNow;
            due = await db.Products.IgnoreQueryFilters().AsNoTracking()
                .Where(p => p.PhotoStatus == ProductPhotoStatus.Pending && (p.PhotoNextTryAt == null || p.PhotoNextTryAt <= now))
                .OrderBy(p => p.PhotoNextTryAt).ThenBy(p => p.Id)
                .Select(p => p.Id)
                .Take(AtOnce)
                .ToListAsync(ct);
            if (due.Count == 0) return false;

            var source = scope.ServiceProvider.GetRequiredService<IAiPhotoSource>();
            if (!await source.AvailableAsync(ct))
            {
                _queue.Pause(TimeSpan.FromMinutes(1), "AI photos are switched off, or no OpenAI key is set (Platform → Settings).");
                return false;
            }
        }

        var outcomes = await Task.WhenAll(due.Select(id => MakeOneAsync(id, ct)));
        var stopping = outcomes.FirstOrDefault(o => o is { StopsTheQueue: true });
        if (stopping != null)
        {
            _log.LogWarning("AI photos: stopped until the set-up is fixed — {Problem}", stopping.Message);
            _queue.Pause(SetUpWait, stopping.Message);
            return false;
        }
        var busy = outcomes.FirstOrDefault(o => o?.Problem == AiPhotoProblem.Busy);
        if (busy != null)
        {
            _queue.Pause(busy.RetryAfter ?? TimeSpan.FromSeconds(60), null);
            return false;
        }
        if (outcomes.Any(o => o?.Problem == AiPhotoProblem.None)) _queue.Worked();
        return due.Count == AtOnce;
    }

    /// <summary>One item's photo. Null when the item no longer wants one.</summary>
    private async Task<AiPhotoOutcome?> MakeOneAsync(Guid productId, CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var source = scope.ServiceProvider.GetRequiredService<IAiPhotoSource>();

        var product = await db.Products.IgnoreQueryFilters().Include(p => p.Category)
            .FirstOrDefaultAsync(p => p.Id == productId, ct);
        if (product == null || product.PhotoStatus != ProductPhotoStatus.Pending) return null;
        product.PhotoStatus = ProductPhotoStatus.Making;
        await db.SaveChangesAsync(ct);

        var outcome = await source.MakeAsync(product.TenantId, PhotoRequest.From(product), ct);

        // The owner may have uploaded a photo, removed it, or deleted the item while this one was made:
        // read it again, fresh (a tracked copy would only give back what was read before).
        db.ChangeTracker.Clear();
        var current = await db.Products.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == productId, ct);
        if (current == null || current.PhotoStatus != ProductPhotoStatus.Making) return outcome;
        product = current;

        if (outcome.Image != null)
        {
            var old = product.ImageUrl;
            var url = await _media.SaveProductPhotoAsync(product.TenantId, product.Id, outcome.Image, ct);
            ProductPhotos.Settle(product, url, ProductPhotoSource.Ai);
            await db.SaveChangesAsync(ct);
            if (old != url) _media.DeleteIfOurs(old);
            _log.LogInformation("AI photos: made the photo for {Product}", product.Name);
            return outcome;
        }

        switch (outcome.Problem)
        {
            case AiPhotoProblem.Blocked:
                product.PhotoStatus = ProductPhotoStatus.Failed;
                product.PhotoError = outcome.Message;
                break;
            case AiPhotoProblem.Failed:
                product.PhotoAttempts += 1;
                var wait = ProductPhotos.Backoff(product.PhotoAttempts);
                product.PhotoStatus = wait == null ? ProductPhotoStatus.Failed : ProductPhotoStatus.Pending;
                product.PhotoNextTryAt = wait == null ? null : DateTime.UtcNow + wait;
                product.PhotoError = outcome.Message;
                break;
            default:
                // The set-up, or too many at once: not this item's fault, so no try is counted.
                product.PhotoStatus = ProductPhotoStatus.Pending;
                product.PhotoError = outcome.Message;
                break;
        }
        await db.SaveChangesAsync(ct);
        return outcome;
    }

    /// <summary>
    /// A business host's own copies of the photos on head office's items, fetched from the cloud, so
    /// the till shows them with no internet. A few at a time; whatever is missed is fetched next time.
    /// </summary>
    private async Task MirrorCloudPhotosAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var urls = await db.Products.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.ImageUrl != null && p.ImageUrl.StartsWith(MediaStore.UrlPrefix))
            .Select(p => p.ImageUrl!)
            .Distinct()
            .ToListAsync(ct);

        var client = _http.CreateClient("cloud-sync");
        client.Timeout = TimeSpan.FromSeconds(60);
        var fetched = 0;
        foreach (var url in urls.Where(u => _media.LocalPath(u) != null && !_media.Exists(u)).Take(50))
        {
            try
            {
                var image = await client.GetByteArrayAsync($"{_link.CloudUrl!.TrimEnd('/')}{url}", ct);
                if (ImageBytes.Extension(image) == null) continue;
                await _media.SaveAtAsync(url, image, ct);
                fetched++;
            }
            catch (HttpRequestException ex)
            {
                _log.LogDebug("AI photos: could not fetch {Url} from the cloud: {Error}", url, ex.Message);
            }
        }
        if (fetched > 0) _log.LogInformation("AI photos: kept {Count} photo(s) from head office on this computer", fetched);
    }
}
