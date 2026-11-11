import { test, assert, assertEqual, assertRejects } from './runner.js';
import { getConfig, loadImpl, registry } from '../js/extract/registry.js';
import { NO_EXTRACTOR } from '../js/extract/registry.js';
import { config } from '../js/extract/config.js';

test('registry: every registered implementation loads with the right shape', async () => {
    for (const kind of Object.keys(registry)) {
        for (const id of Object.keys(registry[kind])) {
            const impl = await loadImpl(kind, id);
            assertEqual(impl.id, id, `${kind}/${id}:`);
        }
    }
});

test('registry: config ids are all registered', () => {
    for (const id of config.sources) assert(registry.source[id], `source ${id}`);
    assert(config.extractor === NO_EXTRACTOR || registry.extractor[config.extractor], 'extractor');
    assert(registry.voice[config.voice], 'voice');
    assert(registry.codec[config.codec], 'codec');
    for (const id of config.storage) assert(registry.storage[id], `storage ${id}`);
});

test('registry: query parameters override config', () => {
    const c = getConfig('?extractor=other&sources=file');
    assertEqual(c.extractor, 'other');
    assertEqual(c.sources.join(), 'file');
    assertEqual(c.voice, config.voice);
});

test('registry: unknown id gives a helpful error', async () => {
    await assertRejects(loadImpl('extractor', 'nope'), (e) => /Registered: yin/.test(e.message));
});
