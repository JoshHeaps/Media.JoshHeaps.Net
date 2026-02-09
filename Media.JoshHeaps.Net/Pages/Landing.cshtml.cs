using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages
{
    public class LandingModel(DbExecutor dbExecutor) : AuthenticatedPageModel
    {
        public bool IsAdmin { get; set; }

        public async Task<IActionResult> OnGetAsync()
        {
            RequireAuthentication();
            LoadUserSession();

            IsAdmin = await dbExecutor.ExecuteAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM app.user_roles ur JOIN app.roles r ON ur.role_id = r.id WHERE ur.user_id = @UserId AND r.name = 'admin')",
                new { UserId });

            return Page();
        }
    }
}
