using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public class LoginModel(AuthService authService) : PageModel
{
    [BindProperty]
    public string Email { get; set; } = string.Empty;

    [BindProperty]
    public string Password { get; set; } = string.Empty;

    [BindProperty]
    public bool RememberMe { get; set; }

    public string? ErrorMessage { get; set; }
    public string? SuccessMessage { get; set; }
    public string? WarningMessage { get; set; }

    public void OnGet([FromQuery] string? registered, [FromQuery] string? verified)
    {
        // Check if user is already logged in
        var userId = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userId))
        {
            Response.Redirect("/Landing");
            return;
        }

        // Show success message if coming from registration
        if (registered == "true")
        {
            SuccessMessage = "Registration successful! Please check your email to verify your account.";
        }

        // Show success message if email was just verified
        if (verified == "true")
        {
            SuccessMessage = "Email verified! You can now sign in.";
        }
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (string.IsNullOrWhiteSpace(Email) || string.IsNullOrWhiteSpace(Password))
        {
            ErrorMessage = "Email/username and password are required";
            return Page();
        }

        var (success, error, userInfo) = await authService.LoginAsync(Email, Password);

        if (!success || userInfo == null)
        {
            ErrorMessage = error ?? "Login failed";
            return Page();
        }

        // Set session
        HttpContext.Session.SetString("UserId", userInfo.Id.ToString());
        HttpContext.Session.SetString("Username", userInfo.Username);
        HttpContext.Session.SetString("Email", userInfo.Email);
        HttpContext.Session.SetString("EmailVerified", userInfo.EmailVerified.ToString());

        // Show warning if email not verified (but still allow login)
        if (!userInfo.EmailVerified)
        {
            WarningMessage = $"Your email is not verified. <a href='/ResendVerification?email={Uri.EscapeDataString(userInfo.Email)}'>Resend verification email</a>";
        }

        // Set cookie if remember me is checked
        if (RememberMe)
        {
            var cookieOptions = new CookieOptions
            {
                Expires = DateTimeOffset.UtcNow.AddDays(30),
                HttpOnly = true,
                Secure = true,
                SameSite = SameSiteMode.Strict
            };
            Response.Cookies.Append("RememberMe", userInfo.Id.ToString(), cookieOptions);
        }

        return Redirect("/Landing");
    }
}
