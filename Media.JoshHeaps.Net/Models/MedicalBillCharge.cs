namespace Media.JoshHeaps.Net.Models;

public class MedicalBillCharge
{
    public long Id { get; set; }
    public long BillId { get; set; }
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
    public string Source { get; set; } = "manual";
    public DateTime CreatedAt { get; set; }
}
