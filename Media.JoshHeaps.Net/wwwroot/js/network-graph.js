// Network Graph Visualization and Management with Community Detection

// State
let currentGraphId = selectedGraphId;
let graphData = { nodes: [], edges: [] };
let selectedNodes = new Set();
let editingNodeId = null;
let editingGraphId = null;
let contextMenuNodeId = null;

// Canvas and rendering
let canvas, ctx;
let scale = 1;
let offsetX = 0, offsetY = 0;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let dragNodeId = null;

// Physics simulation with community detection
let nodes = [];
let edges = [];
let communities = [];
const REPULSION = 10000;
const ATTRACTION = 0.0004;
const COMMUNITY_ATTRACTION = 0.0012;
const DAMPING = 0.85;
const NODE_RADIUS_BASE = 15;
const MIN_NODE_RADIUS = 12;
const MAX_SIMULATION_ITERATIONS = 500;
const MAX_VELOCITY = 10; // Cap maximum velocity to prevent explosive movements
const MIN_DISTANCE = 8; // Minimum distance between node centers
const MIN_VELOCITY = 0.01; // Threshold below which to stop the node completely
let simulationIterations = 0;
let simulationRunning = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeCanvas();
    initializeEventListeners();

    if (currentGraphId) {
        loadGraphData(currentGraphId);
        showWorkspace();
    }
});

// Canvas Setup
function initializeCanvas() {
    canvas = document.getElementById('graph-canvas');
    if (!canvas) return;

    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    if (!canvas) return;
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    render();
}

// Event Listeners
function initializeEventListeners() {
    // Graph management
    document.getElementById('new-graph-btn')?.addEventListener('click', showNewGraphModal);
    document.getElementById('graph-form')?.addEventListener('submit', handleGraphSubmit);

    // Node management
    document.getElementById('add-node-btn')?.addEventListener('click', showNewNodeModal);
    document.getElementById('link-nodes-btn')?.addEventListener('click', linkSelectedNodes);
    document.getElementById('node-form')?.addEventListener('submit', handleNodeSubmit);

    // Search and filter
    document.getElementById('search-nodes')?.addEventListener('input', handleSearch);
    document.getElementById('apply-filter-btn')?.addEventListener('click', applyDegreeFilter);
    document.getElementById('clear-filter-btn')?.addEventListener('click', clearFilter);

    // Canvas controls
    document.getElementById('zoom-in-btn')?.addEventListener('click', () => zoomCanvas(1.2));
    document.getElementById('zoom-out-btn')?.addEventListener('click', () => zoomCanvas(0.8));
    document.getElementById('reset-view-btn')?.addEventListener('click', resetView);

    // Canvas interactions
    if (canvas) {
        canvas.addEventListener('mousedown', handleCanvasMouseDown);
        canvas.addEventListener('mousemove', handleCanvasMouseMove);
        canvas.addEventListener('mouseup', handleCanvasMouseUp);
        canvas.addEventListener('wheel', handleCanvasWheel);
        canvas.addEventListener('dblclick', handleCanvasDoubleClick);
        canvas.addEventListener('contextmenu', handleCanvasContextMenu);
    }

    // Close context menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) {
            hideContextMenu();
        }
    });

    // Context menu item clicks
    document.addEventListener('click', (e) => {
        const menuItem = e.target.closest('.context-menu-item');
        if (menuItem && menuItem.dataset.action) {
            e.preventDefault();
            e.stopPropagation();

            const action = menuItem.dataset.action;
            switch (action) {
                case 'edit':
                    handleContextEdit();
                    break;
                case 'link':
                    handleContextLinkTo();
                    break;
                case 'select':
                    handleContextSelect();
                    break;
                case 'delete':
                    handleContextDelete();
                    break;
            }
        }
    });
}

// Graph Management
function selectGraph(graphId) {
    currentGraphId = graphId;
    window.location.href = `/NetworkGraph?graphId=${graphId}`;
}

async function loadGraphData(graphId) {
    try {
        const response = await fetch(`/api/graph/${graphId}/data`);
        if (!response.ok) throw new Error('Failed to load graph');

        graphData = await response.json();
        initializePhysics();
        showWorkspace();
        startSimulation();
    } catch (error) {
        console.error('Error loading graph:', error);
        alert('Failed to load graph data');
    }
}

function showWorkspace() {
    const workspace = document.getElementById('graph-workspace');
    if (workspace) {
        workspace.style.display = 'flex';

        requestAnimationFrame(() => {
            resizeCanvas();
            centerGraph();
            render();
        });
    }
}

function showNewGraphModal() {
    editingGraphId = null;
    document.getElementById('graph-modal-title').textContent = 'New Graph';
    document.getElementById('graph-name').value = '';
    document.getElementById('graph-description').value = '';
    document.getElementById('save-graph-btn').textContent = 'Create Graph';
    document.getElementById('graph-modal').style.display = 'flex';
}

function editGraph(id, name, description) {
    editingGraphId = id;
    document.getElementById('graph-modal-title').textContent = 'Edit Graph';
    document.getElementById('graph-name').value = name;
    document.getElementById('graph-description').value = description;
    document.getElementById('save-graph-btn').textContent = 'Save Changes';
    document.getElementById('graph-modal').style.display = 'flex';
}

async function handleGraphSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('graph-name').value.trim();
    const description = document.getElementById('graph-description').value.trim();

    if (!name) return;

    try {
        let response;
        if (editingGraphId) {
            response = await fetch(`/api/graph/${editingGraphId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
        } else {
            response = await fetch('/api/graph/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
        }

        if (!response.ok) throw new Error('Failed to save graph');

        closeGraphModal();
        window.location.reload();
    } catch (error) {
        console.error('Error saving graph:', error);
        alert('Failed to save graph');
    }
}

async function deleteGraph(id, name) {
    if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) return;

    try {
        const response = await fetch(`/api/graph/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete graph');

        window.location.href = '/NetworkGraph';
    } catch (error) {
        console.error('Error deleting graph:', error);
        alert('Failed to delete graph');
    }
}

async function cloneGraph(id, name) {
    const newName = prompt(`Enter name for cloned graph:`, `${name} (Copy)`);
    if (!newName) return;

    try {
        const response = await fetch(`/api/graph/${id}/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName })
        });

        if (!response.ok) throw new Error('Failed to clone graph');

        const newGraph = await response.json();
        window.location.href = `/NetworkGraph?graphId=${newGraph.id}`;
    } catch (error) {
        console.error('Error cloning graph:', error);
        alert('Failed to clone graph');
    }
}

function closeGraphModal() {
    document.getElementById('graph-modal').style.display = 'none';
}

// Node Management
function showNewNodeModal() {
    if (!currentGraphId) return;

    editingNodeId = null;
    document.getElementById('node-modal-title').textContent = 'New Node';
    document.getElementById('node-label').value = '';
    document.getElementById('node-notes').value = '';
    document.getElementById('save-node-btn').textContent = 'Create Node';

    // Hide connections section for new nodes
    document.getElementById('node-connections-section').style.display = 'none';

    document.getElementById('node-modal').style.display = 'flex';
}

async function editNode(node) {
    editingNodeId = node.id;
    document.getElementById('node-modal-title').textContent = 'Edit Node';
    document.getElementById('node-label').value = node.label;
    document.getElementById('node-notes').value = node.notes || '';
    document.getElementById('save-node-btn').textContent = 'Save Changes';

    // Show connections section when editing
    document.getElementById('node-connections-section').style.display = 'block';

    // Load connections for this node
    await loadNodeConnections(node.id);

    document.getElementById('node-modal').style.display = 'flex';
}

async function handleNodeSubmit(e) {
    e.preventDefault();

    const label = document.getElementById('node-label').value.trim();
    const notes = document.getElementById('node-notes').value.trim();

    if (!label) return;

    try {
        let response;
        if (editingNodeId) {
            response = await fetch(`/api/graph/nodes/${editingNodeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, notes })
            });
        } else {
            response = await fetch(`/api/graph/${currentGraphId}/nodes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, notes })
            });
        }

        if (!response.ok) throw new Error('Failed to save node');

        closeNodeModal();
        await loadGraphData(currentGraphId);
    } catch (error) {
        console.error('Error saving node:', error);
        alert('Failed to save node');
    }
}

async function deleteNode(nodeId) {
    if (!confirm('Delete this node and all its connections?')) return;

    try {
        const response = await fetch(`/api/graph/nodes/${nodeId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete node');

        await loadGraphData(currentGraphId);
    } catch (error) {
        console.error('Error deleting node:', error);
        alert('Failed to delete node');
    }
}

function closeNodeModal() {
    document.getElementById('node-modal').style.display = 'none';
    // Clear connection search
    document.getElementById('connection-search').value = '';
    document.getElementById('connection-search-results').style.display = 'none';
}

// Node Connection Management (in modal)
let nodeConnections = [];
let connectionSearchTimeout = null;

async function loadNodeConnections(nodeId) {
    if (!currentGraphId || !nodeId) return;

    try {
        // Get all edges for this graph
        const edgesResponse = await fetch(`/api/graph/${currentGraphId}/edges`);
        if (!edgesResponse.ok) throw new Error('Failed to load edges');
        const allEdges = await edgesResponse.json();

        // Get all nodes for the graph
        const nodesResponse = await fetch(`/api/graph/${currentGraphId}/nodes`);
        if (!nodesResponse.ok) throw new Error('Failed to load nodes');
        const allNodes = await nodesResponse.json();

        // Find connections where this node is the source or target (bidirectional)
        nodeConnections = [];
        allEdges.forEach(edge => {
            if (edge.sourceNodeId === nodeId) {
                const targetNode = allNodes.find(n => n.id === edge.targetNodeId);
                if (targetNode) {
                    nodeConnections.push({
                        edgeId: edge.id,
                        nodeId: targetNode.id,
                        label: targetNode.label
                    });
                }
            } else if (edge.targetNodeId === nodeId) {
                const sourceNode = allNodes.find(n => n.id === edge.sourceNodeId);
                if (sourceNode) {
                    nodeConnections.push({
                        edgeId: edge.id,
                        nodeId: sourceNode.id,
                        label: sourceNode.label
                    });
                }
            }
        });

        renderNodeConnections();
    } catch (error) {
        console.error('Error loading connections:', error);
    }
}

function renderNodeConnections() {
    const listEl = document.getElementById('node-connections-list');
    if (!listEl) return;

    if (nodeConnections.length === 0) {
        listEl.innerHTML = '<div class="connections-empty">No connections yet</div>';
        return;
    }

    listEl.innerHTML = nodeConnections.map(conn => `
        <div class="connection-item">
            <div class="connection-info">
                <div class="connection-label">${escapeHtml(conn.label)}</div>
            </div>
            <button type="button" class="connection-remove" onclick="removeConnection(${conn.edgeId})" title="Remove connection">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `).join('');
}

async function removeConnection(edgeId) {
    if (!confirm('Remove this connection?')) return;

    try {
        const response = await fetch(`/api/graph/edges/${edgeId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to remove connection');

        // Reload connections
        await loadNodeConnections(editingNodeId);
    } catch (error) {
        console.error('Error removing connection:', error);
        alert('Failed to remove connection');
    }
}

// Connection search functionality
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('connection-search');
    if (searchInput) {
        searchInput.addEventListener('input', handleConnectionSearch);
        searchInput.addEventListener('blur', () => {
            // Delay hiding to allow click on result
            setTimeout(() => {
                document.getElementById('connection-search-results').style.display = 'none';
            }, 200);
        });
    }
});

async function handleConnectionSearch(e) {
    const query = e.target.value.trim();

    if (!query) {
        document.getElementById('connection-search-results').style.display = 'none';
        return;
    }

    // Debounce search
    clearTimeout(connectionSearchTimeout);
    connectionSearchTimeout = setTimeout(async () => {
        await performConnectionSearch(query);
    }, 300);
}

async function performConnectionSearch(query) {
    if (!currentGraphId || !editingNodeId) return;

    try {
        const response = await fetch(`/api/graph/${currentGraphId}/nodes/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Search failed');

        const results = await response.json();

        // Filter out the current node and already connected nodes
        const connectedNodeIds = nodeConnections.map(c => c.nodeId);
        const availableResults = results.filter(n =>
            n.id !== editingNodeId && !connectedNodeIds.includes(n.id)
        );

        renderConnectionSearchResults(availableResults);
    } catch (error) {
        console.error('Connection search error:', error);
    }
}

function renderConnectionSearchResults(results) {
    const resultsEl = document.getElementById('connection-search-results');
    if (!resultsEl) return;

    if (results.length === 0) {
        resultsEl.innerHTML = '<div class="search-result-item" style="text-align: center; color: var(--text-secondary);">No nodes found</div>';
        resultsEl.style.display = 'block';
        return;
    }

    resultsEl.innerHTML = results.map(node => `
        <div class="search-result-item" onclick="addConnection(${node.id}, '${escapeHtml(node.label)}')">
            <div class="search-result-label">${escapeHtml(node.label)}</div>
            ${node.notes ? `<div class="search-result-notes">${escapeHtml(node.notes)}</div>` : ''}
        </div>
    `).join('');

    resultsEl.style.display = 'block';
}

async function addConnection(targetNodeId, targetLabel) {
    if (!currentGraphId || !editingNodeId) return;

    try {
        const response = await fetch(`/api/graph/${currentGraphId}/edges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceNodeId: editingNodeId,
                targetNodeId: targetNodeId
            })
        });

        if (!response.ok) throw new Error('Failed to create connection');

        // Clear search and reload connections
        document.getElementById('connection-search').value = '';
        document.getElementById('connection-search-results').style.display = 'none';
        await loadNodeConnections(editingNodeId);
    } catch (error) {
        console.error('Error adding connection:', error);
        alert('Failed to add connection');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Edge Management
async function linkSelectedNodes() {
    if (selectedNodes.size < 2) {
        alert('Please select at least 2 nodes to link');
        return;
    }

    const nodeIds = Array.from(selectedNodes);
    const sourceId = nodeIds[0];

    try {
        for (let i = 1; i < nodeIds.length; i++) {
            await fetch(`/api/graph/${currentGraphId}/edges`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceNodeId: sourceId, targetNodeId: nodeIds[i] })
            });
        }

        selectedNodes.clear();
        await loadGraphData(currentGraphId);
    } catch (error) {
        console.error('Error creating edges:', error);
        alert('Failed to create connections');
    }
}

async function deleteEdge(edgeId) {
    try {
        const response = await fetch(`/api/graph/edges/${edgeId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete edge');

        await loadGraphData(currentGraphId);
    } catch (error) {
        console.error('Error deleting edge:', error);
    }
}

// Search and Filter
async function handleSearch(e) {
    const query = e.target.value.trim();

    // Show filter controls when there's a selected node
    const hasSelection = selectedNodes.size > 0;
    document.getElementById('degrees-input').style.display = hasSelection ? 'inline-block' : 'none';
    document.getElementById('filter-mode-select').style.display = hasSelection ? 'inline-block' : 'none';
    document.getElementById('apply-filter-btn').style.display = hasSelection ? 'inline-block' : 'none';
    document.getElementById('clear-filter-btn').style.display = hasSelection ? 'inline-block' : 'none';

    if (!query) {
        clearFilter();
        return;
    }

    try {
        const response = await fetch(`/api/graph/${currentGraphId}/nodes/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Search failed');

        const searchNodes = await response.json();
        highlightNodes(searchNodes.map(n => n.id));
    } catch (error) {
        console.error('Search error:', error);
    }
}

async function applyDegreeFilter() {
    if (selectedNodes.size === 0) {
        alert('Please select a node to filter by (Ctrl+Click on a node)');
        return;
    }

    const targetNodeId = Array.from(selectedNodes)[0];
    const degrees = parseInt(document.getElementById('degrees-input').value) || 1;
    const mode = document.getElementById('filter-mode-select').value;

    // Calculate degrees of separation using BFS
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const distances = new Map();
    const queue = [{ nodeId: targetNodeId, distance: 0 }];
    const visited = new Set([targetNodeId]);

    distances.set(targetNodeId, 0);

    while (queue.length > 0) {
        const { nodeId, distance } = queue.shift();

        // Find all edges connected to this node
        for (const edge of edges) {
            let neighborId = null;
            if (edge.source.id === nodeId) {
                neighborId = edge.target.id;
            } else if (edge.target.id === nodeId) {
                neighborId = edge.source.id;
            }

            if (neighborId && !visited.has(neighborId)) {
                visited.add(neighborId);
                distances.set(neighborId, distance + 1);
                queue.push({ nodeId: neighborId, distance: distance + 1 });
            }
        }
    }

    // Filter nodes based on mode
    const filteredNodeIds = [];
    for (const node of nodes) {
        if (node.id === targetNodeId) continue; // Exclude the target node itself

        const dist = distances.get(node.id);
        const hasConnection = dist !== undefined;

        switch (mode) {
            case 'exact':
                if (dist === degrees) {
                    filteredNodeIds.push(node.id);
                }
                break;
            case 'within':
                if (hasConnection && dist <= degrees) {
                    filteredNodeIds.push(node.id);
                }
                break;
            case 'outside':
                if (!hasConnection || dist > degrees) {
                    filteredNodeIds.push(node.id);
                }
                break;
        }
    }

    highlightNodes(filteredNodeIds);
}

function clearFilter() {
    // Clear highlights
    nodes.forEach(n => n.highlighted = false);
    render();
}

function highlightNodes(nodeIds) {
    nodes.forEach(n => n.highlighted = nodeIds.includes(n.id));
    render();
}

// Community Detection using Louvain-inspired algorithm
function detectCommunities() {
    if (nodes.length === 0) return [];

    // Build adjacency map
    const adjacency = new Map();
    nodes.forEach(n => adjacency.set(n.id, new Set()));

    edges.forEach(e => {
        adjacency.get(e.source.id).add(e.target.id);
        adjacency.get(e.target.id).add(e.source.id);
    });

    // Initialize each node in its own community
    const nodeToCommunity = new Map();
    nodes.forEach((n, idx) => nodeToCommunity.set(n.id, idx));

    let improved = true;
    let iterations = 0;
    const maxIterations = 10;

    // Iteratively optimize modularity
    while (improved && iterations < maxIterations) {
        improved = false;
        iterations++;

        for (const node of nodes) {
            const currentCommunity = nodeToCommunity.get(node.id);
            const neighbors = adjacency.get(node.id);

            if (neighbors.size === 0) continue;

            // Count connections to each neighboring community
            const communityCounts = new Map();
            neighbors.forEach(neighborId => {
                const neighborComm = nodeToCommunity.get(neighborId);
                communityCounts.set(neighborComm, (communityCounts.get(neighborComm) || 0) + 1);
            });

            // Find best community (most connections)
            let bestCommunity = currentCommunity;
            let bestCount = communityCounts.get(currentCommunity) || 0;

            communityCounts.forEach((count, community) => {
                if (count > bestCount) {
                    bestCount = count;
                    bestCommunity = community;
                }
            });

            if (bestCommunity !== currentCommunity) {
                nodeToCommunity.set(node.id, bestCommunity);
                improved = true;
            }
        }
    }

    // Group nodes by community
    const communityMap = new Map();
    nodeToCommunity.forEach((community, nodeId) => {
        if (!communityMap.has(community)) {
            communityMap.set(community, []);
        }
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
            communityMap.get(community).push(node);
        }
    });

    return Array.from(communityMap.values());
}

// Physics Simulation with Community-Aware Layout
function initializePhysics() {
    nodes = graphData.nodes.map(n => ({
        id: n.id,
        label: n.label,
        notes: n.notes,
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: 0,
        vy: 0,
        connections: n.connectionCount,
        selected: false,
        highlighted: false,
        community: null,
        communityCenter: { x: 0, y: 0 }
    }));

    edges = graphData.edges.map(e => ({
        id: e.id,
        source: nodes.find(n => n.id === e.sourceNodeId),
        target: nodes.find(n => n.id === e.targetNodeId)
    })).filter(e => e.source && e.target);

    // Detect communities
    communities = detectCommunities();

    // Assign community centers in a circular pattern
    const radius = Math.min(canvas.width, canvas.height) * 0.3;
    communities.forEach((community, idx) => {
        const angle = (idx / communities.length) * Math.PI * 2;
        const centerX = canvas.width / 2 + Math.cos(angle) * radius;
        const centerY = canvas.height / 2 + Math.sin(angle) * radius;

        community.forEach(node => {
            node.community = idx;
            node.communityCenter = { x: centerX, y: centerY };
        });
    });

    simulationIterations = 0;
    simulationRunning = true;
    centerGraph();
}

function startSimulation() {
    const animate = () => {
        if (simulationRunning) {
            applyForces();
            updatePositions();
        }
        render();
        requestAnimationFrame(animate);
    };
    animate();
}

function applyForces() {
    // Reset velocities slightly
    nodes.forEach(node => {
        node.vx *= 0.4;
        node.vy *= 0.4;
    });

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            // Get node radii
            const radiusI = Math.max(MIN_NODE_RADIUS, NODE_RADIUS_BASE + (nodes[i].connections * 4));
            const radiusJ = Math.max(MIN_NODE_RADIUS, NODE_RADIUS_BASE + (nodes[j].connections * 4));
            const minSeparation = radiusI + radiusJ + MIN_DISTANCE;

            // Adjust repulsion based on community
            let repulsionMultiplier;
            if (nodes[i].community === nodes[j].community) {
                // Moderate repulsion within same community
                repulsionMultiplier = 0.5;
            } else {
                // Stronger repulsion between different communities
                repulsionMultiplier = 1.0;
            }

            const force = (REPULSION * repulsionMultiplier) / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
        }
    }

    // Attraction along edges (stronger within community)
    edges.forEach(edge => {
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const attractionStrength = edge.source.community === edge.target.community
            ? ATTRACTION * 1.2
            : ATTRACTION * 0.4;

        const force = dist * attractionStrength;
        const fx = dx * force;
        const fy = dy * force;

        edge.source.vx += fx;
        edge.source.vy += fy;
        edge.target.vx -= fx;
        edge.target.vy -= fy;
    });

    // Pull nodes toward their community center
    nodes.forEach(node => {
        const dx = node.communityCenter.x - node.x;
        const dy = node.communityCenter.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // High-degree nodes pulled more strongly toward center
        const centerPull = COMMUNITY_ATTRACTION * (1 + node.connections * 0.08);
        const fx = dx * centerPull;
        const fy = dy * centerPull;

        node.vx += fx;
        node.vy += fy;
    });

    // Cap velocities to prevent explosive movements and stop tiny vibrations
    nodes.forEach(node => {
        const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);

        // Stop very small movements to prevent vibration
        if (speed < MIN_VELOCITY) {
            node.vx = 0;
            node.vy = 0;
        } else if (speed > MAX_VELOCITY) {
            node.vx = (node.vx / speed) * MAX_VELOCITY;
            node.vy = (node.vy / speed) * MAX_VELOCITY;
        }
    });
}

function updatePositions() {
    nodes.forEach(node => {
        if (dragNodeId === node.id) return; // Don't update position of dragged node

        node.vx *= DAMPING;
        node.vy *= DAMPING;
        node.x += node.vx;
        node.y += node.vy;
    });

    // Apply position constraints to prevent overlap
    resolveCollisions();
}

function resolveCollisions() {
    // Multiple passes to resolve all collisions
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[j].x - nodes[i].x;
                const dy = nodes[j].y - nodes[i].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Calculate required minimum distance
                const radiusI = Math.max(MIN_NODE_RADIUS, NODE_RADIUS_BASE + (nodes[i].connections * 4));
                const radiusJ = Math.max(MIN_NODE_RADIUS, NODE_RADIUS_BASE + (nodes[j].connections * 4));
                const minDist = radiusI + radiusJ + MIN_DISTANCE;

                // If overlapping, push them apart to exactly the minimum distance
                if (dist < minDist && dist > 0.1) {
                    const overlap = minDist - dist;
                    const angle = Math.atan2(dy, dx);

                    // Push each node half the overlap distance
                    const pushDist = overlap / 2;

                    nodes[i].x -= Math.cos(angle) * pushDist;
                    nodes[i].y -= Math.sin(angle) * pushDist;
                    nodes[j].x += Math.cos(angle) * pushDist;
                    nodes[j].y += Math.sin(angle) * pushDist;

                    // Zero out velocities in the collision direction to stop vibration
                    const relVelX = nodes[j].vx - nodes[i].vx;
                    const relVelY = nodes[j].vy - nodes[i].vy;
                    const relVelDotNormal = (relVelX * dx + relVelY * dy) / dist;

                    if (relVelDotNormal < 0) {
                        // Moving toward each other, stop that component of velocity
                        const normalX = dx / dist;
                        const normalY = dy / dist;

                        nodes[i].vx += normalX * relVelDotNormal * 0.5;
                        nodes[i].vy += normalY * relVelDotNormal * 0.5;
                        nodes[j].vx -= normalX * relVelDotNormal * 0.5;
                        nodes[j].vy -= normalY * relVelDotNormal * 0.5;
                    }
                }
            }
        }
    }
}

// Rendering
function render() {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Apply transformations
    ctx.scale(scale, scale);
    ctx.translate(offsetX, offsetY);

    // Draw edges
    edges.forEach(edge => {
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-primary');
        ctx.lineWidth = 2 / scale;
        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
        ctx.stroke();
    });

    // Draw nodes
    nodes.forEach(node => {
        // Size based on connections (degree centrality)
        const radius = Math.max(MIN_NODE_RADIUS, NODE_RADIUS_BASE + (node.connections * 4));

        // Node circle
        ctx.fillStyle = node.selected
            ? getComputedStyle(document.documentElement).getPropertyValue('--accent-primary')
            : node.highlighted
            ? getComputedStyle(document.documentElement).getPropertyValue('--success')
            : getComputedStyle(document.documentElement).getPropertyValue('--bg-tertiary');

        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-primary');
        ctx.lineWidth = 2 / scale;

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Label
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary');
        ctx.font = `${14 / scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x, node.y);
    });

    ctx.restore();
}

// Canvas Interactions
function handleCanvasMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX * scale) / scale;
    const y = (e.clientY - rect.top - offsetY * scale) / scale;

    dragNodeId = null;
    for (const node of nodes) {
        const radius = Math.max(MIN_NODE_RADIUS, NODE_RADIUS_BASE + (node.connections * 4));
        const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
        if (dist < radius) {
            dragNodeId = node.id;
            if (!e.ctrlKey && !e.metaKey) {
                selectedNodes.clear();
            }
            selectedNodes.add(node.id);
            node.selected = true;
            updateLinkButtonState();
            render();
            return;
        }
    }

    if (!e.ctrlKey && !e.metaKey) {
        selectedNodes.clear();
        nodes.forEach(n => n.selected = false);
        updateLinkButtonState();
    }

    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
}

function handleCanvasMouseMove(e) {
    if (dragNodeId) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - offsetX * scale) / scale;
        const y = (e.clientY - rect.top - offsetY * scale) / scale;

        const node = nodes.find(n => n.id === dragNodeId);
        if (node) {
            node.x = x;
            node.y = y;
            node.vx = 0;
            node.vy = 0;
            render();
        }
        return;
    }

    if (isDragging) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        offsetX += dx / scale;
        offsetY += dy / scale;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        render();
    }
}

function handleCanvasMouseUp() {
    dragNodeId = null;
    isDragging = false;
}

function handleCanvasWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomCanvas(zoomFactor);
}

function handleCanvasDoubleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX * scale) / scale;
    const y = (e.clientY - rect.top - offsetY * scale) / scale;

    for (const node of nodes) {
        const radius = Math.max(MIN_NODE_RADIUS, NODE_RADIUS_BASE + (node.connections * 4));
        const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
        if (dist < radius) {
            editNode(node);
            return;
        }
    }
}

function zoomCanvas(factor) {
    scale *= factor;
    scale = Math.max(0.1, Math.min(5, scale));
    render();
}

function resetView() {
    scale = 1;
    centerGraph();
    render();
}

function centerGraph() {
    if (nodes.length === 0) {
        offsetX = 0;
        offsetY = 0;
        return;
    }

    const minX = Math.min(...nodes.map(n => n.x));
    const maxX = Math.max(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxY = Math.max(...nodes.map(n => n.y));

    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    offsetX = canvas.width / 2 / scale - graphCenterX;
    offsetY = canvas.height / 2 / scale - graphCenterY;
}

function updateLinkButtonState() {
    const btn = document.getElementById('link-nodes-btn');
    if (btn) {
        btn.disabled = selectedNodes.size < 2;
    }

    // Show/hide filter controls based on selection
    const hasSelection = selectedNodes.size > 0;
    document.getElementById('degrees-input').style.display = hasSelection ? 'inline-block' : 'none';
    document.getElementById('filter-mode-select').style.display = hasSelection ? 'inline-block' : 'none';
    document.getElementById('apply-filter-btn').style.display = hasSelection ? 'inline-block' : 'none';
    document.getElementById('clear-filter-btn').style.display = hasSelection ? 'inline-block' : 'none';
}

// Context Menu
function handleCanvasContextMenu(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offsetX * scale) / scale;
    const y = (e.clientY - rect.top - offsetY * scale) / scale;

    // Find clicked node
    let clickedNode = null;
    for (const node of nodes) {
        const radius = Math.max(MIN_NODE_RADIUS, NODE_RADIUS_BASE + (node.connections * 4));
        const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
        if (dist < radius) {
            clickedNode = node;
            break;
        }
    }

    if (clickedNode) {
        contextMenuNodeId = clickedNode.id;
        showContextMenu(e.clientX, e.clientY);
    } else {
        hideContextMenu();
    }
}

function showContextMenu(x, y) {
    const menu = document.getElementById('node-context-menu');
    if (!menu) return;

    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Adjust if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (y - rect.height) + 'px';
    }
}

function hideContextMenu() {
    const menu = document.getElementById('node-context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
    contextMenuNodeId = null;
}

function handleContextEdit() {
    hideContextMenu();
    if (contextMenuNodeId) {
        const node = nodes.find(n => n.id === contextMenuNodeId);
        if (node) {
            editNode(node);
        }
    }
}

async function handleContextLinkTo() {
    hideContextMenu();
    if (!contextMenuNodeId) return;

    if (selectedNodes.size === 0) {
        alert('Please select at least one other node first (Ctrl+Click on nodes)');
        return;
    }

    // Create edges from all selected nodes to the context menu node
    try {
        for (const selectedId of selectedNodes) {
            if (selectedId !== contextMenuNodeId) {
                await fetch(`/api/graph/${currentGraphId}/edges`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sourceNodeId: selectedId,
                        targetNodeId: contextMenuNodeId
                    })
                });
            }
        }

        selectedNodes.clear();
        await loadGraphData(currentGraphId);
    } catch (error) {
        console.error('Error creating edges:', error);
        alert('Failed to create connections');
    }
}

function handleContextSelect() {
    hideContextMenu();
    if (contextMenuNodeId) {
        selectedNodes.add(contextMenuNodeId);
        const node = nodes.find(n => n.id === contextMenuNodeId);
        if (node) {
            node.selected = true;
        }
        updateLinkButtonState();
        render();
    }
}

async function handleContextDelete() {
    hideContextMenu();
    if (contextMenuNodeId) {
        await deleteNode(contextMenuNodeId);
    }
}
