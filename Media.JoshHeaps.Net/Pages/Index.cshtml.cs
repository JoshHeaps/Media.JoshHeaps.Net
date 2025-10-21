using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages
{
    public class IndexModel(UserService userService, MediaService mediaService, FolderService folderService) : AuthenticatedPageModel
    {
        private readonly MediaService _mediaService = mediaService;
        private readonly FolderService _folderService = folderService;

        public UserDashboard? Dashboard { get; set; }
        public List<UserMedia> MediaItems { get; set; } = new();
        public List<Folder> Folders { get; set; } = new();
        public List<Folder> FolderPath { get; set; } = new();
        public long? CurrentFolderId { get; set; }

        [BindProperty]
        public IFormFile? UploadedFile { get; set; }

        [BindProperty]
        public string? Description { get; set; }

        [BindProperty]
        public long? MediaId { get; set; }

        public string? UploadMessage { get; set; }
        public bool UploadSuccess { get; set; }

        public async Task<IActionResult> OnGetAsync(long? folderId = null)
        {
            RequireAuthentication();
            LoadUserSession();

            CurrentFolderId = folderId;

            // Load user dashboard data
            Dashboard = await userService.GetUserDashboardAsync(UserId);

            // Load folders in current directory
            Folders = await _folderService.GetUserFoldersAsync(UserId, CurrentFolderId);

            // Load folder path (breadcrumbs)
            FolderPath = await _folderService.GetFolderPathAsync(CurrentFolderId, UserId);

            // Load initial set of media
            MediaItems = await _mediaService.GetUserMediaAsync(UserId, 0, 20, CurrentFolderId);

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
