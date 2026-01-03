using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.Text.RegularExpressions;

namespace Media.JoshHeaps.Net.Pages;

public class RegisterModel(AuthService authService, EmailService emailService) : PageModel
{
    [BindProperty]
    public string Email { get; set; } = string.Empty;

    [BindProperty]
    public string Username { get; set; } = string.Empty;

    [BindProperty]
    public string Password { get; set; } = string.Empty;

    [BindProperty]
    public string ConfirmPassword { get; set; } = string.Empty;

    public string? ErrorMessage { get; set; }

    public void OnGet()
    {
        // Check if user is already logged in
        var userId = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userId))
        {
            Response.Redirect("/");
        }
    }

    public async Task<IActionResult> OnPostAsync()
    {
        // Validation
        if (string.IsNullOrWhiteSpace(Email) || string.IsNullOrWhiteSpace(Username) ||
            string.IsNullOrWhiteSpace(Password) || string.IsNullOrWhiteSpace(ConfirmPassword))
        {
            ErrorMessage = "All fields are required";
            return Page();
        }

        // Validate email format
        if (!IsValidEmail(Email))
        {
            ErrorMessage = "Please enter a valid email address";
            return Page();
        }

        // Validate username format
        if (!IsValidUsername(Username))
        {
            ErrorMessage = "Username must be 3-50 characters, alphanumeric and underscores only";
            return Page();
        }

        // Validate password length
        if (Password.Length < 8)
        {
            ErrorMessage = "Password must be at least 8 characters";
            return Page();
        }

        // Validate password match
        if (Password != ConfirmPassword)
        {
            ErrorMessage = "Passwords do not match";
            return Page();
        }

        // Register user
        var (success, error, verificationToken) = await authService.RegisterUserAsync(Email, Username, Password);

        if (!success)
        {
            ErrorMessage = error ?? "Registration failed";
            return Page();
        }

        // Send verification email
        if (!string.IsNullOrEmpty(verificationToken))
        {
            await emailService.SendVerificationEmailAsync(Email, Username, verificationToken);
        }

        // Redirect to verification pending page
        return Redirect("/VerificationPending?email=" + Uri.EscapeDataString(Email));
    }

    private bool IsValidEmail(string email)
    {
        try
        {
            var regex = new Regex(@"^[^\s@]+@[^\s@]+\.[^\s@]+$");
            return regex.IsMatch(email);
        }
        catch
        {
            return false;
        }
    }

    private bool IsValidUsername(string username)
    {
        try
        {
            var regex = new Regex(@"^[a-zA-Z0-9_]{3,50}$");
            return regex.IsMatch(username);
        }
        catch
        {
            return false;
        }
    }
}
