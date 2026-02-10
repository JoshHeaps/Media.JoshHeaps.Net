namespace Media.JoshHeaps.Net.Models;

public class VisitPrepData
{
    public List<VisitPrepDocument> RecentDocuments { get; set; } = [];
    public List<MedicalCondition> ActiveConditions { get; set; } = [];
    public List<MedicalPrescription> ActivePrescriptions { get; set; } = [];
    public List<VisitPrepBill> RecentBills { get; set; } = [];
}

public class VisitPrepDocument
{
    public long Id { get; set; }
    public string? Title { get; set; }
    public string? FileName { get; set; }
    public DateTime? DocumentDate { get; set; }
    public string? Classification { get; set; }
}

public class VisitPrepBill
{
    public long Id { get; set; }
    public decimal TotalAmount { get; set; }
    public string? Summary { get; set; }
    public string? Category { get; set; }
    public DateTime? BillDate { get; set; }
}
