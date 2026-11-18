// Every implementation of every step of the arrangement pipeline, loaded lazily.
// To add one: create the module and add one line here. See js/extract/arrangement.md.

export const registry = {
    representation: {
        'stft-log': () => import('./representations/stft-log.js'),
    },
    rhythm: {
        flux: () => import('./rhythm/flux.js'),
    },
    instrument: {
        guitar: () => import('./instruments/guitar.js'),
    },
    timbre: {
        harmonic: () => import('./timbres/harmonic.js'),
    },
    projector: {
        nnls: () => import('./projectors/nnls.js'),
    },
    picker: {
        'onset-rise': () => import('./pickers/onset-rise.js'),
    },
    layers: {
        none: () => import('./layers/none.js'),
    },
    objective: {
        energy: () => import('./objectives/energy.js'),
    },
    multiplexer: {
        greedy: () => import('./multiplexers/greedy.js'),
    },
};

/** The steps chosen by id in the pipeline's options, in the order they run. */
export const STEPS = ['representation', 'rhythm', 'projector', 'picker', 'layers', 'objective', 'multiplexer'];

const COMMON = ['id', 'name', 'defaults'];
const REQUIRED = {
    representation: [...COMMON, 'analyse', 'kernel'],
    rhythm: [...COMMON, 'analyse'],
    instrument: [...COMMON, 'sounds', 'playability', 'defaultProfile'],
    timbre: [...COMMON, 'render'],
    projector: [...COMMON, 'project'],
    picker: [...COMMON, 'pick'],
    layers: [...COMMON, 'find'],
    objective: [...COMMON, 'prepare', 'score'],
    multiplexer: [...COMMON, 'choose'],
};

/** Import one implementation of a step by id, and check its shape. */
export async function loadStep(kind, id) {
    const loader = registry[kind]?.[id];
    if (!loader) {
        const known = Object.keys(registry[kind] ?? {}).join(', ') || 'none';
        throw new Error(`Unknown ${kind} "${id}". Registered: ${known}`);
    }
    const impl = (await loader()).default;
    const missing = REQUIRED[kind].filter((key) => impl?.[key] === undefined);
    if (missing.length) throw new Error(`${kind} "${id}" is missing: ${missing.join(', ')}`);
    if (kind === 'instrument') {
        const p = impl.playability;
        const lacking = ['states', 'cost', 'transition'].filter((k) => typeof p?.[k] !== 'function');
        if (lacking.length) throw new Error(`instrument "${id}" playability is missing: ${lacking.join(', ')}`);
    }
    return impl;
}
