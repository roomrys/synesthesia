// Small DSP helpers. Pure functions apart from resampleFast(), which uses
// OfflineAudioContext when the browser has it.

/** Average several channels into one. */
export function toMono(channels) {
    if (channels.length === 1) return channels[0];
    const out = new Float32Array(channels[0].length);
    for (const ch of channels) {
        for (let i = 0; i < out.length; i++) out[i] += ch[i];
    }
    for (let i = 0; i < out.length; i++) out[i] /= channels.length;
    return out;
}

/** Root-mean-square of samples[start, start + length). */
export function rms(samples, start = 0, length = samples.length - start) {
    const end = Math.min(samples.length, start + length);
    let sum = 0;
    for (let i = Math.max(0, start); i < end; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * Windowed-sinc resampling in plain JS. Works anywhere, but is slower than
 * resampleFast() in a browser.
 */
export function resample(samples, fromRate, toRate, halfTaps = 8) {
    if (fromRate === toRate) return samples;
    const ratio = fromRate / toRate;                 // input samples per output sample
    const cutoff = Math.min(1, 1 / ratio) * 0.95;    // relative to input Nyquist
    const width = Math.ceil(halfTaps / cutoff);
    const out = new Float32Array(Math.floor(samples.length / ratio));
    for (let i = 0; i < out.length; i++) {
        const t = i * ratio;
        const center = Math.floor(t);
        let sum = 0;
        let weightSum = 0;
        for (let k = center - width + 1; k <= center + width; k++) {
            if (k < 0 || k >= samples.length) continue;
            const d = t - k;
            const x = Math.PI * d * cutoff;
            const sinc = x === 0 ? 1 : Math.sin(x) / x;
            const hann = 0.5 + 0.5 * Math.cos((Math.PI * d) / width);
            const w = sinc * hann;
            sum += samples[k] * w;
            weightSum += w;
        }
        out[i] = weightSum ? sum / weightSum : 0;
    }
    return out;
}

/**
 * First and last moments the audio is audible, in seconds, with padding.
 * "Audible" = a window's RMS is within `thresholdDb` of the loudest window
 * (and above an absolute floor, so pure noise doesn't count).
 * Returns null if nothing is audible.
 */
export function findAudibleRange(samples, sampleRate, {
    thresholdDb = -40, windowSeconds = 0.02, padStart = 0.05, padEnd = 0.2, floor = 1e-3,
} = {}) {
    const size = Math.max(1, Math.round(windowSeconds * sampleRate));
    const count = Math.floor(samples.length / size);
    if (!count) return null;
    const levels = new Float32Array(count);
    let loudest = 0;
    for (let w = 0; w < count; w++) {
        levels[w] = rms(samples, w * size, size);
        if (levels[w] > loudest) loudest = levels[w];
    }
    const gate = Math.max(floor, loudest * 10 ** (thresholdDb / 20));
    let first = -1;
    let last = -1;
    for (let w = 0; w < count; w++) {
        if (levels[w] >= gate) {
            if (first < 0) first = w;
            last = w;
        }
    }
    if (first < 0) return null;
    const duration = samples.length / sampleRate;
    return {
        start: Math.max(0, (first * size) / sampleRate - padStart),
        end: Math.min(duration, ((last + 1) * size) / sampleRate + padEnd),
    };
}

/** Encode mono samples as an in-memory 16-bit PCM WAV Blob. */
export function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const ascii = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);          // fmt chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

/** Resample using the browser's native resampler when available. */
export async function resampleFast(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;
    if (typeof OfflineAudioContext === 'undefined') return resample(samples, fromRate, toRate);
    const length = Math.max(1, Math.floor((samples.length * toRate) / fromRate));
    const ctx = new OfflineAudioContext(1, length, toRate);
    const buffer = ctx.createBuffer(1, samples.length, fromRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0);
}
