using System.Security.Cryptography;
using System.Text;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages.Sso;

public class AuthorizeModel(DbExecutor db, IConfiguration config, ILogger<AuthorizeModel> logger) : AuthenticatedPageModel
{
    public async Task<IActionResult> OnGetAsync(
        [FromQuery(Name = "client_id")] string? clientId,
        [FromQuery(Name = "redirect_uri")] string? redirectUri,
        [FromQuery] string? state)
    {
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(redirectUri) || string.IsNullOrWhiteSpace(state))
        {
            return BadRequest("client_id, redirect_uri, and state are required");
        }

        var client = SsoClientRegistry.Find(config, clientId);
        if (client == null) return BadRequest("unknown client_id");
        if (!client.AllowsRedirectUri(redirectUri)) return BadRequest("redirect_uri is not registered for this client");

        if (!IsAuthenticated())
        {
            var original = $"/sso/authorize?client_id={Uri.EscapeDataString(clientId)}&redirect_uri={Uri.EscapeDataString(redirectUri)}&state={Uri.EscapeDataString(state)}";
            return Redirect($"/Login?ReturnUrl={Uri.EscapeDataString(original)}");
        }

        LoadUserSession();

        var code = GenerateCode();
        var codeHash = HashCode(code);
        var lifetime = int.TryParse(config["Sso:CodeLifetimeSeconds"], out var s) ? s : 60;
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(lifetime);

        await db.ExecuteNonQueryAsync(
            @"INSERT INTO app.sso_authorization_codes (code_hash, client_id, user_id, redirect_uri, expires_at)
              VALUES (@codeHash, @clientId, @userId, @redirectUri, @expiresAt)",
            new { codeHash, clientId, userId = UserId, redirectUri, expiresAt });

        logger.LogInformation("SSO code issued for user {UserId} to client {ClientId}", UserId, clientId);

        var separator = redirectUri.Contains('?') ? '&' : '?';
        return Redirect($"{redirectUri}{separator}code={Uri.EscapeDataString(code)}&state={Uri.EscapeDataString(state)}");
    }

    private static string GenerateCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');
    }

    private static string HashCode(string code)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(code));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
