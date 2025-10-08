using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public class MediaService
{
    private readonly DbExecutor _db;
    private readonly IWebHostEnvironment _environment;
    private readonly EncryptionService _encryption;
    private readonly ILogger<MediaService> _logger;

    public MediaService(DbExecutor db, IWebHostEnvironment environment, EncryptionService encryption, ILogger<MediaService> logger)
    {
        _db = db;
        _environment = environment;
        _encryption = encryption;
        _logger = logger;
    }

    public async Task<UserMedia?> SaveMediaAsync(long userId, IFormFile file, string? description = null)
    {
        string? tempFilePath = null;
        string? encryptedFilePath = null;

        try
        {
            // Generate unique filename
            var fileExtension = Path.GetExtension(file.FileName);
            var uniqueFileName = $"{Guid.NewGuid()}{fileExtension}.enc"; // .enc for encrypted

            // Store outside wwwroot in App_Data folder
            var mediaFolder = Path.Combine(_environment.ContentRootPath, "App_Data", "media", userId.ToString());
            Directory.CreateDirectory(mediaFolder);

            tempFilePath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
            encryptedFilePath = Path.Combine(mediaFolder, uniqueFileName);

            // Save uploaded file temporarily
            using (var fileStream = new FileStream(tempFilePath, FileMode.Create))
            {
                await file.CopyToAsync(fileStream);
            }

            // Get image dimensions before encryption
            int? width = null;
            int? height = null;

            if (file.ContentType.StartsWith("image/"))
            {
                try
                {
                    using var image = await SixLabors.ImageSharp.Image.LoadAsync(tempFilePath);
                    width = image.Width;
                    height = image.Height;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to read image dimensions for {FileName}", file.FileName);
                }
            }

            // Encrypt and save
            await _encryption.EncryptFileAsync(tempFilePath, encryptedFilePath);

            // Delete temp file
            File.Delete(tempFilePath);
            tempFilePath = null;

            // Store relative path for database
            var relativeFilePath = Path.Combine("App_Data", "media", userId.ToString(), uniqueFileName);

            // Insert into database
            var query = @"
                INSERT INTO app.user_media (user_id, file_name, file_path, file_size, mime_type, width, height, description, is_encrypted, created_at, updated_at)
                VALUES (@userId, @fileName, @filePath, @fileSize, @mimeType, @width, @height, @description, @isEncrypted, @createdAt, @updatedAt)
                RETURNING id, user_id, file_name, file_path, file_size, mime_type, width, height, description, is_encrypted, created_at, updated_at";

            var media = await _db.ExecuteReaderAsync(query, reader =>
            {
                return new UserMedia
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    FileName = reader.GetString(2),
                    FilePath = reader.GetString(3),
                    FileSize = reader.GetInt64(4),
                    MimeType = reader.GetString(5),
                    Width = reader.IsDBNull(6) ? null : reader.GetInt32(6),
                    Height = reader.IsDBNull(7) ? null : reader.GetInt32(7),
                    Description = reader.IsDBNull(8) ? null : reader.GetString(8),
                    IsEncrypted = reader.GetBoolean(9),
                    CreatedAt = reader.GetDateTime(10),
                    UpdatedAt = reader.GetDateTime(11)
                };
            }, new
            {
                userId,
                fileName = file.FileName,
                filePath = relativeFilePath,
                fileSize = file.Length,
                mimeType = file.ContentType,
                width,
                height,
                description,
                isEncrypted = true,
                createdAt = DateTime.UtcNow,
                updatedAt = DateTime.UtcNow
            });

            return media;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save media for user {UserId}", userId);

            // Cleanup on error
            if (tempFilePath != null && File.Exists(tempFilePath))
            {
                try { File.Delete(tempFilePath); } catch { }
            }
            if (encryptedFilePath != null && File.Exists(encryptedFilePath))
            {
                try { File.Delete(encryptedFilePath); } catch { }
            }

            return null;
        }
    }

    public async Task<List<UserMedia>> GetUserMediaAsync(long userId, int offset = 0, int limit = 20)
    {
        try
        {
            var query = @"
                SELECT id, user_id, file_name, file_path, file_size, mime_type, width, height, description, is_encrypted, created_at, updated_at
                FROM app.user_media
                WHERE user_id = @userId
                ORDER BY created_at DESC
                OFFSET @offset LIMIT @limit";

            var mediaList = await _db.ExecuteListReaderAsync(query, reader =>
            {
                return new UserMedia
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    FileName = reader.GetString(2),
                    FilePath = reader.GetString(3),
                    FileSize = reader.GetInt64(4),
                    MimeType = reader.GetString(5),
                    Width = reader.IsDBNull(6) ? null : reader.GetInt32(6),
                    Height = reader.IsDBNull(7) ? null : reader.GetInt32(7),
                    Description = reader.IsDBNull(8) ? null : reader.GetString(8),
                    IsEncrypted = reader.GetBoolean(9),
                    CreatedAt = reader.GetDateTime(10),
                    UpdatedAt = reader.GetDateTime(11)
                };
            }, new { userId, offset, limit });

            return mediaList;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get media for user {UserId}", userId);
            return new List<UserMedia>();
        }
    }

    public async Task<UserMedia?> GetMediaByIdAsync(long mediaId, long userId)
    {
        try
        {
            var query = @"
                SELECT id, user_id, file_name, file_path, file_size, mime_type, width, height, description, is_encrypted, created_at, updated_at
                FROM app.user_media
                WHERE id = @mediaId AND user_id = @userId";

            var media = await _db.ExecuteReaderAsync(query, reader =>
            {
                return new UserMedia
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    FileName = reader.GetString(2),
                    FilePath = reader.GetString(3),
                    FileSize = reader.GetInt64(4),
                    MimeType = reader.GetString(5),
                    Width = reader.IsDBNull(6) ? null : reader.GetInt32(6),
                    Height = reader.IsDBNull(7) ? null : reader.GetInt32(7),
                    Description = reader.IsDBNull(8) ? null : reader.GetString(8),
                    IsEncrypted = reader.GetBoolean(9),
                    CreatedAt = reader.GetDateTime(10),
                    UpdatedAt = reader.GetDateTime(11)
                };
            }, new { mediaId, userId });

            return media;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get media {MediaId} for user {UserId}", mediaId, userId);
            return null;
        }
    }

    public async Task<byte[]?> GetDecryptedMediaDataAsync(long mediaId, long userId)
    {
        try
        {
            var media = await GetMediaByIdAsync(mediaId, userId);
            if (media == null)
            {
                _logger.LogWarning("Media {MediaId} not found or user {UserId} doesn't have access", mediaId, userId);
                return null;
            }

            var fullPath = Path.Combine(_environment.ContentRootPath, media.FilePath);

            if (!File.Exists(fullPath))
            {
                _logger.LogError("Media file not found at {FilePath}", fullPath);
                return null;
            }

            if (media.IsEncrypted)
            {
                return await _encryption.DecryptFileAsync(fullPath);
            }
            else
            {
                return await File.ReadAllBytesAsync(fullPath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get decrypted media data for {MediaId}", mediaId);
            return null;
        }
    }

    public async Task<bool> DeleteMediaAsync(long mediaId, long userId)
    {
        try
        {
            // Get media info first
            var query = "SELECT file_path FROM app.user_media WHERE id = @mediaId AND user_id = @userId";
            var filePath = await _db.ExecuteReaderAsync(query, reader => reader.GetString(0), new { mediaId, userId });

            if (filePath == null) return false;

            // Delete from database
            var deleteQuery = "DELETE FROM app.user_media WHERE id = @mediaId AND user_id = @userId";
            await _db.ExecuteAsync<object>(deleteQuery, new { mediaId, userId });

            // Delete physical file
            var physicalPath = Path.Combine(_environment.ContentRootPath, filePath);
            if (File.Exists(physicalPath))
            {
                File.Delete(physicalPath);
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete media {MediaId} for user {UserId}", mediaId, userId);
            return false;
        }
    }
}
