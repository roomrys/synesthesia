// Synthetic clips for the debug pages: plucked-string tones (decaying partials,
// slightly sharp higher up), chords, and simple drums. Each preset returns an
// AudioClip at 16 kHz, the rate the arrangement pipeline analyses at.

import { midiToHz } from '../extract/music.js';
import { makeClip } from '../extract/types.js';

const RATE = 16000;

function random(seed) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/** Add a plucked note: partials k^-1.2, higher ones dying faster. */
function pluck(out, midi, at, seconds, amplitude = 0.15) {
    const f0 = midiToHz(midi);
    const start = Math.round(at * RATE);
    const length = Math.min(out.length - start, Math.round(seconds * RATE));
    for (let k = 1; k <= 12; k++) {
        const f = k * f0 * Math.sqrt(1 + 5e-5 * k * k);
        if (f > RATE / 2 - 200) break;
        const amp = amplitude * k ** -1.2;
        const decay = 1.5 + 0.6 * k;   // per second
        const w = (2 * Math.PI * f) / RATE;
        for (let i = 0; i < length; i++) {
            const t = i / RATE;
            const fade = Math.min(1, i / 40, (length - i) / 200);
            out[start + i] += amp * Math.exp(-decay * t) * fade * Math.sin(w * i);
        }
    }
}

/** A noise burst (snare / hi-hat), `seconds` long, fading out. */
function hit(out, at, seconds, amplitude, seed) {
    const rnd = random(seed);
    const start = Math.round(at * RATE);
    const length = Math.min(out.length - start, Math.round(seconds * RATE));
    for (let i = 0; i < length; i++) out[start + i] += amplitude * rnd() * (1 - i / length) ** 2;
}

/** A kick: a falling low sine. */
function kick(out, at, amplitude = 0.5) {
    const start = Math.round(at * RATE);
    const length = Math.min(out.length - start, Math.round(0.15 * RATE));
    let phase = 0;
    for (let i = 0; i < length; i++) {
        const t = i / RATE;
        phase += (2 * Math.PI * (50 + 70 * Math.exp(-t * 30))) / RATE;
        out[start + i] += amplitude * Math.exp(-t * 20) * Math.sin(phase);
    }
}

function clip(seconds, build, label) {
    const out = new Float32Array(Math.round(seconds * RATE));
    build(out);
    return makeClip(out, RATE, label);
}

const EM = [40, 47, 52, 55, 59, 64];
const C = [48, 52, 55, 60, 64];
const G = [43, 47, 50, 55, 59, 67];
const D = [50, 57, 62, 66];

export const PRESETS = {
    triad: { name: 'C major triad', make: () => clip(2, (o) => [48, 52, 55].forEach((m) => pluck(o, m, 0.2, 1.6)), 'C major triad') },
    em: { name: 'E minor, six strings', make: () => clip(2.5, (o) => EM.forEach((m, i) => pluck(o, m, 0.2 + i * 0.012, 2.2, 0.1)), 'E minor strum') },
    melody: {
        name: 'Melody C D E G',
        make: () => clip(2.4, (o) => [60, 62, 64, 67].forEach((m, i) => pluck(o, m, 0.2 + i * 0.5, 0.5)), 'Melody'),
    },
    drum: {
        name: 'Drum hit over a held A3',
        make: () => clip(2, (o) => { pluck(o, 57, 0.2, 1.7); hit(o, 1, 0.08, 0.4, 7); }, 'Drum over A3'),
    },
    band: {
        name: 'Chords, bass and drums',
        make: () => clip(8.2, (o) => {
            [EM, C, G, D].forEach((chord, bar) => {
                const t = 0.2 + bar * 2;
                chord.forEach((m, i) => pluck(o, m, t + i * 0.012, 1.9, 0.07));
                pluck(o, chord[0] - 12, t, 0.9, 0.18);   // bass root, an octave below: under the guitar's range
                pluck(o, chord[chord.length - 1] + 12, t + 1, 0.45, 0.09);               // a melody note
                kick(o, t);
                kick(o, t + 1);
                for (let h = 0; h < 8; h++) hit(o, t + h * 0.25, 0.03, 0.06, 11 + bar * 8 + h);
                hit(o, t + 0.5, 0.12, 0.25, 101 + bar);
                hit(o, t + 1.5, 0.12, 0.25, 201 + bar);
            });
        }, 'Band'),
    },
};
