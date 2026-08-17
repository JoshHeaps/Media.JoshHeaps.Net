using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages;

public class BreadboardModel(BreadboardService breadboardService) : AuthenticatedPageModel
{
    public List<BreadboardProjectSummary> Projects { get; private set; } = [];

    public async Task<IActionResult> OnGetAsync()
    {
        RequireAuthentication();
        LoadUserSession();

        // RequireAuthentication only queues a redirect, so bail out explicitly rather than
        // rendering the page against a zero user id.
        if (UserId == 0)
        {
            return Redirect("/Login");
        }

        Projects = await breadboardService.GetProjectsAsync(UserId);
        return Page();
    }
}
