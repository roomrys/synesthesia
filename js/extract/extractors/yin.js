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

const YIELD_EVERY_FRAMES = 400;
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

function abortError() {
    return new DOMException('Extraction was cancelled', 'AbortError');
}

/** Estimate pitch for every frame. */
async function pitchTrack(x, sr, { minMidi, maxMidi, options, onProgress, signal }) {
    const tauMax = Math.ceil(sr / midiToHz(minMidi - 1));
    const tauMin = Math.max(2, Math.floor(sr / midiToHz(maxMidi + 1)));
    const window = tauMax;                  // integration window
    const frameLength = window + tauMax;
    const hop = Math.max(1, Math.round(options.hopSeconds * sr));
    const frameCount = Math.max(0, Math.floor((x.length - frameLength) / hop) + 1);

    const midi = new Float32Array(frameCount).fill(NaN);
    const confidence = new Float32Array(frameCount);
    const loudness = new Float32Array(frameCount);
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
        if (tau < 0) continue;

        // Parabolic interpolation around the minimum.
        let betterTau = tau;
        if (tau > 1 && tau < tauMax) {
            const a = diff[tau - 1], b = diff[tau], c = diff[tau + 1];
            const denom = a - 2 * b + c;
            if (denom !== 0) betterTau = tau + (a - c) / (2 * denom);
        }
        midi[f] = hzToMidi(sr / betterTau);
        confidence[f] = Math.max(0, Math.min(1, 1 - diff[tau]));
    }

    return {
        hopSeconds: hop / sr,
        startSeconds: window / 2 / sr,   // centre of the first integration window
        midi,
        confidence,
        loudness,
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
    const rounded = new Array(n);
    for (let i = 0; i < n; i++) {
        const m = Math.round(midi[i]);
        rounded[i] = Number.isNaN(midi[i]) || loudness[i] < gate || m < minMidi || m > maxMidi ? null : m;
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
    return notes;
}

export default {
    id: 'yin',
    name: 'YIN (one note at a time)',
    description: 'Classic pitch detection. Best on a single voice or instrument; struggles with chords and full mixes.',
    defaults,

    async extract(clip, { minMidi, maxMidi, options, onProgress, signal }) {
        if (signal?.aborted) throw abortError();
        const x = await resampleFast(clip.samples, clip.sampleRate, options.sampleRate);
        const track = await pitchTrack(x, options.sampleRate, { minMidi, maxMidi, options, onProgress, signal });
        const notes = segment(track, { minMidi, maxMidi, options });
        onProgress?.(1);
        const { loudness, ...pitch } = track;
        return { notes, pitchTrack: pitch };
    },
};
