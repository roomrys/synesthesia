import { test, assertEqual, assertClose } from './runner.js';
import { cropNotes, filterRange, sortNotes } from '../js/extract/noteset.js';

const n = (midi, start, duration) => ({ midi, start, duration, velocity: 1 });

test('noteset: crop trims and re-times', () => {
    const notes = [n(60, 0, 1), n(62, 1.5, 1), n(64, 3, 1), n(65, 5, 1)];
    const out = cropNotes(notes, 2, 3.5);
    assertEqual(out.length, 2);
    assertEqual(out[0].midi, 62);
    assertClose(out[0].start, 0, 1e-9);
    assertClose(out[0].duration, 0.5, 1e-9);
    assertEqual(out[1].midi, 64);
    assertClose(out[1].start, 1, 1e-9);
    assertClose(out[1].duration, 0.5, 1e-9);
});

test('noteset: range filter and sort', () => {
    const notes = [n(70, 1, 1), n(30, 0, 1), n(50, 0, 1)];
    assertEqual(filterRange(notes, 40, 88).length, 2);
    assertEqual(sortNotes(notes).map((x) => x.midi).join(), '30,50,70');
});
