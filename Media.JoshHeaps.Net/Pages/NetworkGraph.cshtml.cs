using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages
{
    public class NetworkGraphModel(GraphService graphService) : AuthenticatedPageModel
    {
        private readonly GraphService _graphService = graphService;

        public List<GraphWithCounts> Graphs { get; set; } = [];
        public long? SelectedGraphId { get; set; }

        public async Task<IActionResult> OnGetAsync([FromQuery] long? graphId = null)
        {
            RequireAuthentication();
            LoadUserSession();

            Graphs = await _graphService.GetUserGraphsAsync(UserId);
            SelectedGraphId = graphId;

            return Page();
        }
    }
}
