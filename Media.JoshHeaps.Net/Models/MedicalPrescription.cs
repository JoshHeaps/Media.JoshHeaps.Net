namespace Media.JoshHeaps.Net.Models;

public class MedicalPrescription
{
    public long Id { get; set; }
    public long PersonId { get; set; }
    public long? DoctorId { get; set; }
    public string MedicationName { get; set; } = string.Empty;
    public string? Dosage { get; set; }
    public string? Frequency { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    // Populated via JOIN, not stored in DB
    public string? DoctorName { get; set; }
    public DateTime? LastPickupDate { get; set; }
}
