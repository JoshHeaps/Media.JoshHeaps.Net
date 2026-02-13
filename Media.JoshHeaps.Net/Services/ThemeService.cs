using System.Text.Json;
using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public class ThemeService(DbExecutor db)
{
    public async Task<UserThemeOverrides?> GetUserThemeAsync(long userId)
    {
        return await db.ExecuteReaderAsync<UserThemeOverrides?>(
            @"SELECT id, user_id, base_theme, color_overrides::text, created_at, updated_at
              FROM app.user_theme_overrides
              WHERE user_id = @userId",
            reader =>
            {
                if (!reader.Read()) return null;
                var overridesJson = reader.GetString(3);
                return new UserThemeOverrides
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    BaseTheme = reader.GetString(2),
                    ColorOverrides = JsonSerializer.Deserialize<Dictionary<string, string>>(overridesJson) ?? new(),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            },
            new { userId });
    }

    public async Task SaveUserThemeAsync(long userId, string baseTheme, Dictionary<string, string> colorOverrides)
    {
        var overridesJson = JsonSerializer.Serialize(colorOverrides);
        await db.ExecuteNonQueryAsync(
            @"INSERT INTO app.user_theme_overrides (user_id, base_theme, color_overrides, created_at, updated_at)
              VALUES (@userId, @baseTheme, @overridesJson::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT (user_id) DO UPDATE
              SET base_theme = @baseTheme,
                  color_overrides = @overridesJson::jsonb,
                  updated_at = CURRENT_TIMESTAMP",
            new { userId, baseTheme, overridesJson });
    }
}
