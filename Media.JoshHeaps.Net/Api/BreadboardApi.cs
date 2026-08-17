using System.Security.Claims;
using System.Text.Json;
using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/breadboard")]
public class BreadboardApi(BreadboardService breadboardService) : ControllerBase
{
    /// <summary>
    /// Pipeline-level guard so an oversized body is rejected before it is buffered into a
    /// string. The validator's 2 MB circuit cap is the real limit; the extra megabyte is
    /// headroom for the JSON envelope around it.
    /// </summary>
    private const long MaxRequestBodyBytes = 3L * 1024 * 1024;

    [HttpGet("projects")]
    public async Task<IActionResult> ListProjects()
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(Problems("Not authenticated"));
        }

        var projects = await breadboardService.GetProjectsAsync(userId.Value);
        return Ok(projects);
    }

    [HttpPost("projects")]
    [RequestSizeLimit(MaxRequestBodyBytes)]
    public async Task<IActionResult> CreateProject([FromBody] CreateBreadboardProjectRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(Problems("Not authenticated"));
        }

        var result = await breadboardService.CreateProjectAsync(userId.Value, request.Name, request.Description);
        return MapResult(result);
    }

    [HttpGet("projects/{projectId:long}")]
    public async Task<IActionResult> GetProject(long projectId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(Problems("Not authenticated"));
        }

        var project = await breadboardService.GetProjectAsync(projectId, userId.Value);
        if (project == null)
        {
            return NotFound(Problems(BreadboardResult.NotFoundMessage));
        }

        return Ok(project);
    }

    [HttpPut("projects/{projectId:long}")]
    [RequestSizeLimit(MaxRequestBodyBytes)]
    public async Task<IActionResult> UpdateProject(long projectId, [FromBody] UpdateBreadboardProjectRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(Problems("Not authenticated"));
        }

        var result = await breadboardService.UpdateProjectAsync(
            projectId,
            userId.Value,
            request.Name,
            request.Description,
            RawCircuit(request.Circuit));

        return MapResult(result);
    }

    [HttpDelete("projects/{projectId:long}")]
    public async Task<IActionResult> DeleteProject(long projectId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(Problems("Not authenticated"));
        }

        var result = await breadboardService.DeleteProjectAsync(projectId, userId.Value);
        return MapResult(result);
    }

    /// <summary>A project that belongs to someone else is reported as missing, never as forbidden.</summary>
    private IActionResult MapResult(BreadboardResult result) => result.Outcome switch
    {
        BreadboardOutcome.Success => result.Project is null ? NoContent() : Ok(result.Project),
        BreadboardOutcome.NotFound => NotFound(new { errors = result.Errors }),
        BreadboardOutcome.Invalid => BadRequest(new { errors = result.Errors }),
        _ => StatusCode(StatusCodes.Status500InternalServerError, new { errors = result.Errors })
    };

    private static object Problems(string message) => new { errors = new[] { message } };

    /// <summary>
    /// An omitted circuit and an explicit JSON null both mean "leave the circuit alone".
    /// Anything else is handed to the service as raw text — the server never reshapes the document.
    /// </summary>
    private static string? RawCircuit(JsonElement? circuit) =>
        circuit is { ValueKind: not JsonValueKind.Undefined and not JsonValueKind.Null } element
            ? element.GetRawText()
            : null;

    /// <summary>
    /// JWT first, then the session cookie — the repo-wide pattern.
    /// CSRF note: the session path carries no antiforgery token, and is safe today only
    /// because of three framework defaults — session cookies are SameSite=Lax, no CORS policy
    /// is registered, and an application/json body forces a preflight. Adding a permissive
    /// CORS policy or SameSite=None anywhere in this app makes these writes CSRF-able.
    /// </summary>
    private long? GetUserIdFromAuth()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrEmpty(userIdClaim) && long.TryParse(userIdClaim, out var jwtUserId))
            return jwtUserId;

        var userIdString = HttpContext.Session.GetString("UserId");
        if (!string.IsNullOrEmpty(userIdString) && long.TryParse(userIdString, out var sessionUserId))
            return sessionUserId;

        return null;
    }
}

public record CreateBreadboardProjectRequest(string? Name, string? Description);

public record UpdateBreadboardProjectRequest(string? Name, string? Description, JsonElement? Circuit);
