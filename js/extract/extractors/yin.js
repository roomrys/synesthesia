// YIN pitch detection (de Cheveigné & Kawahara, 2002) plus note segmentation.
// Detects one pitch at a time, so it suits a single voice or instrument best.
//
// Steps:
//   1. Resample to a modest rate (pitch detection doesn't need high rates).
//   2. For each frame: difference function -> cumulative mean normalised
//      difference -> first dip below `threshold` -> parabolic interpolation.
//   3. Gate out quiet frames, round pitches to MIDI notes, smooth with a
//      sliding majority vote, and group runs of the same note into notes.
//   4. Split a run where loudness jumps (a re-struck note of the same pitch).

import { resampleFast } from '../dsp.js';
import { hzToMidi, midiToHz } from '../music.js';

const defaults = {
    sampleRate: 16000,     // Hz to analyse at
    hopSeconds: 0.01,      // time between frames
    threshold: 0.15,       // YIN dip threshold; lower = stricter
    silenceDb: -40,        // frames this far below the loudest frame are silent
    smoothFrames: 5,       // majority-vote window (frames)
    minNoteSeconds: 0.06,  // drop notes shorter than this
    maxGapSeconds: 0.03,   // bridge unvoiced gaps shorter than this within a note
    onsetRatio: 2,         // split a note when loudness jumps by this factor (0 = off)
};

// Tunable settings shown on the page. Keys match `defaults`.
const settings = [
    {
        key: 'threshold', label: 'Pitch tolerance', min: 0.05, max: 0.6, step: 0.01,
        format: (v) => v.toFixed(2),
        help: 'How clear a pitch must be to count. Raise it for full songs to find more notes (and more mistakes); lower it for a clean solo.',
    },
    {
        key: 'silenceDb', label: 'Quiet cutoff', min: -80, max: -10, step: 1,
        format: (v) => `${v} dB`,
        help: 'Ignore frames this far below the loudest moment. Lower it to keep quiet notes.',
    },
    {
        key: 'minNoteSeconds', label: 'Shortest note', min: 0.02, max: 0.3, step: 0.01,
        format: (v) => `${Math.round(v * 1000)} ms`,
        help: 'Drop notes shorter than this. Lower it for fast passages; raise it to remove blips.',
    },
    {
        key: 'smoothFrames', label: 'Smoothing', min: 1, max: 15, step: 2,
        format: (v) => (v <= 1 ? 'off' : `${v * 10} ms`),
        help: 'Majority vote over neighbouring frames. Removes octave jumps and flicker, but can blur fast notes.',
    },
    {
        key: 'maxGapSeconds', label: 'Bridge gaps', min: 0, max: 0.15, step: 0.01,
        format: (v) => `${Math.round(v * 1000)} ms`,
        help: 'Join a note across short dropouts. Raise it if long notes are broken into pieces.',
    },
    {
        key: 'onsetRatio', label: 'Re-strike split', min: 0, max: 4, step: 0.1,
        format: (v) => (v === 0 ? 'off' : `×${v.toFixed(1)}`),
        help: 'Split a held note when it suddenly gets this much louder (the same note played again). Lower = more splits.',
    },
];

const YIELD_EVERY_FRAMES = 400;
const SEARCH_MIN_MIDI = 33;    // A1, 55 Hz (below a 7-string's low B)
const SEARCH_MAX_MIDI = 100;   // E7, ~2.6 kHz
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

function abortError() {
    return new DOMException('Extraction was cancelled', 'AbortError');
}

/** Estimate pitch for every frame. */
async function pitchTrack(x, sr, { minMidi, maxMidi, options, onProgress, signal }) {
    // Search a wide pitch range whatever the requested range is, and filter later.
    // Narrowing the search makes YIN misread notes outside it as the octave below
    // or above (their period or harmonic falls inside the search).
    const tauMax = Math.ceil(sr / midiToHz(Math.min(minMidi, SEARCH_MIN_MIDI) - 1));
    const tauMin = Math.max(2, Math.floor(sr / midiToHz(Math.max(maxMidi, SEARCH_MAX_MIDI) + 1)));
    const window = tauMax;                  // integration window
    const frameLength = window + tauMax;
    const hop = Math.max(1, Math.round(options.hopSeconds * sr));
    const frameCount = Math.max(0, Math.floor((x.length - frameLength) / hop) + 1);

    const midi = new Float32Array(frameCount).fill(NaN);
    const confidence = new Float32Array(frameCount);
    const loudness = new Float32Array(frameCount);
    const candidateMidi = new Float32Array(frameCount).fill(NaN);
    const aperiodicity = new Float32Array(frameCount).fill(1);
    const diff = new Float32Array(tauMax + 1);

    for (let f = 0; f < frameCount; f++) {
        if (f % YIELD_EVERY_FRAMES === 0) {
            if (signal?.aborted) throw abortError();
            onProgress?.(f / frameCount);
            await nextTick();
        }
        const start = f * hop;

        let energy = 0;
        for (let j = 0; j < window; j++) energy += x[start + j] * x[start + j];
        loudness[f] = Math.sqrt(energy / window);
        if (energy === 0) continue;

        // Difference function.
        for (let tau = 1; tau <= tauMax; tau++) {
            let sum = 0;
            for (let j = 0; j < window; j++) {
                const d = x[start + j] - x[start + j + tau];
                sum += d * d;
            }
            diff[tau] = sum;
        }
        // Cumulative mean normalised difference (in place).
        diff[0] = 1;
        let running = 0;
        for (let tau = 1; tau <= tauMax; tau++) {
            running += diff[tau];
            diff[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
        }
        // First dip below the threshold, then walk down to its local minimum.
        let tau = -1;
        for (let t = tauMin; t <= tauMax; t++) {
            if (diff[t] < options.threshold) {
                while (t + 1 <= tauMax && diff[t + 1] < diff[t]) t++;
                tau = t;
                break;
            }
        }
        const accepted = tau >= 0;
        if (!accepted) {
            // No clear pitch. Keep the best guess (global minimum) for debugging only.
            tau = tauMin;
            for (let t = tauMin + 1; t <= tauMax; t++) if (diff[t] < diff[tau]) tau = t;
        }

        // Parabolic interpolation around the minimum.
        let betterTau = tau;
        if (tau > 1 && tau < tauMax) {
            const a = diff[tau - 1], b = diff[tau], c = diff[tau + 1];
            const denom = a - 2 * b + c;
            if (denom !== 0) betterTau = tau + (a - c) / (2 * denom);
        }
        candidateMidi[f] = hzToMidi(sr / betterTau);
        aperiodicity[f] = diff[tau];
        if (!accepted) continue;
        midi[f] = candidateMidi[f];
        confidence[f] = Math.max(0, Math.min(1, 1 - diff[tau]));
    }

    return {
        hopSeconds: hop / sr,
        startSeconds: window / 2 / sr,   // centre of the first integration window
        midi,
        confidence,
        loudness,
        candidateMidi,   // best guess for every frame, even rejected ones
        aperiodicity,    // YIN dip depth: 0 = perfectly periodic; frames need < threshold
    };
}

/** Most common non-null value in a window; ties keep `fallback`. */
function majority(values, fallback) {
    const counts = new Map();
    for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = fallback;
    let bestCount = counts.get(fallback) ?? 0;
    for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
    return best;
}

/** Turn a frame-level pitch track into notes. */
function segment(track, { minMidi, maxMidi, options }) {
    const { midi, confidence, loudness, hopSeconds, startSeconds } = track;
    const n = midi.length;
    let maxLoudness = 0;
    for (let i = 0; i < n; i++) maxLoudness = Math.max(maxLoudness, loudness[i]);
    const gate = Math.max(1e-4, maxLoudness * 10 ** (options.silenceDb / 20));

    // Rounded MIDI per frame, null when silent, unpitched or out of range.
    // `stats` counts why frames were rejected, to help tune the settings.
    const stats = { frames: n, silent: 0, unclear: 0, outOfRange: 0, pitched: 0, shortNotesDropped: 0, gate, maxLoudness };
    const rounded = new Array(n);
    for (let i = 0; i < n; i++) {
        const m = Math.round(midi[i]);
        let ok = false;
        if (loudness[i] < gate) stats.silent++;
        else if (Number.isNaN(midi[i])) stats.unclear++;
        else if (m < minMidi || m > maxMidi) stats.outOfRange++;
        else { stats.pitched++; ok = true; }
        rounded[i] = ok ? m : null;
    }

    // Majority-vote smoothing removes one-frame octave jumps and blips.
    const half = Math.floor(options.smoothFrames / 2);
    const smooth = rounded.map((v, i) => (v === null ? null : majority(rounded.slice(Math.max(0, i - half), i + half + 1), v)));

    const maxGapFrames = Math.round(options.maxGapSeconds / hopSeconds);
    const notes = [];
    let current = null;

    const close = () => {
        if (!current) return;
        const frames = current.end - current.start + 1;
        const duration = frames * hopSeconds;
        if (duration >= options.minNoteSeconds) {
            let loud = 0, conf = 0, voiced = 0;
            for (let i = current.start; i <= current.end; i++) {
                if (smooth[i] === null) continue;
                loud += loudness[i];
                conf += confidence[i];
                voiced++;
            }
            notes.push({
                midi: current.midi,
                start: Math.max(0, startSeconds + current.start * hopSeconds - hopSeconds / 2),
                duration,
                velocity: Math.min(1, Math.sqrt(loud / voiced / maxLoudness)),
                confidence: conf / voiced,
            });
        } else {
            stats.shortNotesDropped++;
        }
        current = null;
    };

    for (let i = 0; i < n; i++) {
        const m = smooth[i];
        if (m === null) {
            if (current && i - current.end > maxGapFrames) close();
            continue;
        }
        if (current && m === current.midi) {
            // A sudden jump in loudness means the same note was played again.
            const lookback = Math.max(current.start, i - 3);
            let recentMin = Infinity;
            for (let k = lookback; k < i; k++) recentMin = Math.min(recentMin, loudness[k]);
            const longEnough = (i - current.start) * hopSeconds >= options.minNoteSeconds;
            if (options.onsetRatio > 0 && longEnough && loudness[i] > recentMin * options.onsetRatio) {
                close();
                current = { midi: m, start: i, end: i };
            } else {
                current.end = i;
            }
            continue;
        }
        close();
        current = { midi: m, start: i, end: i };
    }
    close();
    return { notes, stats };
}

export default {
    id: 'yin',
    name: 'YIN (one note at a time)',
    description: 'Classic pitch detection. Best on a single voice or instrument; struggles with chords and full mixes.',
    defaults,
    settings,

    async extract(clip, { minMidi, maxMidi, options, onProgress, signal }) {
        if (signal?.aborted) throw abortError();
        const x = await resampleFast(clip.samples, clip.sampleRate, options.sampleRate);
        const track = await pitchTrack(x, options.sampleRate, { minMidi, maxMidi, options, onProgress, signal });
        const { notes, stats } = segment(track, { minMidi, maxMidi, options });
        onProgress?.(1);
        return { notes, pitchTrack: track, stats };
    },
};
