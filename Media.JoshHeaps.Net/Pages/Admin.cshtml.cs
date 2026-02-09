using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages
{
    public class AdminModel(DbExecutor dbExecutor) : AuthenticatedPageModel
    {
        private readonly DbExecutor _dbExecutor = dbExecutor;

        public async Task<IActionResult> OnGetAsync()
        {
            RequireAuthentication();
            LoadUserSession();

            var denied = await RequireRole("admin", _dbExecutor);
            if (denied != null) return denied;

            return Page();
        }
    }
}
