CREATE TABLE app.password_reset_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON app.password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user_id ON app.password_reset_tokens(user_id);
