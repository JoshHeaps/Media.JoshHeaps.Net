using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public class ResendVerificationModel : PageModel
{
    private readonly AuthService _authService;
    private readonly EmailService _emailService;

    [BindProperty]
    public string Email { get; set; } = string.Empty;

    public string? ErrorMessage { get; set; }
    public string? SuccessMessage { get; set; }

    public ResendVerificationModel(AuthService authService, EmailService emailService)
    {
        _authService = authService;
        _emailService = emailService;
    }

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

        var (success, error, verificationToken) = await _authService.ResendVerificationTokenAsync(Email);

        if (!success)
        {
            ErrorMessage = error ?? "Failed to resend verification email";
            return Page();
        }

        // Send verification email
        if (!string.IsNullOrEmpty(verificationToken))
        {
            var emailSent = await _emailService.SendVerificationEmailAsync(Email, Email, verificationToken);

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
