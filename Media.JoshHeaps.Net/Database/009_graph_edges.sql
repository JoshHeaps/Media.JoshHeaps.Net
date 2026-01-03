-- Graph Edges Table
-- Stores connections/relationships between nodes in a graph
CREATE TABLE IF NOT EXISTS app.graph_edges (
    id BIGSERIAL PRIMARY KEY,
    graph_id BIGINT NOT NULL,
    source_node_id BIGINT NOT NULL,
    target_node_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (graph_id) REFERENCES app.graphs(id) ON DELETE CASCADE,
    FOREIGN KEY (source_node_id) REFERENCES app.graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_node_id) REFERENCES app.graph_nodes(id) ON DELETE CASCADE,
    -- Prevent duplicate edges between the same nodes
    UNIQUE (graph_id, source_node_id, target_node_id),
    -- Prevent self-loops (node connecting to itself)
    CHECK (source_node_id != target_node_id)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_graph_id ON app.graph_edges(graph_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source_node_id ON app.graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target_node_id ON app.graph_edges(target_node_id);
-- Composite index for efficient bidirectional queries
CREATE INDEX IF NOT EXISTS idx_graph_edges_nodes ON app.graph_edges(source_node_id, target_node_id);
