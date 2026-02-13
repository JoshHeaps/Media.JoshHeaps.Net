using System.Text.RegularExpressions;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/theme")]
public partial class ThemeApi(ThemeService themeService) : ControllerBase
{
    private static readonly HashSet<string> ValidCssVariables =
    [
        "--bg-primary", "--bg-secondary", "--bg-tertiary", "--bg-hover",
        "--text-primary", "--text-secondary",
        "--border-primary", "--border-secondary",
        "--accent-primary", "--accent-hover",
        "--danger", "--danger-hover", "--success"
    ];

    [GeneratedRegex(@"^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColorRegex();

    [HttpGet("my")]
    public async Task<IActionResult> GetMyTheme()
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();

        var theme = await themeService.GetUserThemeAsync(userId.Value);
        if (theme == null)
        {
            return Ok(new { baseTheme = "light", colorOverrides = new Dictionary<string, string>() });
        }

        return Ok(new { baseTheme = theme.BaseTheme, colorOverrides = theme.ColorOverrides });
    }

    [HttpPut("my")]
    public async Task<IActionResult> SaveMyTheme([FromBody] SaveThemeRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null) return Unauthorized();

        if (request.BaseTheme != "dark" && request.BaseTheme != "light")
            return BadRequest("baseTheme must be 'dark' or 'light'");

        foreach (var (key, value) in request.ColorOverrides)
        {
            if (!ValidCssVariables.Contains(key))
                return BadRequest($"Invalid CSS variable: {key}");
            if (!HexColorRegex().IsMatch(value))
                return BadRequest($"Invalid hex color for {key}: {value}");
        }

        await themeService.SaveUserThemeAsync(userId.Value, request.BaseTheme, request.ColorOverrides);
        return Ok();
    }

    private long? GetUserIdFromAuth()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrEmpty(userIdClaim) && long.TryParse(userIdClaim, out var jwtUserId))
            return jwtUserId;

        var userIdString = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userIdString) && long.TryParse(userIdString, out var sessionUserId))
            return sessionUserId;

        return null;
    }
}

public record SaveThemeRequest(string BaseTheme, Dictionary<string, string> ColorOverrides);
