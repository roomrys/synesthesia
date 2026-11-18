// The arrangement pipeline: runs every step in order. See js/extract/arrangement.md.
//
// Options name the implementation for each step (`projector: 'nnls'`) and the
// ensemble. Each step's own options use keys prefixed with the step's name
// (`projector.sparsity`), so they fit the extractor's flat settings and are
// saved in the note file. With `trace: true` the result also has every step's
// output, for the debug page.

import { loadStep, STEPS } from './registry.js';
import { buildDictionary } from './dictionary.js';

/** A step's options: its defaults, overridden by `<step>.<key>` entries. */
export function stepOptions(options, step, impl) {
    const prefix = `${step}.`;
    const own = {};
    for (const [key, value] of Object.entries(options)) if (key.startsWith(prefix)) own[key.slice(prefix.length)] = value;
    return { ...impl.defaults, ...own };
}

/**
 * Resolve the ensemble: load each member's instrument and timbre, and merge
 * options and profile parameters over their defaults.
 * Entries are { instrument, profile?: 'default' | TimbreProfile, label?, options? }.
 * @returns {Promise<import('./types.js').Member[]>}
 */
export async function resolveEnsemble(entries) {
    const labels = new Map();
    const members = [];
    for (const entry of entries) {
        const instrument = await loadStep('instrument', entry.instrument);
        const profile = !entry.profile || entry.profile === 'default' ? instrument.defaultProfile : entry.profile;
        const timbre = await loadStep('timbre', profile.timbre);
        const base = entry.label ?? instrument.id;
        const seen = (labels.get(base) ?? 0) + 1;
        labels.set(base, seen);
        members.push({
            label: seen > 1 ? `${base} ${seen}` : base,
            instrument,
            options: { ...instrument.defaults, ...entry.options },
            timbre,
            profile: { ...profile, params: { ...timbre.defaults, ...profile.params } },
        });
    }
    return members;
}

/** Choices to notes. Percussive sounds aren't notes yet (they need the note format change), so they're left out. */
function toNotes(choices, ensemble) {
    const pitched = choices.filter((c) => 'midi' in c.candidate.sound);
    const loudest = Math.max(0, ...pitched.map((c) => c.candidate.strength));
    return pitched.map(({ candidate: c, member, weight }) => ({
        midi: c.sound.midi,
        start: c.start,
        duration: c.duration,
        velocity: loudest > 0 ? Math.max(0.05, Math.min(1, Math.sqrt(c.strength / loudest))) : 0.5,
        ...(weight !== undefined ? { confidence: Math.max(0, Math.min(1, weight)) } : {}),
        part: ensemble[member].label,
    }));
}

/**
 * Run the pipeline on a clip.
 * @returns {Promise<{ notes, stats, trace? }>}
 */
export async function runPipeline(clip, options, { onProgress, signal, trace = false } = {}) {
    const impls = {};
    for (const step of STEPS) impls[step] = await loadStep(step, options[step]);
    const opt = Object.fromEntries(STEPS.map((step) => [step, stepOptions(options, step, impls[step])]));
    const check = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
    // Analysis and projection take nearly all the time.
    const part = (from, to) => (p) => onProgress?.(from + (to - from) * p);

    check();
    const spectrogram = await impls.representation.analyse(clip, { options: opt.representation, onProgress: part(0, 0.5), signal });
    const rhythm = await impls.rhythm.analyse(clip, spectrogram, { options: opt.rhythm, signal });
    const ensemble = await resolveEnsemble(options.ensemble);
    const axis = { hz: spectrogram.hz, kernel: (hz) => impls.representation.kernel(hz, { options: opt.representation }) };
    const dictionary = buildDictionary(ensemble, axis);
    check();
    const { activations } = await impls.projector.project(spectrogram, dictionary, { options: opt.projector, onProgress: part(0.5, 0.95), signal });
    check();
    const candidates = impls.picker.pick(activations, dictionary, { rhythm, spectrogram, ensemble, options: opt.picker });
    const layers = impls.layers.find(candidates, { rhythm, activations, ensemble, options: opt.layers });
    const context = impls.objective.prepare(candidates, layers, { spectrogram, activations, dictionary, options: opt.objective });
    const choices = impls.multiplexer.choose(candidates, { layers, objective: impls.objective, context, ensemble, options: opt.multiplexer });
    const notes = toNotes(choices, ensemble);
    onProgress?.(1);

    const stats = {
        frames: spectrogram.frames.length,
        sounds: dictionary.columns.length,
        onsets: rhythm.onsets.length,
        candidates: candidates.length,
        chosen: choices.length,
        percussive: choices.length - notes.length,
    };
    stats.summary = `${stats.onsets} onsets, ${stats.candidates} candidate sounds, ${notes.length} notes kept`
        + (stats.percussive ? ` (and ${stats.percussive} percussive hits, not saved yet).` : '.');
    const result = { notes, stats };
    if (trace) result.trace = { options, stepOptions: opt, spectrogram, rhythm, ensemble, dictionary, activations, candidates, layers, context, choices };
    return result;
}
