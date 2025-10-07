namespace Media.JoshHeaps.Net.Models;

public class UserProfile
{
    public long UserId { get; set; }
    public string? Bio { get; set; }
    public string? AvatarUrl { get; set; }
    public string? Location { get; set; }
    public string? Website { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class UserDashboard
{
    public long UserId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public bool EmailVerified { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLogin { get; set; }
    public UserProfile Profile { get; set; } = new();
}
