// End-to-end: load extract.html in an iframe, open a generated audio file,
// and check that notes are found, shown and playable.

import { test, assert, assertEqual, assertClose } from './runner.js';
import { sequence, wavBytes } from './signals.js';

function waitFor(check, timeoutMs = 15000, what = 'condition') {
    return new Promise((resolve, reject) => {
        const t0 = performance.now();
        const poll = () => {
            let value;
            try { value = check(); } catch { value = null; }
            if (value) return resolve(value);
            if (performance.now() - t0 > timeoutMs) return reject(new Error(`Timed out waiting for ${what}${waitFor.context ? ' — ' + waitFor.context() : ''}`));
            setTimeout(poll, 50);
        };
        poll();
    });
}

async function loadPage() {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width: 1200px; height: 900px; position: absolute; left: -10000px;';
    frame.src = '../extract.html?sources=file';
    document.body.append(frame);
    await waitFor(() => frame.contentDocument?.body?.dataset.ready === 'true', 15000, 'page ready');
    return { frame, doc: frame.contentDocument };
}

test('page: opening an audio file finds notes and enables playback and saving', async () => {
    const { frame, doc } = await loadPage();
    try {
        const status = doc.getElementById('audioStatus');
        assert(!status.classList.contains('error'), `page error: ${status.textContent}`);

        const melody = [{ seconds: 0.3 }, { midi: 64, seconds: 0.4 }, { midi: 67, seconds: 0.4 }, { midi: 71, seconds: 0.4 }, { seconds: 0.3 }];
        const file = new File([wavBytes(sequence(melody, 44100, { harmonics: [1, 0.5, 0.3] }), 44100)], 'test melody.wav', { type: 'audio/wav' });
        const input = doc.querySelector('#sourceButtons input[type="file"]');
        assert(input, 'no file input');
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change'));

        const notesStatus = doc.getElementById('notesStatus');
        waitFor.context = () => `status: "${notesStatus.textContent}"`;
        await waitFor(() => notesStatus.classList.contains('ok') || notesStatus.classList.contains('error'), 15000, 'extraction');
        assertEqual(notesStatus.textContent.match(/Found (\d+) notes/)?.[1], '3', `status: "${notesStatus.textContent}"`);
        assertEqual(doc.getElementById('titleInput').value, 'test-melody');
        assert(!doc.getElementById('saveButton').disabled, 'save disabled');
        assert(!doc.getElementById('playButton').disabled, 'play disabled');

        // Detector settings are rendered from the extractor's list.
        assert(!doc.getElementById('settingsPanel').hidden, 'settings panel hidden');
        assertEqual(doc.querySelectorAll('#settingsGrid input[type="range"]').length, 6, 'sliders:');

        // The time crop starts fitted to the audio: 0.3 s of silence at each end,
        // minus 50 ms padding at the start and plus 200 ms at the end.
        const { state } = frame.contentWindow.extractor;
        assertClose(state.crop.start, 0.25, 0.03, 'crop start:');
        assertClose(state.crop.end, 1.7, 0.03, 'crop end:');
        doc.getElementById('cropResetButton').click();
        assertClose(state.crop.start, 0, 1e-9, 'reset start:');
        doc.getElementById('cropFitButton').click();
        assertClose(state.crop.start, 0.25, 0.03, 'fit start:');

        // The pitch crop defaults to the detected range.
        const pitchDisplay = doc.getElementById('pitchDisplay');
        assertEqual(pitchDisplay.textContent, 'E4 – B4 (3 of 3)', 'pitch crop:');

        // Dragging the top pitch handle down to G4 keeps E4 and G4, without re-running detection.
        const { timeline, player } = frame.contentWindow.extractor;
        const canvas = doc.getElementById('timeline');
        const rect = canvas.getBoundingClientRect();
        const pointer = (type, x, y) => canvas.dispatchEvent(new frame.contentWindow.PointerEvent(type, {
            clientX: rect.left + x, clientY: rect.top + y, pointerId: 1, bubbles: true,
        }));
        const x = rect.width / 2;
        pointer('pointerdown', x, timeline.pitchCropTopY);
        pointer('pointermove', x, timeline.midiToY(67));   // top edge of the G4 row
        pointer('pointerup', x, timeline.midiToY(67));
        assertEqual(pitchDisplay.textContent, 'E4 – G4 (2 of 3)', 'after drag:');
        assertEqual(player.notes.length, 2, 'notes played:');

        // Re-detecting keeps a crop the user moved; Fit to notes restores the detected range.
        notesStatus.textContent = '';
        doc.getElementById('extractButton').click();
        await waitFor(() => /Found 3 notes/.test(notesStatus.textContent), 10000, 're-run');
        assertEqual(pitchDisplay.textContent, 'E4 – G4 (2 of 3)', 'crop after re-run:');
        doc.getElementById('pitchFitButton').click();
        assertEqual(pitchDisplay.textContent, 'E4 – B4 (3 of 3)', 'after fit:');

        // Changing a slider re-runs detection and marks the setting as changed.
        const slider = doc.querySelector('#settingsGrid input[type="range"]');
        notesStatus.textContent = '';
        slider.value = slider.max;
        slider.dispatchEvent(new Event('input'));
        slider.dispatchEvent(new Event('change'));
        await waitFor(() => /Found \d+ notes/.test(notesStatus.textContent), 10000, 're-run after slider change');
        assert(slider.closest('.setting').classList.contains('changed'), 'slider not marked as changed');

        // Reset restores defaults and re-runs.
        notesStatus.textContent = '';
        doc.getElementById('resetSettingsButton').click();
        await waitFor(() => /Found \d+ notes/.test(notesStatus.textContent), 10000, 're-run after reset');
        assert(!doc.querySelector('#settingsGrid .setting.changed'), 'settings still marked as changed after reset');

        // A debug layer is computed on demand and drawn behind the notes.
        const layerSelect = doc.getElementById('layerSelect');
        layerSelect.value = 'salience';
        layerSelect.dispatchEvent(new Event('change'));
        await waitFor(() => timeline.layer?.kind === 'salience', 10000, 'salience layer');
        assert(!doc.getElementById('layerHint').hidden, 'layer hint hidden');
        assert(!doc.getElementById('layerFloor').disabled, 'contrast disabled');
        layerSelect.value = '';
        layerSelect.dispatchEvent(new Event('change'));
        assertEqual(timeline.layer, null, 'layer after None:');

        // Edit mode: draw a D4 in the leading silence, move it, delete it, and undo.
        const editToggle = doc.getElementById('editToggle');
        assert(!editToggle.disabled, 'edit toggle disabled');
        editToggle.click();
        assert(timeline.editing, 'timeline not in edit mode');
        const row = (midi) => timeline.midiToY(midi) + timeline.rowHeight / 2;
        pointer('pointerdown', timeline.timeToX(0.02), row(62));
        pointer('pointermove', timeline.timeToX(0.1), row(62));
        pointer('pointermove', timeline.timeToX(0.2), row(62));
        pointer('pointerup', timeline.timeToX(0.2), row(62));
        const notes = () => state.noteSet.notes;
        assertEqual(notes().length, 4, 'notes after drawing:');
        assertEqual(notes()[0].midi, 62, 'drawn pitch:');
        assertClose(notes()[0].duration, 0.18, 0.02, 'drawn length:');
        assertEqual(pitchDisplay.textContent, 'D4 – B4 (4 of 4)', 'pitch crop grows to keep the new note:');
        assertEqual(player.notes.length, 4, 'notes played after drawing:');

        // Drag the middle of the note up one row (to D#4).
        const mid = timeline.timeToX(0.11);
        pointer('pointerdown', mid, row(62));
        pointer('pointermove', mid, row(63));
        pointer('pointerup', mid, row(63));
        assertEqual(notes()[0].midi, 63, 'moved pitch:');
        assertClose(notes()[0].start, 0.02, 0.02, 'moved start:');

        const key = (k, extra = {}) => doc.body.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
        key('Backspace');
        assertEqual(notes().length, 3, 'notes after delete:');
        doc.getElementById('undoButton').click();
        assertEqual(notes().length, 4, 'notes after undo:');
        assertEqual(notes()[0].midi, 63, 'undo restores the moved note:');
        key('z', { metaKey: true });
        assertEqual(notes()[0].midi, 62, 'second undo restores the pitch:');
        key('z', { metaKey: true, shiftKey: true });
        assertEqual(notes()[0].midi, 63, 'redo:');
        key('e');
        assert(!timeline.editing, 'E should leave edit mode');

        doc.getElementById('playButton').click();
        await waitFor(() => doc.getElementById('playButton').textContent.includes('Pause'), 3000, 'playing');
        await new Promise((r) => setTimeout(r, 300));
        const shown = doc.getElementById('timeDisplay').textContent;
        assert(shown !== '0:00.0', `time display did not move (${shown})`);
        doc.getElementById('playButton').click();
        await waitFor(() => doc.getElementById('playButton').textContent.includes('Play'), 3000, 'paused');
    } finally {
        frame.remove();
    }
});
