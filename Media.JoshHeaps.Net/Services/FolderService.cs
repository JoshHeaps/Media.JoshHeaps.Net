using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public class FolderService(DbExecutor db, ILogger<FolderService> logger)
{
    public async Task<Folder?> CreateFolderAsync(long userId, string name, long? parentFolderId = null)
    {
        try
        {
            // Validate folder name
            if (string.IsNullOrWhiteSpace(name))
            {
                logger.LogWarning("Cannot create folder with empty name for user {UserId}", userId);
                return null;
            }

            // Sanitize folder name (remove invalid characters)
            var sanitizedName = SanitizeFolderName(name);
            if (string.IsNullOrWhiteSpace(sanitizedName))
            {
                logger.LogWarning("Folder name became empty after sanitization for user {UserId}", userId);
                return null;
            }

            // If parent folder is specified, verify it exists and belongs to user
            if (parentFolderId.HasValue)
            {
                var parentExists = await FolderExistsAsync(parentFolderId.Value, userId);
                if (!parentExists)
                {
                    logger.LogWarning("Parent folder {ParentFolderId} not found for user {UserId}", parentFolderId.Value, userId);
                    return null;
                }
            }

            var query = @"
                INSERT INTO app.folders (user_id, name, parent_folder_id, created_at, updated_at)
                VALUES (@userId, @name, @parentFolderId, @createdAt, @updatedAt)
                RETURNING id, user_id, name, parent_folder_id, created_at, updated_at";

            var folder = await db.ExecuteReaderAsync(query, reader =>
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
            logger.LogError(ex, "Failed to create folder '{Name}' for user {UserId}", name, userId);
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

            var folders = await db.ExecuteListReaderAsync(query, reader =>
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
            logger.LogError(ex, "Failed to get folders for user {UserId}, parent {ParentFolderId}", userId, parentFolderId);
            return [];
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

            var folder = await db.ExecuteReaderAsync(query, reader =>
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
            logger.LogError(ex, "Failed to get folder {FolderId} for user {UserId}", folderId, userId);
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
                logger.LogWarning("Cannot rename folder to empty name");
                return false;
            }

            var query = @"
                UPDATE app.folders
                SET name = @newName, updated_at = @updatedAt
                WHERE id = @folderId AND user_id = @userId";

            await db.ExecuteAsync<object>(query, new
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
            logger.LogError(ex, "Failed to rename folder {FolderId} for user {UserId}", folderId, userId);
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

            var subfolderCount = await db.ExecuteReaderAsync(hasSubfoldersQuery, reader => reader.GetInt64(0), new { folderId });
            var mediaCount = await db.ExecuteReaderAsync(hasMediaQuery, reader => reader.GetInt64(0), new { folderId });

            if (!deleteContents && (subfolderCount > 0 || mediaCount > 0))
            {
                logger.LogWarning("Cannot delete folder {FolderId} - it contains items", folderId);
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

                    await db.ExecuteAsync<object>(moveSubfoldersQuery, new
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

                    await db.ExecuteAsync<object>(moveMediaQuery, new
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
            await db.ExecuteAsync<object>(deleteQuery, new { folderId, userId });

            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete folder {FolderId} for user {UserId}", folderId, userId);
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
                    logger.LogWarning("Cannot move folder {FolderId} into its descendant {ParentFolderId}", folderId, newParentFolderId.Value);
                    return false;
                }
            }

            var query = @"
                UPDATE app.folders
                SET parent_folder_id = @newParentFolderId, updated_at = @updatedAt
                WHERE id = @folderId AND user_id = @userId";

            await db.ExecuteAsync<object>(query, new
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
            logger.LogError(ex, "Failed to move folder {FolderId} for user {UserId}", folderId, userId);
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
            logger.LogError(ex, "Failed to get folder path for folder {FolderId}", folderId);
            return [];
        }
    }

    private async Task<bool> FolderExistsAsync(long folderId, long userId)
    {
        try
        {
            var query = "SELECT COUNT(*) FROM app.folders WHERE id = @folderId AND user_id = @userId";
            var count = await db.ExecuteReaderAsync(query, reader => reader.GetInt64(0), new { folderId, userId });
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
                var parentId = await db.ExecuteReaderAsync(query, reader => reader.IsDBNull(0) ? (long?)null : reader.GetInt64(0), new { folderId = currentId });

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
            logger.LogError(ex, "Failed to check if folder {PotentialDescendantId} is descendant of {AncestorId}", potentialDescendantId, ancestorId);
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

    // Folder Sharing Methods

    public async Task<FolderShare?> ShareFolderAsync(long folderId, long ownerId, long sharedWithUserId)
    {
        try
        {
            // Verify folder exists and belongs to owner
            var folder = await GetFolderByIdAsync(folderId, ownerId);
            if (folder == null)
            {
                logger.LogWarning("Cannot share folder {FolderId} - not found or not owned by {OwnerId}", folderId, ownerId);
                return null;
            }

            // Check if already shared
            var existingShare = await GetFolderShareAsync(folderId, sharedWithUserId);
            if (existingShare != null)
            {
                return existingShare;
            }

            var query = @"
                INSERT INTO app.folder_shares (folder_id, owner_user_id, shared_with_user_id, permission_level, include_subfolders, created_at, updated_at)
                VALUES (@folderId, @ownerId, @sharedWithUserId, @permissionLevel, @includeSubfolders, @createdAt, @updatedAt)
                RETURNING id, folder_id, owner_user_id, shared_with_user_id, permission_level, include_subfolders, created_at, updated_at";

            var share = await db.ExecuteReaderAsync(query, reader =>
            {
                return new FolderShare
                {
                    Id = reader.GetInt64(0),
                    FolderId = reader.GetInt64(1),
                    OwnerUserId = reader.GetInt64(2),
                    SharedWithUserId = reader.GetInt64(3),
                    PermissionLevel = reader.GetString(4),
                    IncludeSubfolders = reader.GetBoolean(5),
                    CreatedAt = reader.GetDateTime(6),
                    UpdatedAt = reader.GetDateTime(7)
                };
            }, new
            {
                folderId,
                ownerId,
                sharedWithUserId,
                permissionLevel = "read_only",
                includeSubfolders = true,
                createdAt = DateTime.UtcNow,
                updatedAt = DateTime.UtcNow
            });

            return share;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to share folder {FolderId} with user {SharedWithUserId}", folderId, sharedWithUserId);
            return null;
        }
    }

    public async Task<bool> UnshareFolderAsync(long folderId, long ownerId, long sharedWithUserId)
    {
        try
        {
            var query = @"
                DELETE FROM app.folder_shares
                WHERE folder_id = @folderId AND owner_user_id = @ownerId AND shared_with_user_id = @sharedWithUserId";

            await db.ExecuteAsync<object>(query, new { folderId, ownerId, sharedWithUserId });
            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to unshare folder {FolderId} from user {SharedWithUserId}", folderId, sharedWithUserId);
            return false;
        }
    }

    public async Task<List<FolderShareWithUser>> GetFolderSharesAsync(long folderId, long ownerId)
    {
        try
        {
            var query = @"
                SELECT fs.id, fs.folder_id, fs.owner_user_id, fs.shared_with_user_id,
                       u.username, u.email, fs.permission_level, fs.created_at
                FROM app.folder_shares fs
                JOIN app.users u ON fs.shared_with_user_id = u.id
                WHERE fs.folder_id = @folderId AND fs.owner_user_id = @ownerId
                ORDER BY u.username ASC";

            var shares = await db.ExecuteListReaderAsync(query, reader =>
            {
                return new FolderShareWithUser
                {
                    Id = reader.GetInt64(0),
                    FolderId = reader.GetInt64(1),
                    OwnerUserId = reader.GetInt64(2),
                    SharedWithUserId = reader.GetInt64(3),
                    SharedWithUsername = reader.GetString(4),
                    SharedWithEmail = reader.GetString(5),
                    PermissionLevel = reader.GetString(6),
                    CreatedAt = reader.GetDateTime(7)
                };
            }, new { folderId, ownerId });

            return shares;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get shares for folder {FolderId}", folderId);
            return [];
        }
    }

    public async Task<List<SharedFolderInfo>> GetSharedFoldersAsync(long userId)
    {
        try
        {
            var query = @"
                SELECT fs.folder_id, f.name, fs.owner_user_id, u.username, fs.permission_level, fs.created_at
                FROM app.folder_shares fs
                JOIN app.folders f ON fs.folder_id = f.id
                JOIN app.users u ON fs.owner_user_id = u.id
                WHERE fs.shared_with_user_id = @userId
                ORDER BY f.name ASC";

            var sharedFolders = await db.ExecuteListReaderAsync(query, reader =>
            {
                return new SharedFolderInfo
                {
                    FolderId = reader.GetInt64(0),
                    FolderName = reader.GetString(1),
                    OwnerUserId = reader.GetInt64(2),
                    OwnerUsername = reader.GetString(3),
                    PermissionLevel = reader.GetString(4),
                    SharedAt = reader.GetDateTime(5)
                };
            }, new { userId });

            return sharedFolders;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get shared folders for user {UserId}", userId);
            return [];
        }
    }

    private async Task<FolderShare?> GetFolderShareAsync(long folderId, long sharedWithUserId)
    {
        try
        {
            var query = @"
                SELECT id, folder_id, owner_user_id, shared_with_user_id, permission_level, include_subfolders, created_at, updated_at
                FROM app.folder_shares
                WHERE folder_id = @folderId AND shared_with_user_id = @sharedWithUserId";

            var share = await db.ExecuteReaderAsync(query, reader =>
            {
                return new FolderShare
                {
                    Id = reader.GetInt64(0),
                    FolderId = reader.GetInt64(1),
                    OwnerUserId = reader.GetInt64(2),
                    SharedWithUserId = reader.GetInt64(3),
                    PermissionLevel = reader.GetString(4),
                    IncludeSubfolders = reader.GetBoolean(5),
                    CreatedAt = reader.GetDateTime(6),
                    UpdatedAt = reader.GetDateTime(7)
                };
            }, new { folderId, sharedWithUserId });

            return share;
        }
        catch
        {
            return null;
        }
    }

    public async Task<bool> HasFolderAccessAsync(long folderId, long userId)
    {
        try
        {
            // Check if user is the owner
            var query = "SELECT COUNT(*) FROM app.folders WHERE id = @folderId AND user_id = @userId";
            var isOwner = await db.ExecuteReaderAsync(query, reader => reader.GetInt64(0), new { folderId, userId });
            if (isOwner > 0) return true;

            // Check if folder is shared with user (including parent folders due to subfolders)
            var shareQuery = @"
                WITH RECURSIVE folder_hierarchy AS (
                    -- Base case: the folder itself
                    SELECT id, parent_folder_id
                    FROM app.folders
                    WHERE id = @folderId

                    UNION ALL

                    -- Recursive case: parent folders
                    SELECT f.id, f.parent_folder_id
                    FROM app.folders f
                    INNER JOIN folder_hierarchy fh ON f.id = fh.parent_folder_id
                )
                SELECT COUNT(*)
                FROM app.folder_shares fs
                INNER JOIN folder_hierarchy fh ON fs.folder_id = fh.id
                WHERE fs.shared_with_user_id = @userId AND fs.include_subfolders = true";

            var hasShare = await db.ExecuteReaderAsync(shareQuery, reader => reader.GetInt64(0), new { folderId, userId });
            return hasShare > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to check folder access for folder {FolderId} and user {UserId}", folderId, userId);
            return false;
        }
    }

    public async Task<long?> GetFolderOwnerIdAsync(long folderId)
    {
        try
        {
            var query = "SELECT user_id FROM app.folders WHERE id = @folderId";
            var ownerId = await db.ExecuteReaderAsync(query, reader => reader.GetInt64(0), new { folderId });
            return ownerId;
        }
        catch
        {
            return null;
        }
    }
}
