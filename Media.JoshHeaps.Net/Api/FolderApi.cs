using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/folder")]
public class FolderApi : ControllerBase
{
    private readonly FolderService _folderService;

    public FolderApi(FolderService folderService)
    {
        _folderService = folderService;
    }

    [HttpGet("list")]
    public async Task<IActionResult> ListFolders([FromQuery] long? folderId = null)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var folders = await _folderService.GetUserFoldersAsync(userId.Value, folderId);
        return Ok(folders);
    }

    [HttpGet("path")]
    public async Task<IActionResult> GetFolderPath([FromQuery] long? folderId = null)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var path = await _folderService.GetFolderPathAsync(folderId, userId.Value);
        return Ok(path);
    }

    [HttpPost("create")]
    public async Task<IActionResult> CreateFolder([FromBody] CreateFolderRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { error = "Folder name is required" });
        }

        var folder = await _folderService.CreateFolderAsync(userId.Value, request.Name, request.ParentFolderId);
        if (folder == null)
        {
            return BadRequest(new { error = "Failed to create folder" });
        }

        return Ok(folder);
    }

    [HttpPut("rename")]
    public async Task<IActionResult> RenameFolder([FromBody] RenameFolderRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (string.IsNullOrWhiteSpace(request.NewName))
        {
            return BadRequest(new { error = "New folder name is required" });
        }

        var success = await _folderService.RenameFolderAsync(request.FolderId, userId.Value, request.NewName);
        if (!success)
        {
            return BadRequest(new { error = "Failed to rename folder" });
        }

        return Ok(new { success = true });
    }

    [HttpDelete("delete")]
    public async Task<IActionResult> DeleteFolder([FromQuery] long folderId, [FromQuery] bool deleteContents = false)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var success = await _folderService.DeleteFolderAsync(folderId, userId.Value, deleteContents);
        if (!success)
        {
            return BadRequest(new { error = "Failed to delete folder" });
        }

        return Ok(new { success = true });
    }

    [HttpPut("move")]
    public async Task<IActionResult> MoveFolder([FromBody] MoveFolderRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var success = await _folderService.MoveFolderAsync(request.FolderId, userId.Value, request.NewParentFolderId);
        if (!success)
        {
            return BadRequest(new { error = "Failed to move folder" });
        }

        return Ok(new { success = true });
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

public record CreateFolderRequest(string Name, long? ParentFolderId);
public record RenameFolderRequest(long FolderId, string NewName);
public record MoveFolderRequest(long FolderId, long? NewParentFolderId);
