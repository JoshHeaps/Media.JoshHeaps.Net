namespace Media.JoshHeaps.Net.Models;

public class TimelineEvent
{
    public string EventType { get; set; } = "";
    public long Id { get; set; }
    public string? Label { get; set; }
    public string? Detail { get; set; }
    public string? SubType { get; set; }
    public DateTime? EventDate { get; set; }
    public long? DoctorId { get; set; }
    public DateTime CreatedAt { get; set; }
}
