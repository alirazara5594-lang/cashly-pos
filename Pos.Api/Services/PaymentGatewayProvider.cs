using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace Pos.Api.Services;

public record PaymentIntentResult(bool Success, string? RedirectUrl, string? Instructions, string? ProviderTransactionId, string? ErrorMessage);
public record PaymentConfirmationResult(bool Success, string? ProviderTransactionId, decimal? AmountPKR, string? ErrorMessage);

public interface IPaymentGatewayProvider
{
    string ProviderName { get; }
    bool IsConfigured { get; }
    Task<PaymentIntentResult> CreateIntentAsync(Guid orderId, decimal amountPKR, string? customerPhone, CancellationToken ct = default);
    Task<bool> VerifyWebhookSignatureAsync(string rawBody, IHeaderDictionary headers);
    Task<PaymentConfirmationResult> ParseWebhookAsync(string rawBody);
}

/// <summary>
/// Resolves an <see cref="IPaymentGatewayProvider"/> by its ProviderName (case-insensitive).
/// Registered providers are injected as IEnumerable and indexed once at construction.
/// </summary>
public interface IPaymentGatewayResolver
{
    IPaymentGatewayProvider? Resolve(string providerName);
    IReadOnlyCollection<IPaymentGatewayProvider> All { get; }
}

public class PaymentGatewayResolver : IPaymentGatewayResolver
{
    private readonly Dictionary<string, IPaymentGatewayProvider> _byName;

    public PaymentGatewayResolver(IEnumerable<IPaymentGatewayProvider> providers)
    {
        _byName = providers.ToDictionary(p => p.ProviderName, StringComparer.OrdinalIgnoreCase);
    }

    public IPaymentGatewayProvider? Resolve(string providerName)
        => string.IsNullOrWhiteSpace(providerName) ? null
           : _byName.TryGetValue(providerName.Trim(), out var p) ? p : null;

    public IReadOnlyCollection<IPaymentGatewayProvider> All => _byName.Values;
}

// Built to each provider's publicly documented integration pattern; not verified against a live
// sandbox — confirm against current provider docs before enabling in production.
//
// JazzCash "Mobile Account (MWALLET)" model: the merchant POSTs a form of pp_* parameters to the
// provider's transaction endpoint. Every pp_* field (excluding pp_SecureHash) is sorted by key,
// its values joined with '&' behind the integrity salt, and HMAC-SHA256'd with the salt as key.
public class JazzCashProvider : IPaymentGatewayProvider
{
    private readonly string _merchantId;
    private readonly string _password;
    private readonly string _integritySalt;
    private readonly string _endpoint;

    public JazzCashProvider(IConfiguration config)
    {
        _merchantId = config["JazzCash:MerchantId"] ?? string.Empty;
        _password = config["JazzCash:Password"] ?? string.Empty;
        _integritySalt = config["JazzCash:IntegritySalt"] ?? string.Empty;
        _endpoint = config["JazzCash:Endpoint"] ?? "https://sandbox.jazzcash.com.pk/ApplicationAPI/API/Payment/DoMWalletTransaction";
    }

    public string ProviderName => "JazzCash";

    public bool IsConfigured =>
        !string.IsNullOrEmpty(_merchantId) && !string.IsNullOrEmpty(_password) && !string.IsNullOrEmpty(_integritySalt);

    public Task<PaymentIntentResult> CreateIntentAsync(Guid orderId, decimal amountPKR, string? customerPhone, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            return Task.FromResult(new PaymentIntentResult(
                false, null, null, null,
                "JazzCash is not configured. Add merchant credentials to enable mobile wallet payments."));
        }

        // --- Dead code until credentials exist: real request construction + signing. ---
        var now = DateTime.UtcNow;
        var txnRef = $"T{now:yyyyMMddHHmmss}{orderId.ToString("N")[..6].ToUpperInvariant()}";
        var fields = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["pp_Version"] = "1.1",
            ["pp_TxnType"] = "MWALLET",
            ["pp_Language"] = "EN",
            ["pp_MerchantID"] = _merchantId,
            ["pp_Password"] = _password,
            ["pp_TxnRefNo"] = txnRef,
            // JazzCash amounts are in the minor unit (paisa), integer, no separators.
            ["pp_Amount"] = ((long)Math.Round(amountPKR * 100m, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture),
            ["pp_TxnCurrency"] = "PKR",
            ["pp_TxnDateTime"] = now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture),
            ["pp_TxnExpiryDateTime"] = now.AddHours(1).ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture),
            ["pp_BillReference"] = orderId.ToString("N"),
            ["pp_Description"] = $"POS order {orderId:N}",
            ["pp_MobileNumber"] = NormalizeMsisdn(customerPhone),
            ["pp_CNIC"] = string.Empty,
            ["ppmpf_1"] = orderId.ToString()
        };

        fields["pp_SecureHash"] = ComputeSecureHash(fields);

        // A live implementation would POST `fields` (form-encoded) to _endpoint via HttpClient and
        // map the pp_ResponseCode. Until sandbox credentials exist there is nothing to call.
        return Task.FromResult(new PaymentIntentResult(
            true, _endpoint,
            "Approve the payment request on your JazzCash mobile wallet.",
            txnRef, null));
    }

    public Task<bool> VerifyWebhookSignatureAsync(string rawBody, IHeaderDictionary headers)
    {
        if (!IsConfigured) return Task.FromResult(false);

        var fields = ParseFields(rawBody);
        if (fields == null || !fields.TryGetValue("pp_SecureHash", out var supplied) || string.IsNullOrEmpty(supplied))
            return Task.FromResult(false);

        var signable = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var kv in fields.Where(f => f.Key.StartsWith("pp", StringComparison.OrdinalIgnoreCase) && f.Key != "pp_SecureHash"))
            signable[kv.Key] = kv.Value;

        var expected = ComputeSecureHash(signable);
        return Task.FromResult(CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected.ToUpperInvariant()),
            Encoding.UTF8.GetBytes(supplied.ToUpperInvariant())));
    }

    public Task<PaymentConfirmationResult> ParseWebhookAsync(string rawBody)
    {
        var fields = ParseFields(rawBody);
        if (fields == null)
            return Task.FromResult(new PaymentConfirmationResult(false, null, null, "Unreadable JazzCash callback payload."));

        fields.TryGetValue("pp_ResponseCode", out var code);
        fields.TryGetValue("pp_RetreivalReferenceNo", out var rrn);
        fields.TryGetValue("pp_TxnRefNo", out var txnRef);
        fields.TryGetValue("pp_ResponseMessage", out var message);
        fields.TryGetValue("pp_Amount", out var amountMinor);

        decimal? amount = null;
        if (long.TryParse(amountMinor, NumberStyles.Integer, CultureInfo.InvariantCulture, out var minor))
            amount = minor / 100m;

        // "000" is the documented success response code for JazzCash transactions.
        var success = code == "000";
        return Task.FromResult(new PaymentConfirmationResult(
            success,
            !string.IsNullOrEmpty(rrn) ? rrn : txnRef,
            amount,
            success ? null : (message ?? $"JazzCash declined the transaction (code {code}).")));
    }

    private string ComputeSecureHash(IDictionary<string, string> fields)
    {
        var joined = string.Join("&", fields
            .Where(f => f.Key != "pp_SecureHash" && !string.IsNullOrEmpty(f.Value))
            .OrderBy(f => f.Key, StringComparer.Ordinal)
            .Select(f => f.Value));
        var message = $"{_integritySalt}&{joined}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_integritySalt));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(message)));
    }

    private static string NormalizeMsisdn(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return string.Empty;
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        if (digits.StartsWith("92") && digits.Length > 10) digits = "0" + digits[2..];
        return digits;
    }

    private static Dictionary<string, string>? ParseFields(string rawBody) => PayloadFields.Parse(rawBody);
}

// Built to each provider's publicly documented integration pattern; not verified against a live
// sandbox — confirm against current provider docs before enabling in production.
//
// EasyPaisa hosted-checkout model: parameters are sorted by key, rendered as key=value pairs
// joined with '&', and signed with the merchant hash key (AES/HMAC depending on the account type;
// HMAC-SHA256 is used here as the widely documented variant).
public class EasyPaisaProvider : IPaymentGatewayProvider
{
    private readonly string _storeId;
    private readonly string _hashKey;
    private readonly string _endpoint;

    public EasyPaisaProvider(IConfiguration config)
    {
        _storeId = config["EasyPaisa:StoreId"] ?? string.Empty;
        _hashKey = config["EasyPaisa:HashKey"] ?? string.Empty;
        _endpoint = config["EasyPaisa:Endpoint"] ?? "https://easypay.easypaisa.com.pk/easypay/Index.jsf";
    }

    public string ProviderName => "EasyPaisa";

    public bool IsConfigured => !string.IsNullOrEmpty(_storeId) && !string.IsNullOrEmpty(_hashKey);

    public Task<PaymentIntentResult> CreateIntentAsync(Guid orderId, decimal amountPKR, string? customerPhone, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            return Task.FromResult(new PaymentIntentResult(
                false, null, null, null,
                "EasyPaisa is not configured. Add merchant credentials to enable mobile wallet payments."));
        }

        // --- Dead code until credentials exist: real request construction + signing. ---
        var orderRef = $"E{DateTime.UtcNow:yyyyMMddHHmmss}{orderId.ToString("N")[..6].ToUpperInvariant()}";
        var fields = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["amount"] = amountPKR.ToString("0.00", CultureInfo.InvariantCulture),
            ["autoRedirect"] = "1",
            ["expiryDate"] = DateTime.UtcNow.AddHours(1).ToString("yyyyMMdd HHmmss", CultureInfo.InvariantCulture),
            ["mobileNum"] = customerPhone ?? string.Empty,
            ["orderRefNum"] = orderRef,
            ["paymentMethod"] = "MA_PAYMENT_METHOD",
            ["storeId"] = _storeId
        };

        var signature = ComputeSignature(fields);
        var query = string.Join("&", fields.Select(f => $"{Uri.EscapeDataString(f.Key)}={Uri.EscapeDataString(f.Value)}"))
                    + $"&merchantHashedReq={Uri.EscapeDataString(signature)}";

        return Task.FromResult(new PaymentIntentResult(
            true, $"{_endpoint}?{query}",
            "Complete the payment on the EasyPaisa checkout page.",
            orderRef, null));
    }

    public Task<bool> VerifyWebhookSignatureAsync(string rawBody, IHeaderDictionary headers)
    {
        if (!IsConfigured) return Task.FromResult(false);

        var fields = PayloadFields.Parse(rawBody);
        if (fields == null) return Task.FromResult(false);

        var supplied = headers["X-Easypaisa-Signature"].ToString();
        if (string.IsNullOrEmpty(supplied)) fields.TryGetValue("merchantHashedReq", out supplied!);
        if (string.IsNullOrEmpty(supplied)) return Task.FromResult(false);

        var signable = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var kv in fields.Where(f => f.Key != "merchantHashedReq"))
            signable[kv.Key] = kv.Value;

        var expected = ComputeSignature(signable);
        return Task.FromResult(CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(supplied)));
    }

    public Task<PaymentConfirmationResult> ParseWebhookAsync(string rawBody)
    {
        var fields = PayloadFields.Parse(rawBody);
        if (fields == null)
            return Task.FromResult(new PaymentConfirmationResult(false, null, null, "Unreadable EasyPaisa callback payload."));

        fields.TryGetValue("status", out var status);
        fields.TryGetValue("responseCode", out var code);
        fields.TryGetValue("transactionId", out var txnId);
        fields.TryGetValue("orderRefNum", out var orderRef);
        fields.TryGetValue("amount", out var amountText);
        fields.TryGetValue("responseDesc", out var desc);

        decimal? amount = null;
        if (decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
            amount = parsed;

        // "0000" / "0" are the documented success response codes for EasyPaisa checkout callbacks.
        var success = code is "0000" or "0" || string.Equals(status, "PAID", StringComparison.OrdinalIgnoreCase);
        return Task.FromResult(new PaymentConfirmationResult(
            success,
            !string.IsNullOrEmpty(txnId) ? txnId : orderRef,
            amount,
            success ? null : (desc ?? $"EasyPaisa declined the transaction (code {code}).")));
    }

    private string ComputeSignature(IDictionary<string, string> fields)
    {
        var canonical = string.Join("&", fields
            .Where(f => !string.IsNullOrEmpty(f.Value))
            .OrderBy(f => f.Key, StringComparer.Ordinal)
            .Select(f => $"{f.Key}={f.Value}"));
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_hashKey));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical)));
    }
}

/// <summary>
/// Placeholder for card-network payments. Card acquiring requires a bank/acquirer relationship
/// and terminal certification that this system has no representation of at all, so this provider
/// is permanently inert — swap the DI registration once a real acquirer integration exists.
/// </summary>
public class NullPaymentGatewayProvider : IPaymentGatewayProvider
{
    public string ProviderName => "Card";

    public bool IsConfigured => false;

    public Task<PaymentIntentResult> CreateIntentAsync(Guid orderId, decimal amountPKR, string? customerPhone, CancellationToken ct = default)
        => Task.FromResult(new PaymentIntentResult(
            false, null, null, null,
            "Card processing is not configured. Card payments require an acquiring-bank integration that is not set up for this deployment — settle card sales on the standalone terminal and record them as Card in the POS."));

    public Task<bool> VerifyWebhookSignatureAsync(string rawBody, IHeaderDictionary headers)
        => Task.FromResult(false);

    public Task<PaymentConfirmationResult> ParseWebhookAsync(string rawBody)
        => Task.FromResult(new PaymentConfirmationResult(false, null, null, "Card processing is not configured."));
}

/// <summary>
/// Both providers may call back with either a form-encoded body or JSON, depending on how the
/// merchant account is provisioned. This flattens either into a key/value map.
/// </summary>
internal static class PayloadFields
{
    public static Dictionary<string, string>? Parse(string rawBody)
    {
        if (string.IsNullOrWhiteSpace(rawBody)) return null;

        var trimmed = rawBody.TrimStart();
        if (trimmed.StartsWith('{'))
        {
            try
            {
                using var doc = JsonDocument.Parse(trimmed);
                if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
                var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var prop in doc.RootElement.EnumerateObject())
                {
                    map[prop.Name] = prop.Value.ValueKind switch
                    {
                        JsonValueKind.String => prop.Value.GetString() ?? string.Empty,
                        JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
                        _ => prop.Value.ToString()
                    };
                }
                return map;
            }
            catch (JsonException) { return null; }
        }

        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in rawBody.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = pair.IndexOf('=');
            if (idx <= 0) continue;
            result[Uri.UnescapeDataString(pair[..idx])] = Uri.UnescapeDataString(pair[(idx + 1)..]);
        }
        return result.Count > 0 ? result : null;
    }
}
