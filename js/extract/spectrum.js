// Debug layers for the timeline, drawn on the piano roll's pitch rows:
//
// - spectrogram: energy at each pitch over time. One note shows up as a stack:
//   its own row plus overtones 12, 19, 24, 28… semitones above.
// - salience (harmonic sum): for each pitch, the energy at its overtones added
//   up, so each note's stack collapses onto its own row. This is the first step
//   of classical polyphonic pitch detection.
//
// Both are stored as bytes (0–255), frame by frame, lowest pitch first.
//
// Onsets (where notes seem to start) come from spectral flux: how much the
// short-window (64 ms) log spectrum grows from one frame to the next.

import { resampleFast } from './dsp.js';
import { midiToHz } from './music.js';

export const LAYER_RATE = 16000;

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
export function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = (-2 * Math.PI) / size;
        for (let start = 0; start < n; start += size) {
            for (let k = 0; k < half; k++) {
                const wr = Math.cos(step * k);
                const wi = Math.sin(step * k);
                const a = start + k;
                const b = a + half;
                const tr = re[b] * wr - im[b] * wi;
                const ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
}

/**
 * Pick onset times from a spectral-flux curve: local peaks that stand out from
 * their surroundings, at least `minGap` seconds apart.
 */
export function pickOnsets(flux, hopSeconds, { level = null, offset = 0, floor = 0.08, lift = 0.05, minGap = 0.05 } = {}) {
    let max = 0;
    for (const v of flux) if (v > max) max = v;
    if (max <= 0) return [];
    const near = Math.max(1, Math.round(0.03 / hopSeconds));
    const wide = Math.max(near + 1, Math.round(0.1 / hopSeconds));
    const onsets = [];
    for (let f = 0; f < flux.length; f++) {
        const v = flux[f] / max;
        if (v < floor) continue;
        let peak = true;
        for (let g = Math.max(0, f - near); g <= Math.min(flux.length - 1, f + near) && peak; g++) {
            if (flux[g] > flux[f] || (flux[g] === flux[f] && g < f)) peak = false;
        }
        if (!peak) continue;
        let sum = 0, count = 0;
        for (let g = Math.max(0, f - wide); g <= Math.min(flux.length - 1, f + wide); g++) { sum += flux[g]; count++; }
        if (v < sum / count / max + lift) continue;
        // A note ending in silence can click; only keep peaks where the sound gets louder.
        if (level && (level[Math.min(flux.length - 1, f + near)] <= level[Math.max(0, f - near)])) continue;
        const t = Math.max(0, f * hopSeconds + offset);
        if (onsets.length && t - onsets[onsets.length - 1] < minGap) continue;
        onsets.push(t);
    }
    return onsets;
}

/** Where each pitch bin reads from the FFT: interpolate (low notes) or take the max (high notes). */
function pitchBinMap(minMidi, count, binsPerSemitone, binHz, nyquist) {
    const map = [];
    for (let k = 0; k < count; k++) {
        const centre = minMidi - 0.5 + (k + 0.5) / binsPerSemitone;
        const hz = midiToHz(centre);
        if (hz >= nyquist) { map.push(null); continue; }
        const lo = midiToHz(centre - 0.5 / binsPerSemitone) / binHz;
        const hi = midiToHz(centre + 0.5 / binsPerSemitone) / binHz;
        map.push(hi - lo < 1 ? { at: hz / binHz } : { lo: Math.ceil(lo), hi: Math.floor(hi) });
    }
    return map;
}

/**
 * Compute the spectrogram and salience layers for a clip.
 * Returns { startSeconds, hopSeconds, frames, minMidi, maxMidi, binsPerSemitone, bins,
 *           spectrogram: Uint8Array, salience: Uint8Array } with value[frame * bins + bin].
 */
export async function computeLayers(samples, sampleRate, {
    fftSize = 4096,
    hopSeconds = 0.01,
    maxFrames = 30000,       // longer clips get a coarser hop
    minMidi = 33,
    maxMidi = 100,
    binsPerSemitone = 3,
    harmonics = 10,
    rangeDb = 80,            // the quietest level shown, below the clip's peak
    onsetSize = 1024,        // short window for onsets: 64 ms at 16 kHz
    onsetMaxHz = 5000,
    onProgress,
    signal,
} = {}) {
    const x = sampleRate === LAYER_RATE ? samples : await resampleFast(samples, sampleRate, LAYER_RATE);
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    const gain = peak > 0 ? 1 / peak : 1;

    const duration = x.length / LAYER_RATE;
    const hop = Math.max(hopSeconds, duration / maxFrames);
    const hopSamples = hop * LAYER_RATE;
    const frames = Math.max(1, Math.floor(duration / hop) + 1);
    const bins = (maxMidi - minMidi + 1) * binsPerSemitone;

    // Overtones of the top pitch reach this many bins higher.
    const offsets = Array.from({ length: harmonics }, (_, h) => Math.round(12 * Math.log2(h + 1) * binsPerSemitone));
    const weights = offsets.map((_, h) => 1 / (h + 1));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const allBins = bins + offsets[offsets.length - 1];
    const map = pitchBinMap(minMidi, allBins, binsPerSemitone, LAYER_RATE / fftSize, LAYER_RATE / 2);

    const window = new Float32Array(fftSize);
    let windowSum = 0;
    for (let i = 0; i < fftSize; i++) {
        window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
        windowSum += window[i];
    }
    const scale = (2 * gain) / windowSum;   // a full-scale sine reads as 1
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const mag = new Float32Array(fftSize / 2 + 1);
    const level = new Float32Array(allBins);

    // Onset analysis: a short window that ends at the frame time, so new energy shows up promptly.
    const onsetWindow = new Float32Array(onsetSize);
    for (let i = 0; i < onsetSize; i++) onsetWindow[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / onsetSize);
    const onsetBins = Math.min(onsetSize / 2, Math.floor(onsetMaxHz / (LAYER_RATE / onsetSize)));
    const ore = new Float32Array(onsetSize);
    const oim = new Float32Array(onsetSize);
    let prevLog = new Float32Array(onsetBins);
    let nextLog = new Float32Array(onsetBins);
    const flux = new Float32Array(frames);
    const loudness = new Float32Array(frames);   // total log level per frame, for telling starts from ends
    const onsetScale = (2 * gain) / (onsetSize / 2);

    const spectrogram = new Uint8Array(frames * bins);
    const salienceRaw = new Float32Array(frames * bins);
    let salienceMax = 0;

    for (let f = 0; f < frames; f++) {
        if (f % 100 === 0) {
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            onProgress?.(f / frames);
            await new Promise((r) => setTimeout(r));
        }
        // Window centred on the frame time.
        const first = Math.round(f * hopSamples) - fftSize / 2;
        for (let i = 0; i < fftSize; i++) {
            const j = first + i;
            re[i] = j >= 0 && j < x.length ? x[j] * window[i] : 0;
            im[i] = 0;
        }
        fft(re, im);
        for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]) * scale;

        const end = Math.round(f * hopSamples);
        for (let i = 0; i < onsetSize; i++) {
            const j = end - onsetSize + i;
            ore[i] = j >= 0 && j < x.length ? x[j] * onsetWindow[i] : 0;
            oim[i] = 0;
        }
        fft(ore, oim);
        let rise = 0;
        let total = 0;
        for (let i = 1; i < onsetBins; i++) {
            nextLog[i] = Math.log1p(100 * Math.hypot(ore[i], oim[i]) * onsetScale);
            total += nextLog[i];
            if (f > 0 && nextLog[i] > prevLog[i]) rise += nextLog[i] - prevLog[i];
        }
        flux[f] = rise;
        loudness[f] = total;
        [prevLog, nextLog] = [nextLog, prevLog];

        // Level per pitch bin, 0 (rangeDb below peak) to 1 (peak).
        for (let k = 0; k < allBins; k++) {
            const m = map[k];
            let a = 0;
            if (!m) a = 0;
            else if (m.at !== undefined) {
                const i = Math.floor(m.at);
                const t = m.at - i;
                a = mag[i] * (1 - t) + mag[i + 1] * t;
            } else {
                for (let i = m.lo; i <= m.hi; i++) if (mag[i] > a) a = mag[i];
            }
            const db = 20 * Math.log10(a + 1e-12);
            level[k] = Math.max(0, Math.min(1, 1 + db / rangeDb));
        }

        for (let k = 0; k < bins; k++) {
            spectrogram[f * bins + k] = Math.round(level[k] * 255);
            let s = 0;
            for (let h = 0; h < harmonics; h++) s += weights[h] * level[k + offsets[h]];
            s /= weightSum;
            salienceRaw[f * bins + k] = s;
            if (s > salienceMax) salienceMax = s;
        }
    }

    const salience = new Uint8Array(frames * bins);
    if (salienceMax > 0) for (let i = 0; i < salience.length; i++) salience[i] = Math.round((salienceRaw[i] / salienceMax) * 255);
    onProgress?.(1);
    // The flux peaks about 20 ms after a note starts (measured on synthetic notes).
    const onsets = pickOnsets(flux, hop, { level: loudness, offset: -0.02 });

    return {
        onsets, flux,
        startSeconds: -hop / 2, hopSeconds: hop, frames,
        minMidi, maxMidi, binsPerSemitone, bins,
        spectrogram, salience,
    };
}
