-- Add folder support to user_media table
-- This is backwards compatible - existing media will have NULL folder_id (root level)
ALTER TABLE app.user_media
ADD COLUMN IF NOT EXISTS folder_id BIGINT NULL;

-- Add foreign key constraint
ALTER TABLE app.user_media
ADD CONSTRAINT fk_user_media_folder
FOREIGN KEY (folder_id) REFERENCES app.folders(id) ON DELETE SET NULL;

-- Create index for efficient folder-based queries
CREATE INDEX IF NOT EXISTS idx_user_media_folder_id ON app.user_media(folder_id);

-- Create compound index for user + folder queries
CREATE INDEX IF NOT EXISTS idx_user_media_user_folder ON app.user_media(user_id, folder_id);
