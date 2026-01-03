using Media.JoshHeaps.Net.Services;
using Media.JoshHeaps.Net.Models;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/graph")]
public class GraphApi(GraphService graphService) : ControllerBase
{

    #region Graph Endpoints

    [HttpGet("list")]
    public async Task<IActionResult> ListGraphs()
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var graphs = await graphService.GetUserGraphsAsync(userId.Value);
        return Ok(graphs);
    }

    [HttpGet("{graphId}")]
    public async Task<IActionResult> GetGraph(long graphId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var graph = await graphService.GetGraphByIdAsync(graphId, userId.Value);
        if (graph == null)
        {
            return NotFound(new { error = "Graph not found" });
        }

        return Ok(graph);
    }

    [HttpGet("{graphId}/data")]
    public async Task<IActionResult> GetGraphData(long graphId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var graphData = await graphService.GetGraphDataAsync(graphId, userId.Value);
        if (graphData.Graph == null || graphData.Graph.Id == 0)
        {
            return NotFound(new { error = "Graph not found" });
        }

        return Ok(graphData);
    }

    [HttpPost("create")]
    public async Task<IActionResult> CreateGraph([FromBody] CreateGraphRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { error = "Graph name is required" });
        }

        var graph = await graphService.CreateGraphAsync(userId.Value, request.Name, request.Description);
        if (graph == null)
        {
            return BadRequest(new { error = "Failed to create graph" });
        }

        return Ok(graph);
    }

    [HttpPut("{graphId}")]
    public async Task<IActionResult> UpdateGraph(long graphId, [FromBody] UpdateGraphRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { error = "Graph name is required" });
        }

        var success = await graphService.UpdateGraphAsync(graphId, userId.Value, request.Name, request.Description);
        if (!success)
        {
            return BadRequest(new { error = "Failed to update graph" });
        }

        return Ok(new { success = true });
    }

    [HttpDelete("{graphId}")]
    public async Task<IActionResult> DeleteGraph(long graphId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var success = await graphService.DeleteGraphAsync(graphId, userId.Value);
        if (!success)
        {
            return BadRequest(new { error = "Failed to delete graph" });
        }

        return Ok(new { success = true });
    }

    [HttpPost("{graphId}/clone")]
    public async Task<IActionResult> CloneGraph(long graphId, [FromBody] CloneGraphRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(request.NewName))
        {
            return BadRequest(new { error = "New graph name is required" });
        }

        var newGraph = await graphService.CloneGraphAsync(graphId, userId.Value, request.NewName);
        if (newGraph == null)
        {
            return BadRequest(new { error = "Failed to clone graph" });
        }

        return Ok(newGraph);
    }

    #endregion

    #region Node Endpoints

    [HttpGet("{graphId}/nodes")]
    public async Task<IActionResult> GetNodes(long graphId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var nodes = await graphService.GetGraphNodesAsync(graphId, userId.Value);
        return Ok(nodes);
    }

    [HttpPost("{graphId}/nodes")]
    public async Task<IActionResult> CreateNode(long graphId, [FromBody] CreateNodeRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(request.Label))
        {
            return BadRequest(new { error = "Node label is required" });
        }

        var node = await graphService.CreateNodeAsync(graphId, userId.Value, request.Label, request.Notes);
        if (node == null)
        {
            return BadRequest(new { error = "Failed to create node" });
        }

        return Ok(node);
    }

    [HttpPut("nodes/{nodeId}")]
    public async Task<IActionResult> UpdateNode(long nodeId, [FromBody] UpdateNodeRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(request.Label))
        {
            return BadRequest(new { error = "Node label is required" });
        }

        var success = await graphService.UpdateNodeAsync(nodeId, userId.Value, request.Label, request.Notes);
        if (!success)
        {
            return BadRequest(new { error = "Failed to update node" });
        }

        return Ok(new { success = true });
    }

    [HttpDelete("nodes/{nodeId}")]
    public async Task<IActionResult> DeleteNode(long nodeId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var success = await graphService.DeleteNodeAsync(nodeId, userId.Value);
        if (!success)
        {
            return BadRequest(new { error = "Failed to delete node" });
        }

        return Ok(new { success = true });
    }

    [HttpGet("{graphId}/nodes/search")]
    public async Task<IActionResult> SearchNodes(long graphId, [FromQuery] string q)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(q))
        {
            return BadRequest(new { error = "Search term is required" });
        }

        var nodes = await graphService.SearchNodesAsync(graphId, userId.Value, q);
        return Ok(nodes);
    }

    #endregion

    #region Edge Endpoints

    [HttpGet("{graphId}/edges")]
    public async Task<IActionResult> GetEdges(long graphId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var edges = await graphService.GetGraphEdgesAsync(graphId, userId.Value);
        return Ok(edges);
    }

    [HttpPost("{graphId}/edges")]
    public async Task<IActionResult> CreateEdge(long graphId, [FromBody] CreateEdgeRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var edge = await graphService.CreateEdgeAsync(graphId, userId.Value, request.SourceNodeId, request.TargetNodeId);
        if (edge == null)
        {
            return BadRequest(new { error = "Failed to create edge" });
        }

        return Ok(edge);
    }

    [HttpDelete("edges/{edgeId}")]
    public async Task<IActionResult> DeleteEdge(long edgeId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var success = await graphService.DeleteEdgeAsync(edgeId, userId.Value);
        if (!success)
        {
            return BadRequest(new { error = "Failed to delete edge" });
        }

        return Ok(new { success = true });
    }

    #endregion

    #region Filter Endpoints

    [HttpGet("{graphId}/nodes/filter/connects-to/{targetNodeId}")]
    public async Task<IActionResult> FilterConnectsTo(long graphId, long targetNodeId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var nodes = await graphService.FilterConnectsToAsync(graphId, userId.Value, targetNodeId);
        return Ok(nodes);
    }

    [HttpGet("{graphId}/nodes/filter/not-connects-to/{targetNodeId}")]
    public async Task<IActionResult> FilterDoesNotConnectTo(long graphId, long targetNodeId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var nodes = await graphService.FilterDoesNotConnectToAsync(graphId, userId.Value, targetNodeId);
        return Ok(nodes);
    }

    [HttpGet("{graphId}/nodes/filter/two-degrees/{targetNodeId}")]
    public async Task<IActionResult> FilterTwoDegrees(long graphId, long targetNodeId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var nodes = await graphService.FilterConnectsTwoDegreesAsync(graphId, userId.Value, targetNodeId);
        return Ok(nodes);
    }

    #endregion

    #region Helper Methods

    private long? GetUserIdFromAuth()
    {
        // First try JWT claims (for mobile/API authentication)
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrEmpty(userIdClaim) && long.TryParse(userIdClaim, out var jwtUserId))
        {
            return jwtUserId;
        }

        // Fall back to session (for web authentication)
        var userIdString = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userIdString) && long.TryParse(userIdString, out var sessionUserId))
        {
            return sessionUserId;
        }

        return null;
    }

    #endregion
}

#region Request Models

public record CreateGraphRequest(string Name, string? Description);
public record UpdateGraphRequest(string Name, string? Description);
public record CloneGraphRequest(string NewName);
public record CreateNodeRequest(string Label, string? Notes);
public record UpdateNodeRequest(string Label, string? Notes);
public record CreateEdgeRequest(long SourceNodeId, long TargetNodeId);

#endregion
