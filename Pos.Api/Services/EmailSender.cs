using System;
using System.Net;
using System.Net.Mail;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

namespace Pos.Api.Services;

// ============================================================
// EMAIL
//
// Plain SMTP, so it works with any mail provider (Gmail / Google Workspace, Outlook / Microsoft
// 365, Zoho, SendGrid, Mailgun, Amazon SES, a hosting company's mailbox). Configure it with:
//
//   Email:SmtpHost      e.g. smtp.gmail.com                (or env EMAIL_SMTP_HOST)
//   Email:SmtpPort      e.g. 587                           (or env EMAIL_SMTP_PORT)
//   Email:SmtpUser      the mailbox or API user            (or env EMAIL_SMTP_USER)
//   Email:SmtpPassword  its password / app password / key  (or env EMAIL_SMTP_PASSWORD)
//   Email:From          e.g. "Cashly POS <no-reply@...>"   (or env EMAIL_FROM)
//   Email:EnableSsl     true (default)                     (or env EMAIL_ENABLE_SSL)
//   App:PublicUrl       where people open Cashly, e.g. https://app.cashlypos.com (or env APP_PUBLIC_URL)
//
// Until the host, sender and public address are set, nothing is sent and the screens that would
// send say so, instead of pretending a message went out.
// ============================================================

public interface IEmailSender
{
    bool IsConfigured { get; }
    /// <summary>Mail can actually go out (host + from set). Verification codes need only this;
    /// links (forgot-password) also need <see cref="PublicUrl"/> to point at the real site.</summary>
    bool CanSend { get; }
    /// <summary>Where people open Cashly, for links in emails. Null when not configured.</summary>
    string? PublicUrl { get; }
    Task SendAsync(string to, string subject, string htmlBody, string textBody);
}

public class SmtpEmailSender : IEmailSender
{
    private readonly string? _host;
    private readonly int _port;
    private readonly string? _user;
    private readonly string? _password;
    private readonly string? _from;
    private readonly bool _ssl;

    public SmtpEmailSender(IConfiguration config)
    {
        string? Read(string key, string env) =>
            config[key] is { Length: > 0 } v ? v : Environment.GetEnvironmentVariable(env);

        _host = Read("Email:SmtpHost", "EMAIL_SMTP_HOST");
        _port = int.TryParse(Read("Email:SmtpPort", "EMAIL_SMTP_PORT"), out var port) ? port : 587;
        _user = Read("Email:SmtpUser", "EMAIL_SMTP_USER");
        _password = Read("Email:SmtpPassword", "EMAIL_SMTP_PASSWORD");
        _from = Read("Email:From", "EMAIL_FROM");
        _ssl = !string.Equals(Read("Email:EnableSsl", "EMAIL_ENABLE_SSL"), "false", StringComparison.OrdinalIgnoreCase);
        PublicUrl = Read("App:PublicUrl", "APP_PUBLIC_URL")?.TrimEnd('/');
    }

    public string? PublicUrl { get; }

    // The link in a reset email must point at the real site, never at whatever address the request
    // claimed to come from — so without App:PublicUrl link emails are not sent. Codes don't carry
    // links, so they only need the mailbox itself (CanSend).
    public bool CanSend => !string.IsNullOrWhiteSpace(_host) && !string.IsNullOrWhiteSpace(_from);
    public bool IsConfigured => CanSend && !string.IsNullOrWhiteSpace(PublicUrl);

    // Sendable means the mailbox itself (host + from) — every caller already chose its own gate
    // (links check IsConfigured so a reset link never points at the wrong site; codes check
    // CanSend). Guarding here on IsConfigured would make plain codes wait for App:PublicUrl
    // even though they carry no link at all.
    public async Task SendAsync(string to, string subject, string htmlBody, string textBody)
    {
        if (!CanSend) throw new InvalidOperationException("Email is not configured.");

        using var message = new MailMessage
        {
            // Accepts "no-reply@example.com" and "Cashly POS <no-reply@example.com>" alike.
            From = new MailAddress(_from!),
            Subject = subject,
            Body = textBody,
            IsBodyHtml = false
        };
        message.To.Add(to);
        message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(htmlBody, null, "text/html"));

        using var client = new SmtpClient(_host, _port)
        {
            EnableSsl = _ssl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = 15000
        };
        if (!string.IsNullOrEmpty(_user))
            client.Credentials = new NetworkCredential(_user, _password);

        await client.SendMailAsync(message);
    }
}
