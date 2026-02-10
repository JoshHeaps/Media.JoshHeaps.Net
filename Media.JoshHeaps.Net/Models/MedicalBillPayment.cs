namespace Media.JoshHeaps.Net.Models;

public class MedicalBillPayment
{
    public long Id { get; set; }
    public long BillId { get; set; }
    public long? DocumentId { get; set; }
    public decimal Amount { get; set; }
    public string PaymentType { get; set; } = string.Empty;
    public DateTime? PaymentDate { get; set; }
    public string? Description { get; set; }
    public string Source { get; set; } = "manual";
    public DateTime CreatedAt { get; set; }

    // Populated via JOIN, not stored in DB
    public string? DocumentName { get; set; }
}
