using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace Pos.Api.Services;

// ============================================================
// MOBILE VERIFICATION CODES
//
// A 6-digit code sent to the owner's mobile when a business registers, so "one free trial per
// mobile number" means a number the person actually has. Configure ONE channel (or the env vars):
//
//   Otp:Channel                  "WhatsApp" or "Sms"                          (OTP_CHANNEL)
//
//   WhatsApp — Meta WhatsApp Cloud API. Needs an approved AUTHENTICATION template whose body
//   takes the code as {{1}} (Meta's standard one-time-password template does):
//   Otp:WhatsAppToken            system-user access token                     (OTP_WHATSAPP_TOKEN)
//   Otp:WhatsAppPhoneNumberId    the sending number's ID, not the number      (OTP_WHATSAPP_PHONE_NUMBER_ID)
//   Otp:WhatsAppTemplate         template name, default "verification_code"   (OTP_WHATSAPP_TEMPLATE)
//   Otp:WhatsAppLanguage         template language, default "en"              (OTP_WHATSAPP_LANGUAGE)
//   Otp:WhatsAppCopyCodeButton   "false" if the template has no copy-code button (OTP_WHATSAPP_COPY_BUTTON)
//
//   SMS — Twilio:
//   Otp:TwilioAccountSid                                                      (OTP_TWILIO_ACCOUNT_SID)
//   Otp:TwilioAuthToken                                                       (OTP_TWILIO_AUTH_TOKEN)
//   Otp:TwilioFrom               the sending number or sender ID              (OTP_TWILIO_FROM)
//
// With no channel configured, a development machine writes the code to the backend console so the
// whole flow can be tried; anywhere else codes are off, and registration checks only that the
// number has not been used before.
// ============================================================

public interface IMobileCodeSender
{
    /// <summary>Codes are on: registration asks for one.</summary>
    bool IsEnabled { get; }

    /// <summary>"WhatsApp", "SMS" or "Console" (development), for telling the person where to look.</summary>
    string Channel { get; }

    /// <summary>Sends the code. Mobile is digits with the country code (923001234567).</summary>
    Task<(bool Sent, string? Error)> SendAsync(string mobileDigits, string code, CancellationToken ct = default);
}

public class MobileCodeSender : IMobileCodeSender
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly string _channel;

    private readonly string? _waToken;
    private readonly string? _waPhoneNumberId;
    private readonly string _waTemplate;
    private readonly string _waLanguage;
    private readonly bool _waCopyButton;

    private readonly string? _twilioSid;
    private readonly string? _twilioToken;
    private readonly string? _twilioFrom;

    public MobileCodeSender(IConfiguration config, IHostEnvironment env, IHttpClientFactory httpFactory)
    {
        _httpFactory = httpFactory;
        string? Read(string key, string envName) =>
            config[key] is { Length: > 0 } v ? v : Environment.GetEnvironmentVariable(envName);

        _waToken = Read("Otp:WhatsAppToken", "OTP_WHATSAPP_TOKEN");
        _waPhoneNumberId = Read("Otp:WhatsAppPhoneNumberId", "OTP_WHATSAPP_PHONE_NUMBER_ID");
        _waTemplate = Read("Otp:WhatsAppTemplate", "OTP_WHATSAPP_TEMPLATE") ?? "verification_code";
        _waLanguage = Read("Otp:WhatsAppLanguage", "OTP_WHATSAPP_LANGUAGE") ?? "en";
        _waCopyButton = !string.Equals(Read("Otp:WhatsAppCopyCodeButton", "OTP_WHATSAPP_COPY_BUTTON"), "false", StringComparison.OrdinalIgnoreCase);

        _twilioSid = Read("Otp:TwilioAccountSid", "OTP_TWILIO_ACCOUNT_SID");
        _twilioToken = Read("Otp:TwilioAuthToken", "OTP_TWILIO_AUTH_TOKEN");
        _twilioFrom = Read("Otp:TwilioFrom", "OTP_TWILIO_FROM");

        var wanted = Read("Otp:Channel", "OTP_CHANNEL")?.Trim();
        var whatsAppReady = !string.IsNullOrWhiteSpace(_waToken) && !string.IsNullOrWhiteSpace(_waPhoneNumberId);
        var smsReady = !string.IsNullOrWhiteSpace(_twilioSid) && !string.IsNullOrWhiteSpace(_twilioToken) && !string.IsNullOrWhiteSpace(_twilioFrom);

        _channel = string.Equals(wanted, "WhatsApp", StringComparison.OrdinalIgnoreCase) && whatsAppReady ? "WhatsApp"
                 : string.Equals(wanted, "Sms", StringComparison.OrdinalIgnoreCase) && smsReady ? "SMS"
                 : env.IsDevelopment() ? "Console"
                 : "";
        if (!string.IsNullOrEmpty(wanted) && _channel is "" or "Console")
            Console.WriteLine($"[Mobile codes] Otp:Channel is \"{wanted}\" but its settings are incomplete, so codes are {(_channel == "Console" ? "written to this console" : "off")}.");
    }

    public bool IsEnabled => _channel.Length > 0;
    public string Channel => _channel;

    public async Task<(bool Sent, string? Error)> SendAsync(string mobileDigits, string code, CancellationToken ct = default)
    {
        try
        {
            return _channel switch
            {
                "WhatsApp" => await SendWhatsAppAsync(mobileDigits, code, ct),
                "SMS" => await SendSmsAsync(mobileDigits, code, ct),
                "Console" => WriteToConsole(mobileDigits, code),
                _ => (false, "Mobile codes are not set up on this server.")
            };
        }
        catch (Exception ex)
        {
            return (false, $"Could not reach the {_channel} service: {ex.Message}");
        }
    }

    private static (bool, string?) WriteToConsole(string mobileDigits, string code)
    {
        Console.WriteLine($"[Mobile code] +{mobileDigits}: {code}   (development only — set Otp:Channel to send it for real)");
        return (true, null);
    }

    private async Task<(bool, string?)> SendWhatsAppAsync(string mobileDigits, string code, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _waToken);

        var components = new List<object>
        {
            new { type = "body", parameters = new[] { new { type = "text", text = code } } }
        };
        // Meta's authentication templates carry a "copy code" button that takes the code too.
        if (_waCopyButton)
            components.Add(new { type = "button", sub_type = "url", index = "0", parameters = new[] { new { type = "text", text = code } } });

        var payload = new
        {
            messaging_product = "whatsapp",
            to = mobileDigits,
            type = "template",
            template = new { name = _waTemplate, language = new { code = _waLanguage }, components }
        };
        var url = $"https://graph.facebook.com/v20.0/{Uri.EscapeDataString(_waPhoneNumberId!)}/messages";
        using var response = await client.PostAsync(url, new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"), ct);
        if (response.IsSuccessStatusCode) return (true, null);

        var body = await response.Content.ReadAsStringAsync(ct);
        return (false, ErrorMessage(body, "error", "message") ?? $"WhatsApp returned HTTP {(int)response.StatusCode}.");
    }

    private async Task<(bool, string?)> SendSmsAsync(string mobileDigits, string code, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.ASCII.GetBytes($"{_twilioSid}:{_twilioToken}")));

        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["To"] = "+" + mobileDigits,
            ["From"] = _twilioFrom!,
            ["Body"] = $"Your Cashly POS code is {code}. It works for 10 minutes. Do not share it with anyone."
        });
        var url = $"https://api.twilio.com/2010-04-01/Accounts/{Uri.EscapeDataString(_twilioSid!)}/Messages.json";
        using var response = await client.PostAsync(url, form, ct);
        if (response.IsSuccessStatusCode) return (true, null);

        var body = await response.Content.ReadAsStringAsync(ct);
        return (false, ErrorMessage(body, "message", null) ?? $"SMS service returned HTTP {(int)response.StatusCode}.");
    }

    private static string? ErrorMessage(string body, string first, string? second)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty(first, out var el)) return null;
            if (second == null) return el.ValueKind == JsonValueKind.String ? el.GetString() : null;
            return el.TryGetProperty(second, out var inner) ? inner.GetString() : null;
        }
        catch (JsonException) { return null; }
    }
}
