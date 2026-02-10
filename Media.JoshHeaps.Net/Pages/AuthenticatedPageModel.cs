using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public abstract class AuthenticatedPageModel : PageModel
{
    protected async Task<IActionResult?> RequireRole(string role, DbExecutor dbExecutor)
    {
        var hasRole = await dbExecutor.ExecuteAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM app.user_roles ur JOIN app.roles r ON ur.role_id = r.id WHERE ur.user_id = @UserId AND r.name = @Role)",
            new { UserId, Role = role });

        return hasRole ? null : NotFound();
    }

    public long UserId { get; private set; }
    protected string Username { get; private set; } = string.Empty;
    protected string Email { get; private set; } = string.Empty;
    protected bool EmailVerified { get; private set; }

    protected bool IsAuthenticated()
    {
        var userIdStr = HttpContext.Session.GetString("UserId");
        return !string.IsNullOrEmpty(userIdStr);
    }

    protected void LoadUserSession()
    {
        var userIdStr = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userIdStr) && long.TryParse(userIdStr, out var userId))
        {
            UserId = userId;
            Username = HttpContext.Session.GetString("Username") ?? string.Empty;
            Email = HttpContext.Session.GetString("Email") ?? string.Empty;
            var emailVerifiedStr = HttpContext.Session.GetString("EmailVerified");
            EmailVerified = bool.TryParse(emailVerifiedStr, out var verified) && verified;
        }
    }

    protected void RequireAuthentication()
    {
        if (!IsAuthenticated())
        {
            Response.Redirect("/Login");
        }
    }
}
