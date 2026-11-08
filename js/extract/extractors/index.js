// The extractor interface, and runExtractor(), which every caller should use.
//
// An extractor is a module whose default export looks like:
//
//   {
//     id, name, description,
//     defaults: { ...extractor-specific options },
//     async extract(clip, { minMidi, maxMidi, options, onProgress, signal }) -> NoteSet
//   }
//
// Extractors resample internally as they need. The range is a hint they may use
// to narrow their search; runExtractor() also enforces it on the output.

import { filterRange, sortNotes } from '../noteset.js';

function validateClip(clip) {
    if (!(clip?.samples instanceof Float32Array)) throw new TypeError('clip.samples must be a Float32Array');
    if (!(clip.sampleRate > 0)) throw new TypeError('clip.sampleRate must be positive');
}

function validateNote(note, i, extractorId) {
    const ok = Number.isInteger(note.midi)
        && Number.isFinite(note.start) && note.start >= 0
        && Number.isFinite(note.duration) && note.duration > 0
        && Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1;
    if (!ok) throw new Error(`Extractor "${extractorId}" returned an invalid note at index ${i}: ${JSON.stringify(note)}`);
}

/**
 * Run an extractor with validation, range filtering and sorting.
 * @returns {Promise<import('../types.js').NoteSet>}
 */
export async function runExtractor(extractor, clip, { minMidi = 40, maxMidi = 88, options = {}, onProgress, signal } = {}) {
    validateClip(clip);
    if (!(minMidi <= maxMidi)) throw new RangeError('minMidi must be <= maxMidi');
    const merged = { ...extractor.defaults, ...options };
    const result = await extractor.extract(clip, { minMidi, maxMidi, options: merged, onProgress, signal });
    result.notes.forEach((note, i) => validateNote(note, i, extractor.id));
    return {
        ...result,
        notes: sortNotes(filterRange(result.notes, minMidi, maxMidi)),
        range: { minMidi, maxMidi },
        extractor: { id: extractor.id, options: merged },
    };
}
