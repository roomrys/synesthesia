import { test, assertEqual, assertClose, assertRejects } from './runner.js';
import { loadImpl } from '../js/extract/registry.js';
import { runExtractor } from '../js/extract/extractors/index.js';
import { sequence, wavBytes } from './signals.js';

test('source file: decodes a WAV into a mono clip the extractor can read', async () => {
    const source = await loadImpl('source', 'file');
    const samples = sequence([{ midi: 69, seconds: 0.5 }, { midi: 72, seconds: 0.5 }], 44100);
    const file = new File([wavBytes(samples, 44100)], 'test.wav', { type: 'audio/wav' });
    const clip = await source.open(file);
    assertClose(clip.duration, 1, 0.01);
    assertEqual(clip.label, 'test.wav');
    const extractor = await loadImpl('extractor', 'yin');
    const { notes } = await runExtractor(extractor, clip);
    assertEqual(notes.map((n) => n.midi).join(), '69,72');
});

test('source file: a non-audio file gives a clear error', async () => {
    const source = await loadImpl('source', 'file');
    const file = new File(['not audio'], 'notes.txt');
    await assertRejects(source.open(file), (e) => /could not be decoded/.test(e.message));
});
