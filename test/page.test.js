// End-to-end: load extract.html in an iframe, open a generated audio file,
// and check that notes are found, shown and playable.

import { test, assert, assertEqual } from './runner.js';
import { sequence, wavBytes } from './signals.js';

function waitFor(check, timeoutMs = 15000, what = 'condition') {
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
        await waitFor(() => notesStatus.classList.contains('ok') || notesStatus.classList.contains('error'), 15000, 'extraction');
        assertEqual(notesStatus.textContent.match(/Found (\d+) notes/)?.[1], '3', `status: "${notesStatus.textContent}"`);
        assertEqual(doc.getElementById('titleInput').value, 'test-melody');
        assert(!doc.getElementById('saveButton').disabled, 'save disabled');
        assert(!doc.getElementById('playButton').disabled, 'play disabled');

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
