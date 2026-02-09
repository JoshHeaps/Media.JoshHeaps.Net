-- Email Verification Tokens Table
CREATE TABLE IF NOT EXISTS app.email_verification_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token ON app.email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_user_id ON app.email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_expires_at ON app.email_verification_tokens(expires_at);
