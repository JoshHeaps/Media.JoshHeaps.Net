using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Media.JoshHeaps.Net.Pages
{
    public class LandingModel : AuthenticatedPageModel
    {
        public void OnGet()
        {
            RequireAuthentication();
        }
    }
}
