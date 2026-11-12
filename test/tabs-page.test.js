// End to end: load tabs.html in an iframe, give it notes, and change positions by hand.

import { test, assert, assertEqual } from './runner.js';

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

const note = (midi, start, duration = 0.4) => ({ midi, start, duration, velocity: 0.8 });

test('tabs page: places notes, moves one by hand, types a fret, undoes, crops, loops, saves the crop', async () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width: 1200px; height: 900px; position: absolute; left: -10000px;';
    frame.src = '../tabs.html';
    document.body.append(frame);
    try {
        await waitFor(() => frame.contentDocument?.body?.dataset.ready === 'true', 15000, 'page ready');
        const doc = frame.contentDocument;
        const { state, view, loadNotes, codecs } = frame.contentWindow.tabs;

        // Through the MIDI codec, as if a .mid file was opened: a melody, a chord, and a note too low to play.
        const notes = [note(64, 0), note(67, 0.5), note(69, 1), ...[45, 52, 57, 60, 64].map((m) => note(m, 1.5, 1)), note(30, 2.6)];
        const midiBytes = await codecs.midi.encode({ notes }, { title: 'riff', duration: 3 }).arrayBuffer();
        const { noteSet, meta } = codecs.midi.decode(midiBytes);
        loadNotes(noteSet, meta, 'riff.mid');
        const status = doc.getElementById('status');
        assertEqual(status.textContent, "8 notes placed, 1 the guitar can't play (in red at the bottom).", 'status:');
        assertEqual(doc.getElementById('titleInput').value, 'riff', 'title:');

        // Click a ghost: move the first note (E4) to another string.
        const canvas = doc.getElementById('tab');
        const rect = canvas.getBoundingClientRect();
        const pointer = (type, x, y) => canvas.dispatchEvent(new frame.contentWindow.PointerEvent(type, {
            clientX: rect.left + x, clientY: rect.top + y, pointerId: 1, bubbles: true, button: 0,
        }));
        const e4 = state.notes.find((n) => n.start === 0);
        const box = view.boxAt(e4.string, e4.fret, e4.start);
        pointer('pointermove', box.x + 4, box.y + 4);
        assertEqual(view.hover, e4, 'hovered note:');
        const ghost = view.ghostsFor(e4).find((g) => g.string === 2);
        assert(ghost, 'no ghost on the B string');
        const gb = view.boxAt(ghost.string, ghost.fret, e4.start);
        pointer('pointermove', gb.x + 4, gb.y + 4);
        pointer('pointerdown', gb.x + 4, gb.y + 4);
        pointer('pointerup', gb.x + 4, gb.y + 4);
        const moved = state.notes.find((n) => n.start === 0);
        assertEqual(`${moved.string}/${moved.fret}/${moved.fixed}`, '2/5/true', 'E4 on the B string, fixed:');

        // Type a fret: the selected note stays on its string and changes pitch.
        assertEqual(view.selected?.start, 0, 'selection kept:');
        const key = (k, extra = {}) => doc.body.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
        key('7');
        const typed = state.notes.find((n) => n.start === 0);
        assertEqual(`${typed.string}/${typed.fret}/${typed.midi}`, '2/7/66', 'typed fret 7 on the B string = F#4:');

        // Undo twice: back to the converter's choice.
        key('z', { metaKey: true });
        key('z', { metaKey: true });
        const back = state.notes.find((n) => n.start === 0);
        assertEqual(`${back.midi}/${back.fixed}`, '64/false', 'after undo:');

        // Chord notes are on different strings.
        const chord = state.notes.filter((n) => n.start === 1.5);
        assertEqual(new Set(chord.map((n) => n.string)).size, 5, 'chord strings:');

        // Placing again with the same settings moves nothing, and says so.
        doc.getElementById('placeButton').click();
        assert(status.textContent.startsWith('Placed again: nothing moved'), `status: ${status.textContent}`);

        // Drag the yellow crop handles (from the ends of the strip at the top) to crop 0.5 – 1.0 s.
        const { player } = frame.contentWindow.tabs;
        const ox = (t) => view.overviewTimeToX(t);
        pointer('pointerdown', ox(view.duration), 10);
        pointer('pointermove', ox(1.0), 10);
        pointer('pointerup', ox(1.0), 10);
        pointer('pointerdown', ox(0), 10);
        pointer('pointermove', ox(0.5), 10);
        pointer('pointerup', ox(0.5), 10);
        assert(Math.abs(state.crop.start - 0.5) < 0.03 && Math.abs(state.crop.end - 1.0) < 0.03, `crop ${JSON.stringify(state.crop)}`);
        assertEqual(player.loop, null, 'no loop until Loop crop is ticked:');
        key('l');
        assert(doc.getElementById('loopToggle').checked, 'L should tick Loop crop');
        assert(Math.abs(player.loop.start - 0.5) < 0.03 && Math.abs(player.loop.end - 1.0) < 0.03, `player loop ${JSON.stringify(player.loop)}`);

        doc.getElementById('playButton').click();
        await waitFor(() => doc.getElementById('playButton').textContent.includes('Pause'), 3000, 'playing');
        await new Promise((r) => setTimeout(r, 900));
        const t = player.currentTime;
        assert(t >= 0.45 && t <= 1.05, `playhead ${t} left the crop`);
        doc.getElementById('playButton').click();

        // Only the crop is saved, re-timed to start at 0, with hand-placed positions kept.
        const target = state.notes.find((n) => n.start === 0.5);
        target.fixed = true;
        let saved = null;
        frame.contentWindow.tabs.storage.save = async (name, blob) => { saved = JSON.parse(await blob.text()); return { filename: name, location: 'test' }; };
        doc.getElementById('saveButton').click();
        await waitFor(() => saved, 3000, 'save');
        assertEqual(saved.notes.length, 1, 'notes inside the crop:');
        assertEqual(`${saved.notes[0].start}/${saved.notes[0].string}/${saved.notes[0].fret}`, `0/${target.string}/${target.fret}`, 'saved note:');
        assert(Math.abs(saved.duration - 0.5) < 0.03, `saved duration ${saved.duration}`);

        // Reset: the crop is the whole tab again, so Loop crop repeats it all and wraps to the start.
        doc.getElementById('cropResetButton').click();
        assertEqual(state.crop, null, 'crop after reset:');
        assertEqual(`${player.loop?.start}`, '0', 'whole-tab loop start:');
        assert(player.loop.end >= 3 - 0.01, `whole-tab loop end ${player.loop.end}`);
        player.seek(player.loop.end - 0.2);
        doc.getElementById('playButton').click();
        await waitFor(() => player.playing && player.currentTime < 1, 3000, 'wrap to the start');
        doc.getElementById('playButton').click();
    } finally {
        frame.remove();
    }
});
