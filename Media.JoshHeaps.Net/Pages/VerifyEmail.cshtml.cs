using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public class VerifyEmailModel(AuthService authService) : PageModel
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public bool ShowResendLink { get; set; }

    public async Task<IActionResult> OnGetAsync([FromQuery] string? token)
    {
        if (string.IsNullOrEmpty(token))
        {
            Success = false;
            Message = "Invalid verification link";
            ShowResendLink = false;
            return Page();
        }

        var (success, error) = await authService.VerifyEmailAsync(token);

        Success = success;

        if (success)
        {
            Message = "Your email has been successfully verified!";
            ShowResendLink = false;
        }
        else
        {
            Message = error ?? "Verification failed";
            // Show resend link if token expired
            ShowResendLink = error?.Contains("expired", StringComparison.OrdinalIgnoreCase) ?? false;
        }

        return Page();
    }
}
