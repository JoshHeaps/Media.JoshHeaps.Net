using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages;

public class BreadboardEditorModel(BreadboardService breadboardService) : AuthenticatedPageModel
{
    public long ProjectId { get; private set; }
    public string ProjectName { get; private set; } = string.Empty;

    public async Task<IActionResult> OnGetAsync([FromQuery] long projectId)
    {
        RequireAuthentication();
        LoadUserSession();

        if (UserId == 0)
        {
            return Redirect("/Login");
        }

        // Ownership check lives in SQL, so someone else's project is simply not found. The
        // summary lookup deliberately skips the circuit — the editor module fetches the
        // document itself, and pulling it here would parse a multi-megabyte payload to throw away.
        var project = await breadboardService.GetProjectSummaryAsync(projectId, UserId);
        if (project == null)
        {
            return NotFound();
        }

        ProjectId = project.Id;
        ProjectName = project.Name;
        return Page();
    }
}
