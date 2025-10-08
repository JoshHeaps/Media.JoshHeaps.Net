using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages
{
    public class IndexModel(UserService userService) : AuthenticatedPageModel
    {
        public UserDashboard? Dashboard { get; set; }

        public async Task<IActionResult> OnGetAsync()
        {
            RequireAuthentication();

            LoadUserSession();

            // Load user dashboard data
            Dashboard = await userService.GetUserDashboardAsync(UserId);

            return Page();
        }

        public async Task<IActionResult> OnPostAsync()
        {
            RequireAuthentication();

            LoadUserSession();

            return Page();
        }
    }
}
