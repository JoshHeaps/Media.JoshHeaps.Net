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
}
