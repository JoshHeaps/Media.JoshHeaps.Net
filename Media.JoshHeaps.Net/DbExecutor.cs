using Npgsql;

namespace Media.JoshHeaps.Net;

public class DbExecutor(IConfiguration config)
{
    private string ConnectionString => config["connectionString"]!;

    // Returns a single value (first column, first row)
    public async Task<T?> ExecuteAsync<T>(string query, object? parameters = null)
    {
        parameters ??= new();
        using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        using var cmd = new NpgsqlCommand(query, conn);

        // Add parameters if provided
        foreach (var prop in parameters.GetType().GetProperties())
        {
            cmd.Parameters.AddWithValue($"@{prop.Name}", prop.GetValue(parameters) ?? DBNull.Value);
        }

        var result = await cmd.ExecuteScalarAsync();

        if (result == null || result == DBNull.Value)
            return default;

        return (T)result;
    }

    // Returns a list of values (first column from all rows)
    public async Task<List<T>> ExecuteListAsync<T>(string query, object? parameters = null)
    {
        parameters ??= new();
        using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        using var cmd = new NpgsqlCommand(query, conn);

        foreach (var prop in parameters.GetType().GetProperties())
        {
            cmd.Parameters.AddWithValue($"@{prop.Name}", prop.GetValue(parameters) ?? DBNull.Value);
        }

        using var reader = await cmd.ExecuteReaderAsync();

        List<T> results = [];

        while (await reader.ReadAsync())
        {
            if (reader.IsDBNull(0))
                continue;

            results.Add((T)reader.GetValue(0));
        }

        return results;
    }

    // Returns a data reader for custom mapping (caller must dispose)
    public async Task<T?> ExecuteReaderAsync<T>(string query, Func<NpgsqlDataReader, T?> mapper, object? parameters = null)
    {
        parameters ??= new();
        using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        using var cmd = new NpgsqlCommand(query, conn);

        foreach (var prop in parameters.GetType().GetProperties())
        {
            cmd.Parameters.AddWithValue($"@{prop.Name}", prop.GetValue(parameters) ?? DBNull.Value);
        }

        using var reader = await cmd.ExecuteReaderAsync();

        if (await reader.ReadAsync())
        {
            return mapper(reader);
        }

        return default;
    }

    // Returns a list using custom mapping
    public async Task<List<T>> ExecuteListReaderAsync<T>(string query, Func<NpgsqlDataReader, T> mapper, object? parameters = null)
    {
        parameters ??= new();
        using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        using var cmd = new NpgsqlCommand(query, conn);

        foreach (var prop in parameters.GetType().GetProperties())
        {
            cmd.Parameters.AddWithValue($"@{prop.Name}", prop.GetValue(parameters) ?? DBNull.Value);
        }

        using var reader = await cmd.ExecuteReaderAsync();

        var results = new List<T>();

        while (await reader.ReadAsync())
        {
            results.Add(mapper(reader));
        }

        return results;
    }
}
