using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public class UserService(DbExecutor db)
{
    public async Task<UserDashboard?> GetUserDashboardAsync(long userId)
    {
        try
        {
            var query = @"
                SELECT
                    u.id, u.username, u.email, u.email_verified, u.created_at, u.last_login,
                    p.bio, p.avatar_url, p.location, p.website, p.updated_at
                FROM app.users u
                LEFT JOIN app.user_profiles p ON u.id = p.user_id
                WHERE u.id = @userId";

            var dashboard = await db.ExecuteReaderAsync(query, reader =>
            {
                return new UserDashboard
                {
                    UserId = reader.GetInt64(0),
                    Username = reader.GetString(1),
                    Email = reader.GetString(2),
                    EmailVerified = reader.GetBoolean(3),
                    CreatedAt = reader.GetDateTime(4),
                    LastLogin = reader.IsDBNull(5) ? null : reader.GetDateTime(5),
                    Profile = new UserProfile
                    {
                        UserId = reader.GetInt64(0),
                        Bio = reader.IsDBNull(6) ? null : reader.GetString(6),
                        AvatarUrl = reader.IsDBNull(7) ? null : reader.GetString(7),
                        Location = reader.IsDBNull(8) ? null : reader.GetString(8),
                        Website = reader.IsDBNull(9) ? null : reader.GetString(9),
                        UpdatedAt = reader.IsDBNull(10) ? DateTime.UtcNow : reader.GetDateTime(10)
                    }
                };
            }, new { userId });

            return dashboard;
        }
        catch (Exception)
        {
            return null;
        }
    }

    public async Task<UserProfile?> GetUserProfileAsync(long userId)
    {
        try
        {
            var query = @"
                SELECT user_id, bio, avatar_url, location, website, updated_at
                FROM app.user_profiles
                WHERE user_id = @userId";

            var profile = await db.ExecuteReaderAsync(query, reader =>
            {
                return new UserProfile
                {
                    UserId = reader.GetInt64(0),
                    Bio = reader.IsDBNull(1) ? null : reader.GetString(1),
                    AvatarUrl = reader.IsDBNull(2) ? null : reader.GetString(2),
                    Location = reader.IsDBNull(3) ? null : reader.GetString(3),
                    Website = reader.IsDBNull(4) ? null : reader.GetString(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            }, new { userId });

            return profile;
        }
        catch (Exception)
        {
            return null;
        }
    }

    public async Task<bool> UpdateUserProfileAsync(long userId, string? bio, string? avatarUrl, string? location, string? website)
    {
        try
        {
            await db.ExecuteAsync<object>(
                @"UPDATE app.user_profiles
                  SET bio = @bio, avatar_url = @avatarUrl, location = @location,
                      website = @website, updated_at = @updatedAt
                  WHERE user_id = @userId",
                new { userId, bio, avatarUrl, location, website, updatedAt = DateTime.UtcNow }
            );

            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    public async Task<List<UserSearchResult>> SearchUsersAsync(string query, long excludeUserId)
    {
        try
        {
            var searchQuery = @"
                SELECT id, username, email
                FROM app.users
                WHERE (LOWER(username) LIKE @query OR LOWER(email) LIKE @query)
                  AND id != @excludeUserId
                  AND email_verified = true
                ORDER BY username ASC
                LIMIT 10";

            var users = await db.ExecuteListReaderAsync(searchQuery, reader =>
            {
                return new UserSearchResult
                {
                    Id = reader.GetInt64(0),
                    Username = reader.GetString(1),
                    Email = reader.GetString(2)
                };
            }, new { query = $"%{query.ToLower()}%", excludeUserId });

            return users;
        }
        catch (Exception)
        {
            return [];
        }
    }
}

public class UserSearchResult
{
    public long Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}
