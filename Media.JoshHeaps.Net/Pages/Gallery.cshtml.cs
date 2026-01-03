using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages
{
    public class GalleryModel(UserService userService, MediaService mediaService, FolderService folderService) : AuthenticatedPageModel
    {
        private readonly MediaService _mediaService = mediaService;
        private readonly FolderService _folderService = folderService;

        public UserDashboard? Dashboard { get; set; }
        public List<UserMedia> MediaItems { get; set; } = [];
        public List<Folder> Folders { get; set; } = [];
        public List<Folder> FolderPath { get; set; } = [];
        public List<SharedFolderInfo> SharedFolders { get; set; } = [];
        public long? CurrentFolderId { get; set; }
        public bool IsSharedFolder { get; set; }
        public long? FolderOwnerId { get; set; }
        public string? SharedByUsername { get; set; }
        public string ViewMode { get; set; } = "own"; // "own", "shared", "all"

        [BindProperty]
        public IFormFile? UploadedFile { get; set; }

        [BindProperty]
        public string? Description { get; set; }

        [BindProperty]
        public long? MediaId { get; set; }

        public string? UploadMessage { get; set; }
        public bool UploadSuccess { get; set; }

        public async Task<IActionResult> OnGetAsync(long? folderId = null, string? view = "own")
        {
            RequireAuthentication();
            LoadUserSession();

            CurrentFolderId = folderId;
            ViewMode = view ?? "own";

            // Load user dashboard data
            Dashboard = await userService.GetUserDashboardAsync(UserId);

            // Check if current folder is shared with user
            if (CurrentFolderId.HasValue)
            {
                FolderOwnerId = await _folderService.GetFolderOwnerIdAsync(CurrentFolderId.Value);
                IsSharedFolder = FolderOwnerId != UserId;

                if (IsSharedFolder && FolderOwnerId.HasValue)
                {
                    // Get owner info for display
                    var ownerDashboard = await userService.GetUserDashboardAsync(FolderOwnerId.Value);
                    SharedByUsername = ownerDashboard?.Username;
                }
            }

            // Load folders based on view mode
            if (ViewMode == "shared")
            {
                // Show only shared folders at root level
                SharedFolders = await _folderService.GetSharedFoldersAsync(UserId);
                if (!CurrentFolderId.HasValue)
                {
                    Folders = [];
                }
                else if (IsSharedFolder && FolderOwnerId.HasValue)
                {
                    Folders = await _folderService.GetUserFoldersAsync(FolderOwnerId.Value, CurrentFolderId);
                }
            }
            else if (ViewMode == "own")
            {
                // Show only own folders
                if (!IsSharedFolder)
                {
                    Folders = await _folderService.GetUserFoldersAsync(UserId, CurrentFolderId);
                }
            }
            else // "all"
            {
                // Show both own and shared
                Folders = await _folderService.GetUserFoldersAsync(UserId, CurrentFolderId);
                if (!CurrentFolderId.HasValue)
                {
                    SharedFolders = await _folderService.GetSharedFoldersAsync(UserId);
                }
            }

            // Load folder path (breadcrumbs)
            if (IsSharedFolder && FolderOwnerId.HasValue)
            {
                FolderPath = await _folderService.GetFolderPathAsync(CurrentFolderId, FolderOwnerId.Value);
            }
            else
            {
                FolderPath = await _folderService.GetFolderPathAsync(CurrentFolderId, UserId);
            }

            // Load initial set of media (with access check for shared folders)
            var effectiveUserId = IsSharedFolder && FolderOwnerId.HasValue ? FolderOwnerId.Value : UserId;
            MediaItems = await _mediaService.GetUserMediaAsync(effectiveUserId, 0, 20, CurrentFolderId, UserId);

            return Page();
        }

        public async Task<IActionResult> OnPostAsync(long? folderId = null)
        {
            RequireAuthentication();
            LoadUserSession();

            CurrentFolderId = folderId;
            Dashboard = await userService.GetUserDashboardAsync(UserId);
            Folders = await _folderService.GetUserFoldersAsync(UserId, CurrentFolderId);
            FolderPath = await _folderService.GetFolderPathAsync(CurrentFolderId, UserId);
            MediaItems = await _mediaService.GetUserMediaAsync(UserId, 0, 20, CurrentFolderId);

            return Page();
        }

        public async Task<IActionResult> OnPostAddAsync()
        {
            RequireAuthentication();
            LoadUserSession();

            if (UploadedFile == null || UploadedFile.Length == 0)
            {
                UploadMessage = "Please select a file to upload.";
                UploadSuccess = false;
            }
            else if (!IsValidImageFile(UploadedFile))
            {
                UploadMessage = "Invalid file type. Only images (JPG, PNG, GIF, WEBP) are allowed.";
                UploadSuccess = false;
            }
            else if (UploadedFile.Length > 10 * 1024 * 1024) // 10MB limit
            {
                UploadMessage = "File size exceeds 10MB limit.";
                UploadSuccess = false;
            }
            else
            {
                var media = await _mediaService.SaveMediaAsync(UserId, UploadedFile, Description);
                if (media != null)
                {
                    UploadMessage = "Image uploaded successfully!";
                    UploadSuccess = true;
                }
                else
                {
                    UploadMessage = "Failed to upload image. Please try again.";
                    UploadSuccess = false;
                }
            }

            // Redirect to prevent form resubmission on refresh
            return RedirectToPage();
        }

        public async Task<IActionResult> OnPostDeleteAsync()
        {
            RequireAuthentication();
            LoadUserSession();

            if (MediaId.HasValue)
            {
                var success = await _mediaService.DeleteMediaAsync(MediaId.Value, UserId);
            }

            return RedirectToPage();
        }

        private bool IsValidImageFile(IFormFile file)
        {
            var allowedTypes = new[] { "image/jpeg", "image/png", "image/gif", "image/webp" };
            return allowedTypes.Contains(file.ContentType.ToLower());
        }
    }
}
