using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public class VerificationPendingModel : PageModel
{
    public string Email { get; set; } = string.Empty;

    public IActionResult OnGet([FromQuery] string? email)
    {
        if (string.IsNullOrEmpty(email))
        {
            return Redirect("/Register");
        }

        Email = email;
        return Page();
    }
}
