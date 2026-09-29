using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

public interface IFiscalInvoiceProvider
{
    /// <summary>
    /// Reports a paid sale to the shop's tax authority and returns the fiscal invoice number and the
    /// QR payload to print. (null, null) when the shop has no fiscal connection, the sale is not
    /// paid yet, or the authority could not be reached — the sale itself is never held up.
    /// </summary>
    Task<(string? InvoiceNumber, string? QrPayload)> IssueInvoiceAsync(Guid tenantId, Guid orderId, decimal totalAmount, decimal taxAmount, CancellationToken ct = default);

    /// <summary>Reports a return as a credit note against its original sale. Returns the fiscal number, or null.</summary>
    Task<string?> IssueReturnAsync(Guid tenantId, Guid orderReturnId, CancellationToken ct = default);
}

/// <summary>Does nothing. Kept for installs that want fiscal reporting switched off entirely.</summary>
public class NullFiscalInvoiceProvider : IFiscalInvoiceProvider
{
    public Task<(string? InvoiceNumber, string? QrPayload)> IssueInvoiceAsync(Guid tenantId, Guid orderId, decimal totalAmount, decimal taxAmount, CancellationToken ct = default)
        => Task.FromResult<(string?, string?)>((null, null));

    public Task<string?> IssueReturnAsync(Guid tenantId, Guid orderReturnId, CancellationToken ct = default)
        => Task.FromResult<string?>(null);
}

/// <summary>The default endpoint for each authority, when the shop's connection names none.</summary>
public static class FiscalEndpoints
{
    /// <summary>
    /// FBR and PRA both run the POS integration built by PRAL. SRB and KPRA publish their own
    /// addresses, so a connection to them must name its endpoint. The authority confirms the exact
    /// address when it registers the POS ID; ApiUrl on the connection overrides these.
    /// </summary>
    public static string? DefaultFor(FiscalAuthority authority, FiscalEnvironment environment) => (authority, environment) switch
    {
        (FiscalAuthority.Fbr, FiscalEnvironment.Production) => "https://gw.fbr.gov.pk/imsp/v1/api/Live/PostData",
        (FiscalAuthority.Fbr, FiscalEnvironment.Sandbox) => "https://esp.fbr.gov.pk:8244/FBR/v1/api/Live/PostData",
        (FiscalAuthority.Pra, FiscalEnvironment.Production) => "https://ims.pral.com.pk/ims/production/api/Live/PostData",
        (FiscalAuthority.Pra, FiscalEnvironment.Sandbox) => "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData",
        _ => null
    };
}

/// <summary>
/// Reports sales in the PRAL POS integration format (FBR and PRA): one JSON invoice per sale,
/// answered with a fiscal invoice number. Only for shops that bought the fiscal invoicing add-on
/// and switched their connection on. Never throws into the checkout: a failure is recorded on the
/// connection and the sale can be reported again from Settings.
/// </summary>
public class PralFiscalInvoiceProvider : IFiscalInvoiceProvider
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(8);
    private const string SuccessCode = "100";

    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _http;
    private readonly IEntitlementService _entitlements;
    private readonly ILogger<PralFiscalInvoiceProvider> _log;

    public PralFiscalInvoiceProvider(AppDbContext db, IHttpClientFactory http, IEntitlementService entitlements, ILogger<PralFiscalInvoiceProvider> log)
    {
        _db = db;
        _http = http;
        _entitlements = entitlements;
        _log = log;
    }

    public async Task<(string? InvoiceNumber, string? QrPayload)> IssueInvoiceAsync(Guid tenantId, Guid orderId, decimal totalAmount, decimal taxAmount, CancellationToken ct = default)
    {
        var order = await _db.Orders.IgnoreQueryFilters().Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.Id == orderId && o.TenantId == tenantId, ct);
        // A sale is reported when it is paid: an open table is reported when it is settled.
        if (order == null || !order.IsPaid || order.FiscalInvoiceNumber != null) return (null, null);

        var connection = await ConnectionForAsync(tenantId, order.BranchId, ct);
        if (connection == null) return (null, null);

        var skus = await SkusAsync(order.Items.Select(i => i.ProductId), ct);
        var invoice = BuildInvoice(connection, order.OrderNumber, order.CreatedAt, order.CustomerName, order.CustomerPhone,
            order.PaymentMethod, order.DiscountPKR, order.TaxPKR, order.TotalPKR, invoiceType: 1, refUsin: null,
            order.Items.Select(i => (i.ProductId, i.ProductName, (decimal)i.Quantity, i.TotalPricePKR)).ToList(), skus);

        var number = await PostAsync(connection, invoice, $"order {order.OrderNumber}", ct);
        // The authority's invoice number is also what the printed QR code carries.
        return number == null ? (null, null) : (number, number);
    }

    public async Task<string?> IssueReturnAsync(Guid tenantId, Guid orderReturnId, CancellationToken ct = default)
    {
        var ret = await _db.OrderReturns.IgnoreQueryFilters().Include(r => r.Lines)
            .FirstOrDefaultAsync(r => r.Id == orderReturnId && r.TenantId == tenantId, ct);
        if (ret == null || ret.FiscalInvoiceNumber != null) return null;

        var connection = await ConnectionForAsync(tenantId, ret.BranchId, ct);
        if (connection == null) return null;

        var original = await _db.Orders.IgnoreQueryFilters().AsNoTracking()
            .Where(o => o.Id == ret.OrderId).Select(o => new { o.OrderNumber, o.CustomerName, o.CustomerPhone })
            .FirstOrDefaultAsync(ct);
        var skus = await SkusAsync(ret.Lines.Select(l => l.ProductId), ct);
        var discount = Math.Max(0, ret.Lines.Sum(l => l.TotalPKR) - ret.SubTotalRefundedPKR);
        // A credit note: InvoiceType 3, pointing back at the sale it reverses.
        var invoice = BuildInvoice(connection, ret.ReturnNumber, ret.CreatedAt, original?.CustomerName, original?.CustomerPhone,
            ret.RefundMethod, discount, ret.TaxRefundedPKR, ret.TotalRefundedPKR, invoiceType: 3, refUsin: original?.OrderNumber,
            ret.Lines.Select(l => (l.ProductId, l.ProductName, (decimal)l.Quantity, l.TotalPKR)).ToList(), skus);

        var number = await PostAsync(connection, invoice, $"return {ret.ReturnNumber}", ct);
        if (number != null) ret.FiscalInvoiceNumber = number;
        await _db.SaveChangesAsync(ct);
        return number;
    }

    /// <summary>The shop's switched-on connection, when the shop has the fiscal invoicing add-on.</summary>
    private async Task<FiscalIntegration?> ConnectionForAsync(Guid tenantId, Guid branchId, CancellationToken ct)
    {
        var connection = await _db.FiscalIntegrations.IgnoreQueryFilters()
            .FirstOrDefaultAsync(f => f.TenantId == tenantId && f.BranchId == branchId && f.IsEnabled, ct);
        if (connection == null) return null;
        if (!await _entitlements.BranchHasFeatureAsync(tenantId, branchId, FeatureCodes.FiscalInvoicing)) return null;
        return connection;
    }

    private async Task<Dictionary<Guid, string>> SkusAsync(IEnumerable<Guid> productIds, CancellationToken ct)
    {
        var ids = productIds.Distinct().ToList();
        return await _db.Products.IgnoreQueryFilters().AsNoTracking()
            .Where(p => ids.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => string.IsNullOrWhiteSpace(p.SKU) ? p.Id.ToString("N")[..10] : p.SKU, ct);
    }

    /// <summary>
    /// The invoice in PRAL's format. Line values are the lines' share of the bill, so the lines always
    /// add up to the totals the customer was charged, whatever discount or tax mode applied.
    /// </summary>
    private static Dictionary<string, object?> BuildInvoice(
        FiscalIntegration connection, string usin, DateTime whenUtc, string? buyerName, string? buyerPhone,
        PaymentMethod paymentMethod, decimal discount, decimal tax, decimal total, int invoiceType, string? refUsin,
        IReadOnlyList<(Guid ProductId, string Name, decimal Quantity, decimal Gross)> lines, IReadOnlyDictionary<Guid, string> skus)
    {
        var saleValue = Math.Max(0, total - tax);
        var taxable = saleValue;
        var taxRate = taxable > 0 ? Math.Round(tax / taxable * 100m, 2) : 0m;
        var grossSum = lines.Sum(l => l.Gross);

        var items = new List<Dictionary<string, object?>>();
        decimal saleSoFar = 0, taxSoFar = 0, discountSoFar = 0;
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            var last = i == lines.Count - 1;
            var share = grossSum > 0 ? line.Gross / grossSum : 1m / lines.Count;
            // The last line takes the rounding remainder so the lines add up exactly.
            var lineSale = last ? saleValue - saleSoFar : Math.Round(saleValue * share, 2);
            var lineTax = last ? tax - taxSoFar : Math.Round(tax * share, 2);
            var lineDiscount = last ? discount - discountSoFar : Math.Round(discount * share, 2);
            saleSoFar += lineSale; taxSoFar += lineTax; discountSoFar += lineDiscount;

            items.Add(new Dictionary<string, object?>
            {
                ["ItemCode"] = skus.TryGetValue(line.ProductId, out var sku) ? sku : line.ProductId.ToString("N")[..10],
                ["ItemName"] = line.Name,
                ["Quantity"] = line.Quantity,
                ["PCTCode"] = connection.DefaultPctCode,
                ["TaxRate"] = taxRate,
                ["SaleValue"] = lineSale,
                ["TotalAmount"] = lineSale + lineTax,
                ["TaxCharged"] = lineTax,
                ["Discount"] = lineDiscount,
                ["FurtherTax"] = 0m,
                ["InvoiceType"] = invoiceType,
                ["RefUSIN"] = refUsin
            });
        }

        return new Dictionary<string, object?>
        {
            ["InvoiceNumber"] = "",
            ["POSID"] = long.TryParse(connection.PosId, out var numericPosId) ? numericPosId : connection.PosId,
            ["USIN"] = usin,
            ["DateTime"] = PakistanTime(whenUtc).ToString("yyyy-MM-dd HH:mm:ss"),
            ["BuyerNTN"] = null,
            ["BuyerCNIC"] = null,
            ["BuyerName"] = string.IsNullOrWhiteSpace(buyerName) ? null : buyerName,
            ["BuyerPhoneNumber"] = string.IsNullOrWhiteSpace(buyerPhone) ? null : buyerPhone,
            ["TotalBillAmount"] = total,
            ["TotalQuantity"] = lines.Sum(l => l.Quantity),
            ["TotalSaleValue"] = saleValue,
            ["TotalTaxCharged"] = tax,
            ["Discount"] = discount,
            ["FurtherTax"] = 0m,
            ["PaymentMode"] = PaymentMode(paymentMethod),
            ["RefUSIN"] = refUsin,
            ["InvoiceType"] = invoiceType,
            ["Items"] = items
        };
    }

    /// <summary>PRAL payment modes: 1 cash, 2 card, 3 gift voucher, 5 mixed.</summary>
    private static int PaymentMode(PaymentMethod method) => method switch
    {
        PaymentMethod.Cash => 1,
        PaymentMethod.Split => 5,
        PaymentMethod.CustomerKhata => 1,
        _ => 2 // card and digital wallets
    };

    private static DateTime PakistanTime(DateTime utc)
    {
        var asUtc = DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        foreach (var id in new[] { "Asia/Karachi", "Pakistan Standard Time" })
        {
            try { return TimeZoneInfo.ConvertTimeFromUtc(asUtc, TimeZoneInfo.FindSystemTimeZoneById(id)); }
            catch (TimeZoneNotFoundException) { }
            catch (InvalidTimeZoneException) { }
        }
        return asUtc.AddHours(5); // Pakistan has no daylight saving
    }

    /// <summary>Posts one invoice; the fiscal number on success, null (recorded on the connection) otherwise.</summary>
    private async Task<string?> PostAsync(FiscalIntegration connection, Dictionary<string, object?> invoice, string what, CancellationToken ct)
    {
        var url = string.IsNullOrWhiteSpace(connection.ApiUrl)
            ? FiscalEndpoints.DefaultFor(connection.Authority, connection.Environment)
            : connection.ApiUrl.Trim();
        if (url == null)
            return Fail(connection, $"No endpoint for {connection.Authority}. Enter the address the authority gave you.");
        if (string.IsNullOrWhiteSpace(connection.PosId) || string.IsNullOrWhiteSpace(connection.AccessToken))
            return Fail(connection, "The POS ID or access token is missing.");
        if (string.IsNullOrWhiteSpace(connection.DefaultPctCode))
            return Fail(connection, "The PCT code is missing.");

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(Timeout);
            var client = _http.CreateClient("fiscal");
            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(JsonSerializer.Serialize(invoice), Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", connection.AccessToken);

            using var response = await client.SendAsync(request, timeout.Token);
            var body = await response.Content.ReadAsStringAsync(timeout.Token);
            if (!response.IsSuccessStatusCode)
                return Fail(connection, $"The authority answered {(int)response.StatusCode} for {what}: {Trim(body)}");

            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;
            var code = Read(root, "Code");
            var number = Read(root, "InvoiceNumber");
            if (code == SuccessCode && !string.IsNullOrWhiteSpace(number))
            {
                connection.LastSuccessAt = DateTime.UtcNow;
                connection.LastError = null;
                return number;
            }
            return Fail(connection, $"Refused {what} (code {code ?? "?"}): {Read(root, "Response") ?? Trim(body)}");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or OperationCanceledException)
        {
            return Fail(connection, $"Could not reach the authority for {what}: {ex.Message}");
        }
    }

    private string? Fail(FiscalIntegration connection, string reason)
    {
        connection.LastError = reason.Length > 500 ? reason[..500] : reason;
        connection.LastErrorAt = DateTime.UtcNow;
        _log.LogWarning("[Fiscal] {Reason}", reason);
        return null;
    }

    private static string? Read(JsonElement root, string name)
    {
        foreach (var property in root.EnumerateObject())
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                return property.Value.ValueKind switch
                {
                    JsonValueKind.String => property.Value.GetString(),
                    JsonValueKind.Number => property.Value.GetRawText(),
                    _ => null
                };
        return null;
    }

    private static string Trim(string body) => body.Length > 200 ? body[..200] : body;
}
