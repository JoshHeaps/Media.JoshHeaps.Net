using System.Text.Json.Nodes;
using Media.JoshHeaps.Net.Models;
using Npgsql;

namespace Media.JoshHeaps.Net.Services;

/// <summary>
/// Data access and write rules for breadboard projects. The circuit document is opaque
/// here: it travels as JSON text, is checked by <see cref="BreadboardValidator"/> before
/// it ever reaches the database, and is only parsed on the way out so the API can emit it
/// as a JSON object. Ownership is enforced in SQL — every statement is scoped by user_id,
/// so a project belonging to someone else is indistinguishable from one that never existed.
/// </summary>
public class BreadboardService(DbExecutor db, BreadboardValidator validator, ILogger<BreadboardService> logger)
{
    public const int MaxNameLength = 200;
    public const int MaxDescriptionLength = 2000;
    public const int MaxProjectsPerUser = 200;

    private const string EmptyCircuitJson = """{"version":1,"boards":[],"components":[],"wires":[]}""";

    public async Task<List<BreadboardProjectSummary>> GetProjectsAsync(long userId)
    {
        try
        {
            var query = @"
                SELECT id, name, description, created_at, updated_at
                FROM app.breadboard_projects
                WHERE user_id = @userId
                ORDER BY updated_at DESC";

            return await db.ExecuteListReaderAsync(query, MapSummary, new { userId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to list breadboard projects for user {UserId}", userId);
            return [];
        }
    }

    /// <summary>
    /// Ownership check plus display fields, without dragging the circuit document along.
    /// Pages that only need to know "is this mine, and what is it called" use this so the
    /// document is fetched exactly once, by the editor module over the API.
    /// </summary>
    public async Task<BreadboardProjectSummary?> GetProjectSummaryAsync(long projectId, long userId)
    {
        var query = @"
            SELECT id, name, description, created_at, updated_at
            FROM app.breadboard_projects
            WHERE id = @projectId AND user_id = @userId";

        return await db.ExecuteReaderAsync(query, MapSummary, new { projectId, userId });
    }

    /// <summary>
    /// Returns null only when the project does not exist or is not this user's. Database
    /// failures deliberately propagate — a caller must never turn an outage into a 404.
    /// </summary>
    public async Task<BreadboardProject?> GetProjectAsync(long projectId, long userId)
    {
        var query = @"
            SELECT id, name, description, circuit::text, created_at, updated_at
            FROM app.breadboard_projects
            WHERE id = @projectId AND user_id = @userId";

        return await db.ExecuteReaderAsync(query, MapProject, new { projectId, userId });
    }

    public async Task<BreadboardResult> CreateProjectAsync(long userId, string? name, string? description)
    {
        var errors = new List<string>();

        var trimmedName = ValidateName(name, errors);
        var trimmedDescription = ValidateDescription(description, errors);

        if (errors.Count > 0)
        {
            return BreadboardResult.Invalid(errors);
        }

        // Even the starter document goes through the validator — there is no trusted path by
        // which a circuit reaches the database unchecked. It is server-authored though, so a
        // rejection means the seed and the validator have drifted: that is our bug, not the
        // caller's, and it must not surface as a 400 blaming their input.
        var circuitCheck = validator.Validate(EmptyCircuitJson);
        if (!circuitCheck.IsValid)
        {
            logger.LogError(
                "Seed breadboard circuit document was rejected by the validator: {Errors}",
                string.Join(", ", circuitCheck.Errors));
            return BreadboardResult.Failed("Failed to create project");
        }

        try
        {
            // An authenticated user can otherwise grow the table without bound, 2 MB at a time.
            var projectCount = await db.ExecuteAsync<long>(
                "SELECT COUNT(*) FROM app.breadboard_projects WHERE user_id = @userId",
                new { userId });

            if (projectCount >= MaxProjectsPerUser)
            {
                return BreadboardResult.Invalid([$"Project limit reached ({MaxProjectsPerUser} per account)"]);
            }

            var query = @"
                INSERT INTO app.breadboard_projects (user_id, name, description, circuit, created_at, updated_at)
                VALUES (@userId, @name, @description, @circuit::jsonb, NOW(), NOW())
                RETURNING id, name, description, circuit::text, created_at, updated_at";

            var project = await db.ExecuteReaderAsync(query, MapProject, new
            {
                userId,
                name = trimmedName,
                description = trimmedDescription,
                circuit = EmptyCircuitJson
            });

            return project is null
                ? BreadboardResult.Failed("Failed to create project")
                : BreadboardResult.Succeeded(project);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create breadboard project for user {UserId}", userId);
            return BreadboardResult.Failed("Failed to create project");
        }
    }

    /// <summary>
    /// Partial update: a null argument means "leave unchanged". An explicitly blank
    /// description clears the column.
    /// </summary>
    public async Task<BreadboardResult> UpdateProjectAsync(
        long projectId,
        long userId,
        string? name,
        string? description,
        string? circuitJson)
    {
        var errors = new List<string>();

        var setName = name is not null;
        var trimmedName = setName ? ValidateName(name, errors) : null;

        var setDescription = description is not null;
        var trimmedDescription = setDescription ? ValidateDescription(description, errors) : null;

        var setCircuit = circuitJson is not null;
        if (setCircuit)
        {
            var circuitCheck = validator.Validate(circuitJson!);
            if (!circuitCheck.IsValid)
            {
                errors.AddRange(circuitCheck.Errors);
            }
        }

        if (errors.Count > 0)
        {
            return BreadboardResult.Invalid(errors);
        }

        try
        {
            var query = @"
                UPDATE app.breadboard_projects
                SET name        = CASE WHEN @setName THEN @name ELSE name END,
                    -- NULLIF keeps @description a non-null text parameter, so the server never has
                    -- to infer a type for an untyped NULL, and clearing still works.
                    description = CASE WHEN @setDescription THEN NULLIF(@description, '') ELSE description END,
                    circuit     = CASE WHEN @setCircuit THEN @circuit::jsonb ELSE circuit END,
                    -- A no-op save must not reorder the project list, which sorts on updated_at.
                    updated_at  = CASE WHEN @setName OR @setDescription OR @setCircuit THEN NOW() ELSE updated_at END
                WHERE id = @projectId AND user_id = @userId";

            var rows = await db.ExecuteNonQueryAsync(query, new
            {
                projectId,
                userId,
                setName,
                // Guarded by @setName — the CASE is what keeps this placeholder off the column.
                name = trimmedName ?? string.Empty,
                setDescription,
                description = trimmedDescription ?? string.Empty,
                setCircuit,
                // Guarded by @setCircuit, but the ::jsonb cast still parses it, so it must be
                // valid JSON even on the branch the CASE discards.
                circuit = circuitJson ?? EmptyCircuitJson
            });

            return rows == 0 ? BreadboardResult.Missing() : BreadboardResult.Succeeded();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update breadboard project {ProjectId} for user {UserId}", projectId, userId);
            return BreadboardResult.Failed("Failed to update project");
        }
    }

    public async Task<BreadboardResult> DeleteProjectAsync(long projectId, long userId)
    {
        try
        {
            var query = "DELETE FROM app.breadboard_projects WHERE id = @projectId AND user_id = @userId";
            var rows = await db.ExecuteNonQueryAsync(query, new { projectId, userId });

            return rows == 0 ? BreadboardResult.Missing() : BreadboardResult.Succeeded();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete breadboard project {ProjectId} for user {UserId}", projectId, userId);
            return BreadboardResult.Failed("Failed to delete project");
        }
    }

    private static BreadboardProjectSummary MapSummary(NpgsqlDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.IsDBNull(2) ? null : reader.GetString(2),
        reader.GetDateTime(3),
        reader.GetDateTime(4));

    private BreadboardProject MapProject(NpgsqlDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.IsDBNull(2) ? null : reader.GetString(2),
        ParseCircuit(reader.GetString(3), reader.GetInt64(0)),
        reader.GetDateTime(4),
        reader.GetDateTime(5));

    private JsonNode? ParseCircuit(string circuitJson, long projectId)
    {
        try
        {
            return JsonNode.Parse(circuitJson);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Stored circuit for breadboard project {ProjectId} is not parseable JSON", projectId);
            return null;
        }
    }

    private static string ValidateName(string? name, List<string> errors)
    {
        var trimmed = name?.Trim() ?? string.Empty;

        if (trimmed.Length == 0)
        {
            errors.Add("Name is required");
        }
        else if (trimmed.Length > MaxNameLength)
        {
            errors.Add($"Name must be {MaxNameLength} characters or fewer");
        }
        else if (trimmed.Any(char.IsControl))
        {
            // PostgreSQL rejects NUL in text outright; catching it here makes it a 400 rather
            // than a generic 500, and the rest of the control range has no business in a name.
            errors.Add("Name must not contain control characters");
        }

        return trimmed;
    }

    private static string? ValidateDescription(string? description, List<string> errors)
    {
        var trimmed = description?.Trim();

        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > MaxDescriptionLength)
        {
            errors.Add($"Description must be {MaxDescriptionLength} characters or fewer");
        }
        else if (trimmed.Any(c => char.IsControl(c) && c is not ('\n' or '\r' or '\t')))
        {
            // Line breaks and tabs are legitimate in free text — CR is in the list because a
            // <textarea> submits CRLF. A NUL is not legitimate: PostgreSQL cannot store it in a
            // text column at all, so blocking it here makes it a 400 instead of a 500.
            // This allow-list is a team-lead ruling, not a local preference; Name is
            // deliberately stricter because it is a single-line label.
            errors.Add("Description must not contain control characters");
        }

        return trimmed;
    }
}
