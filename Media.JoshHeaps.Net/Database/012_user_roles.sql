-- Roles table for role-based access control
CREATE TABLE IF NOT EXISTS app.roles (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed the admin role
INSERT INTO app.roles (name) VALUES ('admin') ON CONFLICT (name) DO NOTHING;

-- User roles junction table
CREATE TABLE IF NOT EXISTS app.user_roles (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES app.users(id),
    role_id BIGINT NOT NULL REFERENCES app.roles(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_role UNIQUE (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON app.user_roles(user_id);
