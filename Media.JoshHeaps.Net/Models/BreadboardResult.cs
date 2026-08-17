namespace Media.JoshHeaps.Net.Models;

public enum BreadboardOutcome
{
    Success,
    NotFound,
    Invalid,
    Failed
}

/// <summary>
/// Outcome of a write against a breadboard project. The API layer maps the outcome to a
/// status code; every rule that produces <see cref="BreadboardOutcome.Invalid"/> lives in
/// the service (or the validator it delegates to), never in the controller.
/// </summary>
public sealed record BreadboardResult(
    BreadboardOutcome Outcome,
    IReadOnlyList<string> Errors,
    BreadboardProject? Project)
{
    /// <summary>The single wording for "gone or never yours" — read and write paths share it.</summary>
    public const string NotFoundMessage = "Project not found";

    public static BreadboardResult Succeeded(BreadboardProject? project = null) =>
        new(BreadboardOutcome.Success, [], project);

    public static BreadboardResult Missing() =>
        new(BreadboardOutcome.NotFound, [NotFoundMessage], null);

    public static BreadboardResult Invalid(IReadOnlyList<string> errors) =>
        new(BreadboardOutcome.Invalid, errors, null);

    public static BreadboardResult Failed(string error) =>
        new(BreadboardOutcome.Failed, [error], null);
}
