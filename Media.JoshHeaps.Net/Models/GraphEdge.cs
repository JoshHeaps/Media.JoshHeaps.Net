namespace Media.JoshHeaps.Net.Models;

public class GraphEdge
{
    public long Id { get; set; }
    public long GraphId { get; set; }
    public long SourceNodeId { get; set; }
    public long TargetNodeId { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class GraphData
{
    public Graph Graph { get; set; } = new();
    public List<GraphNodeWithConnections> Nodes { get; set; } = [];
    public List<GraphEdge> Edges { get; set; } = [];
}
