namespace Pos.Api.Services;

public interface IFiscalInvoiceProvider
{
    Task<(string? InvoiceNumber, string? QrPayload)> IssueInvoiceAsync(Guid tenantId, Guid orderId, decimal totalAmount, decimal taxAmount, CancellationToken ct = default);
}

// Placeholder until real tax-authority e-invoicing credentials (e.g. FBR sandbox) are configured.
// Swap the DI registration for a real implementation later — this one is intentionally inert.
public class NullFiscalInvoiceProvider : IFiscalInvoiceProvider
{
    public Task<(string? InvoiceNumber, string? QrPayload)> IssueInvoiceAsync(Guid tenantId, Guid orderId, decimal totalAmount, decimal taxAmount, CancellationToken ct = default)
        => Task.FromResult<(string?, string?)>((null, null));
}
