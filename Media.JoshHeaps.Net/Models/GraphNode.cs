namespace Media.JoshHeaps.Net.Models;

public class GraphNode
{
    public long Id { get; set; }
    public long GraphId { get; set; }
    public string Label { get; set; } = string.Empty;
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class GraphNodeWithConnections : GraphNode
{
    public int ConnectionCount { get; set; }
}
