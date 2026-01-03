namespace Media.JoshHeaps.Net.Models;

public class Graph
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class GraphWithCounts : Graph
{
    public int NodeCount { get; set; }
    public int EdgeCount { get; set; }
}
