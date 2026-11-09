import { test, assert, assertClose } from './runner.js';
import { findAudibleRange, resample, resampleFast, rms } from '../js/extract/dsp.js';
import { sequence } from './signals.js';

function zeroCrossingHz(x, sr) {
    let crossings = 0;
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
    return crossings / (x.length / sr);
}

for (const [name, fn] of [['resample (JS)', resample], ['resampleFast', resampleFast]]) {
    test(`dsp: ${name} keeps pitch and length`, async () => {
        const x = sequence([{ midi: 69, seconds: 1 }], 44100);
        const y = await fn(x, 44100, 16000);
        assertClose(y.length, 16000, 2);
        assertClose(zeroCrossingHz(y, 16000), 440, 3);
        assertClose(rms(y), rms(x), 0.02);
    });
}

test('dsp: audible range skips leading and trailing silence, with padding', () => {
    const x = sequence([{ seconds: 2 }, { midi: 69, seconds: 1 }, { seconds: 0.5 }, { midi: 72, seconds: 1 }, { seconds: 3 }], 48000, { noise: 0.0005 });
    const range = findAudibleRange(x, 48000);
    assertClose(range.start, 2 - 0.05, 0.03, 'start');
    assertClose(range.end, 4.5 + 0.2, 0.03, 'end');
});

test('dsp: audible range of silence is null; padding stays inside the clip', () => {
    assert(findAudibleRange(new Float32Array(48000), 48000) === null, 'silence should be null');
    const x = sequence([{ midi: 69, seconds: 1 }], 48000);
    const range = findAudibleRange(x, 48000);
    assertClose(range.start, 0, 1e-9, 'start');
    assertClose(range.end, 1, 1e-9, 'end');
});

test('dsp: rms of silence is 0', () => {
    assert(rms(new Float32Array(100)) === 0);
});
