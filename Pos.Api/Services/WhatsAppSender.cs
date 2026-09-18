using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Pos.Api.Models;

namespace Pos.Api.Services;

public record WhatsAppSendResult(bool Success, string? ProviderMessageId, string? ErrorMessage);

public interface IWhatsAppSender
{
    /// Matches WhatsAppConfig.Provider ("Manual", "Twilio", "MetaAPI", "Whaticket").
    string ProviderName { get; }
    Task<WhatsAppSendResult> SendAsync(WhatsAppConfig config, string toPhone, string message, CancellationToken ct = default);
}

public interface IWhatsAppSenderResolver
{
    IWhatsAppSender? Resolve(string providerName);
}

public class WhatsAppSenderResolver : IWhatsAppSenderResolver
{
    private readonly Dictionary<string, IWhatsAppSender> _byName;

    public WhatsAppSenderResolver(IEnumerable<IWhatsAppSender> senders)
    {
        _byName = senders.ToDictionary(s => s.ProviderName, StringComparer.OrdinalIgnoreCase);
    }

    public IWhatsAppSender? Resolve(string providerName)
        => string.IsNullOrWhiteSpace(providerName) ? null
           : _byName.TryGetValue(providerName.Trim(), out var s) ? s : null;
}

/// "Manual" is a deliberate no-API mode — the restaurant messages customers by hand from their own
/// phone. It is not a misconfiguration, so it reports a clear, non-alarming reason rather than an error.
public class ManualWhatsAppSender : IWhatsAppSender
{
    public string ProviderName => "Manual";

    public Task<WhatsAppSendResult> SendAsync(WhatsAppConfig config, string toPhone, string message, CancellationToken ct = default)
        => Task.FromResult(new WhatsAppSendResult(false, null,
            "Manual mode — no messaging API is connected. Send this update to the customer yourself."));
}

// Built to Twilio's publicly documented Messages API; not verified against a live account — confirm
// against current Twilio docs before enabling in production.
//
// Auth: HTTP Basic with Account SID as username, Auth Token as password. Endpoint:
// POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json, form-encoded
// From/To/Body, where both numbers carry the "whatsapp:" prefix Twilio's WhatsApp channel requires.
//
// Field mapping onto the existing WhatsAppConfig columns (no schema change needed):
//   ApiKey = Account SID, ApiSecret = Auth Token, PhoneNumberId = the Twilio WhatsApp-enabled number.
public class TwilioWhatsAppSender : IWhatsAppSender
{
    private readonly IHttpClientFactory _httpFactory;

    public TwilioWhatsAppSender(IHttpClientFactory httpFactory) => _httpFactory = httpFactory;

    public string ProviderName => "Twilio";

    public async Task<WhatsAppSendResult> SendAsync(WhatsAppConfig config, string toPhone, string message, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(config.ApiKey) || string.IsNullOrWhiteSpace(config.ApiSecret) || string.IsNullOrWhiteSpace(config.PhoneNumberId))
        {
            return new WhatsAppSendResult(false, null,
                "Twilio is not fully configured — Account SID, Auth Token, and the WhatsApp-enabled From number are all required.");
        }

        try
        {
            var client = _httpFactory.CreateClient();
            var authBytes = Encoding.UTF8.GetBytes($"{config.ApiKey}:{config.ApiSecret}");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(authBytes));

            var url = $"https://api.twilio.com/2010-04-01/Accounts/{Uri.EscapeDataString(config.ApiKey)}/Messages.json";
            var form = new Dictionary<string, string>
            {
                ["From"] = WithWhatsAppPrefix(config.PhoneNumberId),
                ["To"] = WithWhatsAppPrefix(toPhone),
                ["Body"] = message
            };

            using var response = await client.PostAsync(url, new FormUrlEncodedContent(form), ct);
            var body = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
                return new WhatsAppSendResult(false, null, ExtractError(body) ?? $"Twilio returned HTTP {(int)response.StatusCode}.");

            using var doc = JsonDocument.Parse(body);
            var sid = doc.RootElement.TryGetProperty("sid", out var sidEl) ? sidEl.GetString() : null;
            return new WhatsAppSendResult(true, sid, null);
        }
        catch (Exception ex)
        {
            return new WhatsAppSendResult(false, null, $"Failed to reach Twilio: {ex.Message}");
        }
    }

    private static string WithWhatsAppPrefix(string number)
    {
        var trimmed = number.Trim();
        return trimmed.StartsWith("whatsapp:", StringComparison.OrdinalIgnoreCase) ? trimmed : $"whatsapp:{trimmed}";
    }

    private static string? ExtractError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
        }
        catch (JsonException) { return null; }
    }
}

// Built to Meta's publicly documented WhatsApp Cloud API; not verified against a live account —
// confirm against current Meta docs before enabling in production.
//
// Auth: Bearer token. Endpoint: POST https://graph.facebook.com/v20.0/{PhoneNumberId}/messages,
// JSON body of shape { messaging_product: "whatsapp", to, type: "text", text: { body } }.
//
// Field mapping onto the existing WhatsAppConfig columns: PhoneNumberId = Meta's numeric phone
// number ID (not the phone number itself), AccessToken = the long-lived system-user access token.
public class MetaWhatsAppSender : IWhatsAppSender
{
    private readonly IHttpClientFactory _httpFactory;

    public MetaWhatsAppSender(IHttpClientFactory httpFactory) => _httpFactory = httpFactory;

    public string ProviderName => "MetaAPI";

    public async Task<WhatsAppSendResult> SendAsync(WhatsAppConfig config, string toPhone, string message, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(config.PhoneNumberId) || string.IsNullOrWhiteSpace(config.AccessToken))
        {
            return new WhatsAppSendResult(false, null,
                "Meta Cloud API is not fully configured — the Phone Number ID and a valid Access Token are both required.");
        }

        try
        {
            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.AccessToken);

            var url = $"https://graph.facebook.com/v20.0/{Uri.EscapeDataString(config.PhoneNumberId)}/messages";
            var payload = new
            {
                messaging_product = "whatsapp",
                to = NormalizeDigits(toPhone),
                type = "text",
                text = new { body = message }
            };
            var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

            using var response = await client.PostAsync(url, content, ct);
            var body = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
                return new WhatsAppSendResult(false, null, ExtractError(body) ?? $"Meta returned HTTP {(int)response.StatusCode}.");

            using var doc = JsonDocument.Parse(body);
            string? id = null;
            if (doc.RootElement.TryGetProperty("messages", out var msgs) && msgs.ValueKind == JsonValueKind.Array && msgs.GetArrayLength() > 0)
                id = msgs[0].TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            return new WhatsAppSendResult(true, id, null);
        }
        catch (Exception ex)
        {
            return new WhatsAppSendResult(false, null, $"Failed to reach Meta WhatsApp Cloud API: {ex.Message}");
        }
    }

    private static string NormalizeDigits(string phone) => new(phone.Where(char.IsDigit).ToArray());

    private static string? ExtractError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("error", out var err) && err.TryGetProperty("message", out var m)
                ? m.GetString() : null;
        }
        catch (JsonException) { return null; }
    }
}

// Whaticket is a self-hosted gateway with an API shape that varies by deployment/version — this is a
// best-effort call to its commonly documented send-message endpoint, NOT verified against a live
// instance. Confirm the exact path/payload against the specific Whaticket deployment before relying on it.
//
// Field mapping: WebhookUrl = the Whaticket instance's base URL, ApiKey = its API token,
// PhoneNumberId = the connected WhatsApp session/ticket identifier the instance expects.
public class WhaticketWhatsAppSender : IWhatsAppSender
{
    private readonly IHttpClientFactory _httpFactory;

    public WhaticketWhatsAppSender(IHttpClientFactory httpFactory) => _httpFactory = httpFactory;

    public string ProviderName => "Whaticket";

    public async Task<WhatsAppSendResult> SendAsync(WhatsAppConfig config, string toPhone, string message, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(config.WebhookUrl) || string.IsNullOrWhiteSpace(config.ApiKey))
        {
            return new WhatsAppSendResult(false, null,
                "Whaticket is not fully configured — the instance URL and API token are both required.");
        }

        try
        {
            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey);

            var baseUrl = config.WebhookUrl.TrimEnd('/');
            var payload = new { number = NormalizeDigits(toPhone), body = message, ticketId = config.PhoneNumberId };
            var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

            using var response = await client.PostAsync($"{baseUrl}/api/messages/send", content, ct);
            var body = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
                return new WhatsAppSendResult(false, null, $"Whaticket instance returned HTTP {(int)response.StatusCode}: {Truncate(body)}");

            return new WhatsAppSendResult(true, null, null);
        }
        catch (Exception ex)
        {
            return new WhatsAppSendResult(false, null, $"Failed to reach the Whaticket instance: {ex.Message}");
        }
    }

    private static string NormalizeDigits(string phone) => new(phone.Where(char.IsDigit).ToArray());
    private static string Truncate(string s) => s.Length > 200 ? s[..200] : s;
}
