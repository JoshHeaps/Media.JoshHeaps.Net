namespace Media.JoshHeaps.Net.Services;

public sealed class SsoClientConfig
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecretHash { get; set; } = string.Empty;
    public List<string> RedirectUris { get; set; } = [];
    public string Name { get; set; } = string.Empty;

    public bool AllowsRedirectUri(string uri) =>
        RedirectUris.Any(r => string.Equals(r, uri, StringComparison.Ordinal));
}

public static class SsoClientRegistry
{
    public static SsoClientConfig? Find(IConfiguration config, string clientId)
    {
        var clients = config.GetSection("Sso:Clients").Get<List<SsoClientConfig>>() ?? [];
        return clients.FirstOrDefault(c => string.Equals(c.ClientId, clientId, StringComparison.Ordinal));
    }
}
