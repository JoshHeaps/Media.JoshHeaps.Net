namespace Media.JoshHeaps.Net.Models;

public class MedicalPerson
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime? DateOfBirth { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class PersonAccessUser
{
    public long Id { get; set; }
    public string Username { get; set; } = string.Empty;
}
