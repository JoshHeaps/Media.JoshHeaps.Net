CREATE TABLE IF NOT EXISTS app.user_theme_overrides (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    base_theme TEXT NOT NULL DEFAULT 'light',
    color_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_uto_user_id ON app.user_theme_overrides(user_id);
