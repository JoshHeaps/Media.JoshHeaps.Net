using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Media.JoshHeaps.Net.Api;

[ApiController]
[Route("api/blog")]
public class BlogApi(BlogService blogService, DbExecutor dbExecutor) : ControllerBase
{
    [HttpGet("posts")]
    public async Task<IActionResult> GetPosts()
    {
        var posts = await blogService.GetAllPostsAsync();
        return Ok(posts.Select(MapToPublicDto));
    }

    [HttpGet("posts/{slug}")]
    public async Task<IActionResult> GetPostBySlug(string slug)
    {
        var post = await blogService.GetPostBySlugAsync(slug);
        if (post is null) return NotFound();
        return Ok(MapToPublicDto(post));
    }

    [HttpGet("posts/tags/{tag}")]
    public async Task<IActionResult> GetPostsByTag(string tag)
    {
        var posts = await blogService.GetPostsByTagAsync(tag);
        return Ok(posts.Select(MapToPublicDto));
    }

    [HttpGet("posts/admin/{id}")]
    public async Task<IActionResult> GetPostForAdmin(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId is null) return Unauthorized();
        if (!await IsAdmin(userId.Value)) return Forbid();

        var post = await blogService.GetPostByIdAsync(id);
        if (post is null) return NotFound();
        return Ok(MapToAdminDto(post));
    }

    [HttpPost("posts")]
    public async Task<IActionResult> CreatePost([FromBody] CreateBlogPostRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId is null) return Unauthorized();
        if (!await IsAdmin(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "Title is required" });
        if (string.IsNullOrWhiteSpace(request.MarkdownContent))
            return BadRequest(new { error = "Content is required" });

        var post = await blogService.CreatePostAsync(
            request.Title.Trim(),
            request.Summary?.Trim() ?? "",
            request.MarkdownContent,
            request.Tags ?? [],
            userId.Value,
            request.PublishedDate ?? DateTime.UtcNow);

        if (post is null)
            return StatusCode(500, new { error = "Failed to create post" });

        return Ok(MapToAdminDto(post));
    }

    [HttpPut("posts/{id}")]
    public async Task<IActionResult> UpdatePost(long id, [FromBody] UpdateBlogPostRequest request)
    {
        var userId = GetUserIdFromAuth();
        if (userId is null) return Unauthorized();
        if (!await IsAdmin(userId.Value)) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "Title is required" });
        if (string.IsNullOrWhiteSpace(request.MarkdownContent))
            return BadRequest(new { error = "Content is required" });

        var post = await blogService.UpdatePostAsync(
            id,
            request.Title.Trim(),
            request.Summary?.Trim() ?? "",
            request.MarkdownContent,
            request.Tags ?? [],
            request.PublishedDate ?? DateTime.UtcNow);

        if (post is null)
            return NotFound(new { error = "Post not found" });

        return Ok(MapToAdminDto(post));
    }

    [HttpDelete("posts/{id}")]
    public async Task<IActionResult> DeletePost(long id)
    {
        var userId = GetUserIdFromAuth();
        if (userId is null) return Unauthorized();
        if (!await IsAdmin(userId.Value)) return Forbid();

        var deleted = await blogService.DeletePostAsync(id);
        if (!deleted) return NotFound(new { error = "Post not found" });

        return Ok(new { success = true });
    }

    private static object MapToPublicDto(Models.BlogPost post) => new
    {
        post.Id,
        post.Slug,
        post.Title,
        post.Summary,
        post.Tags,
        post.PublishedDate,
        post.HtmlContent
    };

    private static object MapToAdminDto(Models.BlogPost post) => new
    {
        post.Id,
        post.Slug,
        post.Title,
        post.Summary,
        post.MarkdownContent,
        post.Tags,
        post.PublishedDate,
        post.CreatedAt,
        post.UpdatedAt
    };

    private async Task<bool> IsAdmin(long userId)
    {
        return await dbExecutor.ExecuteAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM app.user_roles ur JOIN app.roles r ON ur.role_id = r.id WHERE ur.user_id = @UserId AND r.name = 'admin')",
            new { UserId = userId });
    }

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

public record CreateBlogPostRequest(string Title, string? Summary, string MarkdownContent, List<string>? Tags, DateTime? PublishedDate);
public record UpdateBlogPostRequest(string Title, string? Summary, string MarkdownContent, List<string>? Tags, DateTime? PublishedDate);
