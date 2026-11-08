// Contract tests: every registered extractor must pass these.

import { test, assert, assertEqual, assertClose, assertRejects } from './runner.js';
import { registry, loadImpl } from '../js/extract/registry.js';
import { runExtractor } from '../js/extract/extractors/index.js';
import { sequence, clipOf } from './signals.js';

const GUITARISH = [1, 0.6, 0.4, 0.25, 0.15];
const names = (notes) => notes.map((n) => n.midi).join(',');

for (const id of Object.keys(registry.extractor)) {
    const get = () => loadImpl('extractor', id);

    test(`extractor ${id}: a 440 Hz tone is one A4`, async () => {
        const clip = clipOf(sequence([{ midi: 69, seconds: 1 }]));
        const { notes } = await runExtractor(await get(), clip);
        assertEqual(names(notes), '69');
        assertClose(notes[0].start, 0, 0.05, 'start');
        assertClose(notes[0].duration, 1, 0.08, 'duration');
    });

    test(`extractor ${id}: low E with harmonics has no octave error`, async () => {
        const clip = clipOf(sequence([{ midi: 40, seconds: 1 }], 48000, { harmonics: GUITARISH }));
        const { notes } = await runExtractor(await get(), clip);
        assertEqual(names(notes), '40');
    });

    test(`extractor ${id}: a melody comes out in order with the right timing`, async () => {
        const melody = [
            { seconds: 0.2 },
            { midi: 60, seconds: 0.4 }, { seconds: 0.1 },
            { midi: 62, seconds: 0.4 }, { seconds: 0.1 },
            { midi: 64, seconds: 0.4 }, { seconds: 0.1 },
            { midi: 67, seconds: 0.4 },
        ];
        const clip = clipOf(sequence(melody, 44100, { harmonics: GUITARISH, noise: 0.002 }), 44100);
        const { notes } = await runExtractor(await get(), clip);
        assertEqual(names(notes), '60,62,64,67');
        [0.2, 0.7, 1.2, 1.7].forEach((t, i) => assertClose(notes[i].start, t, 0.03, `note ${i} start`));
    });

    test(`extractor ${id}: the same note played twice is two notes`, async () => {
        const clip = clipOf(sequence([{ midi: 64, seconds: 0.4 }, { seconds: 0.1 }, { midi: 64, seconds: 0.4 }]));
        const { notes } = await runExtractor(await get(), clip);
        assertEqual(names(notes), '64,64');
    });

    test(`extractor ${id}: silence and faint noise give no notes`, async () => {
        const clip = clipOf(sequence([{ seconds: 1 }], 48000, { noise: 0.001 }));
        const { notes } = await runExtractor(await get(), clip);
        assertEqual(notes.length, 0);
    });

    test(`extractor ${id}: notes outside the range are dropped`, async () => {
        const clip = clipOf(sequence([{ midi: 45, seconds: 0.5 }, { seconds: 0.1 }, { midi: 69, seconds: 0.5 }]));
        const { notes, range } = await runExtractor(await get(), clip, { minMidi: 57, maxMidi: 81 });
        assertEqual(names(notes), '69');
        assertEqual(range.minMidi, 57);
    });

    test(`extractor ${id}: reports progress and can be cancelled`, async () => {
        const clip = clipOf(sequence([{ midi: 69, seconds: 3 }]));
        let last = 0;
        await runExtractor(await get(), clip, { onProgress: (p) => { last = p; } });
        assertEqual(last, 1);
        const controller = new AbortController();
        controller.abort();
        await assertRejects(runExtractor(await get(), clip, { signal: controller.signal }), (e) => e.name === 'AbortError');
    });

    test(`extractor ${id}: velocities and confidences are in 0..1`, async () => {
        const clip = clipOf(sequence([{ midi: 57, seconds: 0.5 }, { midi: 59, seconds: 0.5 }], 48000, { harmonics: GUITARISH }));
        const { notes } = await runExtractor(await get(), clip);
        assert(notes.length > 0, 'no notes');
        for (const n of notes) {
            assert(n.velocity > 0 && n.velocity <= 1, `velocity ${n.velocity}`);
            if (n.confidence !== undefined) assert(n.confidence >= 0 && n.confidence <= 1, `confidence ${n.confidence}`);
        }
    });
}
