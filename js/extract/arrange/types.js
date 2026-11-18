// Data types for the arrangement extractor's pipeline. These shapes are the
// contract between its steps; see js/extract/arrangement.md.

/**
 * A time-frequency picture of a clip. Frame f is centred at f * hopSeconds.
 * @typedef {Object} Spectrogram
 * @property {number} hopSeconds
 * @property {Float32Array} hz        Centre frequency of each bin (any spacing).
 * @property {Float32Array[]} frames  Magnitude per bin, one array per frame. A full-scale sine reads as 1.
 */

/**
 * The frequency axis templates are drawn on, from the representation.
 * @typedef {Object} Axis
 * @property {Float32Array} hz
 * @property {(hz: number) => Float32Array} kernel  How a unit sine at `hz` looks in this representation.
 */

/**
 * Something an instrument can sound: a pitch, or a percussive technique.
 * @typedef {{midi: number} | {technique: 'mute' | 'slap' | 'tap'}} Sound
 */

/**
 * Numbers that describe how one particular instrument sounds.
 * @typedef {Object} TimbreProfile
 * @property {string} timbre      The Timbre model id these params are for.
 * @property {string} instrument  The Instrument id.
 * @property {string} name
 * @property {Object} params      Model-specific.
 */

/**
 * One member of the ensemble, resolved by the pipeline.
 * @typedef {Object} Member
 * @property {string} label       Unique within the ensemble; becomes Note.part.
 * @property {Object} instrument  The Instrument implementation.
 * @property {Object} options     The instrument's options (its defaults plus overrides).
 * @property {Object} timbre      The Timbre implementation.
 * @property {TimbreProfile} profile  With params merged over the timbre's defaults.
 */

/**
 * @typedef {Object} Dictionary
 * @property {Float32Array} hz
 * @property {Float32Array[]} columns   One unit-length template per label.
 * @property {{member: number, sound: Sound}[]} labels
 */

/**
 * @typedef {Object} Activations
 * @property {number} hopSeconds
 * @property {Float32Array[]} values   values[column][frame] >= 0
 */

/**
 * A possible note: one dictionary column switching on at one time.
 * @typedef {Object} Candidate
 * @property {number} column
 * @property {number} member
 * @property {Sound} sound
 * @property {number} start       Seconds.
 * @property {number} duration    Seconds.
 * @property {number} strength    How much the activation rose.
 * @property {number} peakFrame   The frame where its activation peaks.
 */

/**
 * A layer of the song. Not an instrument: see Note.part.
 * @typedef {Object} Layer
 * @property {string} id
 * @property {string} kind
 * @property {Map<number, number>} members   Candidate index -> how much it belongs (0..1).
 * @property {{start: number, end: number}[]} occurrences
 */

/**
 * The candidates that start together, with the time until the next step.
 * @typedef {Object} Step
 * @property {number} start
 * @property {number} end
 * @property {Candidate[]} candidates
 */

/**
 * A kept note, from a multiplexer.
 * @typedef {Object} Choice
 * @property {Candidate} candidate
 * @property {number} member
 * @property {*} state             From the member's instrument.playability.states().
 * @property {number} [weight]     0..1, how sure the multiplexer is; becomes Note.confidence.
 */

export {};
