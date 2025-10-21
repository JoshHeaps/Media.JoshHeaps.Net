-- User Folders Table
-- Stores folder hierarchy for organizing media
CREATE TABLE IF NOT EXISTS app.folders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_folder_id BIGINT NULL, -- NULL means root level folder
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_folder_id) REFERENCES app.folders(id) ON DELETE CASCADE,
    -- Ensure folder names are unique within the same parent folder for a user
    UNIQUE (user_id, parent_folder_id, name)
);

CREATE INDEX IF NOT EXISTS idx_folders_user_id ON app.folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_folder_id ON app.folders(parent_folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON app.folders(user_id, parent_folder_id);
