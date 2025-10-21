using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/media")]
public class MediaApi : ControllerBase
{
    private readonly MediaService _mediaService;
    private readonly FolderService _folderService;

    public MediaApi(MediaService mediaService, FolderService folderService)
    {
        _mediaService = mediaService;
        _folderService = folderService;
    }

    [HttpGet("load")]
    public async Task<IActionResult> LoadMedia([FromQuery] int offset = 0, [FromQuery] int limit = 20, [FromQuery] long? folderId = null)
    {
        // Get user ID from JWT claims or session
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized();
        }

        var media = await _mediaService.GetUserMediaAsync(userId.Value, offset, limit, folderId, userId.Value);

        return Ok(media);
    }

    [HttpGet("image/{mediaId}")]
    public async Task<IActionResult> GetImage(long mediaId)
    {
        // Get user ID from JWT claims or session
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        // Get media metadata (includes ownership check)
        var media = await _mediaService.GetMediaByIdAsync(mediaId, userId.Value);
        if (media == null)
        {
            return NotFound(new { error = "Image not found or access denied" });
        }

        // Get decrypted image data
        var imageData = await _mediaService.GetDecryptedMediaDataAsync(mediaId, userId.Value);
        if (imageData == null)
        {
            return NotFound(new { error = "Image file not found" });
        }

        // Return image with proper content type
        return File(imageData, media.MimeType);
    }

    [HttpPost("upload")]
    public async Task<IActionResult> UploadImage([FromForm] IFormFile file, [FromForm] string? description, [FromForm] long? folderId)
    {
        // Get user ID from JWT claims or session
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        // Check folder ownership if uploading to a folder (can't upload to shared folders)
        if (folderId.HasValue)
        {
            var ownerId = await _folderService.GetFolderOwnerIdAsync(folderId.Value);
            if (ownerId != userId.Value)
            {
                return Forbid("Cannot upload to shared folders");
            }
        }

        if (file == null || file.Length == 0)
        {
            return BadRequest(new { error = "No file provided" });
        }

        // Validate file type
        var allowedTypes = new[] { "image/jpeg", "image/png", "image/gif", "image/webp" };
        if (!allowedTypes.Contains(file.ContentType.ToLower()))
        {
            return BadRequest(new { error = "Invalid file type. Only images (JPG, PNG, GIF, WEBP) are allowed" });
        }

        // Validate file size (10MB limit)
        if (file.Length > 10 * 1024 * 1024)
        {
            return BadRequest(new { error = "File size exceeds 10MB limit" });
        }

        // Save media using existing service
        var media = await _mediaService.SaveMediaAsync(userId.Value, file, description, folderId);
        if (media == null)
        {
            return StatusCode(500, new { error = "Failed to upload image" });
        }

        return Ok(media);
    }

    [HttpPut("move")]
    public async Task<IActionResult> MoveMedia([FromBody] MoveMediaRequest request)
    {
        // Get user ID from JWT claims or session
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var success = await _mediaService.MoveMediaToFolderAsync(request.MediaId, userId.Value, request.FolderId);
        if (!success)
        {
            return BadRequest(new { error = "Failed to move media" });
        }

        return Ok(new { success = true });
    }

    [HttpPut("move-bulk")]
    public async Task<IActionResult> MoveBulkMedia([FromBody] MoveBulkMediaRequest request)
    {
        // Get user ID from JWT claims or session
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        if (request.MediaIds == null || !request.MediaIds.Any())
        {
            return BadRequest(new { error = "No media IDs provided" });
        }

        var successCount = 0;
        var failedIds = new List<long>();

        foreach (var mediaId in request.MediaIds)
        {
            var success = await _mediaService.MoveMediaToFolderAsync(mediaId, userId.Value, request.FolderId);
            if (success)
            {
                successCount++;
            }
            else
            {
                failedIds.Add(mediaId);
            }
        }

        return Ok(new {
            success = failedIds.Count == 0,
            movedCount = successCount,
            failedCount = failedIds.Count,
            failedIds = failedIds
        });
    }

    /// <summary>
    /// Gets user ID from either JWT claims (for API) or session (for web)
    /// </summary>
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

public record MoveMediaRequest(long MediaId, long? FolderId);
public record MoveBulkMediaRequest(List<long> MediaIds, long? FolderId);
