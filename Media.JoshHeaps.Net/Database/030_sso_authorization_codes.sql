-- SSO authorization codes for the OAuth2 authorization-code flow.
-- The raw code is never stored; we persist the SHA-256 hash only.
-- Codes are single-use and short-lived (see Sso:CodeLifetimeSeconds in config).

CREATE TABLE IF NOT EXISTS app.sso_authorization_codes (
    code_hash       TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    user_id         BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    redirect_uri    TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_codes_expires ON app.sso_authorization_codes(expires_at);
