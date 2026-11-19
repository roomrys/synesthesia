// The arrangement debug page: run the pipeline with a trace and plot what each
// step produced. See js/extract/arrangement.md ("Debug page").
//
// Views share one time axis (TimeView): the spectrogram, the reconstruction
// from the dictionary and activations, the residual between them, and the
// activations with candidates and kept notes. Clicking picks a moment for the
// frame slice below them.

import { registry, loadStep, STEPS } from '../extract/arrange/registry.js';
import { runPipeline } from '../extract/arrange/pipeline.js';
import { reconstruct, soundName, explainedMask } from '../extract/arrange/dictionary.js';
import { LAYER_RATE } from '../extract/spectrum.js';
import arrange from '../extract/extractors/arrange.js';
import { getConfig, loadAll, loadImpl } from '../extract/registry.js';
import { sourceButtons, sourceHint, liveError } from '../extract/sources/ui.js';
import { Player } from '../extract/player.js';
import { midiToHz, midiToName, hzToMidi, noteColor } from '../extract/music.js';
import { findAudibleRange, resampleFast } from '../extract/dsp.js';
import { PRESETS } from './test-signals.js';
import * as plots from './plots.js';

const GUTTER = 48;
const SPEC_HEIGHT = 170;
const ROW_HEIGHT = 6;
const SLICE_HEIGHT = 240;
const SLICE_COLOURS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9f1c', '#2ec4b6', '#e0aaff'];
const STEP_TITLES = {
    representation: 'Representation', rhythm: 'Rhythm', projector: 'Projector (stage 1)', picker: 'Picker',
    layers: 'Layers (stage 2)', objective: 'Objective', multiplexer: 'Multiplexer (stage 3)',
};

const $ = (id) => document.getElementById(id);
const freshOptions = () => structuredClone(arrange.defaults);
const state = {
    clip: null,
    options: freshOptions(),
    trace: null,
    derived: null,        // images and reconstruction for the current trace
    controller: null,
    player: null,
    rangeDb: 70,
    view: new plots.TimeView(),   // view.cursor is the playhead
    plots: {},
    live: null,                   // the live source listening, if any
    crop: { start: 0, end: 0 },   // time crop: what loops and plays
    pitchCrop: null,              // { min, max } MIDI notes kept, inclusive
    pitchCropMoved: false,        // moved by hand, so kept when the pipeline runs again
};
const GRAB_PX = 6;
window.debugPage = { state };

// ----- pipeline controls -----

function optionInput(key, value, setting, onChange) {
    const row = document.createElement('label');
    row.className = 'opt';
    const name = document.createElement('span');
    name.textContent = setting?.label ?? key;
    if (setting?.help) row.title = setting.help;
    const input = document.createElement('input');
    if (typeof value === 'boolean') {
        input.type = 'checkbox';
        input.checked = value;
        input.addEventListener('change', () => onChange(input.checked));
    } else {
        input.type = 'number';
        input.step = setting?.step ?? 'any';
        if (setting) { input.min = setting.min; input.max = setting.max; }
        input.value = value;
        input.addEventListener('change', () => { if (input.value !== '' && Number.isFinite(Number(input.value))) onChange(Number(input.value)); });
    }
    row.append(name, input);
    return row;
}

async function stepBox(step) {
    const box = document.createElement('div');
    box.className = 'step-box';
    box.dataset.step = step;
    const title = document.createElement('h3');
    title.innerHTML = `<span>${STEP_TITLES[step]}</span><span class="reused"></span>`;
    const select = document.createElement('select');
    for (const id of Object.keys(registry[step])) select.add(new Option(id, id));
    select.value = state.options[step];
    const impl = await loadStep(step, select.value);
    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = impl.description ?? '';
    box.append(title, select, desc);
    for (const [key, value] of Object.entries(impl.defaults)) {
        if (typeof value !== 'number' && typeof value !== 'boolean') continue;
        const full = `${step}.${key}`;
        const setting = impl.settings?.find((s) => s.key === key);
        const row = optionInput(key, state.options[full] ?? value, setting, (v) => {
            state.options[full] = v;
            row.classList.toggle('changed', v !== value);
            changed();
        });
        row.classList.toggle('changed', (state.options[full] ?? value) !== value);
        box.append(row);
    }
    select.addEventListener('change', async () => {
        for (const key of Object.keys(state.options)) if (key.startsWith(`${step}.`)) delete state.options[key];
        state.options[step] = select.value;
        box.replaceWith(await stepBox(step));
        changed();
    });
    return box;
}

async function ensembleBox() {
    const box = document.createElement('div');
    box.className = 'step-box';
    box.dataset.step = 'ensemble';
    const entry = state.options.ensemble[0];
    box.innerHTML = '<h3><span>Ensemble (instrument, timbre)</span><span class="reused"></span></h3>';
    const select = document.createElement('select');
    for (const id of Object.keys(registry.instrument)) select.add(new Option(id, id));
    select.value = entry.instrument;
    const impl = await loadStep('instrument', entry.instrument);
    const timbre = await loadStep('timbre', impl.defaultProfile.timbre);
    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = `${impl.description} Timbre: ${timbre.name} (profile “${impl.defaultProfile.name}”).`;
    box.append(select, desc);
    for (const [key, value] of Object.entries(impl.defaults)) {
        if (typeof value !== 'number' && typeof value !== 'boolean') continue;
        box.append(optionInput(key, entry.options?.[key] ?? value, null, (v) => {
            entry.options = { ...entry.options, [key]: v };
            changed();
        }));
    }
    // Timbre parameters: a profile of this instrument, edited in place.
    const params = { ...timbre.defaults, ...impl.defaultProfile.params, ...entry.profile?.params };
    const heading = document.createElement('p');
    heading.className = 'desc';
    heading.textContent = 'Timbre profile';
    box.append(heading);
    for (const [key, value] of Object.entries(params)) {
        if (typeof value !== 'number') continue;
        box.append(optionInput(key, value, null, (v) => {
            const profile = typeof entry.profile === 'object' ? entry.profile : structuredClone(impl.defaultProfile);
            entry.profile = { ...profile, params: { ...profile.params, [key]: v } };
            changed();
        }));
    }
    select.addEventListener('change', async () => {
        state.options.ensemble = [{ instrument: select.value, profile: 'default' }];
        box.replaceWith(await ensembleBox());
        changed();
    });
    return box;
}

async function buildSteps() {
    const boxes = [];
    for (const step of STEPS) {
        boxes.push(await stepBox(step));
        if (step === 'rhythm') boxes.push(await ensembleBox());
    }
    $('steps').replaceChildren(...boxes);
}

let changeTimer = null;
function changed() {
    if (!$('autoRun').checked || !state.clip) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(run, 250);
}

// ----- running -----

function setStatus(el, text, kind = '') {
    el.textContent = text;
    el.className = `status ${kind}`;
}

async function run() {
    if (!state.clip) return;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    document.body.dataset.run = 'running';
    $('progress').hidden = false;
    setStatus($('runStatus'), 'Running…');
    try {
        const { notes, stats, trace } = await runPipeline(state.clip, structuredClone(state.options), {
            trace: true,
            reuse: state.trace,
            signal: controller.signal,
            onProgress: (p) => { $('progress').value = p; },
        });
        if (controller !== state.controller) return;
        const previous = state.trace;
        state.trace = trace;
        derive(previous);
        setStatus($('runStatus'), `${stats.summary} Notes: ${notes.map((n) => midiToName(n.midi)).join(' ') || 'none'}`, 'ok');
        showTimings(trace);
        // The pitch crop fits the notes unless it was moved by hand (as on the note extractor).
        if (!state.pitchCropMoved || !state.pitchCrop) fitPitchCrop();
        else setPitchCrop(state.pitchCrop.min, state.pitchCrop.max);
        $('playButton').disabled = false;
        await updateStems();   // a new projection means new guitar-space audio
        document.body.dataset.run = 'done';
        draw();
    } catch (err) {
        if (err?.name === 'AbortError') return;
        console.error(err);
        setStatus($('runStatus'), `Error: ${err?.message ?? err}`, 'error');
        document.body.dataset.run = 'error';
    } finally {
        if (controller === state.controller) $('progress').hidden = true;
    }
}

function showTimings(trace) {
    const names = { representation: 'analysis', dictionary: 'dictionary' };
    const parts = Object.entries(trace.timings).map(([step, ms]) => `${names[step] ?? step} ${trace.reused.includes(step) ? 'reused' : `${Math.round(ms)} ms`}`);
    $('timings').textContent = `Steps: ${parts.join(' · ')}`;
    for (const box of document.querySelectorAll('.step-box')) {
        const step = box.dataset.step === 'ensemble' ? 'dictionary' : box.dataset.step;
        box.querySelector('.reused').textContent = trace.reused.includes(step) ? 'reused' : `${Math.round(trace.timings[step] ?? 0)} ms`;
    }
}

// ----- derived data and images -----

/** The order of activation rows: percussive sounds first, then pitches from high to low. */
function rowOrder(dictionary) {
    const idx = dictionary.labels.map((_, j) => j);
    const perc = idx.filter((j) => !('midi' in dictionary.labels[j].sound));
    const pitched = idx.filter((j) => 'midi' in dictionary.labels[j].sound).sort((a, b) => dictionary.labels[b].sound.midi - dictionary.labels[a].sound.midi);
    return [...perc, ...pitched];
}

function derive(previous) {
    const t = state.trace;
    const prev = state.derived;
    const sameProjection = prev && previous && previous.outputs.projector === t.outputs.projector && previous.outputs.dictionary === t.outputs.dictionary;
    const recon = sameProjection ? prev.recon : reconstruct(t.dictionary, t.activations);
    let ref = 0;
    for (const f of t.spectrogram.frames) for (const v of f) if (v > ref) ref = v;
    let maxActivation = 0;
    for (const a of t.activations.values) for (const v of a) if (v > maxActivation) maxActivation = v;
    const order = rowOrder(t.dictionary);
    const rowOf = new Map(order.map((j, r) => [j, r]));
    const rowOfMidi = new Map();   // the first member's pitches, for the pitch crop
    order.forEach((j, r) => {
        const { member, sound } = t.dictionary.labels[j];
        if (member === 0 && 'midi' in sound) rowOfMidi.set(sound.midi, r);
    });
    const midis = [...rowOfMidi.keys()];   // high to low, as the rows go
    // Resynthesised audio depends on the analysis and the reconstruction, like the images.
    const sameAudio = sameProjection && previous.outputs.representation === t.outputs.representation;
    state.derived = {
        recon, ref, maxActivation, order, rowOf, rowOfMidi, midis, images: null, imagesRange: null,
        audio: sameAudio ? prev.audio : {},
    };
    if (sameProjection && prev.images && prev.imagesRange === state.rangeDb && previous.outputs.representation === t.outputs.representation) {
        state.derived.images = prev.images;
        state.derived.imagesRange = prev.imagesRange;
    }
}

function images() {
    const d = state.derived;
    if (d.images && d.imagesRange === state.rangeDb) return d.images;
    const { spectrogram, activations } = state.trace;
    const frames = spectrogram.frames;
    const bins = spectrogram.hz.length;
    const range = state.rangeDb;
    const at = (r) => bins - 1 - r;
    d.images = {
        original: plots.heatImage(frames.length, bins, (f, r) => plots.magma(plots.dbLevel(frames[f][at(r)], d.ref, range))),
        reconstruction: plots.heatImage(frames.length, bins, (f, r) => plots.magma(plots.dbLevel(d.recon[f][at(r)], d.ref, range))),
        residual: plots.heatImage(frames.length, bins, (f, r) => {
            const diff = frames[f][at(r)] - d.recon[f][at(r)];
            return plots.diverging(Math.sign(diff) * plots.dbLevel(Math.abs(diff), d.ref, range));
        }),
        activations: plots.heatImage(frames.length, d.order.length, (f, r) => plots.magma(plots.dbLevel(activations.values[d.order[r]][f], d.maxActivation, range))),
    };
    d.imagesRange = range;
    return d.images;
}

// ----- plots -----

const VIEWS = {
    original: { title: 'Spectrogram', kind: 'spec' },
    reconstruction: { title: 'Guitar space', kind: 'spec' },
    residual: { title: 'Residual', kind: 'spec' },
    activations: { title: 'Activations', kind: 'act' },
};

function makePlots() {
    const container = $('plots');
    for (const [name, def] of Object.entries(VIEWS)) {
        const canvas = document.createElement('canvas');
        canvas.dataset.view = name;
        container.append(canvas);
        plots.attachTimeControls(canvas, state.view, GUTTER, {
            grab: (at) => grab(name, at),
            onPick: (t) => setPlayhead(t),
        });
        canvas.addEventListener('pointermove', (e) => hover(name, canvas, e));
        canvas.addEventListener('pointerleave', () => { $('readout').innerHTML = '&nbsp;'; });
        state.plots[name] = { canvas, def };
    }
}

const visible = (name) => document.querySelector(`input[data-view="${name}"]`).checked;

function specMarks(rect) {
    const { hz } = state.trace.spectrogram;
    const bins = hz.length;
    const marks = [];
    for (let octave = 1; octave <= 8; octave++) {
        const target = midiToHz(12 * (octave + 1));
        if (target < hz[0] || target > hz[bins - 1]) continue;
        let k = 0;
        for (let i = 1; i < bins; i++) if (Math.abs(Math.log(hz[i] / target)) < Math.abs(Math.log(hz[k] / target))) k = i;
        marks.push({ y: rect.y + ((bins - 1 - k + 0.5) / bins) * rect.height, text: `C${octave}` });
    }
    return marks;
}

function actHeight() {
    return Math.max(160, state.derived.order.length * ROW_HEIGHT);
}

function drawPlot(name) {
    const p = state.plots[name];
    p.canvas.hidden = !visible(name);
    if (p.canvas.hidden) return;
    const isAct = p.def.kind === 'act';
    const { ctx, width, height } = plots.fitCanvas(p.canvas, isAct ? actHeight() : SPEC_HEIGHT);
    const rect = { x: GUTTER, y: 0, width: width - GUTTER, height };
    const view = state.view;
    const { spectrogram } = state.trace;
    plots.drawHeat(ctx, images()[name], view, rect, spectrogram.hopSeconds);
    let marks;
    if (isAct) {
        drawActivationOverlays(ctx, rect);
        const rowH = rect.height / state.derived.order.length;
        marks = state.derived.order.flatMap((j, r) => {
            const sound = state.trace.dictionary.labels[j].sound;
            const show = !('midi' in sound) || rowH >= 9 || sound.midi % 12 === 0 || sound.midi % 12 === 4;
            return show ? [{ y: rect.y + (r + 0.5) * rowH, text: soundName(sound) }] : [];
        });
    } else {
        marks = specMarks(rect);
    }
    plots.drawCrop(ctx, view, rect, state.crop);
    if (isAct) drawPitchCrop(ctx, rect);
    plots.drawTimeGrid(ctx, view, rect);
    drawOnsets(ctx, rect, isAct);
    plots.drawMarkers(ctx, view, rect);
    plots.drawGutter(ctx, rect, marks, p.def.title);
}

function drawOnsets(ctx, rect, full) {
    ctx.save();
    ctx.strokeStyle = full ? 'rgba(80, 160, 255, 0.35)' : 'rgba(80, 160, 255, 0.9)';
    for (const t of state.trace.rhythm.onsets) {
        if (t < state.view.t0 || t > state.view.t1) continue;
        const x = state.view.x(t, rect.x, rect.width);
        ctx.beginPath();
        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + (full ? rect.height : 8));
        ctx.stroke();
    }
    ctx.restore();
}

function drawActivationOverlays(ctx, rect) {
    const { candidates, choices } = state.trace;
    const { rowOf, order } = state.derived;
    const rowH = rect.height / order.length;
    const view = state.view;
    const box = (c) => {
        const x0 = view.x(c.start, rect.x, rect.width);
        const x1 = view.x(c.start + c.duration, rect.x, rect.width);
        return { x: x0, y: rect.y + rowOf.get(c.column) * rowH, w: Math.max(2, x1 - x0), h: rowH };
    };
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    for (const c of candidates) {
        if (c.start > view.t1 || c.start + c.duration < view.t0) continue;
        const b = box(c);
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, Math.max(1, b.h - 1));
    }
    for (const { candidate: c } of choices) {
        if (c.start > view.t1 || c.start + c.duration < view.t0) continue;
        const b = box(c);
        ctx.fillStyle = 'midi' in c.sound ? noteColor(c.sound.midi) : '#ffffff';
        ctx.globalAlpha = !('midi' in c.sound) || inPitchCrop(c.sound.midi) ? 0.75 : 0.2;
        ctx.fillRect(b.x, b.y, b.w, Math.max(2, b.h));
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

// ----- crops and the playhead -----

const inPitchCrop = (midi) => !state.pitchCrop || (midi >= state.pitchCrop.min && midi <= state.pitchCrop.max);

/** Kept notes inside the pitch crop: what plays. */
function playedNotes() {
    return (state.trace?.notes ?? []).filter((n) => inPitchCrop(n.midi));
}

/** The y range (top, bottom) of a pitch's row on the activations plot, or null. */
function pitchRowY(midi, rect) {
    const row = state.derived?.rowOfMidi.get(midi);
    if (row === undefined) return null;
    const rowH = rect.height / state.derived.order.length;
    return { top: rect.y + row * rowH, bottom: rect.y + (row + 1) * rowH };
}

/** The pitch whose row is at y, clamped to the pitched rows. */
function pitchAtY(y, rect) {
    const { midis } = state.derived;   // high to low, as the rows go
    let best = midis[0];
    for (const m of midis) {
        const r = pitchRowY(m, rect);
        if (y >= r.top) best = m;
    }
    return best;
}

function drawPitchCrop(ctx, rect) {
    const crop = state.pitchCrop;
    if (!crop) return;
    const top = pitchRowY(crop.max, rect);
    const bottom = pitchRowY(crop.min, rect);
    if (!top || !bottom) return;
    const firstPitch = pitchRowY(state.derived.midis[0], rect).top;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(rect.x, firstPitch, rect.width, top.top - firstPitch);
    ctx.fillRect(rect.x, bottom.bottom, rect.width, rect.y + rect.height - bottom.bottom);
    ctx.strokeStyle = ctx.fillStyle = '#ffd400';
    ctx.lineWidth = 2;
    for (const y of [top.top, bottom.bottom]) {
        ctx.beginPath();
        ctx.moveTo(rect.x, y);
        ctx.lineTo(rect.x + rect.width, y);
        ctx.stroke();
        ctx.fillRect(rect.x + 4, y - 4, 20, 8);   // grip
    }
    ctx.restore();
}

/** What's under the pointer to drag on plot `name`: the playhead, a time-crop handle, or a pitch-crop handle. */
function grab(name, at) {
    if (!state.trace) return null;
    const view = state.view;
    const rect = { x: GUTTER, y: 0, width: at.width - GUTTER, height: at.height };
    const near = (t) => t !== null && Math.abs(view.x(t, rect.x, rect.width) - at.x) <= GRAB_PX;
    if (near(view.cursor)) {
        return { cursor: 'ew-resize', drag: (a) => setPlayhead(a.t) };
    }
    if (near(state.crop.start)) {
        return { cursor: 'col-resize', drag: (a) => setCrop(Math.min(a.t, state.crop.end - 0.1), state.crop.end) };
    }
    if (near(state.crop.end)) {
        return { cursor: 'col-resize', drag: (a) => setCrop(state.crop.start, Math.max(a.t, state.crop.start + 0.1)) };
    }
    if (name === 'activations' && state.pitchCrop) {
        const top = pitchRowY(state.pitchCrop.max, rect);
        const bottom = pitchRowY(state.pitchCrop.min, rect);
        if (top && Math.abs(at.y - top.top) <= GRAB_PX) {
            return { cursor: 'row-resize', drag: (a) => setPitchCrop(state.pitchCrop.min, Math.max(state.pitchCrop.min, pitchAtY(a.y + 1, rect)), { moved: true }) };
        }
        if (bottom && Math.abs(at.y - bottom.bottom) <= GRAB_PX) {
            return { cursor: 'row-resize', drag: (a) => setPitchCrop(Math.min(state.pitchCrop.max, pitchAtY(a.y - 1, rect)), state.pitchCrop.max, { moved: true }) };
        }
    }
    return null;
}

const formatTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Move the playhead (and the frame slice) to `t`, and the player with it. */
function setPlayhead(t) {
    const clamped = Math.max(0, Math.min(state.view.duration, t));
    state.view.cursor = clamped;
    state.player?.seek(clamped);
    $('timeDisplay').textContent = formatTime(clamped);
    draw();
}

function setCrop(start, end) {
    const duration = state.clip?.duration ?? 0;
    state.crop = { start: Math.max(0, start), end: Math.min(duration, end) };
    updateLoop();
    refreshCropUI();
    draw();
}

function fitCropToAudio() {
    if (!state.clip) return;
    const range = findAudibleRange(state.clip.samples, state.clip.sampleRate);
    if (!range) {
        setStatus($('audioStatus'), 'The audio seems silent, so the crop was left as it is.');
        return;
    }
    setCrop(range.start, range.end);
}

function setPitchCrop(min, max, { moved = false } = {}) {
    state.pitchCrop = { min, max };
    if (moved) state.pitchCropMoved = true;
    state.player?.setNotes(playedNotes());
    refreshCropUI();
    draw();
}

function fitPitchCrop() {
    const notes = state.trace?.notes ?? [];
    state.pitchCropMoved = false;
    if (!notes.length) {
        state.pitchCrop = null;
        state.player?.setNotes([]);
        refreshCropUI();
        draw();
        return;
    }
    setPitchCrop(Math.min(...notes.map((n) => n.midi)), Math.max(...notes.map((n) => n.midi)));
}

function refreshCropUI() {
    const has = Boolean(state.clip);
    for (const id of ['cropStartButton', 'cropEndButton', 'cropFitButton', 'cropResetButton']) $(id).disabled = !has;
    $('cropDisplay').textContent = has
        ? `${formatTime(state.crop.start)} – ${formatTime(state.crop.end)} (${(state.crop.end - state.crop.start).toFixed(1)} s)` : '–';
    const notes = state.trace?.notes ?? [];
    $('pitchFitButton').disabled = !notes.length;
    $('pitchDisplay').textContent = state.pitchCrop && notes.length
        ? `${midiToName(state.pitchCrop.min)} – ${midiToName(state.pitchCrop.max)} (${playedNotes().length} of ${notes.length})` : '–';
}

function updateLoop() {
    state.player?.setLoop($('loopToggle').checked ? { ...state.crop } : null);
}

function hover(name, canvas, e) {
    if (!state.trace) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < GUTTER) return;
    const t = state.view.time(x, GUTTER, r.width - GUTTER);
    const { spectrogram, activations, dictionary, candidates } = state.trace;
    const f = Math.max(0, Math.min(spectrogram.frames.length - 1, Math.round(t / spectrogram.hopSeconds)));
    const db = (v, ref) => (v > 0 ? `${(20 * Math.log10(v / ref)).toFixed(1)} dB` : '−∞');
    let text;
    if (state.plots[name].def.kind === 'spec') {
        const bins = spectrogram.hz.length;
        const k = Math.max(0, Math.min(bins - 1, bins - 1 - Math.floor((y / r.height) * bins)));
        const hz = spectrogram.hz[k];
        const v = spectrogram.frames[f][k];
        const rec = state.derived.recon[f][k];
        text = `${t.toFixed(3)} s · ${hz.toFixed(1)} Hz (${midiToName(Math.round(hzToMidi(hz)))}) · original ${db(v, 1)} · guitar space ${db(rec, 1)} · residual ${db(Math.abs(v - rec), 1)}${v - rec < 0 ? ' (over)' : ''}`;
    } else {
        const row = Math.max(0, Math.min(state.derived.order.length - 1, Math.floor((y / r.height) * state.derived.order.length)));
        const j = state.derived.order[row];
        const a = activations.values[j][f];
        const cand = candidates.find((c) => c.column === j && t >= c.start && t <= c.start + c.duration);
        const kept = cand && state.trace.choices.some((ch) => ch.candidate === cand);
        text = `${t.toFixed(3)} s · ${soundName(dictionary.labels[j].sound)} · activation ${a.toFixed(4)} (${db(a, state.derived.maxActivation)} of the loudest)`
            + (cand ? ` · candidate from ${cand.start.toFixed(3)} s for ${cand.duration.toFixed(3)} s, rose ${cand.strength.toFixed(4)}${kept ? ', kept' : ', not kept'}` : '');
    }
    $('readout').textContent = text;
}

// ----- frame slice -----

function drawSlice() {
    const row = $('sliceRow');
    row.hidden = !visible('slice');
    if (row.hidden) return;
    const canvas = $('sliceCanvas');
    const { ctx, width, height } = plots.fitCanvas(canvas, SLICE_HEIGHT);
    const rect = { x: GUTTER, y: 4, width: width - GUTTER - 4, height: height - 22 };
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const legend = $('sliceLegend');
    const { spectrogram, activations, dictionary } = state.trace;
    if (state.view.cursor === null) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('Click a plot above to look at one moment.', rect.x + 8, rect.y + 20);
        legend.replaceChildren();
        return;
    }
    const f = Math.max(0, Math.min(spectrogram.frames.length - 1, Math.round(state.view.cursor / spectrogram.hopSeconds)));
    const v = spectrogram.frames[f];
    const rec = state.derived.recon[f];
    const bins = v.length;
    const ref = state.derived.ref;
    const range = state.rangeDb;
    const xOf = (k) => rect.x + ((k + 0.5) / bins) * rect.width;
    const yOf = (value) => rect.y + (1 - plots.dbLevel(value, ref, range)) * rect.height;

    // Grid: dB lines and octave marks.
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    for (let d = 0; d <= range; d += 10) {
        const y = rect.y + (d / range) * rect.height;
        ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.width, y); ctx.stroke();
        ctx.fillText(`−${d}`, 4, y + 3);
    }
    for (const m of specMarks({ y: 0, height: bins })) {
        const k = bins - 1 - Math.round(m.y - 0.5);
        const x = xOf(k);
        ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.height); ctx.stroke();
        ctx.fillText(m.text, x + 2, rect.y + rect.height + 12);
    }

    const line = (values, style, widthPx, dash = []) => {
        ctx.save();
        ctx.strokeStyle = style;
        ctx.lineWidth = widthPx;
        ctx.setLineDash(dash);
        ctx.beginPath();
        for (let k = 0; k < bins; k++) {
            const x = xOf(k), y = yOf(values[k]);
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    };

    // The strongest templates at this frame, each drawn on its own.
    let total = 0, left = 0;
    for (let i = 0; i < bins; i++) { total += v[i] * v[i]; left += (v[i] - rec[i]) ** 2; }
    const top = dictionary.columns.map((_, j) => ({ j, a: activations.values[j][f] }))
        .filter((c) => c.a > 0).sort((a, b) => b.a - a.a).slice(0, SLICE_COLOURS.length);
    top.forEach(({ j, a }, i) => line(dictionary.columns[j].map((w) => w * a), SLICE_COLOURS[i], 1));
    line(v, '#ffffff', 2);
    line(rec, '#5ee7ff', 1.5, [5, 3]);

    const items = [
        { colour: '#ffffff', text: `original · ${state.view.cursor.toFixed(3)} s` },
        { colour: '#5ee7ff', text: `guitar space · explains ${total > 0 ? Math.round(100 * (1 - left / total)) : 0}%` },
        ...top.map(({ j, a }, i) => {
            let share = 0;
            const w = dictionary.columns[j];
            for (let k = 0; k < bins; k++) share += (a * w[k]) ** 2;
            return { colour: SLICE_COLOURS[i], text: `${soundName(dictionary.labels[j].sound).padEnd(5)} ${a.toFixed(4)} · ${total > 0 ? Math.round((100 * share) / total) : 0}%` };
        }),
    ];
    legend.replaceChildren(...items.map(({ colour, text }) => {
        const div = document.createElement('div');
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = colour;
        const label = document.createElement('span');
        label.textContent = text;
        div.append(swatch, label);
        return div;
    }));
}

// ----- drawing -----

let frameRequested = false;
function draw() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
        frameRequested = false;
        if (!state.trace) return;
        for (const name of Object.keys(VIEWS)) drawPlot(name);
        drawSlice();
    });
}

// ----- audio sources -----

const MAX_LISTEN_SECONDS = 20 * 60;

async function setupSources() {
    const config = getConfig();
    const sources = await loadAll('source', config);
    $('sourceButtons').append(...sourceButtons(sources, { onLive: startLive, onFile: openFile }));
    $('sourceHint').textContent = sourceHint(sources, config, { page: 'debug/arrange.html' });
    if (!sources.length) setStatus($('audioStatus'), 'None of the configured audio sources work in this browser.', 'error');
}

function setListening(listening) {
    $('liveControls').hidden = !listening;
    for (const b of $('sourceButtons').querySelectorAll('button')) b.disabled = listening;
    $('presetSelect').disabled = listening;
}

async function startLive(source) {
    setStatus($('audioStatus'), '');
    state.player?.pause();
    try {
        await source.start({
            onLevel: ({ peak, seconds }) => {
                $('level').value = Math.max(peak, $('level').value * 0.85);
                $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
                if (seconds >= MAX_LISTEN_SECONDS) stopLive(`Stopped after ${MAX_LISTEN_SECONDS / 60} minutes.`);
            },
            onEnded: () => stopLive(),
        });
        state.live = source;
        $('elapsed').textContent = '0:00';
        setListening(true);
    } catch (err) {
        const { cancelled, message } = liveError(err);
        setStatus($('audioStatus'), message, cancelled ? '' : 'error');
    }
}

async function stopLive(message = '') {
    const source = state.live;
    if (!source) return;
    state.live = null;
    setListening(false);
    try {
        const clip = await source.stop();
        if (clip.duration < 0.5) {
            setStatus($('audioStatus'), 'Less than half a second of audio was captured.', 'error');
            return;
        }
        setStatus($('audioStatus'), message);
        $('presetSelect').value = '';
        await setClip(clip);
    } catch (err) {
        setStatus($('audioStatus'), err?.message ?? String(err), 'error');
    }
}

async function openFile(source, file) {
    setStatus($('audioStatus'), `Opening ${file.name}…`);
    try {
        const clip = await source.open(file);
        setStatus($('audioStatus'), '');
        $('presetSelect').value = '';
        await setClip(clip);
    } catch (err) {
        setStatus($('audioStatus'), err?.message ?? String(err), 'error');
    }
}

/** Drop the clip and everything computed from it (audio stays in memory only while in use). */
function clearClip() {
    state.controller?.abort();
    state.player?.pause();
    state.player?.setClip(null);
    state.player?.setNotes([]);
    state.clip = null;
    state.trace = null;
    state.derived = null;
    state.pitchCrop = null;
    state.pitchCropMoved = false;
    refreshCropUI();
    $('clipRow').hidden = true;
    $('runButton').disabled = true;
    $('playButton').disabled = true;
    $('presetSelect').value = '';
    setStatus($('runStatus'), '');
    $('timings').textContent = '';
    for (const canvas of document.querySelectorAll('#plots canvas')) canvas.hidden = true;
    $('sliceRow').hidden = true;
}

// ----- audio and playback -----

async function setClip(clip) {
    state.player?.pause();
    state.clip = clip;
    state.trace = null;
    state.derived = null;
    state.pitchCrop = null;
    state.pitchCropMoved = false;
    state.view.reset(clip.duration);
    $('clipInfo').textContent = `${clip.label ?? 'Clip'} · ${clip.duration.toFixed(2)} s · ${clip.sampleRate} Hz`;
    $('clipRow').hidden = false;
    $('runButton').disabled = false;
    state.player?.setClip(clip);
    // The time crop starts fitted to the audio, as on the note extractor.
    state.crop = { start: 0, end: clip.duration };
    fitCropToAudio();
    setPlayhead(0);
    await run();
}

async function ensurePlayer() {
    if (state.player) return state.player;
    const player = new Player(await loadImpl('voice', 'tone'));
    await player.init();
    player.setSongVolume(Number($('songVolume').value));
    player.setNotesVolume(Number($('notesVolume').value));
    STEM_SLIDERS.forEach((id, i) => player.setTrackVolume(i + 1, Number($(id).value)));
    player.onStop = () => {
        $('playButton').textContent = '▶ Play';
        state.view.cursor = player.position;
        draw();
    };
    player.setClip(state.clip);
    player.setNotes(playedNotes());
    player.setRate(Number($('speed').value));
    player.position = state.view.cursor ?? 0;
    state.player = player;
    updateLoop();
    return player;
}

async function togglePlay() {
    if (!state.clip) return;
    try {
        const player = await ensurePlayer();
        if (player.playing) {
            player.pause();
            $('playButton').textContent = '▶ Play';
            state.view.cursor = player.position;
            draw();
            return;
        }
        await updateStems();
        let from = state.view.cursor ?? 0;
        if ($('loopToggle').checked && (from < state.crop.start || from >= state.crop.end - 0.05)) from = state.crop.start;
        await player.play(from);
        $('playButton').textContent = '❚❚ Pause';
        requestAnimationFrame(follow);
    } catch (err) {
        setStatus($('audioStatus'), `Playback failed: ${err?.message ?? err}`, 'error');
    }
}

/** While playing: move the playhead with the song, and keep it on screen if Follow is on. */
function follow() {
    const player = state.player;
    if (!player?.playing) return;
    const t = player.currentTime;
    state.view.cursor = t;
    $('timeDisplay').textContent = formatTime(t);
    const span = state.view.t1 - state.view.t0;
    if ($('followPlayhead').checked && (t > state.view.t1 || t < state.view.t0)) state.view.panBy(t - state.view.t0 - 0.1 * span);
    else draw();
    requestAnimationFrame(follow);
}

// Stems: guitar space and the residual, resynthesised from the spectrogram with a
// soft mask and its complement (so they add up to the song), then played with
// the song as extra channels: track 1 is guitar space, track 2 the residual.
const STEM_SLIDERS = ['guitarVolume', 'residualVolume'];

/** Guitar space and the residual at the clip's rate, computed once per projection (shared while in progress). */
function stems() {
    const d = state.derived;
    d.audio.stems ??= computeStems(d).catch((err) => {
        delete d.audio.stems;   // try again next time
        throw err;
    });
    return d.audio.stems;
}

async function computeStems(d) {
    const { clip, trace } = state;
    const representation = await loadStep('representation', trace.options.representation);
    if (!representation.resynthesize) throw new Error(`The ${representation.id} representation can't be played back.`);
    setStatus($('audioStatus'), 'Preparing guitar space and the residual…');
    const guitarMask = explainedMask(trace.spectrogram.frames, d.recon);
    const residualMask = guitarMask.map((m) => m.map((v) => 1 - v));
    const opts = { options: trace.stepOptions.representation };
    // At the clip's rate and exactly its length, as the player's channels must be.
    const toClipRate = async (x) => {
        const y = await resampleFast(x, LAYER_RATE, clip.sampleRate);
        const out = new Float32Array(clip.samples.length);
        out.set(y.subarray(0, out.length));
        return out;
    };
    const guitar = await toClipRate(await representation.resynthesize(clip, guitarMask, opts));
    const residual = await toClipRate(await representation.resynthesize(clip, residualMask, opts));
    setStatus($('audioStatus'), '');
    return [guitar, residual];
}

/**
 * Give the player the current stems if a stem slider is up, or none (so stale
 * ones from an earlier projection never play). Keeps the playhead and playback.
 */
async function updateStems() {
    const player = state.player;
    if (!player || !state.trace) return;
    try {
        const wanted = STEM_SLIDERS.some((id) => Number($(id).value) > 0);
        const next = wanted ? await stems() : [];
        const current = player.stems;
        if (next.length === current.length && next.every((s, i) => s === current[i])) return;
        await player.setStems(next);
    } catch (err) {
        setStatus($('audioStatus'), `Playback failed: ${err?.message ?? err}`, 'error');
    }
}

function setSpeed(rate) {
    const r = Math.max(0.25, Math.min(1.5, Math.round(rate * 20) / 20));
    $('speed').value = r;
    $('speedDisplay').textContent = `${Math.round(r * 100)}%`;
    state.player?.setRate(r);
}

// ----- wiring -----

async function init() {
    for (const [id, p] of Object.entries(PRESETS)) $('presetSelect').add(new Option(p.name, id));
    $('presetSelect').addEventListener('change', () => {
        const preset = PRESETS[$('presetSelect').value];
        if (preset) setClip(preset.make());
    });
    $('stopButton').addEventListener('click', () => stopLive());
    $('clearButton').addEventListener('click', clearClip);
    await setupSources();
    $('runButton').addEventListener('click', run);
    $('resetButton').addEventListener('click', async () => {
        state.options = freshOptions();
        await buildSteps();
        changed();
    });
    $('playButton').addEventListener('click', togglePlay);
    $('songVolume').addEventListener('input', () => state.player?.setSongVolume(Number($('songVolume').value)));
    $('notesVolume').addEventListener('input', () => state.player?.setNotesVolume(Number($('notesVolume').value)));
    $('rangeDb').addEventListener('input', () => {
        state.rangeDb = Number($('rangeDb').value);
        $('rangeDisplay').textContent = `${state.rangeDb} dB`;
        draw();
    });
    $('fitButton').addEventListener('click', () => state.view.reset(state.view.duration));
    for (const box of document.querySelectorAll('input[data-view]')) box.addEventListener('change', draw);
    $('loopToggle').addEventListener('change', updateLoop);
    STEM_SLIDERS.forEach((id, i) => $(id).addEventListener('input', () => {
        state.player?.setTrackVolume(i + 1, Number($(id).value));
        updateStems();
    }));
    $('speed').addEventListener('input', () => setSpeed(Number($('speed').value)));
    $('cropStartButton').addEventListener('click', () => setCrop(Math.min(state.view.cursor ?? 0, state.crop.end - 0.1), state.crop.end));
    $('cropEndButton').addEventListener('click', () => setCrop(state.crop.start, Math.max(state.view.cursor ?? 0, state.crop.start + 0.1)));
    $('cropFitButton').addEventListener('click', fitCropToAudio);
    $('cropResetButton').addEventListener('click', () => setCrop(0, state.clip?.duration ?? 0));
    $('pitchFitButton').addEventListener('click', fitPitchCrop);
    document.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'range';
        if (typing || !state.clip) return;
        if (e.key === ' ' && document.activeElement?.tagName === 'BUTTON') return;   // the button handles it
        if (e.key === ' ') {
            e.preventDefault();
            togglePlay();
        } else if (e.key === '[') {
            $('cropStartButton').click();
        } else if (e.key === ']') {
            $('cropEndButton').click();
        } else if (e.key === 'l') {
            $('loopToggle').checked = !$('loopToggle').checked;
            updateLoop();
        } else if (e.key === '-' || e.key === '=') {
            setSpeed(Number($('speed').value) + (e.key === '-' ? -0.05 : 0.05));
        }
    });
    window.addEventListener('resize', draw);
    state.view.onChange(draw);
    makePlots();
    await buildSteps();
    document.body.dataset.ready = 'true';
    // ?preset=band opens a test clip straight away; &cursor=1.2 puts the playhead (and the slice) there.
    const params = new URLSearchParams(location.search);
    const preset = params.get('preset');
    if (PRESETS[preset]) {
        $('presetSelect').value = preset;
        await setClip(PRESETS[preset].make());
        if (params.has('cursor')) setPlayhead(Number(params.get('cursor')));
    }
}

init().catch((err) => {
    console.error(err);
    setStatus($('audioStatus'), `The page failed to start: ${err?.message ?? err}`, 'error');
});
