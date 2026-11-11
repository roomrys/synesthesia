// Operations on lists of notes.

/** Sort notes by start time, then pitch. Returns a new array. */
export function sortNotes(notes) {
    return [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/** Keep notes whose pitch is within [minMidi, maxMidi]. */
export function filterRange(notes, minMidi, maxMidi) {
    return notes.filter((n) => n.midi >= minMidi && n.midi <= maxMidi);
}

/**
 * Keep the parts of notes inside [start, end) and re-time them so `start` becomes 0.
 * Notes that cross a boundary are trimmed.
 */
export function cropNotes(notes, start, end, minDuration = 0.01) {
    const out = [];
    for (const n of notes) {
        const s = Math.max(n.start, start);
        const e = Math.min(n.start + n.duration, end);
        if (e - s < minDuration) continue;
        out.push({ ...n, start: s - start, duration: e - s });
    }
    return out;
}

/** Shift every note by `offset` seconds. */
export function shiftNotes(notes, offset) {
    return notes.map((n) => ({ ...n, start: n.start + offset }));
}
