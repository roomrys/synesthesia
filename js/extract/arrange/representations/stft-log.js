// Representation: a short-time Fourier transform mapped onto a log-frequency
// axis (a few bins per semitone), as the debug layers in spectrum.js do.
//
// Magnitudes are absolute (a full-scale sine reads as 1), not normalised to the
// clip's peak, so quiet audio stays quiet. Below about C3 the 256 ms window
// can't fully separate neighbouring semitones; the kernel smears the same way,
// so templates still match the analysis.

import { resampleFast } from '../../dsp.js';
import { fft, pitchBinMap, LAYER_RATE } from '../../spectrum.js';
import { midiToHz, hzToMidi } from '../../music.js';

const defaults = {
    fftSize: 4096,         // 256 ms at 16 kHz
    hopSeconds: 0.01,
    maxFrames: 30000,      // longer clips get a coarser hop
    minMidi: 24,           // C1, below the lowest guitar note and the slap's thump
    binsPerSemitone: 3,
};

const cancelled = () => new DOMException('Cancelled', 'AbortError');

/** The axis and the FFT-to-axis map for some options. Cached, since the kernel needs it too. */
const setups = new Map();
function setup(o) {
    const key = `${o.fftSize}/${o.minMidi}/${o.binsPerSemitone}`;
    if (setups.has(key)) return setups.get(key);
    const nyquist = LAYER_RATE / 2;
    // Stop one bin short of the Nyquist frequency.
    const count = Math.floor((hzToMidi(nyquist) - (o.minMidi - 0.5)) * o.binsPerSemitone) - 1;
    const hz = new Float32Array(count);
    for (let k = 0; k < count; k++) hz[k] = midiToHz(o.minMidi - 0.5 + (k + 0.5) / o.binsPerSemitone);
    const map = pitchBinMap(o.minMidi, count, o.binsPerSemitone, LAYER_RATE / o.fftSize, nyquist);
    const window = new Float32Array(o.fftSize);
    let sum = 0;
    for (let i = 0; i < o.fftSize; i++) {
        window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / o.fftSize);
        sum += window[i];
    }
    const s = { hz, map, window, scale: 2 / sum, kernels: new Map() };
    setups.set(key, s);
    return s;
}

/** FFT magnitudes onto the axis: interpolate for narrow (low) bins, take the max for wide (high) ones. */
function toAxis(mag, map, out) {
    for (let k = 0; k < map.length; k++) {
        const m = map[k];
        let a = 0;
        if (m && m.at !== undefined) {
            const i = Math.floor(m.at);
            const t = m.at - i;
            a = mag[i] * (1 - t) + mag[i + 1] * t;
        } else if (m) {
            for (let i = m.lo; i <= m.hi; i++) if (mag[i] > a) a = mag[i];
        }
        out[k] = a;
    }
    return out;
}

/** Window `get(i)` (i = 0..fftSize-1), transform, and map onto the axis. */
function analyseFrame(get, s, o, re, im, mag, out) {
    for (let i = 0; i < o.fftSize; i++) {
        re[i] = get(i) * s.window[i];
        im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]) * s.scale;
    return toAxis(mag, s.map, out);
}

export default {
    id: 'stft-log',
    name: 'Log-frequency spectrogram',
    description: 'A 256 ms Fourier transform every 10 ms, three bins per semitone.',
    defaults,

    async analyse(clip, { options, onProgress, signal } = {}) {
        const o = { ...defaults, ...options };
        if (signal?.aborted) throw cancelled();
        const x = clip.sampleRate === LAYER_RATE ? clip.samples : await resampleFast(clip.samples, clip.sampleRate, LAYER_RATE);
        const s = setup(o);
        const duration = x.length / LAYER_RATE;
        const hop = Math.max(o.hopSeconds, duration / o.maxFrames);
        const hopSamples = hop * LAYER_RATE;
        const count = Math.max(1, Math.floor(duration / hop) + 1);
        const re = new Float32Array(o.fftSize);
        const im = new Float32Array(o.fftSize);
        const mag = new Float32Array(o.fftSize / 2 + 1);
        const frames = [];
        for (let f = 0; f < count; f++) {
            if (f % 200 === 0) {
                if (signal?.aborted) throw cancelled();
                onProgress?.(f / count);
                await new Promise((r) => setTimeout(r));
            }
            const first = Math.round(f * hopSamples) - o.fftSize / 2;   // centred on the frame time
            const get = (i) => {
                const j = first + i;
                return j >= 0 && j < x.length ? x[j] : 0;
            };
            frames.push(analyseFrame(get, s, o, re, im, mag, new Float32Array(s.hz.length)));
        }
        onProgress?.(1);
        return { hopSeconds: hop, hz: s.hz, frames };
    },

    /** How a steady unit sine at `hz` looks in this representation (computed, then cached). */
    kernel(hz, { options } = {}) {
        const o = { ...defaults, ...options };
        const s = setup(o);
        const key = hz.toFixed(3);
        if (!s.kernels.has(key)) {
            const re = new Float32Array(o.fftSize);
            const im = new Float32Array(o.fftSize);
            const mag = new Float32Array(o.fftSize / 2 + 1);
            const w = (2 * Math.PI * hz) / LAYER_RATE;
            s.kernels.set(key, analyseFrame((i) => Math.sin(w * i), s, o, re, im, mag, new Float32Array(s.hz.length)));
        }
        return s.kernels.get(key);
    },
};
