// End-to-end: load debug/arrange.html in an iframe, run the pipeline on test
// clips and a generated WAV file, and check the views draw and steps are reused.

import { test, assert, assertEqual } from './runner.js';
import { sequence, wavBytes } from './signals.js';

function waitFor(check, timeoutMs = 20000, what = 'condition') {
    return new Promise((resolve, reject) => {
        const t0 = performance.now();
        const poll = () => {
            let value;
            try { value = check(); } catch { value = null; }
            if (value) return resolve(value);
            if (performance.now() - t0 > timeoutMs) return reject(new Error(`Timed out waiting for ${what}`));
            setTimeout(poll, 50);
        };
        poll();
    });
}

async function loadPage() {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width: 1200px; height: 1400px; position: absolute; left: -10000px;';
    frame.src = '../debug/arrange.html';
    document.body.append(frame);
    await waitFor(() => frame.contentDocument?.body?.dataset.ready === 'true', 15000, 'page ready');
    return { frame, doc: frame.contentDocument };
}

/** Wait for the next run to finish, after `start()` kicks it off. */
async function runAndWait(doc, start) {
    doc.body.dataset.run = '';
    start();
    await waitFor(() => ['done', 'error'].includes(doc.body.dataset.run), 20000, 'run');
    const status = doc.getElementById('runStatus');
    assertEqual(doc.body.dataset.run, 'done', `run failed: ${status.textContent}`);
    return status.textContent;
}

/** True if the canvas has any pixel that isn't black. */
function hasContent(canvas) {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 30) return true;
    return false;
}

const nextFrame = (win) => new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));

test('debug page: a test chord runs, every view draws, and the slice explains a clicked moment', async () => {
    const { frame, doc } = await loadPage();
    try {
        assertEqual(doc.querySelectorAll('.step-box').length, 8, 'step boxes (7 steps and the ensemble):');
        const select = doc.getElementById('presetSelect');
        const status = await runAndWait(doc, () => { select.value = 'triad'; select.dispatchEvent(new Event('change')); });
        assert(/Notes: C3 E3 G3$/.test(status), `status: ${status}`);
        await nextFrame(frame.contentWindow);
        for (const canvas of doc.querySelectorAll('#plots canvas')) {
            assert(canvas.width > 0 && canvas.height > 0, `${canvas.dataset.view} has no size`);
            assert(hasContent(canvas), `${canvas.dataset.view} is blank`);
        }

        // Click the middle of the activations plot: the slice shows that frame.
        const act = doc.querySelector('canvas[data-view="activations"]');
        const r = act.getBoundingClientRect();
        const at = { clientX: r.left + 48 + (r.width - 48) * 0.4, clientY: r.top + 20, pointerId: 1, bubbles: true };
        act.dispatchEvent(new frame.contentWindow.PointerEvent('pointerdown', at));
        act.dispatchEvent(new frame.contentWindow.PointerEvent('pointerup', at));
        await nextFrame(frame.contentWindow);
        const legend = doc.getElementById('sliceLegend').textContent;
        assert(/guitar space · explains \d+%/.test(legend), `legend: ${legend}`);
        assert(/C3/.test(legend) && /E3/.test(legend) && /G3/.test(legend), `legend lacks the chord: ${legend}`);
    } finally {
        frame.remove();
    }
});

test('debug page: changing a late step reuses the analysis; an audio file runs too', async () => {
    const { frame, doc } = await loadPage();
    try {
        const select = doc.getElementById('presetSelect');
        await runAndWait(doc, () => { select.value = 'em'; select.dispatchEvent(new Event('change')); });
        const input = [...doc.querySelectorAll('.step-box[data-step="multiplexer"] .opt')]
            .find((row) => row.textContent.includes('Notes at once')).querySelector('input');
        const status = await runAndWait(doc, () => { input.value = '3'; input.dispatchEvent(new Event('change')); });
        assertEqual(status.match(/Notes: (.*)$/)[1].split(' ').length, 3, `three notes: ${status}`);
        const timings = doc.getElementById('timings').textContent;
        assert(/analysis reused/.test(timings) && /projector reused/.test(timings), `timings: ${timings}`);

        const file = new File([wavBytes(sequence([{ seconds: 0.2 }, { midi: 64, seconds: 0.5 }], 44100, { harmonics: [1, 0.5, 0.3] }), 44100)], 'e4.wav', { type: 'audio/wav' });
        const fileInput = doc.getElementById('fileInput');
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
        const fromFile = await runAndWait(doc, () => fileInput.dispatchEvent(new Event('change')));
        assert(/Notes: E4$/.test(fromFile), `file status: ${fromFile}`);
    } finally {
        frame.remove();
    }
});
