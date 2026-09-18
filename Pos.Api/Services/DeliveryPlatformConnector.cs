using System.Globalization;
using System.Text.Json;

namespace Pos.Api.Services;

/// <summary>
/// A platform-neutral line item. The connector cannot resolve an internal ProductId on its own
/// (it has no database access), so it reports whatever identifiers the platform sent and the
/// webhook endpoint in Program.cs matches them against Products (by SKU, then by name).
/// </summary>
public record ExternalOrderItem(string? ExternalProductId, string? Sku, string Name, int Quantity, decimal UnitPricePKR);

/// <summary>
/// Normalized delivery-platform order. Prices carried here are informational only — the internal
/// order is always re-priced server-side from DB product prices before it is saved.
/// </summary>
public record NormalizedExternalOrder(
    string ExternalOrderId,
    string? CustomerName,
    string? CustomerPhone,
    string? DeliveryAddress,
    bool IsPrepaid,
    string? Notes,
    List<ExternalOrderItem> Items);

public record ExternalOrderImportResult(bool Success, string? ErrorMessage, NormalizedExternalOrder? Order, string ExternalOrderId);

public interface IDeliveryPlatformConnector
{
    string PlatformName { get; }
    Task<ExternalOrderImportResult> ParseIncomingOrderAsync(string rawPayload, Guid tenantId, Guid branchId);
}

public interface IDeliveryPlatformResolver
{
    IDeliveryPlatformConnector? Resolve(string platformName);
    IReadOnlyCollection<IDeliveryPlatformConnector> All { get; }
}

public class DeliveryPlatformResolver : IDeliveryPlatformResolver
{
    private readonly Dictionary<string, IDeliveryPlatformConnector> _byName;

    public DeliveryPlatformResolver(IEnumerable<IDeliveryPlatformConnector> connectors)
        => _byName = connectors.ToDictionary(c => c.PlatformName, StringComparer.OrdinalIgnoreCase);

    public IDeliveryPlatformConnector? Resolve(string platformName)
        => string.IsNullOrWhiteSpace(platformName) ? null
           : _byName.TryGetValue(platformName.Trim(), out var c) ? c : null;

    public IReadOnlyCollection<IDeliveryPlatformConnector> All => _byName.Values;
}

// Payload shape is a best-effort guess based on typical delivery-platform partner webhook
// conventions; confirm against Foodpanda's actual partner API docs once partner credentials/access
// exist. Expected shape:
// {
//   "orderId": "FP-12345",
//   "customer": { "name": "...", "phone": "...", "address": "..." },
//   "paymentStatus": "PAID" | "COD",
//   "notes": "...",
//   "items": [ { "productId": "...", "sku": "...", "name": "...", "quantity": 2, "price": 450 } ]
// }
public class FoodpandaStubConnector : IDeliveryPlatformConnector
{
    public string PlatformName => "Foodpanda";

    public Task<ExternalOrderImportResult> ParseIncomingOrderAsync(string rawPayload, Guid tenantId, Guid branchId)
    {
        if (string.IsNullOrWhiteSpace(rawPayload))
            return Fail("Empty webhook payload.", string.Empty);

        JsonDocument doc;
        try { doc = JsonDocument.Parse(rawPayload); }
        catch (JsonException ex) { return Fail($"Payload is not valid JSON: {ex.Message}", string.Empty); }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return Fail("Payload root must be a JSON object.", string.Empty);

            var externalId = ReadString(root, "orderId") ?? ReadString(root, "order_id") ?? ReadString(root, "id") ?? string.Empty;
            if (string.IsNullOrWhiteSpace(externalId))
                return Fail("Payload has no order identifier.", string.Empty);

            string? name = null, phone = null, address = null;
            if (root.TryGetProperty("customer", out var customer) && customer.ValueKind == JsonValueKind.Object)
            {
                name = ReadString(customer, "name") ?? ReadString(customer, "fullName");
                phone = ReadString(customer, "phone") ?? ReadString(customer, "mobile");
                address = ReadString(customer, "address") ?? ReadString(customer, "deliveryAddress");
            }
            name ??= ReadString(root, "customerName");
            phone ??= ReadString(root, "customerPhone");
            address ??= ReadString(root, "deliveryAddress");

            var paymentStatus = ReadString(root, "paymentStatus") ?? ReadString(root, "payment_status") ?? string.Empty;
            var isPrepaid = paymentStatus.Equals("PAID", StringComparison.OrdinalIgnoreCase)
                            || paymentStatus.Equals("PREPAID", StringComparison.OrdinalIgnoreCase);

            var items = new List<ExternalOrderItem>();
            if (root.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in itemsEl.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) continue;
                    var itemName = ReadString(item, "name") ?? ReadString(item, "title") ?? "Unknown item";
                    var qty = ReadInt(item, "quantity") ?? ReadInt(item, "qty") ?? 0;
                    if (qty <= 0) continue;
                    items.Add(new ExternalOrderItem(
                        ReadString(item, "productId") ?? ReadString(item, "product_id"),
                        ReadString(item, "sku"),
                        itemName,
                        qty,
                        ReadDecimal(item, "price") ?? ReadDecimal(item, "unitPrice") ?? 0m));
                }
            }

            if (items.Count == 0)
                return Fail("Payload contains no usable line items.", externalId);

            return Task.FromResult(new ExternalOrderImportResult(
                true, null,
                new NormalizedExternalOrder(externalId, name, phone, address, isPrepaid, ReadString(root, "notes"), items),
                externalId));
        }
    }

    private static Task<ExternalOrderImportResult> Fail(string message, string externalId)
        => Task.FromResult(new ExternalOrderImportResult(false, message, null, externalId));

    private static string? ReadString(JsonElement el, string name)
        => el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int? ReadInt(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)) return i;
        if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s)) return s;
        return null;
    }

    private static decimal? ReadDecimal(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d)) return d;
        if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var s)) return s;
        return null;
    }
}
