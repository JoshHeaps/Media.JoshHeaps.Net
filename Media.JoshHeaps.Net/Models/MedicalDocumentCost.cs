namespace Media.JoshHeaps.Net.Models;

public class MedicalDocumentCost
{
    public long Id { get; set; }
    public long DocumentId { get; set; }
    public long PersonId { get; set; }
    public decimal Amount { get; set; }
    public string? CostType { get; set; }
    public string? Category { get; set; }
    public DateTime? CostDate { get; set; }
    public string? Description { get; set; }
    public string Source { get; set; } = "manual";
    public DateTime CreatedAt { get; set; }
}
