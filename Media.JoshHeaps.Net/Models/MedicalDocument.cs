namespace Media.JoshHeaps.Net.Models;

public class MedicalDocument
{
    public long Id { get; set; }
    public long PersonId { get; set; }
    public string DocumentType { get; set; } = "file"; // "file" or "note"
    public string? FileName { get; set; }
    public string? FilePath { get; set; }
    public long? FileSize { get; set; }
    public string? MimeType { get; set; }
    public bool IsEncrypted { get; set; } = true;
    public string? Title { get; set; }
    public string? Description { get; set; }
    public DateTime? DocumentDate { get; set; }
    public string? Classification { get; set; }
    public string? ExtractedText { get; set; }
    public bool AiProcessed { get; set; }
    public DateTime? AiProcessedAt { get; set; }
    public string? AiRawResponse { get; set; }
    public long? DoctorId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    // Convenience properties populated separately
    public List<MedicalTag> Tags { get; set; } = [];
}
