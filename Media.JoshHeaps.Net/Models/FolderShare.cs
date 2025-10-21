namespace Media.JoshHeaps.Net.Models;

public class FolderShare
{
    public long Id { get; set; }
    public long FolderId { get; set; }
    public long OwnerUserId { get; set; }
    public long SharedWithUserId { get; set; }
    public string PermissionLevel { get; set; } = "read_only";
    public bool IncludeSubfolders { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class FolderShareWithUser
{
    public long Id { get; set; }
    public long FolderId { get; set; }
    public long OwnerUserId { get; set; }
    public long SharedWithUserId { get; set; }
    public string SharedWithUsername { get; set; } = string.Empty;
    public string SharedWithEmail { get; set; } = string.Empty;
    public string PermissionLevel { get; set; } = "read_only";
    public DateTime CreatedAt { get; set; }
}

public class SharedFolderInfo
{
    public long FolderId { get; set; }
    public string FolderName { get; set; } = string.Empty;
    public long OwnerUserId { get; set; }
    public string OwnerUsername { get; set; } = string.Empty;
    public string PermissionLevel { get; set; } = "read_only";
    public DateTime SharedAt { get; set; }
}
