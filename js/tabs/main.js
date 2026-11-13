// Tabs page: open a note file or MIDI file, give every note a string and fret,
// show it as tablature, let the user change positions, play it, and save it.

import { getConfig, load, loadImpl, registry } from '../extract/registry.js';
import { Player } from '../extract/player.js';
import { cropNotes, sortNotes } from '../extract/noteset.js';
import { STANDARD, midiAt, positionsFor } from './guitar.js';
import { CHORD_WINDOW, runFingering } from './index.js';
import { TabView } from './tabview.js';

const GUITAR = STANDARD;     // tuning and capo come later, as properties of the fretboard
const SPEED = { min: 0.25, max: 1.5 };
const MAX_HISTORY = 200;
const FRET_TYPING_MS = 700;  // a second digit within this time makes a two-digit fret

const $ = (id) => document.getElementById(id);
const el = {
    openButton: $('openButton'), fileInfo: $('fileInfo'), fingeringSelect: $('fingeringSelect'),
    placeButton: $('placeButton'), fixAllButton: $('fixAllButton'), unfixAllButton: $('unfixAllButton'),
    fingeringHint: $('fingeringHint'), status: $('status'), settingsPanel: $('settingsPanel'),
    settingsGrid: $('settingsGrid'), resetSettingsButton: $('resetSettingsButton'),
    tab: $('tab'), playButton: $('playButton'), timeDisplay: $('timeDisplay'), speed: $('speed'),
    speedDisplay: $('speedDisplay'), loopToggle: $('loopToggle'), volume: $('volume'), followPlayhead: $('followPlayhead'),
    undoButton: $('undoButton'), redoButton: $('redoButton'), cropDisplay: $('cropDisplay'),
    cropStartButton: $('cropStartButton'), cropEndButton: $('cropEndButton'), cropFitButton: $('cropFitButton'),
    cropResetButton: $('cropResetButton'),
    titleInput: $('titleInput'), saveButton: $('saveButton'), saveStatus: $('saveStatus'),
};

const state = {
    notes: [],           // placed notes: Note + { string, fret, fixed }
    unplayable: [],      // notes the guitar can't play
    meta: null,          // from the opened file: title, duration, song, source, extra
    extractor: null,     // from the opened file, kept when saving
    history: [],
    future: [],
    crop: null,          // { start, end } what loops and is saved, or null for the whole tab
};

let config, fingering, storage, codecs, player, view;
let typing = { text: '', at: 0 };

// ----- helpers -----

function setStatus(node, message = '', kind = '') {
    node.textContent = message;
    node.className = `status ${kind}`;
}

function formatTime(t) {
    const m = Math.floor(t / 60);
    return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

const allNotes = () => [...state.notes, ...state.unplayable];
const copyNotes = (notes) => notes.map((n) => ({ ...n }));

function refresh() {
    const has = allNotes().length > 0;
    for (const b of [el.placeButton, el.fixAllButton, el.unfixAllButton, el.saveButton, el.cropStartButton,
        el.cropEndButton, el.cropFitButton, el.cropResetButton]) b.disabled = !has;
    const crop = cropRange();
    el.cropDisplay.textContent = has
        ? `${formatTime(crop.start)} – ${formatTime(crop.end)} (${(crop.end - crop.start).toFixed(1)} s)${state.crop ? '' : ', the whole tab'}`
        : '–';
    el.playButton.disabled = !state.notes.length;
    el.playButton.textContent = player?.playing ? '❚❚ Pause' : '▶ Play';
    el.undoButton.disabled = !state.history.length;
    el.redoButton.disabled = !state.future.length;
}

// ----- placing notes -----

const positionKey = (n) => `${n.start}|${n.midi}`;

/**
 * Give every note a position with the current fingering, keeping hand-fixed ones.
 * With `again`, the status says how many notes moved.
 */
function place(notes = allNotes(), { keepSelected = view.selected, again = false } = {}) {
    const before = new Map(state.notes.map((n) => [positionKey(n), `${n.string}/${n.fret}`]));
    const result = runFingering(fingering, notes, GUITAR, { options: tunedOptions() });
    state.notes = result.notes;
    state.unplayable = result.unplayable;
    view.setNotes(state.notes, state.unplayable);
    view.select(keepSelected ? state.notes.find((n) => n.start === keepSelected.start && n.midi === keepSelected.midi) ?? null : null);
    player.setNotes(state.notes);
    updateCrop();
    const fixed = state.notes.filter((n) => n.fixed).length;
    const parts = [`${state.notes.length} notes placed`];
    if (again) {
        const moved = state.notes.filter((n) => before.has(positionKey(n)) && before.get(positionKey(n)) !== `${n.string}/${n.fret}`).length;
        parts[0] = moved ? `Placed again: ${moved} note${moved === 1 ? '' : 's'} moved`
            : 'Placed again: nothing moved, every note is already where these settings put it';
    }
    if (fixed) parts.push(`${fixed} by hand`);
    if (state.unplayable.length) parts.push(`${state.unplayable.length} the guitar can't play (in red at the bottom)`);
    setStatus(el.status, `${parts.join(', ')}.`, state.unplayable.length ? '' : 'ok');
    refresh();
}

/** Show a note set (from a file, or from a test). */
export function loadNotes(noteSet, meta = {}, label = '') {
    player.pause();
    state.meta = meta;
    state.extractor = noteSet.extractor ?? null;
    state.history = [];
    state.future = [];
    view.setMinDuration(meta.duration ?? 0);
    state.crop = null;
    place(sortNotes(noteSet.notes.map((n) => ({ ...n }))), { keepSelected: null });
    view.setNotes(state.notes, state.unplayable, { fit: true });
    if (meta.title) el.titleInput.value = meta.title;
    const song = [meta.song?.artist, meta.song?.title].filter(Boolean).join(' – ');
    el.fileInfo.textContent = [label, song].filter(Boolean).join(' · ');
    seek(0);
}

async function openFile() {
    try {
        const file = await storage.open({
            accept: { 'application/json': ['.synesthesia', '.json'], 'audio/midi': ['.mid', '.midi'] },
            description: 'Notes or MIDI',
        });
        const codec = /\.midi?$/i.test(file.name) ? codecs.midi : codecs.json;
        const { noteSet, meta } = codec.decode(await file.arrayBuffer());
        if (!meta.title) meta.title = file.name.replace(/\.[^.]+$/, '');
        loadNotes(noteSet, meta, file.name);
        setStatus(el.saveStatus);
    } catch (err) {
        if (err.name !== 'AbortError') setStatus(el.status, err.message, 'error');
    }
}

// ----- editing -----

function beginEdit() {
    state.history.push(copyNotes(allNotes()));
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
}

/**
 * Put a note on a position by hand. A note already on that string at the same
 * time gives way: it is unfixed, so the fingering finds it another string.
 */
function setPosition(note, string, fret) {
    for (const other of state.notes) {
        if (other !== note && other.string === string && Math.abs(other.start - note.start) <= CHORD_WINDOW) other.fixed = false;
    }
    Object.assign(note, { string, fret, midi: midiAt(GUITAR, string, fret), fixed: true });
}

function choosePosition(note, pos) {
    beginEdit();
    setPosition(note, pos.string, pos.fret);
    place(allNotes(), { keepSelected: note });
    player.audition(note.midi);
}

/** Move the selected note to the next string up (-1) or down (+1) that plays the same pitch. */
function moveString(step) {
    const note = view.selected;
    if (!note) return;
    const options = positionsFor(GUITAR, note.midi)
        .filter((p) => (step < 0 ? p.string < note.string : p.string > note.string))
        .sort((a, b) => (step < 0 ? b.string - a.string : a.string - b.string));
    if (options.length) choosePosition(note, options[0]);
}

/** Type a fret number for the selected note: it stays on its string and changes pitch. */
function typeFret(digit) {
    const note = view.selected;
    if (!note) return;
    const now = performance.now();
    const text = now - typing.at < FRET_TYPING_MS && typing.note === note ? typing.text + digit : digit;
    const fret = Math.min(GUITAR.frets, Number(text));
    typing = { text: String(fret), at: now, note };
    beginEdit();
    setPosition(note, note.string, fret);
    place(allNotes(), { keepSelected: note });
    typing.note = view.selected;
    player.audition(midiAt(GUITAR, note.string, fret));
}

function toggleFixed() {
    const note = view.selected;
    if (!note) return;
    beginEdit();
    note.fixed = !note.fixed;
    place(allNotes(), { keepSelected: note });
}

function setAllFixed(fixed) {
    beginEdit();
    for (const n of state.notes) n.fixed = fixed;
    place();
}

function deleteSelected() {
    const note = view.selected;
    if (!note) return;
    beginEdit();
    state.notes = state.notes.filter((n) => n !== note);
    place(allNotes(), { keepSelected: null });
}

function addNote(string, time) {
    beginEdit();
    const note = { midi: midiAt(GUITAR, string, 0), start: time, duration: 0.5, velocity: 0.8 };
    setPosition(note, string, 0);
    place([...allNotes(), note], { keepSelected: note });
    typing = { text: '', at: 0, note: view.selected };
    player.audition(note.midi);
}

function restore(notes) {
    place(notes, { keepSelected: null });
}

function undo() {
    if (!state.history.length) return;
    state.future.push(copyNotes(allNotes()));
    restore(state.history.pop());
}

function redo() {
    if (!state.future.length) return;
    state.history.push(copyNotes(allNotes()));
    restore(state.future.pop());
}

// ----- fingering settings (remembered per fingering, as a convenience) -----

const settingsKey = (id) => `synesthesia.fingering.${id}`;

function loadTuned(id) {
    try { return JSON.parse(localStorage.getItem(settingsKey(id))) ?? {}; } catch { return {}; }
}

function saveTuned(id, values) {
    try { localStorage.setItem(settingsKey(id), JSON.stringify(values)); } catch { /* not remembered */ }
}

function tunedOptions() {
    const saved = loadTuned(fingering.id);
    const out = {};
    for (const s of fingering.settings ?? []) {
        const v = Number(saved[s.key]);
        if (Number.isFinite(v) && v >= s.min && v <= s.max) out[s.key] = v;
    }
    return out;
}

function renderSettings() {
    const list = fingering.settings ?? [];
    el.settingsPanel.hidden = !list.length;
    el.settingsGrid.replaceChildren();
    const tuned = tunedOptions();
    for (const s of list) {
        const value = tuned[s.key] ?? fingering.defaults[s.key];
        const format = s.format ?? String;
        const wrap = Object.assign(document.createElement('label'), { className: 'setting', title: s.help ?? '' });
        const head = Object.assign(document.createElement('div'), { className: 'setting-head' });
        const output = Object.assign(document.createElement('output'), { textContent: format(value) });
        head.append(Object.assign(document.createElement('span'), { textContent: s.label }), output);
        const input = Object.assign(document.createElement('input'), { type: 'range', min: s.min, max: s.max, step: s.step, value });
        const mark = (v) => wrap.classList.toggle('changed', v !== fingering.defaults[s.key]);
        mark(value);
        input.addEventListener('input', () => { output.textContent = format(Number(input.value)); mark(Number(input.value)); });
        input.addEventListener('change', () => {
            saveTuned(fingering.id, { ...loadTuned(fingering.id), [s.key]: Number(input.value) });
            if (allNotes().length) { beginEdit(); place(allNotes(), { again: true }); }
        });
        wrap.append(head, input);
        if (s.help) wrap.append(Object.assign(document.createElement('small'), { textContent: s.help }));
        el.settingsGrid.append(wrap);
    }
}

// ----- playback -----

function seek(t) {
    player.seek(t);
    view.setPlayhead(t);
    el.timeDisplay.textContent = formatTime(t);
}

/** The crop: what loops and what is saved. The whole tab until a handle is moved. */
function cropRange() {
    return state.crop ?? { start: 0, end: Math.max(player?.length ?? 0, view?.duration ?? 0) };
}

/** Show the crop, and keep the player's loop in step with it and the Loop checkbox. */
function updateCrop() {
    const crop = cropRange();
    view.setCrop(crop);
    player.setLoop(el.loopToggle.checked ? crop : null);
    refresh();
}

function setCrop(start, end) {
    const total = Math.max(player.length, view.duration);
    start = Math.max(0, Math.min(start, total));
    end = Math.max(start + 0.1, Math.min(end, total));
    state.crop = start <= 0 && end >= total ? null : { start, end };
    updateCrop();
}

/** Crop to where the notes start and end. */
function fitCrop() {
    const notes = allNotes();
    if (!notes.length) return;
    setCrop(Math.min(...notes.map((n) => n.start)), Math.max(...notes.map((n) => n.start + n.duration)));
}

function togglePlay() {
    if (!state.notes.length) return;
    if (player.playing) {
        player.pause();
    } else {
        let from = player.position >= player.length - 0.05 ? 0 : player.position;
        if (el.loopToggle.checked) {
            const { start, end } = cropRange();
            if (from < start || from >= end - 0.05) from = start;
        }
        player.play(from).catch((err) => setStatus(el.status, `Playback failed: ${err.message}`, 'error'));
        view.follow = el.followPlayhead.checked;
        animate();
    }
    refresh();
}

function animate() {
    const t = player.currentTime;
    view.playing = player.playing;
    view.setPlayhead(t);
    el.timeDisplay.textContent = formatTime(t);
    if (player.playing) requestAnimationFrame(animate);
    else refresh();
}

function setSpeed(rate) {
    player.setRate(rate);
    el.speed.value = rate;
    el.speedDisplay.textContent = `${Math.round(rate * 100)}%`;
}

// ----- saving -----

async function save() {
    if (!allNotes().length) return;
    const crop = cropRange();
    const notes = sortNotes(cropNotes(allNotes(), crop.start, crop.end));
    if (!notes.length) {
        setStatus(el.saveStatus, 'There are no notes inside the crop.', 'error');
        return;
    }
    const title = el.titleInput.value.trim() || 'tabs';
    const midis = notes.map((n) => n.midi);
    const noteSet = {
        notes,
        range: { minMidi: Math.min(...midis), maxMidi: Math.max(...midis) },
        extractor: state.extractor ?? { id: 'none', options: {} },
    };
    const meta = state.meta ?? {};
    // The source's start is where these notes begin in the original audio, so it moves with the crop.
    const source = meta.source ? { ...meta.source, start: (meta.source.start ?? 0) + crop.start } : undefined;
    const blob = codecs.json.encode(noteSet, {
        title, duration: crop.end - crop.start, song: meta.song ?? undefined, source, extra: meta.extra ?? undefined,
    });
    try {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tabs';
        const { filename, location } = await storage.save(slug + codecs.json.extension, blob);
        const part = state.crop ? ` (${formatTime(crop.start)} – ${formatTime(crop.end)})` : '';
        setStatus(el.saveStatus, `Saved ${notes.length} notes${part} to ${filename} in ${location}.`, 'ok');
    } catch (err) {
        setStatus(el.saveStatus, err.name === 'AbortError' ? 'Not saved.' : err.message, err.name === 'AbortError' ? '' : 'error');
    }
}

/** Move one end of the crop to the playhead. */
function cropAtPlayhead(end) {
    const t = player.currentTime;
    const crop = cropRange();
    if (end === 'start') setCrop(Math.min(t, crop.end - 0.1), crop.end);
    else setCrop(crop.start, Math.max(t, crop.start + 0.1));
}

// ----- keys -----

function onKey(e) {
    const tag = e.target.tagName;
    if ((tag === 'INPUT' && e.target.type === 'text') || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
        return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
    } else if (/^[0-9]$/.test(e.key) && view.selected) {
        typeFret(e.key);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!view.selected) return;
        e.preventDefault();
        moveString(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'l' || e.key === 'L') {
        el.loopToggle.checked = !el.loopToggle.checked;
        updateCrop();
    } else if (e.key === '[' || e.key === ']') {
        cropAtPlayhead(e.key === '[' ? 'start' : 'end');
    } else if (e.key === 'f' || e.key === 'F') {
        toggleFixed();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!view.selected) return;
        e.preventDefault();
        deleteSelected();
    } else if (e.key === 'Escape') {
        view.select(null);
    } else if (e.key === '-' || e.key === '=') {
        const step = e.key === '-' ? -0.05 : 0.05;
        setSpeed(Math.round(Math.min(SPEED.max, Math.max(SPEED.min, player.rate + step)) * 100) / 100);
    }
}

// ----- start -----

async function main() {
    config = getConfig();
    const [voiceImpl, json, midi] = await Promise.all([load('voice', config), loadImpl('codec', 'json'), loadImpl('codec', 'midi')]);
    codecs = { json, midi };
    [storage, fingering] = await Promise.all([load('storage', config), load('fingering', config)]);

    for (const id of Object.keys(registry.fingering)) {
        const impl = await loadImpl('fingering', id);
        el.fingeringSelect.append(new Option(impl.name, id, false, id === fingering.id));
    }
    el.fingeringHint.textContent = fingering.description ?? '';
    renderSettings();

    view = new TabView(el.tab, {
        guitar: GUITAR,
        onSeek: seek,
        onChoose: choosePosition,
        onMoveStart: () => beginEdit(),
        onMove: (note) => place(allNotes(), { keepSelected: note }),
        onAdd: addNote,
        onAudition: (m) => player.audition(m),
        onCropChange: ({ start, end }) => setCrop(start, end),
    });
    player = new Player(voiceImpl);
    player.onStop = () => refresh();
    await player.init();
    player.setClip(null);
    player.setNotesVolume(Number(el.volume.value));
    player.setSongVolume(0);

    el.openButton.addEventListener('click', openFile);
    el.placeButton.addEventListener('click', () => { beginEdit(); place(allNotes(), { again: true }); });
    el.fixAllButton.addEventListener('click', () => setAllFixed(true));
    el.unfixAllButton.addEventListener('click', () => setAllFixed(false));
    el.fingeringSelect.addEventListener('change', async () => {
        fingering = await loadImpl('fingering', el.fingeringSelect.value);
        el.fingeringHint.textContent = fingering.description ?? '';
        renderSettings();
        if (allNotes().length) { beginEdit(); place(allNotes(), { again: true }); }
    });
    el.resetSettingsButton.addEventListener('click', () => {
        saveTuned(fingering.id, {});
        renderSettings();
        if (allNotes().length) { beginEdit(); place(allNotes(), { again: true }); }
    });
    el.playButton.addEventListener('click', togglePlay);
    el.loopToggle.addEventListener('change', updateCrop);
    el.cropStartButton.addEventListener('click', () => cropAtPlayhead('start'));
    el.cropEndButton.addEventListener('click', () => cropAtPlayhead('end'));
    el.cropFitButton.addEventListener('click', fitCrop);
    el.cropResetButton.addEventListener('click', () => setCrop(0, Infinity));
    el.speed.addEventListener('input', () => setSpeed(Number(el.speed.value)));
    el.volume.addEventListener('input', () => player.setNotesVolume(Number(el.volume.value)));
    el.followPlayhead.addEventListener('change', () => { view.follow = el.followPlayhead.checked && player.playing; });
    el.undoButton.addEventListener('click', undo);
    el.redoButton.addEventListener('click', redo);
    el.saveButton.addEventListener('click', save);
    document.addEventListener('keydown', onKey);

    refresh();
    // For debugging in the console (and tests).
    window.tabs = { state, view, player, storage, loadNotes, codecs };
    document.body.dataset.ready = 'true';
}

main().catch((err) => {
    console.error(err);
    setStatus(el.status, `The page failed to start: ${err.message}`, 'error');
});
