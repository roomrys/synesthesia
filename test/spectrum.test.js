import { test, assert, assertEqual } from './runner.js';
import { computeLayers, fft } from '../js/extract/spectrum.js';
import { sequence } from './signals.js';

const HARMONICS = [1, 0.6, 0.4, 0.3, 0.2];

/** Sum several tones (a chord) of the same length. */
function chord(midis, seconds, sampleRate) {
    const parts = midis.map((midi) => sequence([{ midi, seconds }], sampleRate, { harmonics: HARMONICS, amplitude: 0.3 }));
    const out = new Float32Array(parts[0].length);
    for (const p of parts) for (let i = 0; i < out.length; i++) out[i] += p[i];
    return out;
}

/** Values of one layer at one frame, one per semitone (the centre bin of each row). */
function rowValues(layers, kind, frame) {
    const { bins, binsPerSemitone: bps, minMidi } = layers;
    const rows = new Map();
    for (let m = minMidi; m <= layers.maxMidi; m++) {
        let v = 0;
        for (let b = 0; b < bps; b++) v = Math.max(v, layers[kind][frame * bins + (m - minMidi) * bps + b]);
        rows.set(m, v);
    }
    return rows;
}

/** Rows that are louder than both neighbours, loudest first. */
function peakRows(rows) {
    return [...rows].filter(([m, v]) => v > (rows.get(m - 1) ?? 0) && v >= (rows.get(m + 1) ?? 0))
        .sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

test('spectrum: fft finds a sine at its bin', () => {
    const n = 64;
    const re = Float32Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n));
    const im = new Float32Array(n);
    fft(re, im);
    const mags = [...re].map((r, i) => Math.hypot(r, im[i]));
    assertEqual(mags.indexOf(Math.max(...mags.slice(0, n / 2))), 5, 'peak bin:');
    assert(Math.abs(mags[5] - n / 2) < 1e-3, `magnitude ${mags[5]}`);
});

test('spectrum: one note shows its overtones; the harmonic sum puts it on its own row', async () => {
    const x = sequence([{ midi: 57, seconds: 1 }], 44100, { harmonics: HARMONICS });
    const layers = await computeLayers(x, 44100);
    const frame = Math.round(0.5 / layers.hopSeconds);
    const spec = rowValues(layers, 'spectrogram', frame);
    for (const overtone of [57, 69, 76, 81]) assert(spec.get(overtone) > 200, `no energy at ${overtone}: ${spec.get(overtone)}`);
    assertEqual(peakRows(rowValues(layers, 'salience', frame))[0], 57, 'strongest salience row:');
});

test('spectrum: a C major chord shows C, E and G in the harmonic sum', async () => {
    const layers = await computeLayers(chord([48, 52, 55], 1, 44100), 44100);
    const frame = Math.round(0.5 / layers.hopSeconds);
    const top = peakRows(rowValues(layers, 'salience', frame)).slice(0, 3).sort((a, b) => a - b);
    assertEqual(top.join(','), '48,52,55', 'top salience rows:');
});

test('spectrum: long clips use a coarser hop', async () => {
    const layers = await computeLayers(new Float32Array(16000 * 10), 16000, { maxFrames: 100 });
    assert(layers.frames <= 101, `frames ${layers.frames}`);
    assert(layers.hopSeconds >= 0.1 - 1e-9, `hop ${layers.hopSeconds}`);
});

test('spectrum: onsets find note starts (including a repeated note) but not note ends', async () => {
    const segments = [{ seconds: 0.5 }, { midi: 64, seconds: 0.4 }, { midi: 67, seconds: 0.3 }, { midi: 67, seconds: 0.3 },
        { seconds: 0.2 }, { midi: 52, seconds: 0.5 }, { midi: 71, seconds: 0.25 }, { seconds: 0.5 }];
    const layers = await computeLayers(sequence(segments, 44100, { harmonics: [1, 0.6, 0.4, 0.3] }), 44100);
    const starts = [0.5, 0.9, 1.2, 1.7, 2.2];
    assertEqual(layers.onsets.length, starts.length, `onsets ${JSON.stringify(layers.onsets)}:`);
    layers.onsets.forEach((t, i) => assert(Math.abs(t - starts[i]) <= 0.03, `onset ${i}: ${t} vs ${starts[i]}`));
});
