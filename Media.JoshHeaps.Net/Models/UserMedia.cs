namespace Media.JoshHeaps.Net.Models;

public class UserMedia
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty; // Path to encrypted file on disk
    public long FileSize { get; set; }
    public string MimeType { get; set; } = string.Empty;
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string? Description { get; set; }
    public bool IsEncrypted { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
