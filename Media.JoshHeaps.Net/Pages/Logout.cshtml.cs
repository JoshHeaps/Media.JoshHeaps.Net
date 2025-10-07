using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages;

public class LogoutModel : PageModel
{
    public IActionResult OnGet()
    {
        // Clear session
        HttpContext.Session.Clear();

        // Clear remember me cookie if exists
        if (Request.Cookies.ContainsKey("RememberMe"))
        {
            Response.Cookies.Delete("RememberMe");
        }

        // Redirect to login page
        return Redirect("/Login");
    }

    public IActionResult OnPost()
    {
        // Same as OnGet
        return OnGet();
    }
}
