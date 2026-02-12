using System.Security.Cryptography;
using System.Text;
using Media.JoshHeaps.Net;
using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public class AuthService(DbExecutor db)
{
    // Hash a password using BCrypt
    public string HashPassword(string password)
    {
        return BCrypt.Net.BCrypt.HashPassword(password);
    }

    // Verify a password against a hash
    public bool VerifyPassword(string password, string hash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(password, hash);
        }
        catch
        {
            return false;
        }
    }

    // Register a new user
    public async Task<(bool Success, string? Error, string? VerificationToken)> RegisterUserAsync(string email, string username, string password)
    {
        try
        {
            // Check if email already exists
            var emailExists = await db.ExecuteAsync<long>(
                "SELECT COUNT(*) FROM app.users WHERE email = @email",
                new { email }
            );

            if (emailExists > 0)
            {
                return (false, "Email is already registered", null);
            }

            // Check if username already exists
            var usernameExists = await db.ExecuteAsync<long>(
                "SELECT COUNT(*) FROM app.users WHERE username = @username",
                new { username }
            );

            if (usernameExists > 0)
            {
                return (false, "Username is already taken", null);
            }

            // Hash the password
            var passwordHash = HashPassword(password);

            // Insert new user and get the user ID
            var userId = await db.ExecuteAsync<long>(
                @"INSERT INTO app.users (email, username, password_hash, is_active, email_verified, failed_login_attempts)
                  VALUES (@email, @username, @passwordHash, true, false, 0)
                  RETURNING id",
                new { email, username, passwordHash }
            );

            // Generate verification token
            var verificationToken = GenerateVerificationToken();
            var expiresAt = DateTime.UtcNow.AddHours(24);

            // Store verification token
            await db.ExecuteAsync<object>(
                @"INSERT INTO app.email_verification_tokens (user_id, token, expires_at)
                  VALUES (@userId, @verificationToken, @expiresAt)",
                new { userId, verificationToken, expiresAt }
            );

            return (true, null, verificationToken);
        }
        catch (Exception ex)
        {
            return (false, $"Registration failed: {ex.Message}", null);
        }
    }

    // Generate verification token
    private string GenerateVerificationToken()
    {
        return Guid.NewGuid().ToString("N");
    }

    // Verify email with token
    public async Task<(bool Success, string? Error)> VerifyEmailAsync(string token)
    {
        try
        {
            // Get token info
            var tokenRow = await db.ExecuteReaderAsync(
                @"SELECT user_id, expires_at, verified_at
                  FROM app.email_verification_tokens
                  WHERE token = @token",
                reader =>
                {
                    return new
                    {
                        UserId = reader.GetInt64(0),
                        ExpiresAt = reader.GetDateTime(1),
                        VerifiedAt = reader.IsDBNull(2) ? (DateTime?)null : reader.GetDateTime(2)
                    };
                },
                new { token }
            );

            if (tokenRow == null)
            {
                return (false, "Invalid verification token");
            }

            if (tokenRow.VerifiedAt.HasValue)
            {
                return (false, "Email has already been verified");
            }

            if (tokenRow.ExpiresAt < DateTime.UtcNow)
            {
                return (false, "Verification token has expired");
            }

            // Mark token as verified
            await db.ExecuteAsync<object>(
                "UPDATE app.email_verification_tokens SET verified_at = @verifiedAt WHERE token = @token",
                new { verifiedAt = DateTime.UtcNow, token }
            );

            // Mark user email as verified
            await db.ExecuteAsync<object>(
                "UPDATE app.users SET email_verified = true WHERE id = @userId",
                new { userId = tokenRow.UserId }
            );

            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, $"Verification failed: {ex.Message}");
        }
    }

    // Resend verification email
    public async Task<(bool Success, string? Error, string? VerificationToken)> ResendVerificationTokenAsync(string email)
    {
        try
        {
            // Get user by email
            var userRow = await db.ExecuteReaderAsync(
                "SELECT id, email_verified FROM app.users WHERE email = @email",
                reader =>
                {
                    return new
                    {
                        UserId = reader.GetInt64(0),
                        EmailVerified = reader.GetBoolean(1)
                    };
                },
                new { email }
            );

            if (userRow == null)
            {
                return (false, "Email not found", null);
            }

            if (userRow.EmailVerified)
            {
                return (false, "Email is already verified", null);
            }

            // Invalidate old tokens (set verified_at to prevent reuse)
            await db.ExecuteAsync<object>(
                "UPDATE app.email_verification_tokens SET verified_at = @verifiedAt WHERE user_id = @userId AND verified_at IS NULL",
                new { verifiedAt = DateTime.UtcNow, userId = userRow.UserId }
            );

            // Generate new verification token
            var verificationToken = GenerateVerificationToken();
            var expiresAt = DateTime.UtcNow.AddHours(24);

            // Store new verification token
            await db.ExecuteAsync<object>(
                @"INSERT INTO app.email_verification_tokens (user_id, token, expires_at)
                  VALUES (@userId, @verificationToken, @expiresAt)",
                new { userId = userRow.UserId, verificationToken, expiresAt }
            );

            return (true, null, verificationToken);
        }
        catch (Exception ex)
        {
            return (false, $"Failed to resend verification: {ex.Message}", null);
        }
    }

    // Login user
    public async Task<(bool Success, string? Error, UserLoginInfo? User)> LoginAsync(string emailOrUsername, string password)
    {
        try
        {
            // Get user by email or username
            var query = @"
                SELECT id, email, username, password_hash, is_active, email_verified,
                       failed_login_attempts, locked_until, last_login
                FROM app.users
                WHERE email = @emailOrUsername OR username = @emailOrUsername";

            var userRow = await db.ExecuteReaderAsync(query, reader =>
            {
                return new UserRow
                {
                    Id = reader.GetInt64(0),
                    Email = reader.GetString(1),
                    Username = reader.GetString(2),
                    PasswordHash = reader.GetString(3),
                    IsActive = reader.GetBoolean(4),
                    EmailVerified = reader.GetBoolean(5),
                    FailedAttempts = reader.GetInt32(6),
                    LockedUntil = reader.IsDBNull(7) ? (DateTime?)null : reader.GetDateTime(7)
                };
            }, new { emailOrUsername });

            if (userRow == null)
            {
                return (false, "Invalid email/username or password", null);
            }

            // Check if account is locked
            if (userRow.LockedUntil.HasValue && userRow.LockedUntil.Value > DateTime.UtcNow)
            {
                var remainingMinutes = (int)(userRow.LockedUntil.Value - DateTime.UtcNow).TotalMinutes;
                return (false, $"Account is locked. Try again in {remainingMinutes} minute(s)", null);
            }

            // Check if account is active
            if (!userRow.IsActive)
            {
                return (false, "Account is deactivated", null);
            }

            // Verify password
            if (!VerifyPassword(password, userRow.PasswordHash))
            {
                // Increment failed attempts
                await IncrementFailedLoginAttemptsAsync(userRow.Id, userRow.FailedAttempts);
                return (false, "Invalid email/username or password", null);
            }

            // Successful login - reset failed attempts and update last login
            await ResetFailedLoginAttemptsAsync(userRow.Id);

            var userInfo = new UserLoginInfo
            {
                Id = userRow.Id,
                Email = userRow.Email,
                Username = userRow.Username,
                IsActive = userRow.IsActive,
                EmailVerified = userRow.EmailVerified
            };

            return (true, null, userInfo);
        }
        catch (Exception ex)
        {
            return (false, $"Login failed: {ex.Message}", null);
        }
    }

    // Increment failed login attempts
    private async Task IncrementFailedLoginAttemptsAsync(long userId, int currentAttempts)
    {
        var newAttempts = currentAttempts + 1;

        // Lock account for 15 minutes after 5 failed attempts
        if (newAttempts >= 5)
        {
            var lockUntil = DateTime.UtcNow.AddMinutes(15);
            await db.ExecuteAsync<object>(
                "UPDATE app.users SET failed_login_attempts = @newAttempts, locked_until = @lockUntil WHERE id = @userId",
                new { userId, newAttempts, lockUntil }
            );
        }
        else
        {
            await db.ExecuteAsync<object>(
                "UPDATE app.users SET failed_login_attempts = @newAttempts WHERE id = @userId",
                new { userId, newAttempts }
            );
        }
    }

    // Reset failed login attempts
    private async Task ResetFailedLoginAttemptsAsync(long userId)
    {
        await db.ExecuteAsync<object>(
            "UPDATE app.users SET failed_login_attempts = 0, locked_until = NULL, last_login = @lastLogin WHERE id = @userId",
            new { userId, lastLogin = DateTime.UtcNow }
        );
    }

    public static string GenerateSecureToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
            .Replace("+", "-")
            .Replace("/", "_")
            .TrimEnd('=');
    }

    public static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    public async Task<(bool Success, string? Error, string? Token, string? Username)> RequestPasswordResetAsync(string email)
    {
        try
        {
            var userRow = await db.ExecuteReaderAsync(
                "SELECT id, username, is_active, locked_until FROM app.users WHERE email = @email",
                reader => new
                {
                    UserId = reader.GetInt64(0),
                    Username = reader.GetString(1),
                    IsActive = reader.GetBoolean(2),
                    LockedUntil = reader.IsDBNull(3) ? (DateTime?)null : reader.GetDateTime(3)
                },
                new { email }
            );

            if (userRow == null)
            {
                // Artificial delay to prevent timing-based email enumeration
                await Task.Delay(Random.Shared.Next(100, 300));
                return (true, null, null, null);
            }

            // Silently succeed for inactive/locked accounts (don't reveal state)
            if (!userRow.IsActive ||
                (userRow.LockedUntil.HasValue && userRow.LockedUntil.Value > DateTime.UtcNow))
            {
                return (true, null, null, null);
            }

            // Rate limit: max 3 requests per hour
            var recentCount = await db.ExecuteAsync<long>(
                @"SELECT COUNT(*) FROM app.password_reset_tokens
                  WHERE user_id = @userId AND created_at > @cutoff",
                new { userId = userRow.UserId, cutoff = DateTimeOffset.UtcNow.AddHours(-1) }
            );

            if (recentCount >= 3)
            {
                return (true, null, null, null);
            }

            // Invalidate all existing unused tokens for this user
            await db.ExecuteNonQueryAsync(
                @"UPDATE app.password_reset_tokens
                  SET used_at = @now
                  WHERE user_id = @userId AND used_at IS NULL",
                new { userId = userRow.UserId, now = DateTimeOffset.UtcNow }
            );

            // Generate and store new token
            var token = GenerateSecureToken();
            var tokenHash = HashToken(token);
            var expiresAt = DateTimeOffset.UtcNow.AddHours(1);

            await db.ExecuteNonQueryAsync(
                @"INSERT INTO app.password_reset_tokens (user_id, token_hash, expires_at)
                  VALUES (@userId, @tokenHash, @expiresAt)",
                new { userId = userRow.UserId, tokenHash, expiresAt }
            );

            return (true, null, token, userRow.Username);
        }
        catch (Exception ex)
        {
            return (false, $"Password reset request failed: {ex.Message}", null, null);
        }
    }

    public async Task<(bool Valid, string? Error)> ValidatePasswordResetTokenAsync(string token)
    {
        try
        {
            var tokenHash = HashToken(token);

            var tokenRow = await db.ExecuteReaderAsync(
                @"SELECT expires_at, used_at FROM app.password_reset_tokens
                  WHERE token_hash = @tokenHash",
                reader => new
                {
                    ExpiresAt = reader.GetFieldValue<DateTimeOffset>(0),
                    UsedAt = reader.IsDBNull(1) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(1)
                },
                new { tokenHash }
            );

            if (tokenRow == null)
                return (false, "Invalid or expired reset link. Please request a new one.");

            if (tokenRow.UsedAt.HasValue)
                return (false, "This reset link has already been used. Please request a new one.");

            if (tokenRow.ExpiresAt < DateTimeOffset.UtcNow)
                return (false, "This reset link has expired. Please request a new one.");

            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, $"Token validation failed: {ex.Message}");
        }
    }

    public async Task<(bool Success, string? Error)> ResetPasswordAsync(string token, string newPassword)
    {
        try
        {
            var tokenHash = HashToken(token);

            var tokenRow = await db.ExecuteReaderAsync(
                @"SELECT id, user_id, expires_at, used_at FROM app.password_reset_tokens
                  WHERE token_hash = @tokenHash",
                reader => new
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    ExpiresAt = reader.GetFieldValue<DateTimeOffset>(2),
                    UsedAt = reader.IsDBNull(3) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(3)
                },
                new { tokenHash }
            );

            if (tokenRow == null)
                return (false, "Invalid or expired reset link. Please request a new one.");

            if (tokenRow.UsedAt.HasValue)
                return (false, "This reset link has already been used. Please request a new one.");

            if (tokenRow.ExpiresAt < DateTimeOffset.UtcNow)
                return (false, "This reset link has expired. Please request a new one.");

            // Hash new password and update user
            var passwordHash = HashPassword(newPassword);
            await db.ExecuteNonQueryAsync(
                @"UPDATE app.users
                  SET password_hash = @passwordHash, failed_login_attempts = 0, locked_until = NULL
                  WHERE id = @userId",
                new { userId = tokenRow.UserId, passwordHash }
            );

            // Mark token as used
            await db.ExecuteNonQueryAsync(
                "UPDATE app.password_reset_tokens SET used_at = @now WHERE id = @tokenId",
                new { tokenId = tokenRow.Id, now = DateTimeOffset.UtcNow }
            );

            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, $"Password reset failed: {ex.Message}");
        }
    }
}
