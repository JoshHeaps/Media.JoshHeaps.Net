namespace Media.JoshHeaps.Net.Models;

public class MedicalCondition
{
    public long Id { get; set; }
    public long PersonId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime? DiagnosedDate { get; set; }
    public string? Notes { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
