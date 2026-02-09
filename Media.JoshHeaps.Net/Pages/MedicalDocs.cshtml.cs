using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages
{
    public class MedicalDocsModel(DbExecutor dbExecutor) : AuthenticatedPageModel
    {
        private readonly DbExecutor _dbExecutor = dbExecutor;

        public async Task<IActionResult> OnGetAsync()
        {
            RequireAuthentication();
            LoadUserSession();

            var denied = await RequireRole("medical", _dbExecutor);
            if (denied != null) return denied;

            return Page();
        }
    }
}
