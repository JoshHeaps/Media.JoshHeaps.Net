namespace Media.JoshHeaps.Net.Models;

public class UserThemeOverrides
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string BaseTheme { get; set; } = "light";
    public Dictionary<string, string> ColorOverrides { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
