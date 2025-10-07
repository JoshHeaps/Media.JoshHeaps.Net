using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public class VerifyEmailModel : PageModel
{
    private readonly AuthService _authService;

    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public bool ShowResendLink { get; set; }

    public VerifyEmailModel(AuthService authService)
    {
        _authService = authService;
    }

    public async Task<IActionResult> OnGetAsync([FromQuery] string? token)
    {
        if (string.IsNullOrEmpty(token))
        {
            Success = false;
            Message = "Invalid verification link";
            ShowResendLink = false;
            return Page();
        }

        var (success, error) = await _authService.VerifyEmailAsync(token);

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
