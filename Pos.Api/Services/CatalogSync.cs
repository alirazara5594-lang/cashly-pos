using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Services;

// ============================================================
// CATALOGUE DOWN-SYNC (head office -> branch)
//
// The other half of sync, and until now the missing one: a chain's menu is authored once at head
// office, the branch till sells it, and nothing moved between them. The policy that says head
// office owns the catalogue (TenantSettings.CatalogControl) already stops branch staff editing
// locally — which left a branch whose only way to get a new burger was a phone call.
//
// Two decisions shape everything below.
//
// 1. IT IS A SNAPSHOT, NOT A STREAM. Categories and products are hard-deleted at head office, and
//    a change feed cannot carry a deletion unless it also carries a tombstone. So the cloud sends
//    the whole catalogue and the host reconciles against it: anything head office no longer has is
//    retired here. Retirement, not deletion — a product an old order still points at must survive,
//    or the sales history breaks.
//
// 2. THE BRANCH PROTECTS ITSELF. The pull is refused outright when this host's own
//    CatalogControl says branches may edit, because in that mode the local rows are the branch's
//    own work and head office is not authoritative over them. The host's setting is what decides,
//    not the cloud's: the thing being protected is data on this disk.
//
// The version hash exists so a shop on a phone tether does not re-download its own menu every five
// minutes. Head office hashes what it is about to send; if that matches what the host last applied,
// nothing is transferred at all.
// ============================================================

// --- Wire shape --------------------------------------------------------------
// Flat records rather than entities: the JSON must not change because a navigation property did.
//
// Cost is deliberately absent. This endpoint answers to a six-character host code, and what an
// item cost head office is margin the till has no need of to sell it: the branch keeps its own
// cost, and the pull carries only what decides what is on the menu and what it charges.

public sealed record CatalogCategoryDto(
    Guid Id, string Name, string? LocalName, string Icon, int SortOrder, bool IsSample);

public sealed record CatalogProductDto(
    Guid Id, Guid CategoryId, string SKU, string Barcode, string Name, string? UrduName,
    string Description, decimal SellingPricePKR, string Unit,
    string? ImageUrl, string Station, bool IsActive, bool IsSample);

public sealed record CatalogModifierDto(
    Guid Id, Guid ProductId, string Name, decimal PricePKR, Guid? IngredientId, decimal? IngredientQty);

public sealed record CatalogBranchPriceDto(
    Guid Id, Guid ProductId, decimal? SellingPricePKR, bool IsAvailable, DateTime UpdatedAt);

public sealed record CatalogSnapshot(
    string CatalogVersion,
    string CatalogControl,
    bool BranchPricing,
    List<CatalogCategoryDto> Categories,
    List<CatalogProductDto> Products,
    List<CatalogModifierDto> Modifiers,
    List<CatalogBranchPriceDto> BranchPrices);

/// <summary>
/// What <c>GET /api/sync/catalog</c> returns. One shape either way, so an unchanged menu is a
/// twenty-byte answer the host can read without deciding between two formats.
/// </summary>
public sealed record CatalogPullResponse(string CatalogVersion, bool Unchanged, CatalogSnapshot? Catalog);

// ============================================================
// CLOUD SIDE — build the snapshot and its version
// ============================================================

public class CatalogBuilder
{
    private readonly AppDbContext _db;

    public CatalogBuilder(AppDbContext db) => _db = db;

    /// <summary>
    /// The catalogue as head office has it, plus a hash of it. Every list is ordered by id so the
    /// hash is the same on any machine, in any timezone, on any run.
    /// </summary>
    public async Task<CatalogSnapshot> BuildAsync(Guid tenantId, Guid branchId, CancellationToken ct = default)
    {
        var categories = await _db.Categories.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .OrderBy(c => c.Id)
            .ToListAsync(ct);

        var products = await _db.Products.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .OrderBy(p => p.Id)
            .ToListAsync(ct);

        var productIds = products.Select(p => p.Id).ToList();
        var modifiers = productIds.Count == 0
            ? new List<ProductModifier>()
            : await _db.ProductModifiers.IgnoreQueryFilters().AsNoTracking()
                .Where(m => productIds.Contains(m.ProductId))
                .OrderBy(m => m.Id)
                .ToListAsync(ct);

        // Only this host's own branch: another shop's price overrides are not this shop's business.
        var branchPrices = await _db.BranchProductPrices.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.TenantId == tenantId && p.BranchId == branchId)
            .OrderBy(p => p.Id)
            .ToListAsync(ct);

        var settings = await _db.TenantSettings.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);

        var snapshot = new CatalogSnapshot(
            CatalogVersion: string.Empty,
            CatalogControl: (settings?.CatalogControl ?? CatalogControl.BranchesMayEdit).ToString(),
            BranchPricing: settings?.BranchPricing ?? false,
            Categories: categories.Select(c => new CatalogCategoryDto(
                c.Id, c.Name, c.LocalName, c.Icon, c.SortOrder, c.IsSample)).ToList(),
            Products: products.Select(p => new CatalogProductDto(
                p.Id, p.CategoryId, p.SKU, p.Barcode, p.Name, p.UrduName, p.Description,
                p.SellingPricePKR, p.Unit, p.ImageUrl,
                p.Station.ToString(), p.IsActive, p.IsSample)).ToList(),
            Modifiers: modifiers.Select(m => new CatalogModifierDto(
                m.Id, m.ProductId, m.Name, m.PricePKR, m.IngredientId, m.IngredientQty)).ToList(),
            BranchPrices: branchPrices.Select(b => new CatalogBranchPriceDto(
                b.Id, b.ProductId, b.SellingPricePKR, b.IsAvailable, b.UpdatedAt)).ToList());

        return snapshot with { CatalogVersion = ComputeVersion(snapshot) };
    }

    /// <summary>
    /// SHA-256 over the content, truncated to 16 bytes. Records serialise in declaration order and
    /// every list is id-sorted, so identical catalogues hash identically everywhere.
    /// </summary>
    private static string ComputeVersion(CatalogSnapshot snapshot)
    {
        var canonical = JsonSerializer.Serialize(new
        {
            snapshot.CatalogControl,
            snapshot.BranchPricing,
            snapshot.Categories,
            snapshot.Products,
            snapshot.Modifiers,
            snapshot.BranchPrices
        });
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexString(digest.AsSpan(0, 16)).ToLowerInvariant();
    }
}

// ============================================================
// HOST SIDE — apply a snapshot to the till's own database
// ============================================================

/// <summary>What one catalogue apply did.</summary>
public sealed record CatalogApplyResult(
    bool Applied,
    string? SkippedBecause,
    int CategoriesWritten,
    int ProductsWritten,
    int ProductsRetired,
    int PricesWritten,
    IReadOnlyList<string> Reasons)
{
    public string? ReasonSummary => Reasons.Count == 0 ? null : string.Join("; ", Reasons.Take(5));

    public static CatalogApplyResult Skipped(string reason) =>
        new(false, reason, 0, 0, 0, 0, Array.Empty<string>());
}

public class CatalogMirror
{
    private readonly AppDbContext _db;

    public CatalogMirror(AppDbContext db) => _db = db;

    /// <summary>
    /// Applies one head-office catalogue to this host.
    ///
    /// One SaveChanges for the whole snapshot: a category without its products, or a product whose
    /// modifiers half-arrived, is not a state the till should ever be able to see.
    /// </summary>
    public async Task<CatalogApplyResult> ApplyAsync(
        Guid tenantId, Guid? branchId, CatalogSnapshot snapshot, CancellationToken ct = default)
    {
        var settings = await _db.TenantSettings.IgnoreQueryFilters()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);

        // The host's own policy, read from this disk — not the cloud's answer. This is the guard
        // that stops a pull silently overwriting work branch staff are allowed to do.
        if (settings == null || settings.CatalogControl != CatalogControl.HeadOfficeOnly)
            return CatalogApplyResult.Skipped("this host's catalogue is edited locally, not taken from head office");

        var localProducts = await _db.Products.IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId)
            .ToListAsync(ct);
        var activeLocally = localProducts.Count(p => p.IsActive);

        // An empty head office catalogue is almost always a read that went wrong, not a business
        // that deleted every item it sells. Refusing costs one missed pull; complying would blank
        // the till's menu.
        if (snapshot.Products.Count == 0 && activeLocally > 0)
            return CatalogApplyResult.Skipped(
                $"head office sent no products but this host has {activeLocally} active; refusing to retire them all");

        var reasons = new List<string>();

        // --- Categories: upsert by id, then retire the ones head office has dropped ---------
        var payloadCategoryIds = snapshot.Categories.Select(c => c.Id).ToHashSet();
        var localCategories = await _db.Categories.IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId)
            .ToListAsync(ct);

        // Looked up across every tenant on purpose: an id that already belongs to another business
        // must be reported, not collided with. Loaded by id rather than by tenant so that case is
        // visible at all.
        var categoriesById = payloadCategoryIds.Count == 0
            ? new Dictionary<Guid, Category>()
            : (await _db.Categories.IgnoreQueryFilters()
                    .Where(c => payloadCategoryIds.Contains(c.Id))
                    .ToListAsync(ct))
              .ToDictionary(c => c.Id);
        foreach (var local in localCategories)
            if (!categoriesById.ContainsKey(local.Id))
                categoriesById[local.Id] = local;

        int categoriesWritten = 0;
        foreach (var dto in snapshot.Categories)
        {
            if (categoriesById.TryGetValue(dto.Id, out var existing))
            {
                if (existing.TenantId != tenantId)
                {
                    reasons.Add($"category {dto.Id} belongs to another business");
                    continue;
                }
                existing.Name = dto.Name;
                existing.LocalName = dto.LocalName;
                existing.Icon = dto.Icon;
                existing.SortOrder = dto.SortOrder;
                existing.IsSample = dto.IsSample;
            }
            else
            {
                var created = new Category
                {
                    Id = dto.Id, TenantId = tenantId, Name = dto.Name, LocalName = dto.LocalName,
                    Icon = dto.Icon, SortOrder = dto.SortOrder, IsSample = dto.IsSample
                };
                _db.Categories.Add(created);
                categoriesById[created.Id] = created;
            }
            categoriesWritten++;
        }

        // Everything below may only point at a category this business owns. Foreign ones were left
        // in the map above so they can be seen in the reasons, but nothing may reference them.
        var usableCategoryIds = categoriesById
            .Where(kv => kv.Value.TenantId == tenantId)
            .Select(kv => kv.Key)
            .ToHashSet();

        // --- Products: upsert, assign categories, retire the rest --------------------------
        var payloadProductIds = snapshot.Products.Select(p => p.Id).ToHashSet();
        var productsById = payloadProductIds.Count == 0
            ? new Dictionary<Guid, Product>()
            : (await _db.Products.IgnoreQueryFilters()
                    .Where(p => payloadProductIds.Contains(p.Id))
                    .ToListAsync(ct))
              .ToDictionary(p => p.Id);

        int productsWritten = 0;
        var writtenProductIds = new HashSet<Guid>();

        foreach (var dto in snapshot.Products)
        {
            // Whatever happens to this record, it was present at head office — so it must not be
            // retired below just because the update could not be applied.
            writtenProductIds.Add(dto.Id);

            if (!usableCategoryIds.Contains(dto.CategoryId))
            {
                // A product pointing at a category neither side has would violate the foreign key
                // and take the whole batch down with it.
                reasons.Add($"product {dto.Id} references a category head office did not send");
                continue;
            }

            if (productsById.TryGetValue(dto.Id, out var product))
            {
                if (product.TenantId != tenantId)
                {
                    reasons.Add($"product {dto.Id} belongs to another business");
                    continue;
                }
            }
            else
            {
                product = new Product { Id = dto.Id, TenantId = tenantId };
                _db.Products.Add(product);
                productsById[dto.Id] = product;
            }

            product.CategoryId = dto.CategoryId;
            product.SKU = dto.SKU;
            product.Barcode = dto.Barcode;
            product.Name = dto.Name;
            product.UrduName = dto.UrduName;
            product.Description = dto.Description;
            // Cost is not on the wire: a branch's costing is its own (what it paid, per location),
            // and head office's cost is margin this endpoint should not be handing out.
            product.SellingPricePKR = dto.SellingPricePKR;
            product.Unit = dto.Unit;
            product.ImageUrl = dto.ImageUrl;
            product.Station = ParseEnum(dto.Station, KitchenStation.MainKitchen);
            product.IsActive = dto.IsActive;
            product.IsSample = dto.IsSample;
            productsWritten++;
        }

        // Retire, never delete: OrderItem rows point here, and losing a sale's line item to keep
        // the menu tidy would be a terrible trade.
        int productsRetired = 0;
        foreach (var local in localProducts)
        {
            if (writtenProductIds.Contains(local.Id) || !local.IsActive) continue;
            local.IsActive = false;
            productsRetired++;
        }

        // --- Categories head office dropped: remove only if nothing points at them ----------
        foreach (var local in localCategories)
        {
            if (payloadCategoryIds.Contains(local.Id)) continue;
            if (localProducts.Any(p => p.CategoryId == local.Id))
            {
                reasons.Add($"category '{local.Name}' is gone at head office but still holds items here");
                continue;
            }
            _db.Categories.Remove(local);
            categoriesById.Remove(local.Id);
            usableCategoryIds.Remove(local.Id);
        }

        // --- Modifiers: reconcile per product -----------------------------------------------
        var ingredientIds = snapshot.Modifiers
            .Where(m => m.IngredientId != null)
            .Select(m => m.IngredientId!.Value)
            .ToHashSet();
        var validIngredients = ingredientIds.Count == 0
            ? new HashSet<Guid>()
            : (await _db.Ingredients.IgnoreQueryFilters()
                    .Where(i => i.TenantId == tenantId && ingredientIds.Contains(i.Id))
                    .Select(i => i.Id)
                    .ToListAsync(ct))
              .ToHashSet();

        var payloadModifierIds = snapshot.Modifiers.Select(m => m.Id).ToHashSet();
        var byProductQuery = payloadProductIds.Count == 0
            ? new List<ProductModifier>()
            : await _db.ProductModifiers.IgnoreQueryFilters()
                .Where(m => payloadProductIds.Contains(m.ProductId))
                .ToListAsync(ct);
        var byIdQuery = payloadModifierIds.Count == 0
            ? new List<ProductModifier>()
            : await _db.ProductModifiers.IgnoreQueryFilters()
                .Where(m => payloadModifierIds.Contains(m.Id))
                .ToListAsync(ct);

        // Both lookups matter: the first is what a stale modifier is found through (and then
        // removed), the second is what an existing id is updated through — it may be attached to a
        // product this snapshot does not mention.
        var modifiersById = new Dictionary<Guid, ProductModifier>();
        foreach (var m in byProductQuery) modifiersById[m.Id] = m;
        foreach (var m in byIdQuery) modifiersById[m.Id] = m;

        foreach (var dto in snapshot.Modifiers)
        {
            if (!writtenProductIds.Contains(dto.ProductId)) continue; // its product was skipped

            // An ingredient id head office knows and this host does not is still a real stock
            // movement on the other side; the link is the only part that cannot be honoured.
            var ingredientId = dto.IngredientId;
            if (ingredientId != null && !validIngredients.Contains(ingredientId.Value))
            {
                reasons.Add($"modifier '{dto.Name}' ingredient {ingredientId} is unknown here");
                ingredientId = null;
            }

            if (!modifiersById.TryGetValue(dto.Id, out var modifier))
            {
                modifier = new ProductModifier { Id = dto.Id, ProductId = dto.ProductId };
                _db.ProductModifiers.Add(modifier);
                modifiersById[dto.Id] = modifier;
            }

            modifier.ProductId = dto.ProductId;
            modifier.Name = dto.Name;
            modifier.PricePKR = dto.PricePKR;
            modifier.IngredientId = ingredientId;
            modifier.IngredientQty = dto.IngredientQty;
        }

        foreach (var local in byProductQuery)
            if (!payloadModifierIds.Contains(local.Id))
                _db.ProductModifiers.Remove(local);

        // --- Per-branch prices --------------------------------------------------------------
        // Both sides must agree that branches do not price for themselves before this list is
        // treated as complete. If either says branches own their prices, the rows here are the
        // branch's own and are left exactly as they are.
        int pricesWritten = 0;
        if (branchId == null)
        {
            reasons.Add("this host's branch is unknown, so per-branch prices were left alone");
        }
        else if (settings.BranchPricing || snapshot.BranchPricing)
        {
            reasons.Add("branches set their own prices here, so per-branch prices were left alone");
        }
        else
        {
            var owningBranch = branchId.Value;
            var payloadPriceIds = snapshot.BranchPrices.Select(p => p.Id).ToHashSet();
            var localPrices = await _db.BranchProductPrices.IgnoreQueryFilters()
                .Where(p => p.TenantId == tenantId && p.BranchId == owningBranch)
                .ToListAsync(ct);

            foreach (var dto in snapshot.BranchPrices)
            {
                var local = localPrices.FirstOrDefault(p => p.Id == dto.Id);
                if (local == null)
                {
                    local = new BranchProductPrice
                    {
                        Id = dto.Id, TenantId = tenantId, BranchId = owningBranch
                    };
                    _db.BranchProductPrices.Add(local);
                }
                else if (local.TenantId != tenantId || local.BranchId != owningBranch)
                {
                    reasons.Add($"price override {dto.Id} is not this host's");
                    continue;
                }

                local.ProductId = dto.ProductId;
                local.SellingPricePKR = dto.SellingPricePKR;
                local.IsAvailable = dto.IsAvailable;
                local.UpdatedAt = dto.UpdatedAt;
                pricesWritten++;
            }

            foreach (var local in localPrices)
                if (!payloadPriceIds.Contains(local.Id))
                    _db.BranchProductPrices.Remove(local);
        }

        await _db.SaveChangesAsync(ct);

        return new CatalogApplyResult(true, null, categoriesWritten, productsWritten,
            productsRetired, pricesWritten, reasons);
    }

    private static TEnum ParseEnum<TEnum>(string? raw, TEnum fallback) where TEnum : struct, Enum =>
        !string.IsNullOrWhiteSpace(raw) && Enum.TryParse<TEnum>(raw, true, out var parsed) ? parsed : fallback;
}
