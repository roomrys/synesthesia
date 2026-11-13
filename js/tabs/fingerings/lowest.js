// Fingering: the lowest fret for every note. A simple baseline for tests and comparison.

import { positionsFor } from '../guitar.js';
import { groupEvents, hasFixedPosition } from '../index.js';

export default {
    id: 'lowest',
    name: 'Lowest fret',
    description: 'Every note at the lowest fret it can be played on. Simple, but the hand jumps around.',
    defaults: {},

    assign(notes, guitar) {
        const placed = [];
        const unplayable = [];
        for (const event of groupEvents(notes)) {
            const fixed = event.notes.filter((n) => hasFixedPosition(n, guitar));
            const used = new Set(fixed.map((n) => n.string));
            placed.push(...fixed.map((n) => ({ ...n })));
            // Highest notes first, so they get the high strings.
            const free = event.notes.filter((n) => !hasFixedPosition(n, guitar)).sort((a, b) => b.midi - a.midi);
            for (const note of free) {
                const options = positionsFor(guitar, note.midi).filter((p) => !used.has(p.string));
                if (!options.length) {
                    unplayable.push(note);
                    continue;
                }
                const best = options.reduce((a, b) => (b.fret < a.fret ? b : a));
                used.add(best.string);
                placed.push({ ...note, string: best.string, fret: best.fret, fixed: false });
            }
        }
        return { notes: placed, unplayable };
    },
};
