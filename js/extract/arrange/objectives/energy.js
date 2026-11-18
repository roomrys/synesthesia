// Objective: how much of the spectrogram the chosen candidates explain.
//
// The baseline objective, used by stage 1. At one reference frame per step
// (where its strongest candidate peaks, so a short hit counts as much as a
// chord that takes a moment to fill the analysis window):
//   base = the frame minus what every column that is NOT a candidate at this
//          step explains (sounds still ringing from earlier, percussion, …)
//   score(chosen) = (‖base‖² − ‖base − Σ chosen‖²) / ‖frame‖²
// so adding a candidate is worth the share of the frame it accounts for. It
// ignores layers; fair-distinct (stage 3) uses them.

const defaults = {};

export default {
    id: 'energy',
    name: 'Explained energy',
    description: 'The share of the sound that the chosen notes account for.',
    defaults,

    prepare(candidates, layers, { spectrogram, activations, dictionary } = {}) {
        return { spectrogram, activations, dictionary, steps: new Map() };
    },

    score(chosen, step, context) {
        const s = stepSetup(step, context);
        if (!chosen.length || s.total === 0) return 0;
        const { columns } = context.dictionary;
        const H = context.activations.values;
        const left = Float64Array.from(s.base);
        for (const c of chosen) {
            const w = columns[c.column];
            const h = H[c.column][s.frame];
            for (let i = 0; i < left.length; i++) left[i] -= h * w[i];
        }
        let after = 0;
        for (const v of left) after += v * v;
        return (s.baseEnergy - after) / s.total;
    },
};

/** The reference frame and baseline for a step, computed once. */
function stepSetup(step, context) {
    const key = step.start;
    if (context.steps.has(key)) return context.steps.get(key);
    const { spectrogram, activations, dictionary } = context;
    const strongest = step.candidates.reduce((a, c) => (c.strength > a.strength ? c : a));
    const frame = Math.max(0, Math.min(spectrogram.frames.length - 1, strongest.peakFrame));
    const v = spectrogram.frames[frame];
    const own = new Set(step.candidates.map((c) => c.column));
    const base = Float64Array.from(v);
    dictionary.columns.forEach((w, j) => {
        if (own.has(j)) return;
        const h = activations.values[j][frame];
        if (h > 0) for (let i = 0; i < base.length; i++) base[i] -= h * w[i];
    });
    let total = 0, baseEnergy = 0;
    for (let i = 0; i < v.length; i++) {
        total += v[i] * v[i];
        baseEnergy += base[i] * base[i];
    }
    const s = { frame, base, total, baseEnergy };
    context.steps.set(key, s);
    return s;
}
