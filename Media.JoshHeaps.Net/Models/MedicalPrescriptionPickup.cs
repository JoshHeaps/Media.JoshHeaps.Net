namespace Media.JoshHeaps.Net.Models;

public class MedicalPrescriptionPickup
{
    public long Id { get; set; }
    public long PrescriptionId { get; set; }
    public long? DocumentId { get; set; }
    public DateTime PickupDate { get; set; }
    public string? Quantity { get; set; }
    public string? Pharmacy { get; set; }
    public decimal? Cost { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
}
