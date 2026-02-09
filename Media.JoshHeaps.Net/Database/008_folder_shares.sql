-- Folder Shares Table
-- Stores folder sharing permissions between users
CREATE TABLE IF NOT EXISTS app.folder_shares (
    id BIGSERIAL PRIMARY KEY,
    folder_id BIGINT NOT NULL,
    owner_user_id BIGINT NOT NULL,
    shared_with_user_id BIGINT NOT NULL,
    permission_level VARCHAR(50) DEFAULT 'read_only', -- Future: could be 'read_write'
    include_subfolders BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES app.folders(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id) REFERENCES app.users(id) ON DELETE CASCADE,
    FOREIGN KEY (shared_with_user_id) REFERENCES app.users(id) ON DELETE CASCADE,
    -- Ensure a folder can only be shared once with each user
    UNIQUE (folder_id, shared_with_user_id),
    -- Prevent self-sharing
    CHECK (owner_user_id != shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_shares_folder_id ON app.folder_shares(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_shares_shared_with_user_id ON app.folder_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_folder_shares_owner_user_id ON app.folder_shares(owner_user_id);
