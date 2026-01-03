-- Network Graphs Table
-- Stores user-created network graphs
CREATE TABLE IF NOT EXISTS app.graphs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE,
    -- Ensure graph names are unique per user
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_graphs_user_id ON app.graphs(user_id);
CREATE INDEX IF NOT EXISTS idx_graphs_name ON app.graphs(name);
