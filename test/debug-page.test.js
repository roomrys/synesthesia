// End-to-end: load debug/arrange.html in an iframe, run the pipeline on test
// clips and a generated WAV file, and check the views draw and steps are reused.

import { test, assert, assertEqual, assertClose } from './runner.js';
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
        await waitFor(() => frame.contentWindow.debugPage.state.derived?.synthSpec, 15000, 'the synthesised view');
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

test('debug page: crops and a draggable playhead, as on the note extractor', async () => {
    const { frame, doc } = await loadPage();
    const win = frame.contentWindow;
    try {
        const select = doc.getElementById('presetSelect');
        await runAndWait(doc, () => { select.value = 'triad'; select.dispatchEvent(new Event('change')); });
        await nextFrame(win);
        const { state } = win.debugPage;
        // The time crop starts fitted to the audio (the chord starts at 0.2 s; 50 ms padding).
        assert(Math.abs(state.crop.start - 0.15) < 0.03, `crop start ${state.crop.start}`);
        assertEqual(doc.getElementById('pitchDisplay').textContent, 'C3 – G3 (3 of 3)', 'pitch crop:');

        const canvas = doc.querySelector('canvas[data-view="original"]');
        const r = canvas.getBoundingClientRect();
        const xOf = (t) => r.left + 48 + ((t - state.view.t0) / (state.view.t1 - state.view.t0)) * (r.width - 48);
        const drag = (fromT, toT, y = r.top + 40) => {
            const ev = (type, t) => new win.PointerEvent(type, { clientX: xOf(t), clientY: y, pointerId: 1, bubbles: true });
            canvas.dispatchEvent(ev('pointerdown', fromT));
            canvas.dispatchEvent(ev('pointermove', (fromT + toT) / 2));
            canvas.dispatchEvent(ev('pointermove', toT));
            canvas.dispatchEvent(ev('pointerup', toT));
        };

        // Drag the playhead (at 0) to 1 s: it moves, and the view doesn't pan.
        const before = [state.view.t0, state.view.t1].join();
        drag(0, 1);
        assert(Math.abs(state.view.cursor - 1) < 0.02, `playhead ${state.view.cursor}`);
        assertEqual([state.view.t0, state.view.t1].join(), before, 'view panned:');
        assertEqual(doc.getElementById('timeDisplay').textContent, '0:01.0');

        // Drag the end of the time crop in to 1.5 s.
        drag(state.crop.end, 1.5);
        assert(Math.abs(state.crop.end - 1.5) < 0.02, `crop end ${state.crop.end}`);

        // [ sets the crop start at the playhead; Reset brings back the whole clip.
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: '[', bubbles: true }));
        assert(Math.abs(state.crop.start - 1) < 0.02, `crop start after [: ${state.crop.start}`);
        doc.getElementById('cropResetButton').click();
        assertEqual(state.crop.start, 0, 'reset start:');

        // Dragging the pitch crop's top handle down from G3 to E3 leaves two notes to play.
        const act = doc.querySelector('canvas[data-view="activations"]');
        const ar = act.getBoundingClientRect();
        const rowH = ar.height / state.derived.order.length;
        const rowTop = (midi) => ar.top + state.derived.rowOfMidi.get(midi) * rowH;
        const x = ar.left + 48 + (ar.width - 48) * 0.6;
        const ev = (type, y) => new win.PointerEvent(type, { clientX: x, clientY: y, pointerId: 2, bubbles: true });
        act.dispatchEvent(ev('pointerdown', rowTop(55)));
        act.dispatchEvent(ev('pointermove', rowTop(52) + rowH / 2));
        act.dispatchEvent(ev('pointerup', rowTop(52) + rowH / 2));
        assertEqual(doc.getElementById('pitchDisplay').textContent, 'C3 – E3 (2 of 3)', 'after dragging the top down:');
        doc.getElementById('pitchFitButton').click();
        assertEqual(doc.getElementById('pitchDisplay').textContent, 'C3 – G3 (3 of 3)', 'fit to notes:');
    } finally {
        frame.remove();
    }
});

test('debug page: guitar space and the residual have volume sliders, mixed with the song', async () => {
    const { frame, doc } = await loadPage();
    const win = frame.contentWindow;
    try {
        const select = doc.getElementById('presetSelect');
        await runAndWait(doc, () => { select.value = 'triad'; select.dispatchEvent(new Event('change')); });
        const { state } = win.debugPage;
        doc.getElementById('playButton').click();
        await waitFor(() => state.player?.playing, 15000, 'playback');
        assertEqual(state.player.stems.length, 0, 'no stems while their sliders are at 0:');

        const slide = (id, value) => {
            const el = doc.getElementById(id);
            el.value = String(value);
            el.dispatchEvent(new Event('input'));
        };
        slide('guitarVolume', 0.7);
        await waitFor(() => state.player.stems.length === 3, 15000, 'stems on the player');
        assert(state.player.playing, 'stopped playing when the stems were added');
        assertClose(state.player.trackGains[1].gain.value, 0.7, 1e-6, 'guitar space volume:');
        assertClose(state.player.trackGains[0].gain.value, 0.8, 1e-6, 'the song keeps its volume:');

        const energy = (x) => x.reduce((s, v) => s + v * v, 0) / x.length;
        const [guitar, residual, synth] = state.player.stems;
        const original = energy(state.clip.samples);
        assert(energy(guitar) > 0.5 * original, `guitar space keeps ${energy(guitar) / original} of a plucked chord`);
        assert(energy(residual) < energy(guitar), 'the residual is louder than guitar space for a plucked chord');
        const ratio = energy(synth) / original;
        assert(ratio > 0.25 && ratio < 4, `synthesised energy is ${ratio} of the original`);
        slide('synthVolume', 0.5);
        assertClose(state.player.trackGains[3].gain.value, 0.5, 1e-6, 'synthesised volume:');
        slide('synthVolume', 0);

        slide('guitarVolume', 0);
        await waitFor(() => state.player.stems.length === 0, 5000, 'stems dropped when both sliders are at 0');
        state.player.pause();
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
        const fileInput = doc.querySelector('#sourceButtons input[type="file"]');
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
        const fromFile = await runAndWait(doc, () => fileInput.dispatchEvent(new Event('change')));
        assert(/Notes: E4$/.test(fromFile), `file status: ${fromFile}`);

        doc.getElementById('clearButton').click();
        assertEqual(frame.contentWindow.debugPage.state.clip, null, 'clip after Clear:');
        assert(doc.getElementById('runButton').disabled, 'Run still enabled after Clear');
    } finally {
        frame.remove();
    }
});

test('debug page: offers the same audio sources as the note extractor', async () => {
    const { loadAll, getConfig } = await import('../js/extract/registry.js');
    const expected = (await loadAll('source', getConfig(''))).map((s) => s.id).join(',');
    const { frame, doc } = await loadPage();
    try {
        const ids = [...doc.querySelectorAll('#sourceButtons button')].map((b) => b.dataset.source).join(',');
        assert(expected.includes('file'), `expected sources: ${expected}`);
        assertEqual(ids, expected, 'sources:');
    } finally {
        frame.remove();
    }
});
