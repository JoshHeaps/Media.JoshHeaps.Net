using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/auth")]
public class AuthApi(AuthService authService, IConfiguration configuration) : ControllerBase
{
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.EmailOrUsername) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { error = "Email/username and password are required" });
        }

        var (success, error, userInfo) = await authService.LoginAsync(request.EmailOrUsername, request.Password);

        if (!success || userInfo == null)
        {
            return Unauthorized(new { error = error ?? "Invalid credentials" });
        }

        // Generate JWT token
        var token = GenerateJwtToken(userInfo);

        return Ok(new LoginResponse
        {
            Token = token,
            User = userInfo
        });
    }

    [Authorize]
    [HttpPost("validate")]
    public IActionResult Validate()
    {
        // If we get here, the JWT token is valid
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var email = User.FindFirst(ClaimTypes.Email)?.Value;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        var emailVerified = User.FindFirst("EmailVerified")?.Value;

        if (string.IsNullOrEmpty(userId))
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        return Ok(new
        {
            user = new UserLoginInfo
            {
                Id = long.Parse(userId),
                Email = email ?? string.Empty,
                Username = username ?? string.Empty,
                EmailVerified = bool.Parse(emailVerified ?? "false"),
                IsActive = true
            }
        });
    }

    private string GenerateJwtToken(UserLoginInfo user)
    {
        var jwtKey = configuration["Jwt:Key"] ?? throw new InvalidOperationException("JWT Key not configured");
        var jwtIssuer = configuration["Jwt:Issuer"] ?? throw new InvalidOperationException("JWT Issuer not configured");
        var jwtAudience = configuration["Jwt:Audience"] ?? throw new InvalidOperationException("JWT Audience not configured");
        var jwtExpiryDays = int.Parse(configuration["Jwt:ExpiryInDays"] ?? "30");

        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim("EmailVerified", user.EmailVerified.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: jwtIssuer,
            audience: jwtAudience,
            claims: claims,
            expires: DateTime.UtcNow.AddDays(jwtExpiryDays),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

// Request/Response models
public class LoginRequest
{
    public string EmailOrUsername { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class LoginResponse
{
    public string Token { get; set; } = string.Empty;
    public UserLoginInfo User { get; set; } = new();
}
