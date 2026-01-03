using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/folder")]
public class FolderApi(FolderService folderService) : ControllerBase
{
    [HttpGet("list")]
    public async Task<IActionResult> ListFolders([FromQuery] long? folderId = null)
    {
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var folders = await folderService.GetUserFoldersAsync(userId.Value, folderId);
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

        var path = await folderService.GetFolderPathAsync(folderId, userId.Value);
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

        // If parent folder specified, check ownership (can't create in shared folders)
        if (request.ParentFolderId.HasValue)
        {
            var parentOwnerId = await folderService.GetFolderOwnerIdAsync(request.ParentFolderId.Value);
            if (parentOwnerId != userId.Value)
            {
                return Forbid("Cannot create folders in shared folders");
            }
        }

        var folder = await folderService.CreateFolderAsync(userId.Value, request.Name, request.ParentFolderId);
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

        // Check ownership (can't rename shared folders)
        var ownerId = await folderService.GetFolderOwnerIdAsync(request.FolderId);
        if (ownerId != userId.Value)
        {
            return Forbid("Cannot rename shared folders");
        }

        var success = await folderService.RenameFolderAsync(request.FolderId, userId.Value, request.NewName);
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

        // Check ownership (can't delete shared folders)
        var ownerId = await folderService.GetFolderOwnerIdAsync(folderId);
        if (ownerId != userId.Value)
        {
            return Forbid("Cannot delete shared folders");
        }

        var success = await folderService.DeleteFolderAsync(folderId, userId.Value, deleteContents);
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

        // Check ownership (can't move shared folders)
        var ownerId = await folderService.GetFolderOwnerIdAsync(request.FolderId);
        if (ownerId != userId.Value)
        {
            return Forbid("Cannot move shared folders");
        }

        var success = await folderService.MoveFolderAsync(request.FolderId, userId.Value, request.NewParentFolderId);
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
