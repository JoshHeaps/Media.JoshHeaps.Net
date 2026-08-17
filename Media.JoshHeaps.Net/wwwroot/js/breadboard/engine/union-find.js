/**
 * Union-find over string keys, backed by typed arrays.
 *
 * Used once per `load` to collapse breadboard strips, rails, wires and
 * component pins into nets. Keys arrive as strings (strip keys from
 * shared/board-geometry.js) and are interned to dense integer ids so the
 * parent/rank arrays can be Int32Array.
 */

export class UnionFind {
	constructor(expectedKeys = 256) {
		/** @type {Map<string, number>} */
		this.ids = new Map();
		this.parent = new Int32Array(expectedKeys);
		this.rank = new Uint8Array(expectedKeys);
		this.size = 0;
	}

	/** Interns a key, returning its dense id. Creates the key if it is new. */
	intern(key) {
		const existing = this.ids.get(key);
		if (existing !== undefined) return existing;
		const id = this.size++;
		if (id >= this.parent.length) this.#grow();
		this.parent[id] = id;
		this.rank[id] = 0;
		this.ids.set(key, id);
		return id;
	}

	#grow() {
		const parent = new Int32Array(this.parent.length * 2);
		parent.set(this.parent);
		const rank = new Uint8Array(parent.length);
		rank.set(this.rank);
		this.parent = parent;
		this.rank = rank;
	}

	find(id) {
		const parent = this.parent;
		let root = id;
		while (parent[root] !== root) root = parent[root];
		// Path compression, iterative so deep chains cannot blow the stack.
		while (parent[id] !== root) {
			const next = parent[id];
			parent[id] = root;
			id = next;
		}
		return root;
	}

	union(a, b) {
		let ra = this.find(a);
		let rb = this.find(b);
		if (ra === rb) return ra;
		const rank = this.rank;
		if (rank[ra] < rank[rb]) {
			const t = ra;
			ra = rb;
			rb = t;
		}
		this.parent[rb] = ra;
		if (rank[ra] === rank[rb]) rank[ra]++;
		return ra;
	}

	unionKeys(keyA, keyB) {
		return this.union(this.intern(keyA), this.intern(keyB));
	}

	/**
	 * Assigns each root a dense net id in ascending root order, then returns
	 * `{ netCount, netOfKey }` where netOfKey maps every interned key to its net.
	 * Deterministic: net ids depend only on intern order, which depends only on
	 * the circuit document, never on hash iteration of the roots.
	 */
	finish() {
		const netOfRoot = new Int32Array(this.size).fill(-1);
		let netCount = 0;
		for (let id = 0; id < this.size; id++) {
			const root = this.find(id);
			if (netOfRoot[root] === -1) netOfRoot[root] = netCount++;
		}
		/** @type {Map<string, number>} */
		const netOfKey = new Map();
		for (const [key, id] of this.ids) netOfKey.set(key, netOfRoot[this.find(id)]);
		return { netCount, netOfKey };
	}
}
