using System;

namespace Pos.Api.Models;

// ============================================================
// FISCAL INVOICING
//
// In Pakistan a restaurant's sales are reported to the tax authority as they happen: FBR for the
// federal territory, PRA in Punjab, SRB in Sindh, KPRA in Khyber Pakhtunkhwa. The authority
// answers each sale with a fiscal invoice number, printed on the receipt with a QR code.
//
// One connection per location: every till at a shop reports under that shop's POS ID.
// ============================================================

public enum FiscalAuthority
{
    Fbr = 1,
    Pra = 2,
    Srb = 3,
    Kpra = 4
}

public enum FiscalEnvironment
{
    /// <summary>The authority's test system. Nothing reported here is a real invoice.</summary>
    Sandbox = 1,
    Production = 2
}

public class FiscalIntegration
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }

    public FiscalAuthority Authority { get; set; } = FiscalAuthority.Fbr;
    public FiscalEnvironment Environment { get; set; } = FiscalEnvironment.Sandbox;

    /// <summary>The POS ID the authority registered for this shop.</summary>
    public string PosId { get; set; } = string.Empty;

    /// <summary>The authority's access token for this POS ID. A secret: never returned to the browser.</summary>
    public string AccessToken { get; set; } = string.Empty;

    /// <summary>
    /// The endpoint sales are posted to. Blank = the default for the authority and environment
    /// (see FiscalEndpoints). The authority confirms the exact address when it issues the POS ID.
    /// </summary>
    public string? ApiUrl { get; set; }

    /// <summary>The PCT (tariff) code reported on every line, e.g. the code the authority gave
    /// for restaurant services. Required by the authority on each item.</summary>
    public string DefaultPctCode { get; set; } = string.Empty;

    public bool IsEnabled { get; set; }

    public DateTime? LastSuccessAt { get; set; }
    public string? LastError { get; set; }
    public DateTime? LastErrorAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
