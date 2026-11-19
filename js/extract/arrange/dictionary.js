// The dictionary: one template per sound of every ensemble member. Pure.

import { midiToName } from '../music.js';

/**
 * Render every sound of every member with its timbre, scaled to unit length.
 * @param {import('./types.js').Member[]} members
 * @param {import('./types.js').Axis} axis
 * @returns {import('./types.js').Dictionary}
 */
export function buildDictionary(members, axis) {
    const columns = [];
    const labels = [];
    members.forEach((member, index) => {
        for (const sound of member.instrument.sounds(member.options)) {
            const column = Float32Array.from(member.timbre.render(member, sound, axis));
            let norm = 0;
            for (const v of column) {
                if (!(v >= 0)) throw new Error(`timbre "${member.timbre.id}" rendered a negative or invalid value`);
                norm += v * v;
            }
            norm = Math.sqrt(norm);
            if (norm === 0) continue;   // nothing on this axis (e.g. above its top)
            for (let i = 0; i < column.length; i++) column[i] /= norm;
            columns.push(column);
            labels.push({ member: index, sound });
        }
    });
    return { hz: axis.hz, columns, labels };
}

/**
 * The spectrogram the dictionary and activations add up to: frame f is
 * Σ_j activation[j][f] · column[j]. Returns one Float32Array per frame.
 */
export function reconstruct(dictionary, activations) {
    const { columns } = dictionary;
    const H = activations.values;
    const frames = H[0]?.length ?? 0;
    const bins = dictionary.hz.length;
    const out = Array.from({ length: frames }, () => new Float32Array(bins));
    for (let j = 0; j < columns.length; j++) {
        const w = columns[j];
        const h = H[j];
        for (let f = 0; f < frames; f++) {
            const a = h[f];
            if (a <= 0) continue;
            const frame = out[f];
            for (let i = 0; i < bins; i++) frame[i] += a * w[i];
        }
    }
    return out;
}

/**
 * How much of each bin the reconstruction accounts for, 0..1: min(1, recon / original).
 * Used as a soft mask to hear guitar space; 1 − mask is the residual, and the two
 * add back up to the original.
 */
export function explainedMask(frames, recon) {
    return frames.map((v, f) => {
        const r = recon[f];
        const m = new Float32Array(v.length);
        for (let i = 0; i < v.length; i++) m[i] = v[i] > 0 ? Math.min(1, r[i] / v[i]) : 0;
        return m;
    });
}

/** A short name for a sound: the note name for a pitch, or the technique. */
export function soundName(sound) {
    return 'midi' in sound ? midiToName(sound.midi) : sound.technique;
}
