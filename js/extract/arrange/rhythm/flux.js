// Rhythm: onsets from spectral flux, the same analysis as the timeline's blue
// onset ticks (spectrum.js). Beats and bars come later (stage 2).

import { resampleFast } from '../../dsp.js';
import { spectralFlux, pickOnsets, ONSET_OFFSET, LAYER_RATE } from '../../spectrum.js';

export default {
    id: 'flux',
    name: 'Spectral flux',
    description: 'Onsets where the short-window spectrum suddenly grows.',
    defaults: { minGap: 0.05 },

    async analyse(clip, spectrogram, { options, signal } = {}) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const x = clip.sampleRate === LAYER_RATE ? clip.samples : await resampleFast(clip.samples, clip.sampleRate, LAYER_RATE);
        let peak = 0;
        for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
        const hop = spectrogram.hopSeconds;
        const { flux, loudness } = spectralFlux(x, spectrogram.frames.length, hop * LAYER_RATE, { gain: peak > 0 ? 1 / peak : 1 });
        const onsets = pickOnsets(flux, hop, { level: loudness, offset: ONSET_OFFSET, minGap: options?.minGap ?? 0.05 });
        return { onsets, beats: [], bars: [], flux };
    },
};
