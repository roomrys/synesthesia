// The arrangement extractor: a playable arrangement of the whole song for an
// ensemble (for now, one guitar), built from math, not a trained model.
// It runs the pipeline in js/extract/arrange/; see js/extract/arrangement.md.
//
// Its options pick an implementation for each step, and hold each step's own
// options under keys prefixed with the step (`projector.sparsity`). The page's
// sliders come from the default implementations' settings.

import { runPipeline } from '../arrange/pipeline.js';
import representation from '../arrange/representations/stft-log.js';
import rhythm from '../arrange/rhythm/flux.js';
import projector from '../arrange/projectors/nnls.js';
import picker from '../arrange/pickers/onset-rise.js';
import layers from '../arrange/layers/none.js';
import objective from '../arrange/objectives/energy.js';
import multiplexer from '../arrange/multiplexers/greedy.js';

const DEFAULT_STEPS = { representation, rhythm, projector, picker, layers, objective, multiplexer };

const defaults = {
    ...Object.fromEntries(Object.entries(DEFAULT_STEPS).map(([step, impl]) => [step, impl.id])),
    ensemble: [{ instrument: 'guitar', profile: 'default' }],
};
const settings = [];
for (const [step, impl] of Object.entries(DEFAULT_STEPS)) {
    for (const [key, value] of Object.entries(impl.defaults)) defaults[`${step}.${key}`] = value;
    for (const s of impl.settings ?? []) settings.push({ ...s, key: `${step}.${s.key}` });
}

export default {
    id: 'arrange',
    name: 'Arrangement (chords, polyphonic)',
    description: 'Explains the song as a mix of guitar sounds and keeps the notes that account for the most at each onset.',
    defaults,
    settings,

    async extract(clip, { options, onProgress, signal }) {
        if (signal?.aborted) throw new DOMException('Extraction was cancelled', 'AbortError');
        const { notes, stats } = await runPipeline(clip, options, { onProgress, signal });
        return { notes, stats };
    },
};
