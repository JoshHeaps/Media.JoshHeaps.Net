namespace Media.JoshHeaps.Net.Models;

public class BlogPost
{
    public long Id { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string MarkdownContent { get; set; } = string.Empty;
    public string HtmlContent { get; set; } = string.Empty;
    public List<string> Tags { get; set; } = [];
    public long AuthorId { get; set; }
    public DateTime PublishedDate { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
