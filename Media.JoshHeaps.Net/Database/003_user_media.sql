-- User Media/Images Table
-- Stores encrypted images outside wwwroot for security
CREATE TABLE IF NOT EXISTS app.user_media (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL, -- Path to encrypted file outside wwwroot
    file_size BIGINT NOT NULL, -- Original file size before encryption
    mime_type VARCHAR(100) NOT NULL,
    width INT NULL,
    height INT NULL,
    description TEXT NULL,
    is_encrypted BOOLEAN DEFAULT true, -- Flag indicating if file is encrypted on disk
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_media_user_id ON app.user_media(user_id);
CREATE INDEX IF NOT EXISTS idx_user_media_created_at ON app.user_media(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_media_mime_type ON app.user_media(mime_type);
