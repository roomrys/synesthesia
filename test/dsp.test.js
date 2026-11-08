import { test, assert, assertClose } from './runner.js';
import { resample, resampleFast, rms } from '../js/extract/dsp.js';
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

test('dsp: rms of silence is 0', () => {
    assert(rms(new Float32Array(100)) === 0);
});
