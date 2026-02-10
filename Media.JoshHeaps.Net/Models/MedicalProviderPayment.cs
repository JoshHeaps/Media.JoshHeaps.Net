namespace Media.JoshHeaps.Net.Models;

public class MedicalProviderPayment
{
    public long Id { get; set; }
    public long ProviderId { get; set; }
    public long? DocumentId { get; set; }
    public decimal Amount { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? Description { get; set; }
    public string Source { get; set; } = "manual";
    public DateTime CreatedAt { get; set; }
}
