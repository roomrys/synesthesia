// The Fingering interface, and the shared helpers every fingering uses.
//
// A fingering gives every note a string and fret:
//
//   {
//     id, name, description,
//     defaults: object,
//     settings?: [{ key, label, min, max, step, format?(value), help? }],
//     assign(notes, guitar, { options }): TabResult,
//   }
//
//   TabNote   = Note & { string, fret, fixed? }   fixed: chosen by hand, keep it
//   TabResult = { notes: TabNote[], unplayable: Note[], fingering: { id, options } }
//
// Always call fingerings through runFingering(), which checks the rules below.
// See js/tabs/README.md.

import { midiAt, stringCount } from './guitar.js';
import { sortNotes } from '../extract/noteset.js';

/** Notes starting within this many seconds of each other are one chord. */
export const CHORD_WINDOW = 0.03;

/**
 * Group notes (sorted by start) into events: notes that start together.
 * Returns [{ start, end, notes }], in time order.
 */
export function groupEvents(notes, window = CHORD_WINDOW) {
    const events = [];
    for (const note of sortNotes(notes)) {
        const last = events[events.length - 1];
        if (last && note.start - last.start <= window) {
            last.notes.push(note);
            last.end = Math.max(last.end, note.start + note.duration);
        } else {
            events.push({ start: note.start, end: note.start + note.duration, notes: [note] });
        }
    }
    return events;
}

/** A note keeps its hand-chosen position if it has one that plays its pitch. */
export function hasFixedPosition(note, guitar) {
    return Boolean(note.fixed)
        && Number.isInteger(note.string) && note.string >= 1 && note.string <= stringCount(guitar)
        && Number.isInteger(note.fret) && note.fret >= 0 && note.fret <= guitar.frets
        && midiAt(guitar, note.string, note.fret) === note.midi;
}

/**
 * Run a fingering and check its result:
 * - every note is either placed or unplayable, never both, never lost;
 * - every placed note's position plays its pitch;
 * - notes that start together are on different strings;
 * - hand-fixed positions are kept.
 * Throws if a fingering breaks a rule, so a bad implementation can't reach the page.
 */
export function runFingering(fingering, notes, guitar, { options = {} } = {}) {
    const merged = { ...fingering.defaults, ...options };
    const result = fingering.assign(notes, guitar, { options: merged });
    const placed = result.notes ?? [];
    const unplayable = result.unplayable ?? [];
    if (placed.length + unplayable.length !== notes.length) {
        throw new Error(`${fingering.id}: ${notes.length} notes in, ${placed.length} placed + ${unplayable.length} unplayable out`);
    }
    for (const n of placed) {
        if (midiAt(guitar, n.string, n.fret) !== n.midi || n.fret < 0 || n.fret > guitar.frets) {
            throw new Error(`${fingering.id}: string ${n.string} fret ${n.fret} doesn't play MIDI ${n.midi}`);
        }
    }
    for (const event of groupEvents(placed)) {
        const strings = event.notes.map((n) => n.string);
        if (new Set(strings).size !== strings.length) {
            throw new Error(`${fingering.id}: two notes at ${event.start.toFixed(3)} s share a string`);
        }
    }
    for (const n of notes) {
        if (!hasFixedPosition(n, guitar)) continue;
        const out = placed.find((p) => p.start === n.start && p.midi === n.midi && p.fixed);
        if (!out || out.string !== n.string || out.fret !== n.fret) {
            throw new Error(`${fingering.id}: moved a hand-fixed note (MIDI ${n.midi} at ${n.start} s)`);
        }
    }
    return {
        notes: sortNotes(placed),
        unplayable: sortNotes(unplayable),
        fingering: { id: fingering.id, options: merged },
    };
}
