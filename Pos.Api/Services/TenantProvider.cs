namespace Pos.Api.Services;

public interface ITenantProvider
{
    Guid? TenantId { get; }
}

public class TenantProvider : ITenantProvider
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public TenantProvider(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public Guid? TenantId
    {
        get
        {
            if (_httpContextAccessor.HttpContext?.Items["TenantId"] is Guid tenantId)
                return tenantId;
            return null;
        }
    }
}
