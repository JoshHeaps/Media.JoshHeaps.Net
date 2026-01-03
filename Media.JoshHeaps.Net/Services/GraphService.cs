using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public class GraphService(DbExecutor db, ILogger<GraphService> logger)
{

    #region Graph Operations

    public async Task<List<GraphWithCounts>> GetUserGraphsAsync(long userId)
    {
        try
        {
            var query = @"
                SELECT
                    g.id, g.user_id, g.name, g.description, g.created_at, g.updated_at,
                    COUNT(DISTINCT n.id) as node_count,
                    COUNT(DISTINCT e.id) as edge_count
                FROM app.graphs g
                LEFT JOIN app.graph_nodes n ON g.id = n.graph_id
                LEFT JOIN app.graph_edges e ON g.id = e.graph_id
                WHERE g.user_id = @userId
                GROUP BY g.id, g.user_id, g.name, g.description, g.created_at, g.updated_at
                ORDER BY g.updated_at DESC";

            return await db.ExecuteListReaderAsync(query, reader =>
            {
                return new GraphWithCounts
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    Name = reader.GetString(2),
                    Description = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    NodeCount = reader.GetInt32(6),
                    EdgeCount = reader.GetInt32(7)
                };
            }, new { userId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get graphs for user {UserId}", userId);
            return [];
        }
    }

    public async Task<Graph?> GetGraphByIdAsync(long graphId, long userId)
    {
        try
        {
            var query = @"
                SELECT id, user_id, name, description, created_at, updated_at
                FROM app.graphs
                WHERE id = @graphId AND user_id = @userId";

            return await db.ExecuteReaderAsync(query, reader =>
            {
                return new Graph
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    Name = reader.GetString(2),
                    Description = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            }, new { graphId, userId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get graph {GraphId} for user {UserId}", graphId, userId);
            return null;
        }
    }

    public async Task<Graph?> CreateGraphAsync(long userId, string name, string? description = null)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                logger.LogWarning("Cannot create graph with empty name for user {UserId}", userId);
                return null;
            }

            var query = @"
                INSERT INTO app.graphs (user_id, name, description, created_at, updated_at)
                VALUES (@userId, @name, @description, @createdAt, @updatedAt)
                RETURNING id, user_id, name, description, created_at, updated_at";

            return await db.ExecuteReaderAsync(query, reader =>
            {
                return new Graph
                {
                    Id = reader.GetInt64(0),
                    UserId = reader.GetInt64(1),
                    Name = reader.GetString(2),
                    Description = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            }, new
            {
                userId,
                name = name.Trim(),
                description,
                createdAt = DateTime.UtcNow,
                updatedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create graph '{Name}' for user {UserId}", name, userId);
            return null;
        }
    }

    public async Task<bool> UpdateGraphAsync(long graphId, long userId, string name, string? description)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                logger.LogWarning("Cannot update graph with empty name");
                return false;
            }

            var query = @"
                UPDATE app.graphs
                SET name = @name, description = @description, updated_at = @updatedAt
                WHERE id = @graphId AND user_id = @userId";

            var rowsAffected = await db.ExecuteNonQueryAsync(query, new
            {
                graphId,
                userId,
                name = name.Trim(),
                description,
                updatedAt = DateTime.UtcNow
            });

            return rowsAffected > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update graph {GraphId}", graphId);
            return false;
        }
    }

    public async Task<bool> DeleteGraphAsync(long graphId, long userId)
    {
        try
        {
            var query = "DELETE FROM app.graphs WHERE id = @graphId AND user_id = @userId";
            var rowsAffected = await db.ExecuteNonQueryAsync(query, new { graphId, userId });
            return rowsAffected > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete graph {GraphId}", graphId);
            return false;
        }
    }

    public async Task<Graph?> CloneGraphAsync(long graphId, long userId, string newName)
    {
        try
        {
            // Get original graph
            var originalGraph = await GetGraphByIdAsync(graphId, userId);
            if (originalGraph == null) return null;

            // Create new graph
            var newGraph = await CreateGraphAsync(userId, newName, originalGraph.Description);
            if (newGraph == null) return null;

            // Get all nodes from original graph
            var nodes = await GetGraphNodesAsync(graphId, userId);
            var nodeMapping = new Dictionary<long, long>(); // old ID -> new ID

            // Clone nodes
            foreach (var node in nodes)
            {
                var newNode = await CreateNodeAsync(newGraph.Id, userId, node.Label, node.Notes);
                if (newNode != null)
                {
                    nodeMapping[node.Id] = newNode.Id;
                }
            }

            // Get all edges from original graph
            var edges = await GetGraphEdgesAsync(graphId, userId);

            // Clone edges with new node IDs
            foreach (var edge in edges)
            {
                if (nodeMapping.ContainsKey(edge.SourceNodeId) && nodeMapping.ContainsKey(edge.TargetNodeId))
                {
                    await CreateEdgeAsync(newGraph.Id, userId, nodeMapping[edge.SourceNodeId], nodeMapping[edge.TargetNodeId]);
                }
            }

            return newGraph;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to clone graph {GraphId}", graphId);
            return null;
        }
    }

    #endregion

    #region Node Operations

    public async Task<List<GraphNodeWithConnections>> GetGraphNodesAsync(long graphId, long userId)
    {
        try
        {
            // Verify user owns the graph
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return [];

            var query = @"
                SELECT
                    n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at,
                    COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) as connection_count
                FROM app.graph_nodes n
                LEFT JOIN app.graph_edges e1 ON n.id = e1.source_node_id
                LEFT JOIN app.graph_edges e2 ON n.id = e2.target_node_id
                WHERE n.graph_id = @graphId
                GROUP BY n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at
                ORDER BY n.label";

            return await db.ExecuteListReaderAsync(query, reader =>
            {
                return new GraphNodeWithConnections
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    Label = reader.GetString(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    ConnectionCount = reader.GetInt32(6)
                };
            }, new { graphId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get nodes for graph {GraphId}", graphId);
            return [];
        }
    }

    public async Task<GraphNode?> CreateNodeAsync(long graphId, long userId, string label, string? notes = null)
    {
        try
        {
            // Verify user owns the graph
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return null;

            if (string.IsNullOrWhiteSpace(label))
            {
                logger.LogWarning("Cannot create node with empty label");
                return null;
            }

            var query = @"
                INSERT INTO app.graph_nodes (graph_id, label, notes, created_at, updated_at)
                VALUES (@graphId, @label, @notes, @createdAt, @updatedAt)
                RETURNING id, graph_id, label, notes, created_at, updated_at";

            var node = await db.ExecuteReaderAsync(query, reader =>
            {
                return new GraphNode
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    Label = reader.GetString(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            }, new
            {
                graphId,
                label = label.Trim(),
                notes,
                createdAt = DateTime.UtcNow,
                updatedAt = DateTime.UtcNow
            });

            // Update graph's updated_at
            await TouchGraphAsync(graphId);

            return node;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create node in graph {GraphId}", graphId);
            return null;
        }
    }

    public async Task<bool> UpdateNodeAsync(long nodeId, long userId, string label, string? notes)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(label))
            {
                logger.LogWarning("Cannot update node with empty label");
                return false;
            }

            // Get node to verify ownership through graph
            var node = await GetNodeByIdAsync(nodeId);
            if (node == null) return false;

            var graph = await GetGraphByIdAsync(node.GraphId, userId);
            if (graph == null) return false;

            var query = @"
                UPDATE app.graph_nodes
                SET label = @label, notes = @notes, updated_at = @updatedAt
                WHERE id = @nodeId";

            var rowsAffected = await db.ExecuteNonQueryAsync(query, new
            {
                nodeId,
                label = label.Trim(),
                notes,
                updatedAt = DateTime.UtcNow
            });

            if (rowsAffected > 0)
            {
                await TouchGraphAsync(node.GraphId);
            }

            return rowsAffected > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update node {NodeId}", nodeId);
            return false;
        }
    }

    public async Task<bool> DeleteNodeAsync(long nodeId, long userId)
    {
        try
        {
            // Get node to verify ownership and get graph ID
            var node = await GetNodeByIdAsync(nodeId);
            if (node == null) return false;

            var graph = await GetGraphByIdAsync(node.GraphId, userId);
            if (graph == null) return false;

            var query = "DELETE FROM app.graph_nodes WHERE id = @nodeId";
            var rowsAffected = await db.ExecuteNonQueryAsync(query, new { nodeId });

            if (rowsAffected > 0)
            {
                await TouchGraphAsync(node.GraphId);
            }

            return rowsAffected > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete node {NodeId}", nodeId);
            return false;
        }
    }

    public async Task<List<GraphNodeWithConnections>> SearchNodesAsync(long graphId, long userId, string searchTerm)
    {
        try
        {
            // Verify user owns the graph
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return [];

            var query = @"
                SELECT
                    n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at,
                    COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) as connection_count
                FROM app.graph_nodes n
                LEFT JOIN app.graph_edges e1 ON n.id = e1.source_node_id
                LEFT JOIN app.graph_edges e2 ON n.id = e2.target_node_id
                WHERE n.graph_id = @graphId
                    AND (LOWER(n.label) LIKE @searchPattern OR LOWER(n.notes) LIKE @searchPattern)
                GROUP BY n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at
                ORDER BY n.label";

            var searchPattern = $"%{searchTerm.ToLower()}%";

            return await db.ExecuteListReaderAsync(query, reader =>
            {
                return new GraphNodeWithConnections
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    Label = reader.GetString(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    ConnectionCount = reader.GetInt32(6)
                };
            }, new { graphId, searchPattern });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to search nodes in graph {GraphId}", graphId);
            return [];
        }
    }

    private async Task<GraphNode?> GetNodeByIdAsync(long nodeId)
    {
        try
        {
            var query = @"
                SELECT id, graph_id, label, notes, created_at, updated_at
                FROM app.graph_nodes
                WHERE id = @nodeId";

            return await db.ExecuteReaderAsync(query, reader =>
            {
                return new GraphNode
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    Label = reader.GetString(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                };
            }, new { nodeId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get node {NodeId}", nodeId);
            return null;
        }
    }

    #endregion

    #region Edge Operations

    public async Task<List<GraphEdge>> GetGraphEdgesAsync(long graphId, long userId)
    {
        try
        {
            // Verify user owns the graph
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return [];

            var query = @"
                SELECT id, graph_id, source_node_id, target_node_id, created_at
                FROM app.graph_edges
                WHERE graph_id = @graphId
                ORDER BY created_at";

            return await db.ExecuteListReaderAsync(query, reader =>
            {
                return new GraphEdge
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    SourceNodeId = reader.GetInt64(2),
                    TargetNodeId = reader.GetInt64(3),
                    CreatedAt = reader.GetDateTime(4)
                };
            }, new { graphId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get edges for graph {GraphId}", graphId);
            return [];
        }
    }

    public async Task<GraphEdge?> CreateEdgeAsync(long graphId, long userId, long sourceNodeId, long targetNodeId)
    {
        try
        {
            // Verify user owns the graph
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return null;

            // Verify both nodes belong to this graph
            var sourceNode = await GetNodeByIdAsync(sourceNodeId);
            var targetNode = await GetNodeByIdAsync(targetNodeId);

            if (sourceNode == null || targetNode == null ||
                sourceNode.GraphId != graphId || targetNode.GraphId != graphId)
            {
                logger.LogWarning("Invalid nodes for edge creation");
                return null;
            }

            var query = @"
                INSERT INTO app.graph_edges (graph_id, source_node_id, target_node_id, created_at)
                VALUES (@graphId, @sourceNodeId, @targetNodeId, @createdAt)
                RETURNING id, graph_id, source_node_id, target_node_id, created_at";

            var edge = await db.ExecuteReaderAsync(query, reader =>
            {
                return new GraphEdge
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    SourceNodeId = reader.GetInt64(2),
                    TargetNodeId = reader.GetInt64(3),
                    CreatedAt = reader.GetDateTime(4)
                };
            }, new
            {
                graphId,
                sourceNodeId,
                targetNodeId,
                createdAt = DateTime.UtcNow
            });

            await TouchGraphAsync(graphId);

            return edge;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create edge in graph {GraphId}", graphId);
            return null;
        }
    }

    public async Task<bool> DeleteEdgeAsync(long edgeId, long userId)
    {
        try
        {
            // Get edge to verify ownership through graph
            var edge = await GetEdgeByIdAsync(edgeId);
            if (edge == null) return false;

            var graph = await GetGraphByIdAsync(edge.GraphId, userId);
            if (graph == null) return false;

            var query = "DELETE FROM app.graph_edges WHERE id = @edgeId";
            var rowsAffected = await db.ExecuteNonQueryAsync(query, new { edgeId });

            if (rowsAffected > 0)
            {
                await TouchGraphAsync(edge.GraphId);
            }

            return rowsAffected > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete edge {EdgeId}", edgeId);
            return false;
        }
    }

    private async Task<GraphEdge?> GetEdgeByIdAsync(long edgeId)
    {
        try
        {
            var query = @"
                SELECT id, graph_id, source_node_id, target_node_id, created_at
                FROM app.graph_edges
                WHERE id = @edgeId";

            return await db.ExecuteReaderAsync(query, reader =>
            {
                return new GraphEdge
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    SourceNodeId = reader.GetInt64(2),
                    TargetNodeId = reader.GetInt64(3),
                    CreatedAt = reader.GetDateTime(4)
                };
            }, new { edgeId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get edge {EdgeId}", edgeId);
            return null;
        }
    }

    #endregion

    #region Filter Operations

    public async Task<List<GraphNodeWithConnections>> FilterConnectsToAsync(long graphId, long userId, long targetNodeId)
    {
        try
        {
            // Verify user owns the graph
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return [];

            var query = @"
                SELECT
                    n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at,
                    COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) as connection_count
                FROM app.graph_nodes n
                LEFT JOIN app.graph_edges e1 ON n.id = e1.source_node_id
                LEFT JOIN app.graph_edges e2 ON n.id = e2.target_node_id
                WHERE n.graph_id = @graphId
                    AND EXISTS (
                        SELECT 1 FROM app.graph_edges e
                        WHERE e.graph_id = @graphId
                            AND (
                                (e.source_node_id = n.id AND e.target_node_id = @targetNodeId)
                                OR (e.target_node_id = n.id AND e.source_node_id = @targetNodeId)
                            )
                    )
                GROUP BY n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at
                ORDER BY n.label";

            return await db.ExecuteListReaderAsync(query, reader =>
            {
                return new GraphNodeWithConnections
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    Label = reader.GetString(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    ConnectionCount = reader.GetInt32(6)
                };
            }, new { graphId, targetNodeId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to filter nodes connecting to {NodeId}", targetNodeId);
            return [];
        }
    }

    public async Task<List<GraphNodeWithConnections>> FilterDoesNotConnectToAsync(long graphId, long userId, long targetNodeId)
    {
        try
        {
            // Verify user owns the graph
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return [];

            var query = @"
                SELECT
                    n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at,
                    COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) as connection_count
                FROM app.graph_nodes n
                LEFT JOIN app.graph_edges e1 ON n.id = e1.source_node_id
                LEFT JOIN app.graph_edges e2 ON n.id = e2.target_node_id
                WHERE n.graph_id = @graphId
                    AND n.id != @targetNodeId
                    AND NOT EXISTS (
                        SELECT 1 FROM app.graph_edges e
                        WHERE e.graph_id = @graphId
                            AND (
                                (e.source_node_id = n.id AND e.target_node_id = @targetNodeId)
                                OR (e.target_node_id = n.id AND e.source_node_id = @targetNodeId)
                            )
                    )
                GROUP BY n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at
                ORDER BY n.label";

            return await db.ExecuteListReaderAsync(query, reader =>
            {
                return new GraphNodeWithConnections
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    Label = reader.GetString(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    ConnectionCount = reader.GetInt32(6)
                };
            }, new { graphId, targetNodeId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to filter nodes not connecting to {NodeId}", targetNodeId);
            return [];
        }
    }

    public async Task<List<GraphNodeWithConnections>> FilterConnectsTwoDegreesAsync(long graphId, long userId, long targetNodeId)
    {
        try
        {
            // Verify user owns the graph
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return [];

            // Find nodes that connect to nodes that connect to the target (bidirectional)
            var query = @"
                SELECT DISTINCT
                    n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at,
                    COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) as connection_count
                FROM app.graph_nodes n
                LEFT JOIN app.graph_edges e1 ON n.id = e1.source_node_id
                LEFT JOIN app.graph_edges e2 ON n.id = e2.target_node_id
                WHERE n.graph_id = @graphId
                    AND n.id != @targetNodeId
                    AND EXISTS (
                        SELECT 1 FROM app.graph_edges e_first, app.graph_edges e_second
                        WHERE e_first.graph_id = @graphId
                            AND e_second.graph_id = @graphId
                            -- n connects to intermediate node (bidirectional)
                            AND (
                                (e_first.source_node_id = n.id AND e_second.source_node_id = e_first.target_node_id)
                                OR (e_first.source_node_id = n.id AND e_second.target_node_id = e_first.target_node_id)
                                OR (e_first.target_node_id = n.id AND e_second.source_node_id = e_first.source_node_id)
                                OR (e_first.target_node_id = n.id AND e_second.target_node_id = e_first.source_node_id)
                            )
                            -- intermediate node connects to target (bidirectional)
                            AND (
                                e_second.source_node_id = @targetNodeId
                                OR e_second.target_node_id = @targetNodeId
                            )
                            -- Exclude direct connections
                            AND NOT EXISTS (
                                SELECT 1 FROM app.graph_edges e_direct
                                WHERE e_direct.graph_id = @graphId
                                    AND (
                                        (e_direct.source_node_id = n.id AND e_direct.target_node_id = @targetNodeId)
                                        OR (e_direct.target_node_id = n.id AND e_direct.source_node_id = @targetNodeId)
                                    )
                            )
                    )
                GROUP BY n.id, n.graph_id, n.label, n.notes, n.created_at, n.updated_at
                ORDER BY n.label";

            return await db.ExecuteListReaderAsync(query, reader =>
            {
                return new GraphNodeWithConnections
                {
                    Id = reader.GetInt64(0),
                    GraphId = reader.GetInt64(1),
                    Label = reader.GetString(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    ConnectionCount = reader.GetInt32(6)
                };
            }, new { graphId, targetNodeId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to filter nodes with two-degree connections to {NodeId}", targetNodeId);
            return [];
        }
    }

    #endregion

    #region Helper Methods

    private async Task TouchGraphAsync(long graphId)
    {
        try
        {
            var query = "UPDATE app.graphs SET updated_at = @updatedAt WHERE id = @graphId";
            await db.ExecuteNonQueryAsync(query, new { graphId, updatedAt = DateTime.UtcNow });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to touch graph {GraphId}", graphId);
        }
    }

    public async Task<GraphData> GetGraphDataAsync(long graphId, long userId)
    {
        try
        {
            var graph = await GetGraphByIdAsync(graphId, userId);
            if (graph == null) return new GraphData();

            var nodes = await GetGraphNodesAsync(graphId, userId);
            var edges = await GetGraphEdgesAsync(graphId, userId);

            return new GraphData
            {
                Graph = graph,
                Nodes = nodes,
                Edges = edges
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get graph data for {GraphId}", graphId);
            return new GraphData();
        }
    }

    #endregion
}
