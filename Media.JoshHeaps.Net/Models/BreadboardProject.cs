using System.Text.Json.Nodes;

namespace Media.JoshHeaps.Net.Models;

/// <summary>Row shape for the project list — deliberately excludes the circuit document.</summary>
public sealed record BreadboardProjectSummary(
    long Id,
    string Name,
    string? Description,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>
/// A single project including its circuit document. The circuit is opaque to C# —
/// it is stored and validated as text and only parsed here so the API emits it as a
/// real JSON object rather than a JSON-encoded string.
/// </summary>
public sealed record BreadboardProject(
    long Id,
    string Name,
    string? Description,
    JsonNode? Circuit,
    DateTime CreatedAt,
    DateTime UpdatedAt);
