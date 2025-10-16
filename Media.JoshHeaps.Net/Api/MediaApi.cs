using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/media")]
public class MediaApi : ControllerBase
{
    private readonly MediaService _mediaService;

    public MediaApi(MediaService mediaService)
    {
        _mediaService = mediaService;
    }

    [HttpGet("load")]
    public async Task<IActionResult> LoadMedia([FromQuery] int offset = 0, [FromQuery] int limit = 20)
    {
        // Get user ID from JWT claims or session
        var userId = GetUserIdFromAuth();
        if (userId == null)
        {
            return Unauthorized();
        }

        var media = await _mediaService.GetUserMediaAsync(userId.Value, offset, limit);

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
