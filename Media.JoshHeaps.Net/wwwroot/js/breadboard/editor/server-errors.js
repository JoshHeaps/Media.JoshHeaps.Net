// Friendly wording for the server validator's machine-readable error tokens.
//
// The validator emits `path:reason` tokens (e.g. "components[3].props.color:unsupported")
// deliberately, so they stay machine-readable. Turning them into sentences belongs
// here, in the UI layer, and MUST fall back to the raw token for anything unrecognised
// - a new validator reason has to remain visible, not vanish.

const REASONS = Object.freeze(Object.assign(Object.create(null), {
    malformed_json: 'could not be read',
    exceeds_max_size: 'is larger than the 2 MB limit',
    unsupported: 'has a value this build does not support',
    unknown_property: 'has a property this build does not recognise',
    not_an_object: 'is not shaped like a circuit element',
    not_an_array: 'should be a list',
    not_a_boolean: 'should be true or false',
    wrong_length: 'has the wrong number of entries',
    out_of_range: 'is outside the allowed range',
    unknown_board: 'refers to a board that does not exist',
    duplicate: 'is used more than once',
    not_applicable: 'is not allowed on this component',
    contradicts_anchor_row: 'does not match which side of the centre channel the part sits on',
    footprint_off_board: 'would place part of the component off the edge of the board',
    package_off_board: 'is too close to the edge for the package to fit',
    not_valid_on_rail: 'is not a valid direction for a part in a power rail',
    rail_pair_already_supplied: 'already has a 5V supply on that rail pair',
    unsupported_version: 'was saved by a different version of the editor',
    truncated: 'and more problems were found than can be listed'
}));

const PATHS = Object.freeze(Object.assign(Object.create(null), {
    circuit: 'The circuit',
    version: 'The circuit version',
    boards: 'The boards list',
    components: 'The components list',
    wires: 'The wires list'
}));

function describePath(path) {
    if (PATHS[path]) return PATHS[path];

    // components[3].props.color -> "Component 4's colour"
    const match = /^(components|wires|boards)\[(\d+)\](?:\.(.+))?$/.exec(path);
    if (match) {
        const noun = { components: 'Component', wires: 'Wire', boards: 'Board' }[match[1]];
        const ordinal = Number(match[2]) + 1;
        const field = match[3] ? ` (${match[3].replace(/\./g, ' ')})` : '';
        return `${noun} ${ordinal}${field}`;
    }
    return path;
}

/**
 * Turn one validator token into a sentence, or return it unchanged when it is not in
 * the expected shape.
 * @param {string} token
 * @returns {string}
 */
export function describeServerError(token) {
    if (typeof token !== 'string') return String(token);
    const split = token.lastIndexOf(':');
    if (split <= 0) return token;

    const path = token.slice(0, split);
    const reason = token.slice(split + 1);
    const wording = REASONS[reason];
    // Unrecognised reason: show the raw token so nothing is silently swallowed.
    if (!wording) return token;
    return `${describePath(path)} ${wording}.`;
}

/** Map a list of tokens, preserving order. */
export function describeServerErrors(tokens) {
    return tokens.map(describeServerError);
}
