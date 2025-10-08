using Media.JoshHeaps.Net.Models;
using Media.JoshHeaps.Net.Services;
using Microsoft.AspNetCore.Mvc;

namespace Media.JoshHeaps.Net.Pages
{
    public class IndexModel(UserService userService, MediaService mediaService) : AuthenticatedPageModel
    {
        private readonly MediaService _mediaService = mediaService;

        public UserDashboard? Dashboard { get; set; }
        public List<UserMedia> MediaItems { get; set; } = new();

        [BindProperty]
        public IFormFile? UploadedFile { get; set; }

        [BindProperty]
        public string? Description { get; set; }

        public string? UploadMessage { get; set; }
        public bool UploadSuccess { get; set; }

        public async Task<IActionResult> OnGetAsync()
        {
            RequireAuthentication();
            LoadUserSession();

            // Load user dashboard data
            Dashboard = await userService.GetUserDashboardAsync(UserId);

            // Load initial set of media
            MediaItems = await _mediaService.GetUserMediaAsync(UserId, 0, 20);

            return Page();
        }

        public async Task<IActionResult> OnPostAsync()
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

            // Reload data
            Dashboard = await userService.GetUserDashboardAsync(UserId);
            MediaItems = await _mediaService.GetUserMediaAsync(UserId, 0, 20);

            return Page();
        }

        public async Task<IActionResult> OnPostDeleteAsync(long mediaId)
        {
            RequireAuthentication();
            LoadUserSession();

            var success = await _mediaService.DeleteMediaAsync(mediaId, UserId);

            return RedirectToPage();
        }

        private bool IsValidImageFile(IFormFile file)
        {
            var allowedTypes = new[] { "image/jpeg", "image/png", "image/gif", "image/webp" };
            return allowedTypes.Contains(file.ContentType.ToLower());
        }
    }
}
