using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("sso")]
public class SsoApi(DbExecutor db, IConfiguration config, ILogger<SsoApi> logger) : ControllerBase
{
    [HttpPost("token")]
    public async Task<IActionResult> Exchange([FromBody] SsoTokenRequest request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.ClientId) || string.IsNullOrWhiteSpace(request.Code))
        {
            return BadRequest(new { error = "client_id and code are required" });
        }

        if (!Request.Headers.TryGetValue("X-Client-Secret", out var providedSecret) || string.IsNullOrWhiteSpace(providedSecret))
        {
            return Unauthorized(new { error = "missing client credentials" });
        }

        var client = SsoClientRegistry.Find(config, request.ClientId);
        if (client == null || !BCrypt.Net.BCrypt.Verify(providedSecret!, client.ClientSecretHash))
        {
            logger.LogWarning("SSO token exchange failed: bad client credentials for {ClientId}", request.ClientId);
            return Unauthorized(new { error = "invalid client credentials" });
        }

        var codeHash = HashCode(request.Code);
        var row = await ConsumeCodeAsync(codeHash);
        if (row == null)
        {
            return BadRequest(new { error = "invalid, expired, or already-used code" });
        }

        if (!string.Equals(row.Value.ClientId, request.ClientId, StringComparison.Ordinal))
        {
            return BadRequest(new { error = "code was issued for a different client" });
        }

        if (!client.AllowsRedirectUri(row.Value.RedirectUri))
        {
            return BadRequest(new { error = "redirect_uri mismatch" });
        }

        var user = await LoadUserAsync(row.Value.UserId);
        if (user == null)
        {
            return BadRequest(new { error = "user no longer exists" });
        }

        var jwt = IssueToken(user, request.ClientId);
        return Ok(new SsoTokenResponse
        {
            AccessToken = jwt,
            TokenType = "Bearer",
            ExpiresIn = 300
        });
    }

    private async Task<(long UserId, string ClientId, string RedirectUri)?> ConsumeCodeAsync(string codeHash)
    {
        var connectionString = config["connectionString"]!;
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        long userId;
        string clientId;
        string redirectUri;

        await using (var select = new NpgsqlCommand(
            @"SELECT user_id, client_id, redirect_uri
              FROM app.sso_authorization_codes
              WHERE code_hash = @h
                AND consumed_at IS NULL
                AND expires_at > NOW()
              FOR UPDATE", conn, tx))
        {
            select.Parameters.AddWithValue("@h", codeHash);
            await using var reader = await select.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return null;
            userId = reader.GetInt64(0);
            clientId = reader.GetString(1);
            redirectUri = reader.GetString(2);
        }

        await using (var update = new NpgsqlCommand(
            "UPDATE app.sso_authorization_codes SET consumed_at = NOW() WHERE code_hash = @h",
            conn, tx))
        {
            update.Parameters.AddWithValue("@h", codeHash);
            await update.ExecuteNonQueryAsync();
        }

        await tx.CommitAsync();
        return (userId, clientId, redirectUri);
    }

    private async Task<SsoUser?> LoadUserAsync(long userId)
    {
        return await db.ExecuteReaderAsync(
            "SELECT id, email, username, email_verified FROM app.users WHERE id = @userId AND is_active = true",
            reader => new SsoUser
            {
                Id = reader.GetInt64(0),
                Email = reader.GetString(1),
                Username = reader.GetString(2),
                EmailVerified = reader.GetBoolean(3)
            },
            new { userId });
    }

    private string IssueToken(SsoUser user, string audience)
    {
        var jwtKey = config["Jwt:Key"] ?? throw new InvalidOperationException("JWT Key not configured");
        var jwtIssuer = config["Jwt:Issuer"] ?? throw new InvalidOperationException("JWT Issuer not configured");

        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim("EmailVerified", user.EmailVerified.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N"))
        };

        var token = new JwtSecurityToken(
            issuer: jwtIssuer,
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static string HashCode(string code)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(code));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

public sealed class SsoTokenRequest
{
    public string ClientId { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
}

public sealed class SsoTokenResponse
{
    public string AccessToken { get; set; } = string.Empty;
    public string TokenType { get; set; } = "Bearer";
    public int ExpiresIn { get; set; }
}

internal sealed class SsoUser
{
    public long Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public bool EmailVerified { get; set; }
}
