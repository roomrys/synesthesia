// Contract tests: every voice must make sound for a scheduled note, and only then.

import { test, assert } from './runner.js';
import { registry, loadImpl } from '../js/extract/registry.js';
import { rms } from '../js/extract/dsp.js';

for (const id of Object.keys(registry.voice)) {
    test(`voice ${id}: plays a scheduled note at the right time`, async () => {
        const sr = 44100;
        const ctx = new OfflineAudioContext(1, sr * 1, sr);
        const voice = await (await loadImpl('voice', id)).create(ctx, ctx.destination);
        voice.scheduleNote({ midi: 69, start: 0, duration: 0.3, velocity: 0.8 }, 0.4);
        const out = (await ctx.startRendering()).getChannelData(0);
        voice.dispose();
        const before = rms(out, 0, sr * 0.35);
        const during = rms(out, sr * 0.45, sr * 0.2);
        assert(before < 1e-4, `sound before the note (rms ${before})`);
        assert(during > 0.01, `no sound during the note (rms ${during})`);
    });

    test(`voice ${id}: plays overlapping notes (chords)`, async () => {
        const sr = 44100;
        const ctx = new OfflineAudioContext(1, sr * 0.5, sr);
        const voice = await (await loadImpl('voice', id)).create(ctx, ctx.destination);
        for (const midi of [60, 64, 67]) voice.scheduleNote({ midi, start: 0, duration: 0.3, velocity: 0.8 }, 0.05);
        const chord = (await ctx.startRendering()).getChannelData(0);
        voice.dispose();

        const ctx1 = new OfflineAudioContext(1, sr * 0.5, sr);
        const voice1 = await (await loadImpl('voice', id)).create(ctx1, ctx1.destination);
        voice1.scheduleNote({ midi: 60, start: 0, duration: 0.3, velocity: 0.8 }, 0.05);
        const single = (await ctx1.startRendering()).getChannelData(0);
        voice1.dispose();

        const ratio = rms(chord, sr * 0.1, sr * 0.1) / rms(single, sr * 0.1, sr * 0.1);
        assert(ratio > 1.3, `chord should be louder than one note (ratio ${ratio.toFixed(2)})`);
    });
}
