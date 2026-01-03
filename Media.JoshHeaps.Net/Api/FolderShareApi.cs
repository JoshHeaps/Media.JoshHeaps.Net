using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/folder-share")]
public class FolderShareApi(FolderService folderService, UserService userService) : ControllerBase
{
    [HttpPost("share")]
    public async Task<IActionResult> ShareFolder([FromBody] ShareFolderRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var share = await folderService.ShareFolderAsync(request.FolderId, userId.Value, request.SharedWithUserId);
        if (share == null)
        {
            return BadRequest(new { error = "Failed to share folder" });
        }

        return Ok(share);
    }

    [HttpDelete("unshare")]
    public async Task<IActionResult> UnshareFolder([FromQuery] long folderId, [FromQuery] long sharedWithUserId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var success = await folderService.UnshareFolderAsync(folderId, userId.Value, sharedWithUserId);
        if (!success)
        {
            return BadRequest(new { error = "Failed to unshare folder" });
        }

        return Ok(new { success = true });
    }

    [HttpGet("list-shares")]
    public async Task<IActionResult> ListShares([FromQuery] long folderId)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var shares = await folderService.GetFolderSharesAsync(folderId, userId.Value);
        return Ok(shares);
    }

    [HttpGet("shared-with-me")]
    public async Task<IActionResult> GetSharedWithMe()
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var sharedFolders = await folderService.GetSharedFoldersAsync(userId.Value);
        return Ok(sharedFolders);
    }

    [HttpGet("search-users")]
    public async Task<IActionResult> SearchUsers([FromQuery] string query)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(query) || query.Length < 2)
        {
            return Ok(new List<object>());
        }

        var users = await userService.SearchUsersAsync(query, userId.Value);
        return Ok(users);
    }

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
}

public record ShareFolderRequest(long FolderId, long SharedWithUserId);
