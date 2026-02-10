namespace Media.JoshHeaps.Net.Models;

public class MedicalBillingProvider
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public long PersonId { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    // Populated via aggregation, not stored in DB
    public decimal TotalCharged { get; set; }
    public decimal TotalPaid { get; set; }
    public int BillCount { get; set; }

    public decimal Balance => TotalCharged - TotalPaid;
}
