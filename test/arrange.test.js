// The arrangement pipeline (js/extract/arrange): one contract suite per step
// interface, run against every registered implementation, then the pipeline.
// The extractor contract tests (extractors.test.js) also run on `arrange`.

import { test, assert, assertEqual, assertClose } from './runner.js';
import { registry, loadStep } from '../js/extract/arrange/registry.js';
import { runPipeline, stepOptions, resolveEnsemble } from '../js/extract/arrange/pipeline.js';
import { buildDictionary } from '../js/extract/arrange/dictionary.js';
import { stepsOf } from '../js/extract/arrange/multiplexers/greedy.js';
import arrange from '../js/extract/extractors/arrange.js';
import { midiToHz } from '../js/extract/music.js';
import { sequence, clipOf } from './signals.js';

const GUITARISH = [1, 0.6, 0.4, 0.25, 0.15];
const RATE = 16000;
const ids = (kind) => Object.keys(registry[kind]);
const argmax = (a) => a.reduce((m, v, i) => (v > a[m] ? i : m), 0);
const nearestBin = (hz, axis) => argmax(Array.from(axis, (h) => -Math.abs(Math.log(h / hz))));

function mix(...parts) {
    const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
    for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
    return out;
}
const tone = (midi, at, seconds, amplitude = 0.2) => sequence([{ seconds: at }, { midi, seconds }], RATE, { harmonics: GUITARISH, amplitude });
const midis = (notes) => notes.map((n) => n.midi).sort((a, b) => a - b).join(',');

/** A spectrogram, ensemble and dictionary from the default representation, for testing later steps. */
async function setup(samples) {
    const rep = await loadStep('representation', arrange.defaults.representation);
    const spectrogram = await rep.analyse(clipOf(samples, RATE), { options: rep.defaults });
    const ensemble = await resolveEnsemble(arrange.defaults.ensemble);
    const dictionary = buildDictionary(ensemble, { hz: spectrogram.hz, kernel: (hz) => rep.kernel(hz, { options: rep.defaults }) });
    return { spectrogram, ensemble, dictionary };
}

// ----- Representation -----

for (const id of ids('representation')) {
    test(`arrange representation ${id}: a 440 Hz tone peaks at 440 Hz, like its kernel`, async () => {
        const impl = await loadStep('representation', id);
        const spec = await impl.analyse(clipOf(sequence([{ midi: 69, seconds: 1 }], RATE), RATE), { options: impl.defaults });
        const frame = spec.frames[Math.round(0.5 / spec.hopSeconds)];
        assertEqual(argmax(frame), nearestBin(440, spec.hz), 'peak bin:');
        assertClose(Math.max(...frame), 0.5, 0.1, 'a 0.5 amplitude sine reads about 0.5:');
        assertEqual(argmax(impl.kernel(440, { options: impl.defaults })), nearestBin(440, spec.hz), 'kernel peak:');
        assertClose(spec.frames.length * spec.hopSeconds, 1, 0.05, 'frames cover the clip:');
        for (const f of spec.frames) for (const v of f) assert(v >= 0, 'negative magnitude');
    });
}

for (const id of ids('representation')) {
    test(`arrange representation ${id}: resynthesising with a mask of ones gives the clip back, and guitar + residual add up`, async () => {
        const impl = await loadStep('representation', id);
        if (!impl.resynthesize) return;   // optional
        const samples = sequence([{ seconds: 0.1 }, { midi: 57, seconds: 0.6 }, { seconds: 0.1 }], RATE, { harmonics: GUITARISH });
        const clip = clipOf(samples, RATE);
        const spec = await impl.analyse(clip, { options: impl.defaults });
        const ones = spec.frames.map((f) => new Float32Array(f.length).fill(1));
        const back = await impl.resynthesize(clip, ones, { options: impl.defaults });
        assertEqual(back.length, samples.length, 'length:');
        let err = 0, energy = 0;
        for (let i = 0; i < samples.length; i++) { err += (back[i] - samples[i]) ** 2; energy += samples[i] ** 2; }
        assert(err / energy < 1e-6, `relative error ${err / energy}`);

        // Half and half: the two parts add up to the clip.
        const halves = spec.frames.map((f) => new Float32Array(f.length).fill(0.5));
        const half = await impl.resynthesize(clip, halves, { options: impl.defaults });
        let diff = 0;
        for (let i = 0; i < samples.length; i++) diff += (2 * half[i] - samples[i]) ** 2;
        assert(diff / energy < 1e-6, `halves don't add up: ${diff / energy}`);
    });
}

// ----- Rhythm -----

for (const id of ids('rhythm')) {
    test(`arrange rhythm ${id}: onsets at note starts`, async () => {
        const impl = await loadStep('rhythm', id);
        const samples = sequence([{ seconds: 0.3 }, { midi: 60, seconds: 0.5 }, { midi: 64, seconds: 0.5 }], RATE, { harmonics: GUITARISH });
        const { spectrogram } = await setup(samples);
        const { onsets } = await impl.analyse(clipOf(samples, RATE), spectrogram, { options: impl.defaults });
        assertEqual(onsets.length, 2, `onsets ${JSON.stringify(onsets)}:`);
        [0.3, 0.8].forEach((t, i) => assertClose(onsets[i], t, 0.03, `onset ${i}`));
    });
}

// ----- Instrument -----

for (const id of ids('instrument')) {
    test(`arrange instrument ${id}: every sound can be played alone, with finite costs`, async () => {
        const impl = await loadStep('instrument', id);
        const sounds = impl.sounds(impl.defaults);
        assert(sounds.length > 0, 'no sounds');
        const keys = sounds.map((s) => JSON.stringify(s));
        assertEqual(new Set(keys).size, keys.length, 'sounds are unique:');
        let prev = null;
        for (const s of sounds) {
            const states = impl.playability.states([s], impl.defaults);
            assert(states.length > 0, `can't play ${JSON.stringify(s)}`);
            assert(Number.isFinite(impl.playability.cost(states[0], impl.defaults)), 'cost');
            if (prev) assert(impl.playability.transition(prev, states[0], 0, impl.defaults) >= 0, 'transition');
            prev = states[0];
        }
    });
}

test('arrange instrument guitar: six notes of an E minor chord fit on six strings, seven notes don\'t', async () => {
    const guitar = await loadStep('instrument', 'guitar');
    const em = [40, 47, 52, 55, 59, 64].map((midi) => ({ midi }));
    const states = guitar.playability.states(em, guitar.defaults);
    assert(states.length > 0, 'E minor unplayable');
    const strings = states[0].fingering.chosen.map((p) => p.string);
    assertEqual(new Set(strings).size, 6, 'six different strings:');
    assertEqual(guitar.playability.states([...em, { midi: 67 }], guitar.defaults).length, 0, 'seven notes:');
    assertEqual(guitar.playability.states([{ midi: 30 }], guitar.defaults).length, 0, 'below the low E:');
});

// ----- Timbre and dictionary -----

for (const id of ids('timbre')) {
    test(`arrange timbre ${id}: templates are non-negative and pitched ones peak at their pitch`, async () => {
        const timbre = await loadStep('timbre', id);
        const { spectrogram, ensemble } = await setup(new Float32Array(RATE));
        const rep = await loadStep('representation', arrange.defaults.representation);
        const axis = { hz: spectrogram.hz, kernel: (hz) => rep.kernel(hz, { options: rep.defaults }) };
        const member = { ...ensemble[0], timbre, profile: { timbre: id, instrument: ensemble[0].instrument.id, name: 'test', params: timbre.defaults } };
        for (const sound of member.instrument.sounds(member.options)) {
            const t = timbre.render(member, sound, axis);
            assertEqual(t.length, axis.hz.length, 'length:');
            for (const v of t) assert(v >= 0, `negative value for ${JSON.stringify(sound)}`);
            // Within one bin (a third of a semitone): below about C3 the analysis window is coarser than the axis.
            if ('midi' in sound) assertClose(argmax(t), nearestBin(midiToHz(sound.midi), axis.hz), 1, `peak of ${sound.midi}:`);
        }
    });
}

test('arrange dictionary: one unit-length column per sound, labelled', async () => {
    const { dictionary, ensemble } = await setup(new Float32Array(RATE));
    assertEqual(dictionary.columns.length, ensemble[0].instrument.sounds(ensemble[0].options).length);
    assertEqual(dictionary.labels.length, dictionary.columns.length);
    for (const c of dictionary.columns) assertClose(Math.hypot(...c), 1, 1e-4, 'norm');
});

// ----- Projector -----

for (const id of ids('projector')) {
    test(`arrange projector ${id}: a mix of two templates comes back as those two`, async () => {
        const impl = await loadStep('projector', id);
        const { dictionary } = await setup(new Float32Array(RATE));
        const a = dictionary.labels.findIndex((l) => l.sound.midi === 48);
        const b = dictionary.labels.findIndex((l) => l.sound.midi === 55);
        const frame = dictionary.columns[a].map((v, i) => 0.7 * v + 0.3 * dictionary.columns[b][i]);
        const spectrogram = { hopSeconds: 0.01, hz: dictionary.hz, frames: [frame, new Float32Array(frame.length)] };
        const { activations } = await impl.project(spectrogram, dictionary, { options: { ...impl.defaults, sparsity: 0 } });
        assertClose(activations.values[a][0], 0.7, 0.03, 'first:');
        assertClose(activations.values[b][0], 0.3, 0.03, 'second:');
        const rest = activations.values.reduce((s, v, j) => s + (j === a || j === b ? 0 : v[0]), 0);
        assert(rest < 0.05, `others add up to ${rest}`);
        for (const v of activations.values) assert(v[0] >= 0 && v[1] === 0, 'negative, or not zero in silence');
    });

    test(`arrange projector ${id}: a noise burst lands on the percussive sounds, not on pitches`, async () => {
        const impl = await loadStep('projector', id);
        let seed = 7;
        const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
        const burst = new Float32Array(RATE);
        for (let i = 6000; i < 7000; i++) burst[i] = 0.5 * random();
        const { spectrogram, dictionary } = await setup(burst);
        const { activations } = await impl.project(spectrogram, dictionary, { options: impl.defaults });
        const f = Math.round(0.41 / spectrogram.hopSeconds);
        let pitched = 0, percussive = 0;
        dictionary.labels.forEach((l, j) => { if ('midi' in l.sound) pitched += activations.values[j][f]; else percussive += activations.values[j][f]; });
        assert(percussive > pitched, `percussive ${percussive} vs pitched ${pitched}`);
    });
}

// ----- Picker -----

for (const id of ids('picker')) {
    test(`arrange picker ${id}: candidates start at onsets and end when the sound fades`, async () => {
        const impl = await loadStep('picker', id);
        const { dictionary } = await setup(new Float32Array(RATE));
        const hop = 0.01;
        const values = dictionary.columns.map(() => new Float32Array(200));
        const col = dictionary.labels.findIndex((l) => l.sound.midi === 60);
        for (let f = 50; f < 120; f++) values[col][f] = 0.3;   // 0.5 to 1.2 s
        const candidates = impl.pick({ hopSeconds: hop, values }, dictionary, { rhythm: { onsets: [0.5], beats: [], bars: [] }, options: impl.defaults });
        assertEqual(candidates.length, 1, 'candidates:');
        assertEqual(candidates[0].sound.midi, 60);
        assertClose(candidates[0].start, 0.5, 1e-9, 'start:');
        assertClose(candidates[0].duration, 0.7, 0.02, 'duration:');
    });
}

// ----- Layers, objective, multiplexer -----

async function stage1On(samples) {
    return (await runPipeline(clipOf(samples, RATE), { ...arrange.defaults }, { trace: true })).trace;
}

for (const id of ids('layers')) {
    test(`arrange layers ${id}: every candidate belongs to a layer`, async () => {
        const impl = await loadStep('layers', id);
        const t = await stage1On(mix(tone(48, 0.2, 0.6), tone(55, 0.2, 0.6)));
        const layers = impl.find(t.candidates, { rhythm: t.rhythm, activations: t.activations, ensemble: t.ensemble, options: impl.defaults });
        t.candidates.forEach((_, k) => assert(layers.some((l) => (l.members.get(k) ?? 0) > 0), `candidate ${k} in no layer`));
    });
}

for (const id of ids('objective')) {
    test(`arrange objective ${id}: nothing chosen scores 0, and adding the real note scores more`, async () => {
        const impl = await loadStep('objective', id);
        const t = await stage1On(tone(57, 0.2, 0.8));
        const context = impl.prepare(t.candidates, t.layers, { spectrogram: t.spectrogram, activations: t.activations, dictionary: t.dictionary, options: impl.defaults });
        const step = stepsOf(t.candidates).find((s) => s.candidates.some((c) => c.sound.midi === 57));
        const note = step.candidates.find((c) => c.sound.midi === 57);
        assertEqual(impl.score([], step, context), 0, 'empty:');
        assert(impl.score([note], step, context) > 0.5, `A3 explains ${impl.score([note], step, context)}`);
    });
}

for (const id of ids('multiplexer')) {
    test(`arrange multiplexer ${id}: everything chosen is playable together`, async () => {
        const impl = await loadStep('multiplexer', id);
        const t = await stage1On(mix(...[40, 47, 52, 55, 59, 64, 67].map((m) => tone(m, 0.2, 0.8, 0.1))));
        const objective = await loadStep('objective', arrange.defaults.objective);
        const choices = impl.choose(t.candidates, { layers: t.layers, objective, context: t.context, ensemble: t.ensemble, options: impl.defaults });
        assert(choices.length > 0, 'nothing chosen');
        for (const step of stepsOf(choices.map((c) => c.candidate))) {
            const sounds = step.candidates.map((c) => c.sound);
            const member = t.ensemble[0];
            assert(member.instrument.playability.states(sounds, member.options).length > 0, `unplayable at ${step.start}: ${JSON.stringify(sounds)}`);
        }
        for (const c of choices) assert(c.state !== undefined, 'choice without a state');
    });
}

// ----- The pipeline -----

test('arrange pipeline: step options come from prefixed keys over the defaults', () => {
    const impl = { defaults: { a: 1, b: 2 } };
    const o = stepOptions({ 'projector.a': 5, 'picker.b': 9, projector: 'nnls' }, 'projector', impl);
    assertEqual(JSON.stringify(o), JSON.stringify({ a: 5, b: 2 }));
});

test('arrange pipeline: ensemble members get unique labels', async () => {
    const members = await resolveEnsemble([{ instrument: 'guitar' }, { instrument: 'guitar' }]);
    assertEqual(members.map((m) => m.label).join('|'), 'guitar|guitar 2');
    assertEqual(members[0].profile.timbre, 'harmonic');
});

test('arrange pipeline: chords come out whole', async () => {
    const run = async (samples) => (await runPipeline(clipOf(samples, RATE), { ...arrange.defaults })).notes;
    assertEqual(midis(await run(mix(tone(48, 0.2, 1), tone(52, 0.2, 1), tone(55, 0.2, 1)))), '48,52,55', 'C major:');
    const em = [40, 47, 52, 55, 59, 64];
    assertEqual(midis(await run(mix(...em.map((m) => tone(m, 0.2, 1.2, 0.12))))), em.join(','), 'E minor on six strings:');
});

test('arrange pipeline: a drum hit over a held note is percussive, not a new note', async () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const burst = new Float32Array(RATE * 2);
    for (let i = RATE; i < RATE + 800; i++) burst[i] = 0.5 * random() * (1 - (i - RATE) / 800);
    const { notes, trace } = await runPipeline(clipOf(mix(tone(57, 0.2, 1.6), burst), RATE), { ...arrange.defaults }, { trace: true });
    assertEqual(midis(notes), '57', 'notes:');
    assert(trace.choices.some((c) => c.candidate.sound.technique), 'no percussive choice in the trace');
    assertEqual(notes[0].part, 'guitar', 'part:');
});

test('arrange pipeline: the trace has every step', async () => {
    const { trace } = await runPipeline(clipOf(tone(60, 0.1, 0.4), RATE), { ...arrange.defaults }, { trace: true });
    for (const key of ['spectrogram', 'rhythm', 'ensemble', 'dictionary', 'activations', 'candidates', 'layers', 'context', 'choices']) {
        assert(trace[key] !== undefined, `trace.${key} missing`);
    }
});
