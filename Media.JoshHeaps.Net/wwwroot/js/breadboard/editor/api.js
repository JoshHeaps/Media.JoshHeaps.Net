// Server calls for breadboard projects.
//
// Every error path produces a human-readable message. The API returns a uniform
// { errors: [...] } body on 400/401/404/500, but a request that fails model binding
// before the controller runs yields ASP.NET's ProblemDetails instead, where `errors`
// is an OBJECT keyed by field - hence the Array.isArray guard.

import {
    serializeCircuit,
    circuitByteSize,
    MAX_CIRCUIT_BYTES
} from '../shared/circuit-schema.js';

/** Thrown for any non-2xx response. `messages` is always a non-empty string array. */
export class ApiError extends Error {
    constructor(status, messages) {
        super(messages[0]);
        this.name = 'ApiError';
        this.status = status;
        this.messages = messages;
    }
}

async function readErrors(response) {
    if (response.status === 413) {
        return ['The circuit is too large to save. Remove some wires or components and try again.'];
    }
    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
        return payload.errors.map(String);
    }
    // ProblemDetails: errors is an object of field -> string[]
    if (payload && payload.errors && typeof payload.errors === 'object') {
        const flattened = [];
        for (const value of Object.values(payload.errors)) {
            if (Array.isArray(value)) flattened.push(...value.map(String));
        }
        if (flattened.length > 0) return flattened;
    }
    if (payload && typeof payload.title === 'string') return [payload.title];
    if (response.status === 401) return ['Your session has expired. Please sign in again.'];
    if (response.status === 404) return ['This project no longer exists.'];
    return [`The server returned an unexpected error (${response.status}).`];
}

async function request(url, options = {}) {
    let response;
    try {
        response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));
    } catch {
        throw new ApiError(0, ['Could not reach the server. Check your connection and try again.']);
    }
    if (!response.ok) throw new ApiError(response.status, await readErrors(response));
    if (response.status === 204) return null;
    try {
        return await response.json();
    } catch {
        return null;
    }
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export function createApi(baseUrl) {
    const base = (baseUrl || '/api/breadboard').replace(/\/+$/, '');

    return {
        listProjects() {
            return request(`${base}/projects`);
        },

        createProject(name, description) {
            return request(`${base}/projects`, {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify(description ? { name, description } : { name })
            });
        },

        getProject(id) {
            return request(`${base}/projects/${encodeURIComponent(id)}`);
        },

        /**
         * Save the circuit only. Omitting name/description leaves them untouched
         * server-side, which is why this sends nothing else.
         *
         * The payload is rebuilt by serializeCircuit so no editor state can leak into
         * the document, and its byte size is checked first: the count caps do NOT
         * imply the 2 MB byte cap, so without this the user would meet it as a bare
         * rejection with no explanation.
         */
        saveCircuit(id, circuit) {
            const payload = serializeCircuit(circuit);
            const bytes = circuitByteSize(payload);
            if (bytes > MAX_CIRCUIT_BYTES) {
                const over = Math.ceil((bytes - MAX_CIRCUIT_BYTES) / 1024);
                return Promise.reject(new ApiError(0, [
                    `This circuit is ${(bytes / 1048576).toFixed(2)} MB, which is ${over} KB over the 2 MB limit.`,
                    `It has ${payload.components.length} components and ${payload.wires.length} wires — removing some will bring it under.`
                ]));
            }
            return request(`${base}/projects/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: jsonHeaders,
                body: JSON.stringify({ circuit: payload })
            }).then(() => payload);
        },

        renameProject(id, name, description) {
            const body = {};
            if (name !== undefined) body.name = name;
            if (description !== undefined) body.description = description;
            return request(`${base}/projects/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: jsonHeaders,
                body: JSON.stringify(body)
            });
        },

        deleteProject(id) {
            return request(`${base}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        }
    };
}
