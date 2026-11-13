// The guitar model, and contract tests that every fingering must pass.

import { test, assert, assertEqual } from './runner.js';
import { registry, loadImpl } from '../js/extract/registry.js';
import { STANDARD, midiAt, positionsFor, pitchRange } from '../js/tabs/guitar.js';
import { groupEvents, runFingering } from '../js/tabs/index.js';

const note = (midi, start, duration = 0.25, extra = {}) => ({ midi, start, duration, velocity: 0.8, ...extra });

test('guitar: standard tuning pitches and positions', () => {
    assertEqual(midiAt(STANDARD, 1, 0), 64, 'open high E:');
    assertEqual(midiAt(STANDARD, 6, 0), 40, 'open low E:');
    assertEqual(midiAt(STANDARD, 6, 12), 52, 'low E fret 12:');
    assertEqual(midiAt(STANDARD, 3, 4), 59, 'G string fret 4 = B:');
    assertEqual(JSON.stringify(positionsFor(STANDARD, 40)), '[{"string":6,"fret":0}]', 'low E:');
    assertEqual(positionsFor(STANDARD, 64).length, 5, 'E4 is playable on 5 strings:');
    assertEqual(positionsFor(STANDARD, 39).length, 0, 'below the guitar:');
    assertEqual(JSON.stringify(pitchRange(STANDARD)), '{"min":40,"max":85}', 'range:');
});

test('tabs: notes starting together are one event', () => {
    const events = groupEvents([note(48, 0), note(52, 0.01), note(55, 0.02), note(60, 0.5)]);
    assertEqual(events.map((e) => e.notes.length).join(','), '3,1');
});

for (const id of Object.keys(registry.fingering)) {
    const run = async (notes, options) => runFingering(await loadImpl('fingering', id), notes, STANDARD, { options });

    test(`fingering ${id}: right pitches, chords on different strings, every note accounted for`, async () => {
        // An open E major chord, then a melody.
        const notes = [40, 47, 52, 56, 59, 64].map((m) => note(m, 0, 1))
            .concat([note(60, 1), note(62, 1.25), note(64, 1.5), note(65, 1.75)]);
        const result = await run(notes);
        assertEqual(result.notes.length, notes.length, 'placed:');
        assertEqual(result.unplayable.length, 0, 'unplayable:');
        const chord = result.notes.filter((n) => n.start === 0);
        assertEqual(new Set(chord.map((n) => n.string)).size, 6, 'chord strings:');
        assertEqual(chord.find((n) => n.midi === 40).fret, 0, 'low E is open:');
    });

    test(`fingering ${id}: keeps hand-fixed positions`, async () => {
        // E4 forced onto the B string (fret 5) and A4 onto the G string (fret 14).
        const notes = [note(64, 0, 0.25, { string: 2, fret: 5, fixed: true }), note(69, 0.5, 0.25, { string: 3, fret: 14, fixed: true }), note(67, 1)];
        const result = await run(notes);
        const e4 = result.notes.find((n) => n.midi === 64);
        const a4 = result.notes.find((n) => n.midi === 69);
        assertEqual(`${e4.string}/${e4.fret}/${e4.fixed}`, '2/5/true', 'E4:');
        assertEqual(`${a4.string}/${a4.fret}/${a4.fixed}`, '3/14/true', 'A4:');
    });

    test(`fingering ${id}: reports notes it can't place`, async () => {
        // Too low, too high, and seven notes at once on a six-string guitar.
        const seven = [40, 45, 50, 55, 59, 64, 69].map((m) => note(m, 1, 0.5));
        const result = await run([note(30, 0), note(100, 0.5), ...seven]);
        assertEqual(result.notes.length + result.unplayable.length, 9, 'accounted for:');
        assert(result.unplayable.some((n) => n.midi === 30), 'too low not reported');
        assert(result.unplayable.some((n) => n.midi === 100), 'too high not reported');
        assertEqual(result.notes.filter((n) => n.start === 1).length, 6, 'six of the seven at once:');
    });
}

test('fingering path: a scale stays in one position, a repeated note stays put', async () => {
    const path = await loadImpl('fingering', 'path');
    // G major scale from G3 up an octave, then G4 three times.
    const scale = [55, 57, 59, 60, 62, 64, 66, 67].map((m, i) => note(m, i * 0.25));
    const repeats = [67, 67, 67].map((m, i) => note(m, 2 + i * 0.25));
    const result = runFingering(path, [...scale, ...repeats], STANDARD);
    const fretted = result.notes.slice(0, 8).filter((n) => n.fret > 0).map((n) => n.fret);
    assert(Math.max(...fretted) - Math.min(...fretted) <= 4, `scale frets jump: ${result.notes.map((n) => `${n.string}/${n.fret}`).join(' ')}`);
    const last = result.notes.slice(8);
    assertEqual(new Set(last.map((n) => `${n.string}/${n.fret}`)).size, 1, 'repeated note moved:');
});

test('fingering path: the hand stays in position through an open string', async () => {
    const path = await loadImpl('fingering', 'path');
    // E4 G4 A4 on the e string (0 3 5), open E4 again, then G4 A#4 A4: all should stay on the e string.
    const notes = [64, 67, 69, 64, 67, 70, 69].map((m, i) => note(m, i * 0.4));
    const result = runFingering(path, notes, STANDARD);
    assertEqual(result.notes.map((n) => `${n.string}/${n.fret}`).join(' '), '1/0 1/3 1/5 1/0 1/3 1/6 1/5', 'positions:');
});

test('fingering path: chords stay within the hand\'s reach', async () => {
    const path = await loadImpl('fingering', 'path');
    // A barre-shaped F major (F2 C3 F3 A3 C4 F4) and a high A minor triad.
    const notes = [41, 48, 53, 57, 60, 65].map((m) => note(m, 0, 1)).concat([69, 72, 76].map((m) => note(m, 1.5, 1)));
    const result = runFingering(path, notes, STANDARD);
    assertEqual(result.unplayable.length, 0, 'unplayable:');
    for (const start of [0, 1.5]) {
        const frets = result.notes.filter((n) => n.start === start && n.fret > 0).map((n) => n.fret);
        assert(Math.max(...frets) - Math.min(...frets) <= 4, `chord at ${start} stretches: ${frets}`);
    }
});

test('fingering path: the settings change where notes go', async () => {
    const path = await loadImpl('fingering', 'path');
    // A melody that fits in one position high up, or slides down one string.
    const melody = [76, 74, 72, 71, 72, 74, 76, 76, 76, 74, 74, 74, 76, 79, 79, 76, 74, 72, 71, 69, 67, 69, 71, 72];
    const notes = melody.map((m, i) => note(m, i * 0.3));
    const frets = (options) => runFingering(path, notes, STANDARD, { options }).notes.map((n) => `${n.string}:${n.fret}`).join(' ');
    const base = frets({});
    for (const options of [{ move: 0 }, { reach: 2 }, { height: 0.5 }, { stringChange: 2 }]) {
        assert(frets(options) !== base, `${JSON.stringify(options)} changed nothing`);
    }
    // Avoiding hand moves: fewer changes of position than not caring.
    const shifts = (options) => {
        const placed = runFingering(path, notes, STANDARD, { options }).notes.filter((n) => n.fret > 0);
        return placed.filter((n, i) => i && Math.abs(n.fret - placed[i - 1].fret) > 3).length;
    };
    assert(shifts({ move: 3 }) <= shifts({ move: 0 }), 'more moves when avoiding them');
});
