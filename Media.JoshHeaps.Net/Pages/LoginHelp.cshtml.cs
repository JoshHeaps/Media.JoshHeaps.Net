using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public class LoginHelpModel(AuthService authService, EmailService emailService, ILogger<LoginHelpModel> logger) : PageModel
{
    [BindProperty]
    public string Email { get; set; } = string.Empty;

    [BindProperty]
    public string Token { get; set; } = string.Empty;

    [BindProperty]
    public string NewPassword { get; set; } = string.Empty;

    [BindProperty]
    public string ConfirmPassword { get; set; } = string.Empty;

    public string? ErrorMessage { get; set; }
    public string? SuccessMessage { get; set; }
    public bool ShowResetForm { get; set; }

    public async Task<IActionResult> OnGetAsync([FromQuery] string? token)
    {
        // Redirect if already logged in
        var userId = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userId))
            return Redirect("/Landing");

        if (!string.IsNullOrEmpty(token))
        {
            var (valid, error) = await authService.ValidatePasswordResetTokenAsync(token);
            if (valid)
            {
                ShowResetForm = true;
                Token = token;
            }
            else
            {
                ErrorMessage = error;
            }
        }

        return Page();
    }

    public async Task<IActionResult> OnPostRequestResetAsync()
    {
        // Redirect if already logged in
        var userId = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userId))
            return Redirect("/Landing");

        if (string.IsNullOrWhiteSpace(Email))
        {
            ErrorMessage = "Please enter your email address.";
            return Page();
        }

        var (success, error, token, username) = await authService.RequestPasswordResetAsync(Email.Trim());

        if (!success)
        {
            logger.LogError("Password reset request failed for {Email}: {Error}", Email, error);
        }

        // Send email if we got a token back (user exists and is eligible)
        if (token != null)
        {
            await emailService.SendPasswordResetEmailAsync(Email.Trim(), username ?? Email.Split('@')[0], token);
        }

        // Always show the same message regardless of whether the email exists
        SuccessMessage = "If an account exists with that email, you will receive a password reset link shortly.";
        return Page();
    }

    public async Task<IActionResult> OnPostResetPasswordAsync()
    {
        // Redirect if already logged in
        var userId = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userId))
            return Redirect("/Landing");

        if (string.IsNullOrWhiteSpace(NewPassword) || NewPassword.Length < 8)
        {
            ErrorMessage = "Password must be at least 8 characters.";
            ShowResetForm = true;
            return Page();
        }

        if (NewPassword != ConfirmPassword)
        {
            ErrorMessage = "Passwords do not match.";
            ShowResetForm = true;
            return Page();
        }

        var (success, error) = await authService.ResetPasswordAsync(Token, NewPassword);

        if (!success)
        {
            ErrorMessage = error;
            return Page();
        }

        return Redirect("/Login?reset=true");
    }
}
