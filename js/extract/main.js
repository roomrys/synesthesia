// Note extractor page: wires sources, extractor, player, timeline, codec and storage together.

import { getConfig, load, loadAll, loadImpl, registry } from './registry.js';
import { runExtractor } from './extractors/index.js';
import { cropNotes, filterRange, shiftNotes, sortNotes } from './noteset.js';
import { midiToName } from './music.js';
import { findAudibleRange } from './dsp.js';
import { analysisBlob, buildAnalysis, summarizeStats } from './analysis.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';
import { computeLayers } from './spectrum.js';

const MAX_LISTEN_SECONDS = 20 * 60;
const DETECT_RANGE = { min: 33, max: 100 };   // A1..E7: detection always covers this
const EMPTY_VIEW = { min: 40, max: 88 };      // E2..E6: rows shown before any notes
const VIEW_PADDING = 3;                       // semitones shown around the detected notes
const SPEED = { min: 0.25, max: 1.5 };
const LAYER_VIEW = { min: 40, max: 88 };      // rows shown at least, with a debug layer on
const LAYER_KEY = 'synesthesia.layer';
const LAYER_HINTS = {
    spectrogram: 'Energy at each pitch over time; brighter is louder. One played note lights up its own row '
        + 'and its overtones 12, 19, 24 and 28 semitones above, so a note looks like a stack and a chord like '
        + 'several overlapping stacks. Detected notes are outlined.',
    salience: 'For each pitch, the energy at its overtones added up, so each note\'s stack collapses onto its own '
        + 'row. Chords show as several bright rows at once. Fainter ghosts can appear 12 or 19 semitones above '
        + 'a note. Detected notes are outlined.',
};

const $ = (id) => document.getElementById(id);
const el = {
    sourceButtons: $('sourceButtons'), liveControls: $('liveControls'), stopButton: $('stopButton'),
    elapsed: $('elapsed'), level: $('level'), sourceHint: $('sourceHint'), clipRow: $('clipRow'),
    clipInfo: $('clipInfo'), clearButton: $('clearButton'), audioStatus: $('audioStatus'),
    extractorSelect: $('extractorSelect'), pitchDisplay: $('pitchDisplay'), pitchFitButton: $('pitchFitButton'),
    extractButton: $('extractButton'), cancelButton: $('cancelButton'), progress: $('progress'),
    extractorHint: $('extractorHint'), notesStatus: $('notesStatus'), analysisButton: $('analysisButton'),
    settingsPanel: $('settingsPanel'), settingsGrid: $('settingsGrid'), autoRerun: $('autoRerun'),
    resetSettingsButton: $('resetSettingsButton'),
    timeline: $('timeline'), playButton: $('playButton'), loopToggle: $('loopToggle'),
    speed: $('speed'), speedDisplay: $('speedDisplay'),
    timeDisplay: $('timeDisplay'), songVolume: $('songVolume'), notesVolume: $('notesVolume'),
    followPlayhead: $('followPlayhead'), cropDisplay: $('cropDisplay'), cropStartButton: $('cropStartButton'),
    cropEndButton: $('cropEndButton'), cropResetButton: $('cropResetButton'), cropFitButton: $('cropFitButton'),
    titleInput: $('titleInput'), saveButton: $('saveButton'), loadButton: $('loadButton'),
    layerSelect: $('layerSelect'), layerFloor: $('layerFloor'), layerStatus: $('layerStatus'), layerHint: $('layerHint'),
    folderRow: $('folderRow'), folderName: $('folderName'), folderButton: $('folderButton'), saveStatus: $('saveStatus'),
};

const state = {
    clip: null,          // AudioClip in memory
    noteSet: null,       // NoteSet for the whole clip
    crop: { start: 0, end: 0 },
    pitchCrop: null,     // { min, max } MIDI notes kept, inclusive
    pitchCropMoved: false, // the user moved it, so keep it when re-detecting
    live: null,          // the live source currently listening
    extraction: null,    // AbortController while extracting
    rerun: false,        // run again when the current extraction stops
    layers: null,        // debug layers for the clip, from computeLayers
    layerJob: null,      // AbortController while computing them
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

/** Notes inside the pitch crop: what is played back and saved. */
function keptNotes() {
    if (!state.noteSet) return [];
    const { min, max } = state.pitchCrop ?? { min: 0, max: 127 };
    return filterRange(state.noteSet.notes, min, max);
}

function detectedRange(notes) {
    if (!notes.length) return null;
    return {
        min: notes.reduce((m, n) => Math.min(m, n.midi), Infinity),
        max: notes.reduce((m, n) => Math.max(m, n.midi), -Infinity),
    };
}

/** Rows shown in the piano roll: the detected notes plus padding, and the pitch crop. */
function updateView() {
    const found = detectedRange(state.noteSet?.notes ?? []);
    const base = el.layerSelect.value ? LAYER_VIEW : EMPTY_VIEW;
    if (!found) return timeline.setRange(base.min, base.max);
    const crop = state.pitchCrop ?? found;
    const layerOn = Boolean(el.layerSelect.value);
    timeline.setRange(
        Math.max(DETECT_RANGE.min, Math.min(found.min, crop.min, layerOn ? base.min : Infinity) - VIEW_PADDING),
        Math.min(DETECT_RANGE.max, Math.max(found.max, crop.max, layerOn ? base.max : -Infinity) + VIEW_PADDING),
    );
}

function setPitchCrop(min, max, { fromTimeline = false, moved = true } = {}) {
    state.pitchCrop = { min, max };
    state.pitchCropMoved = moved;
    if (!fromTimeline) timeline.setPitchCrop(min, max);
    player.setNotes(keptNotes());
    refresh();
}

function fitPitchCrop() {
    const found = detectedRange(state.noteSet?.notes ?? []);
    if (found) {
        setPitchCrop(found.min, found.max, { moved: false });
    } else {
        state.pitchCrop = null;
        state.pitchCropMoved = false;
        player.setNotes([]);
        refresh();
    }
    updateView();
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

    for (const b of [el.playButton, el.cropStartButton, el.cropEndButton, el.cropResetButton]) {
        b.disabled = !hasTimeline || listening;
    }
    el.cropFitButton.disabled = !state.clip || listening;
    el.playButton.textContent = player?.playing ? '❚❚ Pause' : '▶ Play';
    el.cropDisplay.textContent = hasTimeline
        ? `${formatTime(state.crop.start)} – ${formatTime(state.crop.end)} (${(state.crop.end - state.crop.start).toFixed(1)} s)`
        : '–';
    el.pitchFitButton.disabled = !hasNotes || listening;
    if (state.noteSet && state.pitchCrop) {
        const kept = keptNotes().length;
        el.pitchDisplay.textContent = `${midiToName(state.pitchCrop.min)} – ${midiToName(state.pitchCrop.max)} (${kept} of ${state.noteSet.notes.length})`;
    } else {
        el.pitchDisplay.textContent = '–';
    }
    el.saveButton.disabled = !hasNotes || extracting;
    el.analysisButton.hidden = !state.noteSet?.pitchTrack || extracting;
}

/** Crop the time range to where the audio starts and ends; leaves it alone if all silent. */
function fitCropToAudio() {
    if (!state.clip) return;
    const range = findAudibleRange(state.clip.samples, state.clip.sampleRate);
    if (range) {
        setCrop(range.start, range.end);
        player.seek(range.start);
        timeline.setPlayhead(range.start);
        el.timeDisplay.textContent = formatTime(range.start);
    } else {
        setStatus(el.audioStatus, 'The audio seems silent, so the crop was left as it is.');
    }
}

function setCrop(start, end, { fromTimeline = false } = {}) {
    state.crop = { start: Math.max(0, start), end: Math.min(duration(), end) };
    if (!fromTimeline) timeline.setCrop(state.crop.start, state.crop.end);
    if (player?.loop) updateLoop();
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
    state.pitchCrop = null;
    state.pitchCropMoved = false;
    player.setClip(clip);
    player.setNotes([]);
    timeline.setClip(clip);
    timeline.setNotes([]);
    resetLayers();
    updateView();
    setCrop(0, clip.duration);
    fitCropToAudio();
    el.clipInfo.textContent = `${formatTime(clip.duration, 0)} of audio in memory`;
    if (!el.titleInput.value) el.titleInput.value = defaultTitle();
    refresh();
    await extract();
}

function clearAudio() {
    player.pause();
    state.clip = null;
    state.noteSet = null;
    state.pitchCrop = null;
    player.setClip(null);
    player.setNotes([]);
    timeline.setClip(null, 0);
    timeline.setNotes([]);
    resetLayers();
    updateView();
    setStatus(el.audioStatus, 'Audio cleared.');
    setStatus(el.notesStatus);
    refresh();
}

// ----- debug layers -----

function loadLayerPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(LAYER_KEY) ?? '{}');
        if (saved.kind in LAYER_HINTS) el.layerSelect.value = saved.kind;
        if (typeof saved.floor === 'number') el.layerFloor.value = saved.floor;
    } catch { /* storage unavailable: use the defaults */ }
}

function saveLayerPrefs() {
    try {
        localStorage.setItem(LAYER_KEY, JSON.stringify({ kind: el.layerSelect.value, floor: Number(el.layerFloor.value) }));
    } catch { /* storage unavailable */ }
}

/** Drop the layers of the previous clip (and stop computing them). */
function resetLayers() {
    state.layerJob?.abort();
    state.layerJob = null;
    state.layers = null;
    updateLayer();
}

/** Show the chosen layer, computing the layers for this clip the first time one is needed. */
function updateLayer() {
    const kind = el.layerSelect.value;
    el.layerFloor.disabled = !kind;
    el.layerHint.hidden = !kind;
    el.layerHint.textContent = LAYER_HINTS[kind] ?? '';
    if (!state.layerJob) el.layerStatus.textContent = '';
    updateView();
    if (!kind || !state.clip) return timeline.setLayer(null);
    if (state.layers) return timeline.setLayer(state.layers, kind);
    if (!state.layerJob) computeLayerData();
}

async function computeLayerData() {
    const job = new AbortController();
    const clip = state.clip;
    state.layerJob = job;
    el.layerStatus.textContent = 'Working…';
    try {
        const layers = await computeLayers(clip.samples, clip.sampleRate, {
            signal: job.signal,
            onProgress: (p) => { el.layerStatus.textContent = `Working… ${Math.round(p * 100)}%`; },
        });
        if (state.layerJob !== job) return;
        state.layers = layers;
        state.layerJob = null;
        updateLayer();
    } catch (err) {
        if (state.layerJob !== job) return;
        state.layerJob = null;
        if (err.name !== 'AbortError') el.layerStatus.textContent = `The layer failed: ${err.message}`;
    }
}

// ----- extraction -----

async function setupExtractors() {
    for (const id of Object.keys(registry.extractor)) {
        const impl = await loadImpl('extractor', id);
        el.extractorSelect.append(new Option(impl.name, id, false, id === config.extractor));
    }
    el.extractorHint.textContent = extractor.description ?? '';
    renderSettings();
    updateView();
}

// ----- detector settings -----
// Each extractor lists its tunable settings; tuned values are remembered per
// extractor in this browser (a convenience only; the page works without it).

const settingsKey = (id) => `synesthesia.extractor.${id}`;

function loadTuned(id) {
    try {
        return JSON.parse(localStorage.getItem(settingsKey(id))) ?? {};
    } catch {
        return {};
    }
}

function saveTuned(id, values) {
    try {
        localStorage.setItem(settingsKey(id), JSON.stringify(values));
    } catch { /* storage unavailable: settings just aren't remembered */ }
}

/** Current option overrides for the active extractor (only valid, known keys). */
function tunedOptions() {
    const saved = loadTuned(extractor.id);
    const out = {};
    for (const s of extractor.settings ?? []) {
        const v = Number(saved[s.key]);
        if (Number.isFinite(v) && v >= s.min && v <= s.max) out[s.key] = v;
    }
    return out;
}

function renderSettings() {
    const list = extractor.settings ?? [];
    el.settingsPanel.hidden = list.length === 0;
    el.settingsGrid.replaceChildren();
    const tuned = tunedOptions();
    for (const s of list) {
        const value = tuned[s.key] ?? extractor.defaults[s.key];
        const format = s.format ?? String;
        const wrap = document.createElement('label');
        wrap.className = 'setting';
        wrap.title = s.help ?? '';
        const head = document.createElement('div');
        head.className = 'setting-head';
        const name = Object.assign(document.createElement('span'), { textContent: s.label });
        const output = Object.assign(document.createElement('output'), { textContent: format(value) });
        head.append(name, output);
        const input = Object.assign(document.createElement('input'), { type: 'range', min: s.min, max: s.max, step: s.step, value });
        const markChanged = (v) => wrap.classList.toggle('changed', v !== extractor.defaults[s.key]);
        markChanged(value);
        input.addEventListener('input', () => {
            const v = Number(input.value);
            output.textContent = format(v);
            markChanged(v);
        });
        input.addEventListener('change', () => {
            saveTuned(extractor.id, { ...loadTuned(extractor.id), [s.key]: Number(input.value) });
            settingsChanged();
        });
        wrap.append(head, input);
        if (s.help) wrap.append(Object.assign(document.createElement('small'), { textContent: s.help }));
        el.settingsGrid.append(wrap);
    }
}

function settingsChanged() {
    if (!state.clip) return;
    if (el.autoRerun.checked) extract();
    else setStatus(el.notesStatus, 'Settings changed. Press “Find notes again” to use them.');
}

function resetSettings() {
    saveTuned(extractor.id, {});
    renderSettings();
    settingsChanged();
}

/**
 * Run the extractor on the clip. If a run is already going, cancel it and run
 * again with the latest settings once it has stopped.
 */
async function extract() {
    if (!state.clip) return;
    if (state.extraction) {
        state.rerun = true;
        state.extraction.abort();
        return;
    }
    const controller = new AbortController();
    state.extraction = controller;
    el.progress.value = 0;
    setStatus(el.notesStatus, 'Finding notes…');
    refresh();
    const t0 = performance.now();
    try {
        // Detect over the full range; the pitch crop then filters instantly.
        const noteSet = await runExtractor(extractor, state.clip, {
            minMidi: DETECT_RANGE.min, maxMidi: DETECT_RANGE.max,
            options: tunedOptions(),
            signal: controller.signal,
            onProgress: (p) => { el.progress.value = p; },
        });
        showNotes(noteSet);
        const ms = performance.now() - t0;
        const took = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
        const summary = summarizeStats(noteSet.stats);
        setStatus(el.notesStatus, `Found ${noteSet.notes.length} notes in ${took}. ${summary} Press play to hear them over the audio.`, 'ok');
    } catch (err) {
        if (err.name !== 'AbortError') setStatus(el.notesStatus, err.message, 'error');
        else if (!state.rerun) setStatus(el.notesStatus, 'Cancelled.');
    } finally {
        state.extraction = null;
        refresh();
    }
    if (state.rerun) {
        state.rerun = false;
        extract();
    }
}

/**
 * Show a NoteSet. The pitch crop fits the detected notes unless the user has
 * moved it (or `pitchCrop` is given, e.g. from an opened file).
 */
function showNotes(noteSet, pitchCrop = null) {
    state.noteSet = noteSet;
    timeline.setNotes(noteSet.notes, noteSet.pitchTrack ?? null);
    if (pitchCrop) setPitchCrop(pitchCrop.min, pitchCrop.max, { moved: true });
    else if (!state.pitchCropMoved || !state.pitchCrop) fitPitchCrop();
    else setPitchCrop(state.pitchCrop.min, state.pitchCrop.max);
    updateView();
}

// ----- playback -----

function startPlayback(from) {
    player.play(from).catch((err) => setStatus(el.notesStatus, `Playback failed: ${err.message}`, 'error'));
    timeline.follow = el.followPlayhead.checked;
    animate();
    refresh();
}

function togglePlay() {
    if (!duration()) return;
    if (player.playing) {
        player.pause();
        refresh();
        return;
    }
    let from = player.position;
    if (el.loopToggle.checked) {
        if (from < state.crop.start || from >= state.crop.end - 0.05) from = state.crop.start;
    } else if (from >= player.length - 0.05) {
        from = 0;
    }
    startPlayback(from);
}

/** Keep the player's loop in step with the checkbox and the time crop. */
function updateLoop() {
    player.setLoop(el.loopToggle.checked ? { start: state.crop.start, end: state.crop.end } : null);
}

function setSpeed(rate) {
    player.setRate(rate);
    el.speed.value = rate;
    el.speedDisplay.textContent = `${Math.round(rate * 100)}%`;
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
    const notes = cropNotes(keptNotes(), state.crop.start, state.crop.end);
    if (!notes.length) return setStatus(el.saveStatus, 'There are no notes inside the crop.', 'error');
    const range = { minMidi: state.pitchCrop.min, maxMidi: state.pitchCrop.max };
    const blob = codec.encode({ ...state.noteSet, notes, range }, { title, duration: state.crop.end - state.crop.start });
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
        state.pitchCropMoved = false;
        showNotes({ ...noteSet, notes: sortNotes(shiftNotes(noteSet.notes, offset)) });
        if (meta.title) el.titleInput.value = meta.title;
        const where = state.clip ? ` from the crop start (${formatTime(offset)})` : '';
        setStatus(el.saveStatus, `Opened ${noteSet.notes.length} notes from ${file.name}${where}.`, 'ok');
        refresh();
    } catch (err) {
        if (err.name === 'AbortError') return;
        setStatus(el.saveStatus, err.message, 'error');
    }
}

/** Save the detector's per-frame numbers (no audio) for debugging. */
async function exportAnalysis() {
    if (!state.noteSet) return;
    const title = el.titleInput.value.trim() || defaultTitle();
    const blob = analysisBlob(buildAnalysis(state.noteSet, { title, clipDuration: state.clip?.duration ?? 0 }));
    try {
        const { filename, location } = await storage.save(`${slugify(title)}.analysis.json`, blob);
        setStatus(el.notesStatus, `Saved the analysis to ${filename} in ${location}. It contains no audio.`, 'ok');
    } catch (err) {
        if (err.name !== 'AbortError') setStatus(el.notesStatus, err.message, 'error');
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
    } else if (e.key === 'l') {
        el.loopToggle.checked = !el.loopToggle.checked;
        updateLoop();
    } else if (e.key === '-' || e.key === '=') {
        const step = e.key === '-' ? -0.05 : 0.05;
        setSpeed(Math.round(Math.min(SPEED.max, Math.max(SPEED.min, player.rate + step)) * 100) / 100);
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
        onPitchCropChange: (min, max) => setPitchCrop(min, max, { fromTimeline: true }),
    });
    player = new Player(voiceImpl);
    player.onStop = () => refresh();
    await player.init();
    player.setSongVolume(Number(el.songVolume.value));
    player.setNotesVolume(Number(el.notesVolume.value));

    await Promise.all([setupSources(), setupExtractors(), setupStorage()]);
    loadLayerPrefs();
    timeline.setLayerFloor(Number(el.layerFloor.value));
    updateLayer();

    el.stopButton.addEventListener('click', () => stopLive());
    el.clearButton.addEventListener('click', clearAudio);
    el.extractButton.addEventListener('click', extract);
    el.cancelButton.addEventListener('click', () => state.extraction?.abort());
    el.analysisButton.addEventListener('click', exportAnalysis);
    el.extractorSelect.addEventListener('change', async () => {
        extractor = await loadImpl('extractor', el.extractorSelect.value);
        el.extractorHint.textContent = extractor.description ?? '';
        renderSettings();
        settingsChanged();
    });
    el.resetSettingsButton.addEventListener('click', resetSettings);
    el.pitchFitButton.addEventListener('click', fitPitchCrop);
    el.playButton.addEventListener('click', togglePlay);
    el.loopToggle.addEventListener('change', updateLoop);
    el.speed.addEventListener('input', () => setSpeed(Number(el.speed.value)));
    el.songVolume.addEventListener('input', () => player.setSongVolume(Number(el.songVolume.value)));
    el.notesVolume.addEventListener('input', () => player.setNotesVolume(Number(el.notesVolume.value)));
    el.followPlayhead.addEventListener('change', () => { timeline.follow = el.followPlayhead.checked && player.playing; });
    el.cropStartButton.addEventListener('click', () => setCrop(Math.min(player.currentTime, state.crop.end - 0.1), state.crop.end));
    el.cropEndButton.addEventListener('click', () => setCrop(state.crop.start, Math.max(player.currentTime, state.crop.start + 0.1)));
    el.cropResetButton.addEventListener('click', () => setCrop(0, duration()));
    el.cropFitButton.addEventListener('click', fitCropToAudio);
    el.layerSelect.addEventListener('change', () => { saveLayerPrefs(); updateLayer(); });
    el.layerFloor.addEventListener('input', () => { timeline.setLayerFloor(Number(el.layerFloor.value)); saveLayerPrefs(); });
    el.saveButton.addEventListener('click', save);
    el.loadButton.addEventListener('click', openNotes);
    el.folderButton.addEventListener('click', chooseFolder);
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', (e) => { if (state.live) e.preventDefault(); });

    refresh();
    // For debugging in the console (and tests): window.extractor.state, .timeline, .player
    window.extractor = { state, timeline, player, keptNotes };
    document.body.dataset.ready = 'true';
}

main().catch((err) => {
    console.error(err);
    setStatus(el.audioStatus, `The page failed to start: ${err.message}`, 'error');
});
