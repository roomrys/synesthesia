// Player: speed, looping, and notes scheduled in step with the song.
// Uses a real AudioContext (headless Chrome runs with autoplay allowed) and a
// fake voice that records what it is asked to play.

import { test, assert, assertClose } from './runner.js';
import { Player } from '../js/extract/player.js';
import { sequence, clipOf } from './signals.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function recordingVoice() {
    const calls = [];
    return {
        calls,
        impl: {
            id: 'recorder', name: 'Recorder',
            async create(ctx) {
                return {
                    scheduleNote: (note, when) => calls.push({ midi: note.midi, when, duration: note.duration, at: ctx.currentTime }),
                    stopAll() {},
                    dispose() {},
                };
            },
        },
    };
}

async function makePlayer(seconds = 4) {
    const voice = recordingVoice();
    const player = new Player(voice.impl);
    await player.init();
    player.setSongVolume(0);
    player.setClip(clipOf(sequence([{ midi: 69, seconds }]), 48000));
    return { player, calls: voice.calls };
}

test('player: half speed moves the song clock at half rate', async () => {
    const { player } = await makePlayer();
    player.setRate(0.5);
    await player.play(0);
    const t0 = player.currentTime;
    const real0 = performance.now();
    await sleep(800);
    const songElapsed = player.currentTime - t0;
    const realElapsed = (performance.now() - real0) / 1000;
    player.pause();
    assertClose(songElapsed / realElapsed, 0.5, 0.12, 'song seconds per real second:');
});

test('player: notes are scheduled stretched by the speed', async () => {
    const { player, calls } = await makePlayer();
    player.setNotes([{ midi: 60, start: 0.3, duration: 0.2, velocity: 1 }]);
    player.setRate(0.5);
    await player.play(0);
    await sleep(900);
    player.pause();
    assert(calls.length === 1, `expected 1 scheduled note, got ${calls.length}`);
    assertClose(calls[0].duration, 0.4, 0.02, 'note length at half speed:');
});

test('player: looping stays inside the loop and replays its notes', async () => {
    const { player, calls } = await makePlayer();
    player.setNotes([{ midi: 64, start: 1.1, duration: 0.1, velocity: 1 }]);
    player.setLoop({ start: 1.0, end: 1.4 });
    await player.play(1.0);
    await sleep(1500);
    const t = player.currentTime;
    const playing = player.playing;
    player.pause();
    assert(playing, 'stopped instead of looping');
    assert(t >= 1.0 && t <= 1.4, `time ${t} outside the loop`);
    assert(calls.filter((c) => c.midi === 64).length >= 2, `note scheduled ${calls.length} times, expected at least 2`);
});

test('player: without looping, playback stops at the end', async () => {
    const { player } = await makePlayer(0.5);
    let stopped = false;
    player.onStop = () => { stopped = true; };
    await player.play(0.2);
    await sleep(700);
    assert(stopped && !player.playing, 'did not stop at the end');
    assertClose(player.currentTime, 0.5, 0.02, 'position at end:');
});
