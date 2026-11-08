// Shared data types for the note extractor. These shapes are the contract
// between modules; see architecture.md.

/**
 * Mono audio held in memory.
 * @typedef {Object} AudioClip
 * @property {Float32Array} samples  Values in -1..1.
 * @property {number} sampleRate     Hz.
 * @property {number} duration       Seconds.
 * @property {string} [label]
 */

/**
 * One detected note. Notes may overlap in time (chords).
 * @typedef {Object} Note
 * @property {number} midi        Integer MIDI note number (60 = C4, 69 = A4).
 * @property {number} start       Seconds.
 * @property {number} duration    Seconds.
 * @property {number} velocity    0..1, relative loudness.
 * @property {number} [confidence] 0..1, extractor-specific.
 * @property {string} [part]      Future: instrument / guitar part.
 */

/**
 * @typedef {Object} PitchTrack
 * @property {number} hopSeconds
 * @property {number} startSeconds   Time of the first frame.
 * @property {Float32Array} midi     Fractional MIDI per frame, NaN = no pitch.
 * @property {Float32Array} confidence
 */

/**
 * Output of an extractor.
 * @typedef {Object} NoteSet
 * @property {Note[]} notes   Sorted by start.
 * @property {{minMidi: number, maxMidi: number}} range
 * @property {{id: string, options: Object}} extractor
 * @property {PitchTrack} [pitchTrack]  Extractors may add extra per-frame arrays (e.g. YIN's candidateMidi, aperiodicity, loudness).
 * @property {Object} [stats]            Extractor-specific counts for debugging (e.g. why frames were rejected).
 */

/** Make an AudioClip from mono samples. */
export function makeClip(samples, sampleRate, label) {
    return { samples, sampleRate, duration: samples.length / sampleRate, label };
}
