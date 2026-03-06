using System.Text.RegularExpressions;
using Markdig;
using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public partial class BlogService(DbExecutor db, ILogger<BlogService> logger)
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .Build();

    public async Task<List<BlogPost>> GetAllPostsAsync()
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                @"SELECT id, slug, title, summary, markdown_content, html_content, tags, author_id, published_date, created_at, updated_at
                  FROM app.blog_posts
                  ORDER BY published_date DESC",
                MapBlogPost);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get all blog posts");
            return [];
        }
    }

    public async Task<BlogPost?> GetPostByIdAsync(long id)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT id, slug, title, summary, markdown_content, html_content, tags, author_id, published_date, created_at, updated_at
                  FROM app.blog_posts
                  WHERE id = @Id",
                MapBlogPost,
                new { Id = id });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get blog post by id {Id}", id);
            return null;
        }
    }

    public async Task<BlogPost?> GetPostBySlugAsync(string slug)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT id, slug, title, summary, markdown_content, html_content, tags, author_id, published_date, created_at, updated_at
                  FROM app.blog_posts
                  WHERE slug = @Slug",
                MapBlogPost,
                new { Slug = slug });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get blog post by slug {Slug}", slug);
            return null;
        }
    }

    public async Task<List<BlogPost>> GetPostsByTagAsync(string tag)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                @"SELECT id, slug, title, summary, markdown_content, html_content, tags, author_id, published_date, created_at, updated_at
                  FROM app.blog_posts
                  WHERE @Tag = ANY(tags)
                  ORDER BY published_date DESC",
                MapBlogPost,
                new { Tag = tag });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get blog posts by tag {Tag}", tag);
            return [];
        }
    }

    public async Task<BlogPost?> CreatePostAsync(string title, string summary, string markdownContent, List<string> tags, long authorId, DateTime publishedDate)
    {
        try
        {
            var slug = GenerateSlug(title);
            var htmlContent = Markdown.ToHtml(markdownContent, Pipeline);
            var now = DateTime.UtcNow;

            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.blog_posts (slug, title, summary, markdown_content, html_content, tags, author_id, published_date, created_at, updated_at)
                  VALUES (@Slug, @Title, @Summary, @MarkdownContent, @HtmlContent, @Tags, @AuthorId, @PublishedDate, @CreatedAt, @UpdatedAt)
                  RETURNING id, slug, title, summary, markdown_content, html_content, tags, author_id, published_date, created_at, updated_at",
                MapBlogPost,
                new
                {
                    Slug = slug,
                    Title = title,
                    Summary = summary,
                    MarkdownContent = markdownContent,
                    HtmlContent = htmlContent,
                    Tags = tags.ToArray(),
                    AuthorId = authorId,
                    PublishedDate = publishedDate,
                    CreatedAt = now,
                    UpdatedAt = now
                });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create blog post '{Title}'", title);
            return null;
        }
    }

    public async Task<BlogPost?> UpdatePostAsync(long id, string title, string summary, string markdownContent, List<string> tags, DateTime publishedDate)
    {
        try
        {
            var slug = GenerateSlug(title);
            var htmlContent = Markdown.ToHtml(markdownContent, Pipeline);

            return await db.ExecuteReaderAsync(
                @"UPDATE app.blog_posts
                  SET slug = @Slug, title = @Title, summary = @Summary, markdown_content = @MarkdownContent,
                      html_content = @HtmlContent, tags = @Tags, published_date = @PublishedDate, updated_at = @UpdatedAt
                  WHERE id = @Id
                  RETURNING id, slug, title, summary, markdown_content, html_content, tags, author_id, published_date, created_at, updated_at",
                MapBlogPost,
                new
                {
                    Id = id,
                    Slug = slug,
                    Title = title,
                    Summary = summary,
                    MarkdownContent = markdownContent,
                    HtmlContent = htmlContent,
                    Tags = tags.ToArray(),
                    PublishedDate = publishedDate,
                    UpdatedAt = DateTime.UtcNow
                });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update blog post {Id}", id);
            return null;
        }
    }

    public async Task<bool> DeletePostAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                "DELETE FROM app.blog_posts WHERE id = @Id",
                new { Id = id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete blog post {Id}", id);
            return false;
        }
    }

    private static BlogPost MapBlogPost(Npgsql.NpgsqlDataReader reader)
    {
        return new BlogPost
        {
            Id = reader.GetInt64(0),
            Slug = reader.GetString(1),
            Title = reader.GetString(2),
            Summary = reader.GetString(3),
            MarkdownContent = reader.GetString(4),
            HtmlContent = reader.GetString(5),
            Tags = reader.GetFieldValue<string[]>(6).ToList(),
            AuthorId = reader.GetInt64(7),
            PublishedDate = reader.GetDateTime(8),
            CreatedAt = reader.GetDateTime(9),
            UpdatedAt = reader.GetDateTime(10)
        };
    }

    private static string GenerateSlug(string title)
    {
        var slug = title.ToLowerInvariant();
        slug = SlugInvalidChars().Replace(slug, "");
        slug = SlugWhitespace().Replace(slug, "-");
        slug = SlugMultipleDashes().Replace(slug, "-");
        return slug.Trim('-');
    }

    [GeneratedRegex(@"[^a-z0-9\s-]")]
    private static partial Regex SlugInvalidChars();

    [GeneratedRegex(@"\s+")]
    private static partial Regex SlugWhitespace();

    [GeneratedRegex(@"-{2,}")]
    private static partial Regex SlugMultipleDashes();
}
