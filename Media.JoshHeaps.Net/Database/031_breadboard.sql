-- Breadboard circuit simulator.
-- A project owns one circuit document (schema v1) stored as JSONB: boards,
-- components and wires laid out on full-size 830-point breadboards.
-- Memory images hold the contents of memory components keyed by the component's
-- uid within the circuit document; no endpoints use them yet.

CREATE TABLE IF NOT EXISTS app.breadboard_projects (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES app.users(id),
    name            TEXT NOT NULL,
    description     TEXT,
    circuit         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_breadboard_projects_user_id ON app.breadboard_projects(user_id);

CREATE TABLE IF NOT EXISTS app.breadboard_memory_images (
    id              BIGSERIAL PRIMARY KEY,
    project_id      BIGINT NOT NULL REFERENCES app.breadboard_projects(id) ON DELETE CASCADE,
    component_uid   TEXT NOT NULL,
    data            BYTEA NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_breadboard_memory_images UNIQUE (project_id, component_uid)
);
