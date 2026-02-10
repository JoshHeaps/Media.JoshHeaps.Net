-- Graph Nodes Table
-- Stores nodes within network graphs
-- Node positions are calculated automatically by the client using community detection
CREATE TABLE IF NOT EXISTS app.graph_nodes (
    id BIGSERIAL PRIMARY KEY,
    graph_id BIGINT NOT NULL,
    label VARCHAR(255) NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (graph_id) REFERENCES app.graphs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_graph_id ON app.graph_nodes(graph_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_label ON app.graph_nodes(label);
