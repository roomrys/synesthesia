// Contract tests: every registered codec must round-trip a NoteSet.

import { test, assertEqual, assertClose, assertRejects } from './runner.js';
import { registry, loadImpl } from '../js/extract/registry.js';

const noteSet = {
    notes: [
        { midi: 64, start: 0.5123, duration: 0.25, velocity: 0.8, confidence: 0.93 },
        { midi: 67, start: 1.0, duration: 0.5, velocity: 0.5 },
    ],
    range: { minMidi: 40, maxMidi: 88 },
    extractor: { id: 'yin', options: { threshold: 0.15 } },
};

for (const id of Object.keys(registry.codec)) {
    test(`codec ${id}: round-trips notes and meta`, async () => {
        const codec = await loadImpl('codec', id);
        const blob = codec.encode(noteSet, { title: 'test song', duration: 2 });
        const { noteSet: back, meta } = codec.decode(await blob.arrayBuffer());
        assertEqual(back.notes.length, 2);
        back.notes.forEach((n, i) => {
            const orig = noteSet.notes[i];
            assertEqual(n.midi, orig.midi);
            assertClose(n.start, orig.start, 0.001);
            assertClose(n.duration, orig.duration, 0.001);
            assertClose(n.velocity, orig.velocity, 0.01);
        });
        assertEqual(meta.title, 'test song');
        assertClose(meta.duration, 2, 0.001);
        if (codec.details === false) return;   // e.g. MIDI keeps notes only
        const withSong = codec.encode(noteSet, {
            title: 't', duration: 2, song: { title: 'Their Song', artist: 'Some Band' },
            source: { type: 'file', label: 'band - song.mp3', start: 12.3456, length: 200 },
            extra: { tuning: 'Drop D', capo: '2' },
        });
        const extra = codec.decode(await withSong.arrayBuffer()).meta;
        assertEqual(extra.song.artist, 'Some Band', 'artist:');
        assertEqual(extra.source.label, 'band - song.mp3', 'source label:');
        assertClose(extra.source.start, 12.346, 0.0005, 'source start:');
        assertEqual(JSON.stringify(extra.extra), '{"tuning":"Drop D","capo":"2"}', 'extra details:');
    });

    test(`codec ${id}: rejects files that aren't note files`, async () => {
        const codec = await loadImpl('codec', id);
        await assertRejects((async () => codec.decode(new TextEncoder().encode('{"hello": 1}').buffer))());
    });
}

test('codec json: keeps hand-fixed positions only', async () => {
    const codec = await loadImpl('codec', 'json');
    const notes = [
        { midi: 64, start: 0, duration: 0.5, velocity: 0.8, string: 2, fret: 5, fixed: true },
        { midi: 67, start: 0.5, duration: 0.5, velocity: 0.8, string: 1, fret: 3, fixed: false },
    ];
    const back = codec.decode(await codec.encode({ ...noteSet, notes }, { title: 't', duration: 1 }).arrayBuffer()).noteSet.notes;
    assertEqual(`${back[0].string}/${back[0].fret}/${back[0].fixed}`, '2/5/true', 'fixed note:');
    assertEqual(back[1].string, undefined, 'converter-placed position should not be saved:');
});

test('codec json: is readable, one note per line', async () => {
    const codec = await loadImpl('codec', 'json');
    const text = await codec.encode(noteSet, { title: 't', duration: 2 }).text();
    const parsed = JSON.parse(text);
    assertEqual(parsed.format, 'synesthesia-notes');
    assertEqual(parsed.notes[0].name, 'E4');
    assertEqual(text.split('\n').filter((l) => l.includes('"midi"')).length, 2);
});
