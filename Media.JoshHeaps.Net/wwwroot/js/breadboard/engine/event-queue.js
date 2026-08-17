/**
 * Binary min-heap event queue, struct-of-arrays over typed arrays.
 *
 * MUTABLE HOT PATH. No object is allocated per event: an event is six parallel
 * slots, and `pop()` writes the popped event into scalar fields on the queue
 * rather than returning a record.
 *
 * Ordering key is the pair (timeNs, seq). A binary heap is not stable, so
 * equal-time events would otherwise pop in an order that shifts when unrelated
 * events are inserted; `seq` is a monotonically increasing insertion counter
 * that makes ties resolve in insertion order. Simulation output is therefore
 * reproducible regardless of the order components appear in the document.
 *
 * `seq` is a float64 counter, not int32: at a few million events per second a
 * 32-bit counter wraps in under half an hour of wall time and the ordering
 * silently inverts. Float64 counts exactly to 2^53.
 */

/** Schedule a driver change: target = driverId, arg = packed drive code. */
export const EVENT_DRIVE = 0;
/** Wake a device with no input change: target = device index, arg = timer id. */
export const EVENT_TIMER = 1;

export class EventQueue {
	constructor(capacity = 1024) {
		this.length = 0;
		this.seqCounter = 0;
		this.time = new Float64Array(capacity);
		this.seq = new Float64Array(capacity);
		this.kind = new Uint8Array(capacity);
		this.target = new Int32Array(capacity);
		this.arg = new Int32Array(capacity);
		this.gen = new Int32Array(capacity);

		// Fields written by pop(). Read them immediately; the next pop overwrites.
		this.outTime = 0;
		this.outKind = 0;
		this.outTarget = 0;
		this.outArg = 0;
		this.outGen = 0;
	}

	get size() {
		return this.length;
	}

	push(timeNs, kind, target, arg, gen) {
		if (this.length === this.time.length) this.#grow();
		let i = this.length++;
		const seq = this.seqCounter++;
		const time = this.time;
		const seqs = this.seq;

		// Sift up, moving the hole rather than swapping pairs.
		while (i > 0) {
			const parent = (i - 1) >> 1;
			const pt = time[parent];
			if (pt < timeNs || (pt === timeNs && seqs[parent] < seq)) break;
			this.#copy(parent, i);
			i = parent;
		}
		time[i] = timeNs;
		seqs[i] = seq;
		this.kind[i] = kind;
		this.target[i] = target;
		this.arg[i] = arg;
		this.gen[i] = gen;
	}

	/** Time of the earliest event, or Infinity when empty. */
	peekTime() {
		return this.length === 0 ? Infinity : this.time[0];
	}

	/** Pops the earliest event into the out* fields. Returns false when empty. */
	pop() {
		if (this.length === 0) return false;
		this.outTime = this.time[0];
		this.outKind = this.kind[0];
		this.outTarget = this.target[0];
		this.outArg = this.arg[0];
		this.outGen = this.gen[0];

		const last = --this.length;
		if (last === 0) return true;
		const time = this.time;
		const seqs = this.seq;
		const lastTime = time[last];
		const lastSeq = seqs[last];

		let i = 0;
		for (;;) {
			const left = i * 2 + 1;
			if (left >= last) break;
			const right = left + 1;
			let child = left;
			if (right < last) {
				const lt = time[left];
				const rt = time[right];
				if (rt < lt || (rt === lt && seqs[right] < seqs[left])) child = right;
			}
			const ct = time[child];
			if (lastTime < ct || (lastTime === ct && lastSeq < seqs[child])) break;
			this.#copy(child, i);
			i = child;
		}
		this.#copy(last, i);
		return true;
	}

	#copy(from, to) {
		this.time[to] = this.time[from];
		this.seq[to] = this.seq[from];
		this.kind[to] = this.kind[from];
		this.target[to] = this.target[from];
		this.arg[to] = this.arg[from];
		this.gen[to] = this.gen[from];
	}

	#grow() {
		const capacity = this.time.length * 2;
		const time = new Float64Array(capacity);
		time.set(this.time);
		const seq = new Float64Array(capacity);
		seq.set(this.seq);
		const kind = new Uint8Array(capacity);
		kind.set(this.kind);
		const target = new Int32Array(capacity);
		target.set(this.target);
		const arg = new Int32Array(capacity);
		arg.set(this.arg);
		const gen = new Int32Array(capacity);
		gen.set(this.gen);
		this.time = time;
		this.seq = seq;
		this.kind = kind;
		this.target = target;
		this.arg = arg;
		this.gen = gen;
	}
}
