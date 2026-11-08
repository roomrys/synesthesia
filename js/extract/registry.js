// Every available implementation, loaded lazily. To add one: create the module
// and add one line here. Modules that aren't selected in config.js are never fetched.

import { config as defaultConfig } from './config.js';

export const registry = {
    source: {
        tab: () => import('./sources/tab.js'),
        file: () => import('./sources/file.js'),
    },
    extractor: {
        yin: () => import('./extractors/yin.js'),
    },
    voice: {
        tone: () => import('./voices/tone.js'),
    },
    codec: {
        json: () => import('./codecs/json.js'),
    },
    storage: {
        folder: () => import('./storage/folder.js'),
        download: () => import('./storage/download.js'),
    },
};

// Members every implementation of a kind must have.
const REQUIRED = {
    source: ['id', 'name', 'kind', 'isSupported'],
    extractor: ['id', 'name', 'defaults', 'extract'],
    voice: ['id', 'name', 'create'],
    codec: ['id', 'name', 'extension', 'mimeType', 'encode', 'decode'],
    storage: ['id', 'name', 'isSupported', 'save', 'open'],
};

const CONFIG_KIND = { sources: 'source', extractor: 'extractor', voice: 'voice', codec: 'codec', storage: 'storage' };

/** config.js merged with any query-parameter overrides. */
export function getConfig(search = globalThis.location?.search ?? '') {
    const params = new URLSearchParams(search);
    const merged = { ...defaultConfig };
    for (const key of Object.keys(CONFIG_KIND)) {
        if (!params.has(key)) continue;
        const value = params.get(key);
        merged[key] = Array.isArray(defaultConfig[key]) ? value.split(',').filter(Boolean) : value;
    }
    return merged;
}

/** Import one implementation by kind and id, and check its shape. */
export async function loadImpl(kind, id) {
    const loader = registry[kind]?.[id];
    if (!loader) {
        const known = Object.keys(registry[kind] ?? {}).join(', ') || 'none';
        throw new Error(`Unknown ${kind} "${id}". Registered: ${known}`);
    }
    const impl = (await loader()).default;
    const missing = REQUIRED[kind].filter((key) => impl?.[key] === undefined);
    if (missing.length) throw new Error(`${kind} "${id}" is missing: ${missing.join(', ')}`);
    return impl;
}

/**
 * Load the configured implementation for a kind. If the config value is a list,
 * return the first one that is supported.
 */
export async function load(kind, config = getConfig()) {
    const key = Object.keys(CONFIG_KIND).find((k) => CONFIG_KIND[k] === kind);
    const choice = config[key];
    const ids = Array.isArray(choice) ? choice : [choice];
    for (const id of ids) {
        const impl = await loadImpl(kind, id);
        if (!impl.isSupported || impl.isSupported()) return impl;
    }
    throw new Error(`No supported ${kind} among: ${ids.join(', ')}`);
}

/** Load every configured implementation for a kind that is supported (used for sources). */
export async function loadAll(kind, config = getConfig()) {
    const key = Object.keys(CONFIG_KIND).find((k) => CONFIG_KIND[k] === kind);
    const ids = [].concat(config[key]);
    const impls = await Promise.all(ids.map((id) => loadImpl(kind, id)));
    return impls.filter((impl) => !impl.isSupported || impl.isSupported());
}
