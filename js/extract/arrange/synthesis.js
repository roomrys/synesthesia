// Hear what the projection decided: audio made only from the dictionary and the
// activations, i.e. "a guitar playing everything". Pure (no DOM, no Web Audio).
//
// - Pitched sounds: additive synthesis. Each partial from the timbre's
//   partials() is an oscillator whose amplitude follows the column's activation
//   (linear between frames). Activation h on a unit template whose rendering
//   was divided by `scale` means partials of amplitude h · amp / scale, which
//   the analysis reads back at the same level.
// - Percussive sounds: noise shaped by the template, made frame by frame with a
//   short inverse FFT and random phase, overlap-added.
//
// It sounds organ-like rather than plucked when the activations follow held
// notes (a voice), which is itself worth hearing.

import { fft } from '../spectrum.js';

const NOISE_SIZE = 1024;
const NOISE_HOP = 256;
const NOISE_GAIN = 8;     // measured: a percussive activation projects back at about the same level with stft-log

/** Value of a log-axis column at frequency `hz` (linear between bins, 0 outside). */
function readAxis(column, axisHz, hz) {
    if (hz < axisHz[0] || hz > axisHz[axisHz.length - 1]) return 0;
    let lo = 0, hi = axisHz.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (axisHz[mid] <= hz) lo = mid; else hi = mid;
    }
    const t = (hz - axisHz[lo]) / (axisHz[hi] - axisHz[lo] || 1);
    return column[lo] + (column[hi] - column[lo]) * t;
}

/**
 * @param {{ dictionary, activations, ensemble }} trace  From runPipeline.
 * @param {{ rate?: number, length: number, pitched?: boolean, percussive?: boolean, floor?: number, seed?: number, signal?: AbortSignal }} options
 *   `pitched` / `percussive` choose which sounds to include (both by default).
 * @returns {Promise<Float32Array>} `length` samples at `rate`
 */
export async function synthesize({ dictionary, activations, ensemble }, {
    rate = 16000, length, pitched = true, percussive: withPercussive = true, floor = 1e-5, seed = 1, signal,
} = {}) {
    const out = new Float32Array(length);
    const H = activations.values;
    const frames = H[0]?.length ?? 0;
    if (!frames) return out;
    const hop = activations.hopSeconds * rate;
    const maxHz = rate * 0.45;
    let s = seed;
    const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const tick = () => new Promise((r) => setTimeout(r));

    // Pitched: one oscillator per partial, amplitude following the activation.
    for (let j = 0; j < H.length && pitched; j++) {
        const { member, sound } = dictionary.labels[j];
        if (!('midi' in sound)) continue;
        const a = H[j];
        let peak = 0;
        for (const v of a) if (v > peak) peak = v;
        if (peak < floor) continue;
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (j % 8 === 0) await tick();
        const m = ensemble[member];
        const partials = m.timbre.partials?.(m, sound, { maxHz }) ?? [];
        const scale = dictionary.scales?.[j] ?? 1;
        for (const { hz, amp } of partials) {
            const w = (2 * Math.PI * hz) / rate;
            const c = Math.cos(w), sn = Math.sin(w);
            const phase = 2 * Math.PI * random();
            let x = Math.cos(phase), y = Math.sin(phase);
            const k = amp / scale;
            for (let f = 0; f < frames; f++) {
                const a0 = a[f], a1 = f + 1 < frames ? a[f + 1] : 0;
                if (a0 < floor && a1 < floor) continue;
                const n0 = Math.round(f * hop);
                const n1 = Math.min(length, Math.round((f + 1) * hop));
                const span = n1 - n0 || 1;
                for (let n = n0; n < n1; n++) {
                    out[n] += k * (a0 + ((a1 - a0) * (n - n0)) / span) * y;
                    const nx = x * c - y * sn;
                    y = x * sn + y * c;
                    x = nx;
                }
                const r = Math.hypot(x, y);   // keep the oscillator on the unit circle
                x /= r;
                y /= r;
            }
        }
    }

    // Percussive: shaped noise, short frames with random phase, overlap-added.
    const percussive = !withPercussive ? [] : dictionary.labels.map((l, j) => (!('midi' in l.sound) ? j : -1)).filter((j) => j >= 0)
        .filter((j) => H[j].some((v) => v >= floor));
    if (percussive.length) {
        const n = NOISE_SIZE;
        const half = n / 2;
        const window = new Float32Array(n);
        for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
        // Each percussive template on the FFT bins.
        const shapes = percussive.map((j) => {
            const shape = new Float32Array(half + 1);
            for (let k = 0; k <= half; k++) shape[k] = readAxis(dictionary.columns[j], dictionary.hz, (k * rate) / n) / (dictionary.scales?.[j] ?? 1);
            return shape;
        });
        const norm = new Float32Array(length);
        const noise = new Float32Array(length);
        const re = new Float32Array(n);
        const im = new Float32Array(n);
        for (let start = -half, step = 0; start < length; start += NOISE_HOP, step++) {
            if (step % 200 === 0) {
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                await tick();
            }
            const centre = (start + half) / hop;   // in activation frames
            const f = Math.min(frames - 1, Math.max(0, Math.floor(centre)));
            const t = Math.min(1, Math.max(0, centre - f));
            const g = (j) => H[j][f] * (1 - t) + (H[j][Math.min(frames - 1, f + 1)] ?? 0) * t;
            const gains = percussive.map(g);
            if (gains.every((v) => v < floor)) continue;
            re.fill(0);
            im.fill(0);
            for (let k = 1; k < half; k++) {
                let mag = 0;
                for (let p = 0; p < percussive.length; p++) mag += gains[p] * shapes[p][k];
                const phase = 2 * Math.PI * random();
                re[k] = mag * Math.cos(phase);
                im[k] = mag * Math.sin(phase);
                re[n - k] = re[k];
                im[n - k] = -im[k];
            }
            fft(re, im);   // conjugate-symmetric in, so the result is real (up to the sign of time)
            for (let i = 0; i < n; i++) {
                const at = start + i;
                if (at < 0 || at >= length) continue;
                noise[at] += re[i] * window[i];
                norm[at] += window[i] * window[i];
            }
        }
        for (let i = 0; i < length; i++) if (norm[i] > 1e-6) out[i] += (NOISE_GAIN * noise[i]) / norm[i];
    }
    return out;
}
