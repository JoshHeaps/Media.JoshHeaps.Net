using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

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
        // Get user ID from session
        var userIdString = HttpContext.Session.GetString("UserId");
        if (string.IsNullOrEmpty(userIdString))
        {
            return Unauthorized();
        }

        var userId = long.Parse(userIdString);
        var media = await _mediaService.GetUserMediaAsync(userId, offset, limit);

        return Ok(media);
    }

    [HttpGet("image/{mediaId}")]
    public async Task<IActionResult> GetImage(long mediaId)
    {
        // Get user ID from session
        var userIdString = HttpContext.Session.GetString("UserId");
        if (string.IsNullOrEmpty(userIdString))
        {
            return Unauthorized(new { error = "Not authenticated" });
        }

        var userId = long.Parse(userIdString);

        // Get media metadata (includes ownership check)
        var media = await _mediaService.GetMediaByIdAsync(mediaId, userId);
        if (media == null)
        {
            return NotFound(new { error = "Image not found or access denied" });
        }

        // Get decrypted image data
        var imageData = await _mediaService.GetDecryptedMediaDataAsync(mediaId, userId);
        if (imageData == null)
        {
            return NotFound(new { error = "Image file not found" });
        }

        // Return image with proper content type
        return File(imageData, media.MimeType);
    }
}
