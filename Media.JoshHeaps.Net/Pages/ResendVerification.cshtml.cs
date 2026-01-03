using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public class ResendVerificationModel(AuthService authService, EmailService emailService) : PageModel
{
    [BindProperty]
    public string Email { get; set; } = string.Empty;

    public string? ErrorMessage { get; set; }
    public string? SuccessMessage { get; set; }

    public void OnGet([FromQuery] string? email)
    {
        if (!string.IsNullOrEmpty(email))
        {
            Email = email;
        }
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (string.IsNullOrWhiteSpace(Email))
        {
            ErrorMessage = "Email is required";
            return Page();
        }

        var (success, error, verificationToken) = await authService.ResendVerificationTokenAsync(Email);

        if (!success)
        {
            ErrorMessage = error ?? "Failed to resend verification email";
            return Page();
        }

        // Send verification email
        if (!string.IsNullOrEmpty(verificationToken))
        {
            var emailSent = await emailService.SendVerificationEmailAsync(Email, Email, verificationToken);

            if (emailSent)
            {
                SuccessMessage = "Verification email sent! Please check your inbox.";
            }
            else
            {
                ErrorMessage = "Failed to send email. Please try again later.";
                return Page();
            }
        }

        return Page();
    }
}
