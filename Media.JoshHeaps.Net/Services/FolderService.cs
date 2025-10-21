using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public class FolderService
{
    private readonly DbExecutor _db;
    private readonly ILogger<FolderService> _logger;

    public FolderService(DbExecutor db, ILogger<FolderService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<Folder?> CreateFolderAsync(long userId, string name, long? parentFolderId = null)
    {
        try
        {
            // Validate folder name
            if (string.IsNullOrWhiteSpace(name))
            {
                _logger.LogWarning("Cannot create folder with empty name for user {UserId}", userId);
                return null;
            }

            // Sanitize folder name (remove invalid characters)
            var sanitizedName = SanitizeFolderName(name);
            if (string.IsNullOrWhiteSpace(sanitizedName))
            {
                _logger.LogWarning("Folder name became empty after sanitization for user {UserId}", userId);
                return null;
            }

            // If parent folder is specified, verify it exists and belongs to user
            if (parentFolderId.HasValue)
            {
                var parentExists = await FolderExistsAsync(parentFolderId.Value, userId);
                if (!parentExists)
                {
                    _logger.LogWarning("Parent folder {ParentFolderId} not found for user {UserId}", parentFolderId.Value, userId);
                    return null;
                }
            }

            var query = @"
                INSERT INTO app.folders (user_id, name, parent_folder_id, created_at, updated_at)
                VALUES (@userId, @name, @parentFolderId, @createdAt, @updatedAt)
                RETURNING id, user_id, name, parent_folder_id, created_at, updated_at";

            var folder = await _db.ExecuteReaderAsync(query, reader =>
            {
                return new Folder
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    Name = reader.GetString(2),
                    ParentFolderId = reader.IsDBNull(3) ? null : reader.GetInt64(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            }, new
            {
                userId,
                name = sanitizedName,
                parentFolderId,
                createdAt = DateTime.UtcNow,
                updatedAt = DateTime.UtcNow
            });

            return folder;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create folder '{Name}' for user {UserId}", name, userId);
            return null;
        }
    }

    public async Task<List<Folder>> GetUserFoldersAsync(long userId, long? parentFolderId = null)
    {
        try
        {
            string query;
            if (parentFolderId.HasValue)
            {
                query = @"
                    SELECT id, user_id, name, parent_folder_id, created_at, updated_at
                    FROM app.folders
                    WHERE user_id = @userId AND parent_folder_id = @parentFolderId
                    ORDER BY name ASC";
            }
            else
            {
                query = @"
                    SELECT id, user_id, name, parent_folder_id, created_at, updated_at
                    FROM app.folders
                    WHERE user_id = @userId AND parent_folder_id IS NULL
                    ORDER BY name ASC";
            }

            var folders = await _db.ExecuteListReaderAsync(query, reader =>
            {
                return new Folder
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    Name = reader.GetString(2),
                    ParentFolderId = reader.IsDBNull(3) ? null : reader.GetInt64(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            }, new { userId, parentFolderId });

            return folders;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get folders for user {UserId}, parent {ParentFolderId}", userId, parentFolderId);
            return new List<Folder>();
        }
    }

    public async Task<Folder?> GetFolderByIdAsync(long folderId, long userId)
    {
        try
        {
            var query = @"
                SELECT id, user_id, name, parent_folder_id, created_at, updated_at
                FROM app.folders
                WHERE id = @folderId AND user_id = @userId";

            var folder = await _db.ExecuteReaderAsync(query, reader =>
            {
                return new Folder
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    Name = reader.GetString(2),
                    ParentFolderId = reader.IsDBNull(3) ? null : reader.GetInt64(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            }, new { folderId, userId });

            return folder;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get folder {FolderId} for user {UserId}", folderId, userId);
            return null;
        }
    }

    public async Task<bool> RenameFolderAsync(long folderId, long userId, string newName)
    {
        try
        {
            var sanitizedName = SanitizeFolderName(newName);
            if (string.IsNullOrWhiteSpace(sanitizedName))
            {
                _logger.LogWarning("Cannot rename folder to empty name");
                return false;
            }

            var query = @"
                UPDATE app.folders
                SET name = @newName, updated_at = @updatedAt
                WHERE id = @folderId AND user_id = @userId";

            await _db.ExecuteAsync<object>(query, new
            {
                folderId,
                userId,
                newName = sanitizedName,
                updatedAt = DateTime.UtcNow
            });

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to rename folder {FolderId} for user {UserId}", folderId, userId);
            return false;
        }
    }

    public async Task<bool> DeleteFolderAsync(long folderId, long userId, bool deleteContents = false)
    {
        try
        {
            // Check if folder has subfolders or media
            var hasSubfoldersQuery = "SELECT COUNT(*) FROM app.folders WHERE parent_folder_id = @folderId";
            var hasMediaQuery = "SELECT COUNT(*) FROM app.user_media WHERE folder_id = @folderId";

            var subfolderCount = await _db.ExecuteReaderAsync(hasSubfoldersQuery, reader => reader.GetInt64(0), new { folderId });
            var mediaCount = await _db.ExecuteReaderAsync(hasMediaQuery, reader => reader.GetInt64(0), new { folderId });

            if (!deleteContents && (subfolderCount > 0 || mediaCount > 0))
            {
                _logger.LogWarning("Cannot delete folder {FolderId} - it contains items", folderId);
                return false;
            }

            if (deleteContents)
            {
                // Move contents to parent folder instead of deleting
                var folder = await GetFolderByIdAsync(folderId, userId);
                if (folder != null)
                {
                    // Move subfolders to parent
                    var moveSubfoldersQuery = @"
                        UPDATE app.folders
                        SET parent_folder_id = @parentFolderId, updated_at = @updatedAt
                        WHERE parent_folder_id = @folderId AND user_id = @userId";

                    await _db.ExecuteAsync<object>(moveSubfoldersQuery, new
                    {
                        parentFolderId = folder.ParentFolderId,
                        folderId,
                        userId,
                        updatedAt = DateTime.UtcNow
                    });

                    // Move media to parent
                    var moveMediaQuery = @"
                        UPDATE app.user_media
                        SET folder_id = @parentFolderId, updated_at = @updatedAt
                        WHERE folder_id = @folderId AND user_id = @userId";

                    await _db.ExecuteAsync<object>(moveMediaQuery, new
                    {
                        parentFolderId = folder.ParentFolderId,
                        folderId,
                        userId,
                        updatedAt = DateTime.UtcNow
                    });
                }
            }

            // Delete the folder
            var deleteQuery = "DELETE FROM app.folders WHERE id = @folderId AND user_id = @userId";
            await _db.ExecuteAsync<object>(deleteQuery, new { folderId, userId });

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete folder {FolderId} for user {UserId}", folderId, userId);
            return false;
        }
    }

    public async Task<bool> MoveFolderAsync(long folderId, long userId, long? newParentFolderId)
    {
        try
        {
            // Verify folder exists and belongs to user
            var folder = await GetFolderByIdAsync(folderId, userId);
            if (folder == null)
            {
                return false;
            }

            // If new parent is specified, verify it exists and isn't a descendant
            if (newParentFolderId.HasValue)
            {
                var parentExists = await FolderExistsAsync(newParentFolderId.Value, userId);
                if (!parentExists)
                {
                    return false;
                }

                // Prevent moving folder into its own descendant
                var isDescendant = await IsFolderDescendantAsync(newParentFolderId.Value, folderId);
                if (isDescendant)
                {
                    _logger.LogWarning("Cannot move folder {FolderId} into its descendant {ParentFolderId}", folderId, newParentFolderId.Value);
                    return false;
                }
            }

            var query = @"
                UPDATE app.folders
                SET parent_folder_id = @newParentFolderId, updated_at = @updatedAt
                WHERE id = @folderId AND user_id = @userId";

            await _db.ExecuteAsync<object>(query, new
            {
                folderId,
                userId,
                newParentFolderId,
                updatedAt = DateTime.UtcNow
            });

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to move folder {FolderId} for user {UserId}", folderId, userId);
            return false;
        }
    }

    public async Task<List<Folder>> GetFolderPathAsync(long? folderId, long userId)
    {
        var path = new List<Folder>();

        if (!folderId.HasValue)
        {
            return path;
        }

        try
        {
            var currentFolderId = folderId;
            while (currentFolderId.HasValue)
            {
                var folder = await GetFolderByIdAsync(currentFolderId.Value, userId);
                if (folder == null)
                {
                    break;
                }

                path.Insert(0, folder);
                currentFolderId = folder.ParentFolderId;
            }

            return path;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get folder path for folder {FolderId}", folderId);
            return new List<Folder>();
        }
    }

    private async Task<bool> FolderExistsAsync(long folderId, long userId)
    {
        try
        {
            var query = "SELECT COUNT(*) FROM app.folders WHERE id = @folderId AND user_id = @userId";
            var count = await _db.ExecuteReaderAsync(query, reader => reader.GetInt64(0), new { folderId, userId });
            return count > 0;
        }
        catch
        {
            return false;
        }
    }

    private async Task<bool> IsFolderDescendantAsync(long potentialDescendantId, long ancestorId)
    {
        try
        {
            var currentId = potentialDescendantId;
            var visited = new HashSet<long>();

            while (currentId != 0)
            {
                if (currentId == ancestorId)
                {
                    return true;
                }

                if (visited.Contains(currentId))
                {
                    // Circular reference detected
                    return false;
                }
                visited.Add(currentId);

                var query = "SELECT parent_folder_id FROM app.folders WHERE id = @folderId";
                var parentId = await _db.ExecuteReaderAsync(query, reader => reader.IsDBNull(0) ? (long?)null : reader.GetInt64(0), new { folderId = currentId });

                if (!parentId.HasValue)
                {
                    break;
                }

                currentId = parentId.Value;
            }

            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to check if folder {PotentialDescendantId} is descendant of {AncestorId}", potentialDescendantId, ancestorId);
            return false;
        }
    }

    private string SanitizeFolderName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return string.Empty;
        }

        // Remove invalid filename characters
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = string.Join("", name.Split(invalidChars, StringSplitOptions.RemoveEmptyEntries));

        // Trim whitespace and limit length
        sanitized = sanitized.Trim();
        if (sanitized.Length > 255)
        {
            sanitized = sanitized.Substring(0, 255);
        }

        return sanitized;
    }
}
