// Note extractor page: wires sources, extractor, player, timeline, codec and storage together.

import { getConfig, load, loadAll, loadImpl, registry } from './registry.js';
import { runExtractor } from './extractors/index.js';
import { cropNotes, shiftNotes, sortNotes } from './noteset.js';
import { midiToName } from './music.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';

const MAX_LISTEN_SECONDS = 20 * 60;
const DEFAULT_RANGE = { min: 40, max: 88 };   // E2..E6, a guitar's range
const NOTE_CHOICES = { min: 21, max: 108 };   // A0..C8

const $ = (id) => document.getElementById(id);
const el = {
    sourceButtons: $('sourceButtons'), liveControls: $('liveControls'), stopButton: $('stopButton'),
    elapsed: $('elapsed'), level: $('level'), sourceHint: $('sourceHint'), clipRow: $('clipRow'),
    clipInfo: $('clipInfo'), clearButton: $('clearButton'), audioStatus: $('audioStatus'),
    extractorSelect: $('extractorSelect'), minNote: $('minNote'), maxNote: $('maxNote'),
    extractButton: $('extractButton'), cancelButton: $('cancelButton'), progress: $('progress'),
    extractorHint: $('extractorHint'), notesStatus: $('notesStatus'),
    timeline: $('timeline'), playButton: $('playButton'), playCropButton: $('playCropButton'),
    timeDisplay: $('timeDisplay'), songVolume: $('songVolume'), notesVolume: $('notesVolume'),
    followPlayhead: $('followPlayhead'), cropDisplay: $('cropDisplay'), cropStartButton: $('cropStartButton'),
    cropEndButton: $('cropEndButton'), cropResetButton: $('cropResetButton'),
    titleInput: $('titleInput'), saveButton: $('saveButton'), loadButton: $('loadButton'),
    folderRow: $('folderRow'), folderName: $('folderName'), folderButton: $('folderButton'), saveStatus: $('saveStatus'),
};

const state = {
    clip: null,          // AudioClip in memory
    noteSet: null,       // NoteSet for the whole clip
    crop: { start: 0, end: 0 },
    live: null,          // the live source currently listening
    extraction: null,    // AbortController while extracting
};

let config, extractor, codec, storage, player, timeline;

// ----- helpers -----

function setStatus(node, message = '', kind = '') {
    node.textContent = message;
    node.className = `status ${kind}`;
}

function formatTime(t, decimals = 1) {
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(decimals);
    return `${m}:${s.padStart(decimals ? 3 + decimals : 2, '0')}`;
}

function slugify(text) {
    return text.trim().toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'notes';
}

function defaultTitle() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `notes-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function duration() {
    return timeline.duration;
}

function range() {
    return { minMidi: Number(el.minNote.value), maxMidi: Number(el.maxNote.value) };
}

// ----- UI state -----

function refresh() {
    const listening = Boolean(state.live);
    const extracting = Boolean(state.extraction);
    const hasTimeline = duration() > 0;
    const hasNotes = Boolean(state.noteSet?.notes.length);

    el.sourceButtons.querySelectorAll('button').forEach((b) => { b.disabled = listening || extracting; });
    el.liveControls.hidden = !listening;
    el.clipRow.hidden = !state.clip || listening;
    el.clearButton.disabled = extracting;

    el.extractButton.disabled = !state.clip || listening || extracting;
    el.extractButton.textContent = state.noteSet && state.clip ? 'Find notes again' : 'Find notes';
    el.cancelButton.hidden = !extracting;
    el.progress.hidden = !extracting;

    for (const b of [el.playButton, el.playCropButton, el.cropStartButton, el.cropEndButton, el.cropResetButton]) {
        b.disabled = !hasTimeline || listening;
    }
    el.playButton.textContent = player?.playing ? '❚❚ Pause' : '▶ Play';
    el.cropDisplay.textContent = hasTimeline
        ? `${formatTime(state.crop.start)} – ${formatTime(state.crop.end)} (${(state.crop.end - state.crop.start).toFixed(1)} s)`
        : '–';
    el.saveButton.disabled = !hasNotes || extracting;
}

function setCrop(start, end, { fromTimeline = false } = {}) {
    state.crop = { start: Math.max(0, start), end: Math.min(duration(), end) };
    if (!fromTimeline) timeline.setCrop(state.crop.start, state.crop.end);
    refresh();
}

// ----- audio sources -----

async function setupSources() {
    const sources = await loadAll('source', config);
    for (const source of sources) {
        const button = document.createElement('button');
        button.textContent = source.startLabel ?? source.name;
        if (source.kind === 'live') {
            button.addEventListener('click', () => startLive(source));
        } else {
            const input = Object.assign(document.createElement('input'), { type: 'file', accept: source.accept ?? '', hidden: true });
            input.addEventListener('change', () => {
                if (input.files[0]) openFile(source, input.files[0]);
                input.value = '';
            });
            button.addEventListener('click', () => input.click());
            el.sourceButtons.append(input);
        }
        el.sourceButtons.append(button);
    }
    const tab = sources.find((s) => s.id === 'tab');
    el.sourceHint.textContent = tab ? tab.hint : '';
    if (!sources.length) setStatus(el.audioStatus, 'None of the configured audio sources work in this browser.', 'error');
}

async function startLive(source) {
    setStatus(el.audioStatus);
    player.pause();
    try {
        await source.start({
            onLevel: ({ peak, seconds }) => {
                el.level.value = Math.max(peak, el.level.value * 0.85);
                el.elapsed.textContent = formatTime(seconds, 0);
                if (seconds >= MAX_LISTEN_SECONDS) stopLive(`Stopped after ${MAX_LISTEN_SECONDS / 60} minutes.`);
            },
            onEnded: () => stopLive(),
        });
        state.live = source;
        el.elapsed.textContent = '0:00';
        refresh();
    } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'AbortError') setStatus(el.audioStatus, 'Sharing was cancelled.');
        else setStatus(el.audioStatus, err.message, 'error');
    }
}

async function stopLive(message = '') {
    const source = state.live;
    if (!source) return;
    state.live = null;
    try {
        const clip = await source.stop();
        if (clip.duration < 0.5) {
            setStatus(el.audioStatus, 'Less than half a second of audio was captured.', 'error');
            refresh();
            return;
        }
        if (message) setStatus(el.audioStatus, message);
        await useClip(clip);
    } catch (err) {
        setStatus(el.audioStatus, err.message, 'error');
        refresh();
    }
}

async function openFile(source, file) {
    setStatus(el.audioStatus, `Opening ${file.name}…`);
    try {
        const clip = await source.open(file);
        setStatus(el.audioStatus);
        if (!el.titleInput.value) el.titleInput.value = slugify(file.name);
        await useClip(clip);
    } catch (err) {
        setStatus(el.audioStatus, err.message, 'error');
    }
}

async function useClip(clip) {
    state.clip = clip;
    state.noteSet = null;
    player.setClip(clip);
    player.setNotes([]);
    timeline.setClip(clip);
    timeline.setNotes([]);
    setCrop(0, clip.duration);
    el.clipInfo.textContent = `${formatTime(clip.duration, 0)} of audio in memory`;
    if (!el.titleInput.value) el.titleInput.value = defaultTitle();
    refresh();
    await extract();
}

function clearAudio() {
    player.pause();
    state.clip = null;
    state.noteSet = null;
    player.setClip(null);
    player.setNotes([]);
    timeline.setClip(null, 0);
    timeline.setNotes([]);
    setStatus(el.audioStatus, 'Audio cleared.');
    setStatus(el.notesStatus);
    refresh();
}

// ----- extraction -----

async function setupExtractors() {
    for (const id of Object.keys(registry.extractor)) {
        const impl = await loadImpl('extractor', id);
        el.extractorSelect.append(new Option(impl.name, id, false, id === config.extractor));
    }
    el.extractorHint.textContent = extractor.description ?? '';

    for (const select of [el.minNote, el.maxNote]) {
        for (let m = NOTE_CHOICES.min; m <= NOTE_CHOICES.max; m++) select.append(new Option(midiToName(m), m));
    }
    el.minNote.value = DEFAULT_RANGE.min;
    el.maxNote.value = DEFAULT_RANGE.max;
    timeline.setRange(DEFAULT_RANGE.min, DEFAULT_RANGE.max);
}

async function extract() {
    if (!state.clip || state.extraction) return;
    const { minMidi, maxMidi } = range();
    const controller = new AbortController();
    state.extraction = controller;
    el.progress.value = 0;
    setStatus(el.notesStatus, 'Finding notes…');
    refresh();
    const t0 = performance.now();
    try {
        const noteSet = await runExtractor(extractor, state.clip, {
            minMidi, maxMidi,
            signal: controller.signal,
            onProgress: (p) => { el.progress.value = p; },
        });
        showNotes(noteSet);
        const ms = performance.now() - t0;
        const took = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
        setStatus(el.notesStatus, `Found ${noteSet.notes.length} notes in ${took}. Press play to hear them over the audio.`, 'ok');
    } catch (err) {
        if (err.name === 'AbortError') setStatus(el.notesStatus, 'Cancelled.');
        else setStatus(el.notesStatus, err.message, 'error');
    } finally {
        state.extraction = null;
        refresh();
    }
}

function showNotes(noteSet) {
    state.noteSet = noteSet;
    player.setNotes(noteSet.notes);
    timeline.setRange(noteSet.range.minMidi, noteSet.range.maxMidi);
    timeline.setNotes(noteSet.notes, noteSet.pitchTrack ?? null);
}

function onRangeChange() {
    let { minMidi, maxMidi } = range();
    if (minMidi > maxMidi) {
        [minMidi, maxMidi] = [maxMidi, minMidi];
        el.minNote.value = minMidi;
        el.maxNote.value = maxMidi;
    }
    timeline.setRange(minMidi, maxMidi);
    if (state.noteSet && state.clip) {
        setStatus(el.notesStatus, 'Range changed. Press “Find notes again” to use it.');
    }
}

// ----- playback -----

function togglePlay() {
    if (!duration()) return;
    if (player.playing) player.pause();
    else player.play(player.position >= player.length - 0.05 ? 0 : player.position);
    timeline.follow = el.followPlayhead.checked;
    animate();
    refresh();
}

function playCrop() {
    player.play(state.crop.start, state.crop.end);
    timeline.follow = el.followPlayhead.checked;
    animate();
    refresh();
}

function animate() {
    const t = player.currentTime;
    timeline.setPlayhead(t);
    el.timeDisplay.textContent = formatTime(t);
    if (player.playing) requestAnimationFrame(animate);
    else refresh();
}

function seek(t) {
    player.seek(t);
    timeline.setPlayhead(t);
    el.timeDisplay.textContent = formatTime(t);
    if (player.playing) animate();
}

// ----- saving and loading -----

async function setupStorage() {
    if (storage.pickFolder) {
        el.folderRow.hidden = false;
        const name = await storage.folderName();
        if (name) {
            el.folderName.textContent = name;
            el.folderButton.textContent = 'Change folder…';
        }
    }
}

async function chooseFolder() {
    try {
        const name = await storage.pickFolder();
        el.folderName.textContent = name;
        el.folderButton.textContent = 'Change folder…';
    } catch (err) {
        if (err.name !== 'AbortError') setStatus(el.saveStatus, err.message, 'error');
    }
}

async function save() {
    if (!state.noteSet) return;
    const title = el.titleInput.value.trim() || defaultTitle();
    const notes = cropNotes(state.noteSet.notes, state.crop.start, state.crop.end);
    if (!notes.length) return setStatus(el.saveStatus, 'There are no notes inside the crop.', 'error');
    const blob = codec.encode({ ...state.noteSet, notes }, { title, duration: state.crop.end - state.crop.start });
    try {
        const { filename, location } = await storage.save(slugify(title) + codec.extension, blob);
        setStatus(el.saveStatus, `Saved ${notes.length} notes to ${filename} in ${location}.`, 'ok');
        await setupStorage();
    } catch (err) {
        if (err.name === 'AbortError') setStatus(el.saveStatus, 'Not saved.');
        else setStatus(el.saveStatus, err.message, 'error');
    }
}

/** Open a notes file and show it. With audio loaded, notes are placed at the crop start. */
async function openNotes() {
    try {
        const file = await storage.open({ accept: { [codec.mimeType]: [codec.extension, '.json'] } });
        const { noteSet, meta } = codec.decode(await file.arrayBuffer());
        player.pause();
        if (!state.clip) {
            player.setClip(null);
            timeline.setClip(null, meta.duration);
            setCrop(0, meta.duration);
        }
        const offset = state.clip ? state.crop.start : 0;
        showNotes({ ...noteSet, notes: sortNotes(shiftNotes(noteSet.notes, offset)) });
        el.minNote.value = noteSet.range.minMidi;
        el.maxNote.value = noteSet.range.maxMidi;
        if (meta.title) el.titleInput.value = meta.title;
        const where = state.clip ? ` from the crop start (${formatTime(offset)})` : '';
        setStatus(el.saveStatus, `Opened ${noteSet.notes.length} notes from ${file.name}${where}.`, 'ok');
        refresh();
    } catch (err) {
        if (err.name === 'AbortError') return;
        setStatus(el.saveStatus, err.message, 'error');
    }
}

// ----- keyboard -----

function onKey(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type === 'text') return;
    if (tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
    } else if (e.key === '[') {
        setCrop(Math.min(player.currentTime, state.crop.end - 0.1), state.crop.end);
    } else if (e.key === ']') {
        setCrop(state.crop.start, Math.max(player.currentTime, state.crop.start + 0.1));
    }
}

// ----- start -----

async function main() {
    config = getConfig();
    [extractor, codec, storage] = await Promise.all([load('extractor', config), load('codec', config), load('storage', config)]);
    const voiceImpl = await load('voice', config);

    timeline = new Timeline(el.timeline, {
        onSeek: seek,
        onCropChange: (start, end) => setCrop(start, end, { fromTimeline: true }),
    });
    player = new Player(voiceImpl);
    player.onStop = () => refresh();
    await player.init();
    player.setSongVolume(Number(el.songVolume.value));
    player.setNotesVolume(Number(el.notesVolume.value));

    await Promise.all([setupSources(), setupExtractors(), setupStorage()]);

    el.stopButton.addEventListener('click', () => stopLive());
    el.clearButton.addEventListener('click', clearAudio);
    el.extractButton.addEventListener('click', extract);
    el.cancelButton.addEventListener('click', () => state.extraction?.abort());
    el.extractorSelect.addEventListener('change', async () => {
        extractor = await loadImpl('extractor', el.extractorSelect.value);
        el.extractorHint.textContent = extractor.description ?? '';
    });
    el.minNote.addEventListener('change', onRangeChange);
    el.maxNote.addEventListener('change', onRangeChange);
    el.playButton.addEventListener('click', togglePlay);
    el.playCropButton.addEventListener('click', playCrop);
    el.songVolume.addEventListener('input', () => player.setSongVolume(Number(el.songVolume.value)));
    el.notesVolume.addEventListener('input', () => player.setNotesVolume(Number(el.notesVolume.value)));
    el.followPlayhead.addEventListener('change', () => { timeline.follow = el.followPlayhead.checked && player.playing; });
    el.cropStartButton.addEventListener('click', () => setCrop(Math.min(player.currentTime, state.crop.end - 0.1), state.crop.end));
    el.cropEndButton.addEventListener('click', () => setCrop(state.crop.start, Math.max(player.currentTime, state.crop.start + 0.1)));
    el.cropResetButton.addEventListener('click', () => setCrop(0, duration()));
    el.saveButton.addEventListener('click', save);
    el.loadButton.addEventListener('click', openNotes);
    el.folderButton.addEventListener('click', chooseFolder);
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', (e) => { if (state.live) e.preventDefault(); });

    refresh();
    document.body.dataset.ready = 'true';
}

main().catch((err) => {
    console.error(err);
    setStatus(el.audioStatus, `The page failed to start: ${err.message}`, 'error');
});
