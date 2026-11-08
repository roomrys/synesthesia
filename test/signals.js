// Synthetic test signals.

import { midiToHz } from '../js/extract/music.js';

/**
 * Build a signal from segments. Each segment is { midi, seconds } for a tone or
 * { seconds } for silence. Tones get harmonics and short fades, like a plucked string.
 */
export function sequence(segments, sampleRate = 48000, { harmonics = [1], amplitude = 0.5, noise = 0 } = {}) {
    const total = segments.reduce((sum, s) => sum + s.seconds, 0);
    const out = new Float32Array(Math.round(total * sampleRate));
    let offset = 0;
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (const seg of segments) {
        const length = Math.round(seg.seconds * sampleRate);
        if (seg.midi !== undefined) {
            const hz = midiToHz(seg.midi);
            const fade = Math.min(length / 2, Math.round(0.005 * sampleRate));
            for (let i = 0; i < length; i++) {
                let v = 0;
                harmonics.forEach((weight, h) => { v += weight * Math.sin(2 * Math.PI * hz * (h + 1) * (i / sampleRate)); });
                const env = Math.min(1, i / fade, (length - i) / fade);
                out[offset + i] = (amplitude * v * env) / harmonics.reduce((a, b) => a + b, 0);
            }
        }
        offset += length;
    }
    if (noise) for (let i = 0; i < out.length; i++) out[i] += noise * random();
    return out;
}

export function clipOf(samples, sampleRate = 48000) {
    return { samples, sampleRate, duration: samples.length / sampleRate };
}

/** Encode mono samples as a 16-bit PCM WAV file. */
export function wavBytes(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
    return buffer;
}
