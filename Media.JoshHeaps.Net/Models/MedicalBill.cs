namespace Media.JoshHeaps.Net.Models;

public class MedicalBill
{
    public long Id { get; set; }
    public long PersonId { get; set; }
    public decimal TotalAmount { get; set; }
    public string? Summary { get; set; }
    public string? Category { get; set; }
    public DateTime? BillDate { get; set; }
    public long? DoctorId { get; set; }
    public long? ProviderId { get; set; }
    public string Source { get; set; } = "manual";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    // Populated via JOIN, not stored in DB
    public string? DoctorName { get; set; }
    public string? ProviderName { get; set; }
    public string? DocumentNames { get; set; }
}
