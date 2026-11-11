// Canvas timeline: overview strip, waveform, piano roll (fretboard colours),
// pitch track, an optional debug layer (spectrogram or harmonic sum), crop
// handles and playhead.
//
// Mouse: scroll to zoom, horizontal scroll or drag to pan, click to jump.
// Yellow handles crop: vertical ones set the time range, horizontal ones set
// the pitch range (notes kept). Drag in the overview to move the view.
//
// In edit mode, dragging in the piano roll edits notes instead of panning:
// drag empty space to add a note, drag a note to move it (with any other
// selected notes), drag its ends to resize it, Shift+drag to box-select and
// Shift+click to add or remove a note from the selection. Times snap to onsets
// and to other notes unless snapping is off or Alt is held. Dragging past the
// left or right edge scrolls. The timeline changes the note objects in place
// and reports through onEditStart (before the first change, for undo) and
// onEdit (after).

import { midiToName, noteColor, overtones, pitchClass } from './music.js';

const GUTTER = 44;
const OVERVIEW_H = 34;
const WAVE_H = 56;
const GAP = 6;
const HANDLE_HIT = 7;
const BLOCK = 256;
const MIN_SPAN = 0.5;
const SHARPS = new Set([1, 3, 6, 8, 10]);
const EDGE_HIT = 5;          // pixels at each end of a note that resize it
const MIN_NOTE = 0.03;       // shortest note you can draw, in seconds
const OVERTONES = overtones(8);
const HOVER_WIDTH = 56;      // pixels: the hover preview starts at the cursor and extends right
const SNAP_PX = 8;           // snap to a target this close, in pixels
const EDGE_ZONE = 30;        // pixels from the left/right edge where dragging scrolls
const AUTO_SCROLL_RATE = 0.2;  // views per second at the edge (doubles far past it)

const COLORS = {
    background: '#0d0d12',
    panel: '#16161e',
    wave: '#8a8aa8',
    waveDim: '#4a4a5e',
    grid: '#2a2a38',
    sharpRow: '#121218',
    text: '#b8b8cc',
    crop: '#ffd400',
    outside: 'rgba(0, 0, 0, 0.6)',
    outsideLayer: 'rgba(0, 0, 0, 0.25)',
    playhead: '#ffffff',
    selected: '#ffffff',
    onset: '#7fe7ff',
    box: 'rgba(127, 231, 255, 0.12)',
    view: 'rgba(255, 255, 255, 0.7)',
    pitch: 'rgba(255, 255, 255, 0.45)',
    rejected: '#c8c8ff',
};

const TILE_COLUMNS = 4096;   // canvases wider than this are split into tiles

// Dark to bright: black, purple, red, orange, pale yellow (like "inferno").
const LAYER_STOPS = [[0, 0, 0, 4], [0.25, 87, 16, 110], [0.5, 188, 55, 84], [0.75, 249, 142, 9], [1, 252, 255, 164]];
const LAYER_LUT = (() => {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
        const v = i / 255;
        const k = Math.min(LAYER_STOPS.length - 2, Math.floor(v * (LAYER_STOPS.length - 1)));
        const [a, b] = [LAYER_STOPS[k], LAYER_STOPS[k + 1]];
        const t = (v - a[0]) / (b[0] - a[0]);
        for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * t;
    }
    return lut;
})();

function formatTime(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(s < 10 && m === 0 ? 1 : 0)}`;
}

function niceStep(span, pixels) {
    const target = span / Math.max(1, pixels / 90);
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    return steps.find((s) => s >= target) ?? 600;
}

export class Timeline {
    constructor(canvas, { onSeek, onCropChange, onPitchCropChange, onEditStart, onEdit, onAudition } = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onSeek = onSeek;
        this.onCropChange = onCropChange;
        this.onPitchCropChange = onPitchCropChange;
        this.onEditStart = onEditStart;   // () before a note is changed
        this.onEdit = onEdit;             // () after a note was added, moved or resized
        this.onAudition = onAudition;     // (midi) to preview a pitch while editing
        this.editing = false;
        this.selection = new Set();       // selected notes while editing
        this.hover = null;                // { midi, x } where a note would be drawn, while editing
        this.onsets = [];                 // sorted times where notes seem to start (from spectrum.js)
        this.snapping = true;
        this.pitchCrop = { min: 40, max: 88 };   // kept notes, inclusive MIDI
        this.clip = null;
        this.duration = 0;
        this.notes = [];
        this.pitchTrack = null;
        this.minMidi = 40;
        this.maxMidi = 88;
        this.crop = { start: 0, end: 0 };
        this.view = { start: 0, end: 1 };
        this.playhead = 0;
        this.follow = false;
        this.peakCache = new Map();
        this.layer = null;        // { data, kind } from spectrum.js computeLayers
        this.layerFloor = 0.4;    // values below this are hidden
        this.layerTiles = null;

        new ResizeObserver(() => this.resize()).observe(canvas);
        canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
        canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
        canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
        canvas.addEventListener('pointerleave', () => this.setHover(null));
        canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
        this.resize();
    }

    // ----- data -----

    /** Show a clip (or none) spanning `duration` seconds. Resets view and crop. */
    setClip(clip, duration = clip?.duration ?? 0) {
        this.clip = clip;
        this.duration = duration;
        this.blocks = clip ? this.buildBlocks(clip.samples) : null;
        this.peakCache.clear();
        this.view = { start: 0, end: Math.max(MIN_SPAN, duration) };
        this.crop = { start: 0, end: duration };
        this.playhead = 0;
        this.draw();
    }

    setNotes(notes, pitchTrack = null) {
        this.notes = notes;
        const present = new Set(notes);
        for (const n of this.selection) if (!present.has(n)) this.selection.delete(n);
        this.pitchTrack = pitchTrack;
        const end = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
        if (end > this.duration) {
            this.duration = end;
            if (!this.clip) this.view.end = Math.max(this.view.end, end);
        }
        this.draw();
    }

    setEditing(on) {
        this.editing = on;
        if (!on) {
            this.selection.clear();
            this.hover = null;
        }
        this.draw();
    }

    /** Select a note, a list of notes, or nothing (null). */
    select(notes) {
        this.selection = new Set(!notes ? [] : Array.isArray(notes) ? notes : [notes]);
        this.draw();
    }

    /** The selected note if exactly one is selected. */
    get selected() {
        return this.selection.size === 1 ? [...this.selection][0] : null;
    }

    /** Times (seconds, any order) where notes seem to start; shown and snapped to while editing. */
    setOnsets(times) {
        this.onsets = Float64Array.from(times ?? []).sort();
        this.draw();
    }

    setSnapping(on) {
        this.snapping = on;
    }

    setHover(hover) {
        if (hover?.midi === this.hover?.midi && hover?.x === this.hover?.x) return;
        this.hover = hover;
        this.draw();
    }

    /** Show a debug layer: `data` from computeLayers, `kind` 'spectrogram' | 'salience'. Null hides it. */
    setLayer(data, kind) {
        this.layer = data && kind ? { data, kind } : null;
        this.layerTiles = null;
        this.draw();
    }

    /** Hide layer values below `floor` (0–1); the rest is stretched to the full colour range. */
    setLayerFloor(floor) {
        this.layerFloor = floor;
        this.layerTiles = null;
        this.draw();
    }

    /** The pitch rows shown in the piano roll. */
    setRange(minMidi, maxMidi) {
        this.minMidi = minMidi;
        this.maxMidi = maxMidi;
        this.draw();
    }

    /** The pitch crop: notes from `min` to `max` (inclusive) are kept. */
    setPitchCrop(min, max) {
        this.pitchCrop = { min, max };
        this.draw();
    }

    inPitchCrop(midi) {
        return midi >= this.pitchCrop.min && midi <= this.pitchCrop.max;
    }

    setCrop(start, end) {
        this.crop = { start, end };
        this.draw();
    }

    setPlayhead(t) {
        this.playhead = t;
        if (this.follow) {
            const span = this.view.end - this.view.start;
            if (t > this.view.end - span * 0.02 || t < this.view.start) this.setView(t - span * 0.1, t + span * 0.9);
        }
        this.draw();
    }

    // ----- geometry -----

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const { clientWidth: w, clientHeight: h } = this.canvas;
        if (!w || !h) return;
        this.width = w;
        this.height = h;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.peakCache.clear();
        this.draw();
    }

    get plotWidth() { return this.width - GUTTER; }
    get waveTop() { return OVERVIEW_H + GAP; }
    get rollTop() { return this.waveTop + WAVE_H + GAP; }
    get rollHeight() { return this.height - this.rollTop; }

    timeToX(t) { return GUTTER + ((t - this.view.start) / (this.view.end - this.view.start)) * this.plotWidth; }
    xToTime(x) { return this.view.start + ((x - GUTTER) / this.plotWidth) * (this.view.end - this.view.start); }
    overviewTimeToX(t) { return GUTTER + (t / Math.max(1e-9, this.duration)) * this.plotWidth; }
    overviewXToTime(x) { return ((x - GUTTER) / this.plotWidth) * this.duration; }

    midiToY(midi) {
        const rows = this.maxMidi - this.minMidi + 1;
        return this.rollTop + ((this.maxMidi - midi) / rows) * this.rollHeight;
    }
    get rowHeight() { return this.rollHeight / (this.maxMidi - this.minMidi + 1); }
    get pitchCropTopY() { return this.midiToY(this.pitchCrop.max); }
    get pitchCropBottomY() { return this.midiToY(this.pitchCrop.min) + this.rowHeight; }
    /** The MIDI row under y. */
    rowAt(y) { return this.maxMidi - Math.floor((y - this.rollTop) / this.rowHeight); }
    /** Nearest row boundary to y, as the MIDI note just above it. */
    boundaryMidiAt(y) { return this.maxMidi - Math.round((y - this.rollTop) / this.rowHeight) + 1; }

    setView(start, end) {
        const span = Math.min(Math.max(MIN_SPAN, end - start), Math.max(MIN_SPAN, this.duration));
        start = Math.max(0, Math.min(start, Math.max(0, this.duration - span)));
        this.view = { start, end: start + span };
        this.draw();
    }

    // ----- waveform peaks -----

    buildBlocks(samples) {
        const count = Math.ceil(samples.length / BLOCK);
        const min = new Float32Array(count);
        const max = new Float32Array(count);
        for (let b = 0; b < count; b++) {
            let lo = 0, hi = 0;
            const end = Math.min(samples.length, (b + 1) * BLOCK);
            for (let i = b * BLOCK; i < end; i++) {
                const v = samples[i];
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            min[b] = lo;
            max[b] = hi;
        }
        return { min, max };
    }

    peaks(start, end, pixels) {
        const key = `${start}|${end}|${pixels}`;
        if (this.peakCache.has(key)) return this.peakCache.get(key);
        const { samples, sampleRate } = this.clip;
        const min = new Float32Array(pixels);
        const max = new Float32Array(pixels);
        const perPixel = ((end - start) * sampleRate) / pixels;
        for (let p = 0; p < pixels; p++) {
            const a = Math.max(0, Math.floor(start * sampleRate + p * perPixel));
            const b = Math.min(samples.length, Math.floor(start * sampleRate + (p + 1) * perPixel));
            let lo = 0, hi = 0;
            if (b - a >= BLOCK * 2) {
                for (let k = Math.floor(a / BLOCK); k < Math.ceil(b / BLOCK); k++) {
                    if (this.blocks.min[k] < lo) lo = this.blocks.min[k];
                    if (this.blocks.max[k] > hi) hi = this.blocks.max[k];
                }
            } else {
                for (let i = a; i < b; i++) {
                    if (samples[i] < lo) lo = samples[i];
                    if (samples[i] > hi) hi = samples[i];
                }
            }
            min[p] = lo;
            max[p] = hi;
        }
        if (this.peakCache.size > 8) this.peakCache.clear();
        const result = { min, max };
        this.peakCache.set(key, result);
        return result;
    }

    // ----- drawing -----

    draw() {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this.render();
        });
    }

    render() {
        const { ctx, width, height } = this;
        if (!width) return;
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, width, height);
        if (!this.duration) {
            ctx.fillStyle = COLORS.text;
            ctx.font = '14px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No audio yet', width / 2, height / 2);
            return;
        }
        this.renderOverview();
        this.renderWave();
        this.renderRoll();
        this.renderCropAndPlayhead();
    }

    drawPeaks(peaks, top, h, color) {
        const { ctx } = this;
        const mid = top + h / 2;
        ctx.fillStyle = color;
        for (let p = 0; p < peaks.min.length; p++) {
            const y1 = mid - peaks.max[p] * (h / 2);
            const y2 = mid - peaks.min[p] * (h / 2);
            ctx.fillRect(GUTTER + p, y1, 1, Math.max(1, y2 - y1));
        }
    }

    renderOverview() {
        const { ctx } = this;
        ctx.fillStyle = COLORS.panel;
        ctx.fillRect(GUTTER, 0, this.plotWidth, OVERVIEW_H);
        if (this.clip) this.drawPeaks(this.peaks(0, this.duration, Math.floor(this.plotWidth)), 2, OVERVIEW_H - 4, COLORS.waveDim);
        // Notes as ticks, so you can see where music was found.
        for (const n of this.notes) {
            ctx.fillStyle = noteColor(n.midi);
            ctx.globalAlpha = this.inPitchCrop(n.midi) ? 1 : 0.2;
            const x = this.overviewTimeToX(n.start);
            ctx.fillRect(x, OVERVIEW_H - 5, Math.max(1, this.overviewTimeToX(n.start + n.duration) - x), 3);
        }
        ctx.globalAlpha = 1;
        const x1 = this.overviewTimeToX(this.view.start);
        const x2 = this.overviewTimeToX(this.view.end);
        ctx.strokeStyle = COLORS.view;
        ctx.lineWidth = 1;
        ctx.strokeRect(x1 + 0.5, 0.5, Math.max(2, x2 - x1 - 1), OVERVIEW_H - 1);
        ctx.fillStyle = COLORS.text;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('All', 8, OVERVIEW_H / 2 + 4);
    }

    renderWave() {
        const { ctx } = this;
        const top = this.waveTop;
        ctx.fillStyle = COLORS.panel;
        ctx.fillRect(GUTTER, top, this.plotWidth, WAVE_H);
        if (this.clip) this.drawPeaks(this.peaks(this.view.start, this.view.end, Math.floor(this.plotWidth)), top + 12, WAVE_H - 14, COLORS.wave);

        // Onsets, while editing: short ticks along the bottom of the waveform.
        if (this.editing && this.onsets.length) {
            ctx.fillStyle = COLORS.onset;
            const first = this.lowerBound(this.view.start);
            for (let i = first; i < this.onsets.length && this.onsets[i] <= this.view.end; i++) {
                ctx.fillRect(Math.round(this.timeToX(this.onsets[i])), top + WAVE_H - 7, 1, 7);
            }
        }

        // Time ruler.
        const span = this.view.end - this.view.start;
        const step = niceStep(span, this.plotWidth);
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        for (let t = Math.ceil(this.view.start / step) * step; t <= this.view.end; t += step) {
            const x = Math.round(this.timeToX(t)) + 0.5;
            ctx.strokeStyle = COLORS.grid;
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, this.height);
            ctx.stroke();
            ctx.fillStyle = COLORS.text;
            ctx.fillText(formatTime(t), x + 3, top + 10);
        }
    }

    renderRoll() {
        const { ctx } = this;
        const rowH = this.rowHeight;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, this.rollTop, this.width, this.rollHeight);
        ctx.clip();

        // Rows: darker for sharps, a line and label at each C (or every row if there's room).
        ctx.font = `${Math.min(11, Math.max(8, rowH - 2))}px system-ui, sans-serif`;
        ctx.textAlign = 'right';
        for (let m = this.minMidi; m <= this.maxMidi; m++) {
            const y = this.midiToY(m);
            const pc = pitchClass(m);
            if (SHARPS.has(pc)) {
                ctx.fillStyle = COLORS.sharpRow;
                ctx.fillRect(GUTTER, y, this.plotWidth, rowH);
            }
            if (pc === 0) {
                ctx.fillStyle = COLORS.grid;
                ctx.fillRect(GUTTER, Math.round(y + rowH) - 1, this.plotWidth, 1);
            }
            if (pc === 0 || rowH >= 11) {
                ctx.fillStyle = pc === 0 ? COLORS.text : COLORS.waveDim;
                ctx.fillText(midiToName(m), GUTTER - 6, y + rowH / 2 + 4);
            }
            // Colour key in the gutter, like the fretboard.
            ctx.fillStyle = noteColor(m);
            ctx.globalAlpha = 0.5;
            ctx.fillRect(GUTTER - 3, y + 0.5, 3, Math.max(1, rowH - 1));
            ctx.globalAlpha = 1;
        }

        this.renderLayer();
        this.renderPitchTrack();

        // Notes: filled, or outlined over a debug layer so the energy underneath shows.
        ctx.textAlign = 'left';
        ctx.font = '10px system-ui, sans-serif';
        ctx.lineWidth = 1.5;
        for (const n of this.notes) {
            if (n.start + n.duration < this.view.start || n.start > this.view.end) continue;
            const x = this.timeToX(n.start);
            const w = Math.max(2, this.timeToX(n.start + n.duration) - x);
            const y = this.midiToY(n.midi);
            ctx.globalAlpha = this.inPitchCrop(n.midi) ? 0.55 + 0.45 * n.velocity : 0.18;
            if (this.layer) {
                ctx.strokeStyle = noteColor(n.midi);
                ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, Math.max(1, rowH - 1.5));
                ctx.globalAlpha = 1;
                continue;
            }
            ctx.fillStyle = noteColor(n.midi);
            ctx.fillRect(x, y + 1, w, Math.max(2, rowH - 2));
            ctx.globalAlpha = 1;
            if (w > 26 && rowH >= 10) {
                ctx.fillStyle = '#000';
                ctx.fillText(midiToName(n.midi), x + 3, y + rowH / 2 + 3.5);
            }
        }
        const single = this.selected;
        if (single) this.renderOvertones(single.midi, this.timeToX(single.start), this.timeToX(single.start + single.duration), 1);
        if (this.hover && !this.drag) {
            const { midi, x } = this.hover;
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = noteColor(midi);
            ctx.strokeRect(x + 0.5, this.midiToY(midi) + 0.5, HOVER_WIDTH - 1, rowH - 1);
            if (rowH >= 8) {
                ctx.fillStyle = noteColor(midi);
                ctx.textAlign = 'center';
                ctx.font = '9px system-ui, sans-serif';
                ctx.fillText(midiToName(midi), x + HOVER_WIDTH / 2, this.midiToY(midi) + rowH / 2 + 3);
            }
            ctx.globalAlpha = 1;
            this.renderOvertones(midi, x, x + HOVER_WIDTH, 0.6);
        }
        ctx.strokeStyle = COLORS.selected;
        ctx.lineWidth = 2;
        for (const n of this.selection) {
            const x = this.timeToX(n.start);
            ctx.strokeRect(x - 1, this.midiToY(n.midi), Math.max(2, this.timeToX(n.start + n.duration) - x) + 2, rowH);
        }
        const d = this.drag;
        if (d?.snappedTo !== undefined && d.snappedTo !== null) {
            const x = Math.round(this.timeToX(d.snappedTo)) + 0.5;
            ctx.strokeStyle = COLORS.onset;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, this.rollTop);
            ctx.lineTo(x, this.height);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (d?.type === 'box') {
            const x1 = this.timeToX(Math.min(d.t0, d.t1));
            const x2 = this.timeToX(Math.max(d.t0, d.t1));
            const y1 = Math.min(d.y0, d.y1);
            const h = Math.abs(d.y1 - d.y0);
            ctx.fillStyle = COLORS.box;
            ctx.fillRect(x1, y1, x2 - x1, h);
            ctx.strokeStyle = COLORS.onset;
            ctx.lineWidth = 1;
            ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, h);
        }
                ctx.restore();
    }

    /** Centre of the visible part of [x1, x2], for labels inside a box. */
    labelX(x1, x2) {
        const a = Math.max(x1, GUTTER);
        const b = Math.min(x2, this.width);
        return (a + Math.max(a, b)) / 2;
    }

    /**
     * Where a note's overtones sound, from x1 to x2: dashed boxes in the note's colour,
     * fading with each harmonic, at their exact (not rounded) pitch, labelled ×2, ×3…
     */
    renderOvertones(midi, x1, x2, strength) {
        const { ctx } = this;
        const rowH = this.rowHeight;
        const w = Math.max(2, x2 - x1);
        ctx.save();
        ctx.strokeStyle = ctx.fillStyle = noteColor(midi);
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const labelX = this.labelX(x1, x2);
        for (const { harmonic, semitones } of OVERTONES) {
            const pitch = midi + semitones;
            if (pitch > this.maxMidi + 0.5) break;
            const y = this.midiToY(pitch);
            ctx.globalAlpha = strength * (0.75 - 0.07 * (harmonic - 2));
            ctx.strokeRect(x1 + 0.5, y + 0.5, w - 1, Math.max(1, rowH - 1));
            if (rowH >= 8 && w >= 18) ctx.fillText(`×${harmonic}`, labelX, y + rowH / 2 + 3);
        }
        ctx.restore();
    }

    /** Canvases holding the layer as an image: one column per frame, highest pitch at the top. */
    buildLayerTiles() {
        const { data, kind } = this.layer;
        const values = data[kind];
        const { bins, frames } = data;
        const floor = this.layerFloor;
        const stretch = 255 / Math.max(1e-6, 1 - floor);
        const tiles = [];
        for (let c0 = 0; c0 < frames; c0 += TILE_COLUMNS) {
            const w = Math.min(TILE_COLUMNS, frames - c0);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = bins;
            const ctx = canvas.getContext('2d');
            const image = ctx.createImageData(w, bins);
            const px = image.data;
            for (let f = 0; f < w; f++) {
                const base = (c0 + f) * bins;
                for (let k = 0; k < bins; k++) {
                    const v = Math.round((values[base + k] / 255 - floor) * stretch);
                    if (v <= 0) continue;
                    const i = ((bins - 1 - k) * w + f) * 4;
                    const c = Math.min(255, v) * 3;
                    px[i] = LAYER_LUT[c];
                    px[i + 1] = LAYER_LUT[c + 1];
                    px[i + 2] = LAYER_LUT[c + 2];
                    px[i + 3] = Math.min(255, v * 1.6);
                }
            }
            ctx.putImageData(image, 0, 0);
            tiles.push({ canvas, first: c0, columns: w });
        }
        return tiles;
    }

    renderLayer() {
        if (!this.layer) return;
        const { data } = this.layer;
        const low = Math.max(this.minMidi, data.minMidi);
        const high = Math.min(this.maxMidi, data.maxMidi);
        if (high < low) return;
        this.layerTiles ??= this.buildLayerTiles();
        const { ctx } = this;
        const bps = data.binsPerSemitone;
        const sy = data.bins - (high - data.minMidi + 1) * bps;
        const sh = (high - low + 1) * bps;
        const dy = this.midiToY(high);
        const dh = (high - low + 1) * this.rowHeight;
        ctx.imageSmoothingEnabled = true;
        for (const tile of this.layerTiles) {
            const ts = data.startSeconds + tile.first * data.hopSeconds;
            const te = ts + tile.columns * data.hopSeconds;
            const a = Math.max(ts, this.view.start);
            const b = Math.min(te, this.view.end);
            if (b <= a) continue;
            const dx = this.timeToX(a);
            ctx.drawImage(tile.canvas, (a - ts) / data.hopSeconds, sy, (b - a) / data.hopSeconds, sh, dx, dy, this.timeToX(b) - dx, dh);
        }
    }

    renderPitchTrack() {
        const track = this.pitchTrack;
        if (!track) return;
        const { ctx } = this;
        const first = Math.max(0, Math.floor((this.view.start - track.startSeconds) / track.hopSeconds));
        const last = Math.min(track.midi.length - 1, Math.ceil((this.view.end - track.startSeconds) / track.hopSeconds));
        const stride = Math.max(1, Math.floor((last - first) / (this.plotWidth * 2)));
        const rowH = this.rowHeight;

        // Rejected best guesses as faint dots: brighter = closer to being accepted.
        if (track.candidateMidi) {
            ctx.fillStyle = COLORS.rejected;
            for (let i = first; i <= last; i += stride) {
                const m = track.candidateMidi[i];
                if (!Number.isNaN(track.midi[i]) || Number.isNaN(m) || m < this.minMidi - 0.5 || m > this.maxMidi + 0.5) continue;
                ctx.globalAlpha = Math.max(0.08, Math.min(0.7, 1 - (track.aperiodicity?.[i] ?? 1)));
                ctx.fillRect(this.timeToX(track.startSeconds + i * track.hopSeconds) - 1, this.midiToY(m) + rowH / 2 - 1, 2, 2);
            }
            ctx.globalAlpha = 1;
        }

        ctx.strokeStyle = COLORS.pitch;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let drawing = false;
        for (let i = first; i <= last; i += stride) {
            const m = track.midi[i];
            if (Number.isNaN(m) || m < this.minMidi - 0.5 || m > this.maxMidi + 0.5) { drawing = false; continue; }
            const x = this.timeToX(track.startSeconds + i * track.hopSeconds);
            const y = this.midiToY(m) + rowH / 2;
            if (drawing) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            drawing = true;
        }
        ctx.stroke();
    }

    renderCropAndPlayhead() {
        const { ctx } = this;
        const top = this.waveTop;
        const bottom = this.height;
        // Shade outside the crop, in the main area and the overview.
        ctx.fillStyle = COLORS.outside;
        const cs = Math.max(GUTTER, this.timeToX(this.crop.start));
        const ce = Math.min(this.width, this.timeToX(this.crop.end));
        if (cs > GUTTER) ctx.fillRect(GUTTER, top, cs - GUTTER, bottom - top);
        if (ce < this.width) ctx.fillRect(Math.max(GUTTER, ce), top, this.width - Math.max(GUTTER, ce), bottom - top);
        // Shade pitch rows outside the pitch crop (only inside the time crop, to avoid double shading).
        const pTop = this.pitchCropTopY;
        const pBottom = this.pitchCropBottomY;
        const left = Math.max(GUTTER, cs);
        const right = Math.min(this.width, ce);
        // Lighter over a debug layer, so energy outside the kept notes stays visible.
        if (this.layer) ctx.fillStyle = COLORS.outsideLayer;
        if (right > left) {
            if (pTop > this.rollTop) ctx.fillRect(left, this.rollTop, right - left, pTop - this.rollTop);
            if (pBottom < bottom) ctx.fillRect(left, pBottom, right - left, bottom - pBottom);
        }
        ctx.fillStyle = COLORS.outside;
        const os = this.overviewTimeToX(this.crop.start);
        const oe = this.overviewTimeToX(this.crop.end);
        ctx.fillRect(GUTTER, 0, os - GUTTER, OVERVIEW_H);
        ctx.fillRect(oe, 0, this.width - oe, OVERVIEW_H);

        // Crop handles.
        ctx.fillStyle = COLORS.crop;
        for (const [t, dir] of [[this.crop.start, 1], [this.crop.end, -1]]) {
            const x = this.timeToX(t);
            if (x >= GUTTER - 1 && x <= this.width + 1) {
                ctx.fillRect(Math.round(x) - 1, top, 2, bottom - top);
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x + dir * 10, top);
                ctx.lineTo(x, top + 12);
                ctx.fill();
            }
            const ox = this.overviewTimeToX(t);
            ctx.fillRect(Math.round(ox) - 1, 0, 2, OVERVIEW_H);
        }

        // Pitch crop handles: horizontal lines with a tab in the gutter.
        for (const [y, dir] of [[pTop, 1], [pBottom, -1]]) {
            if (y < this.rollTop - 1 || y > bottom + 1) continue;
            ctx.fillRect(GUTTER, Math.round(y) - 1, this.plotWidth, 2);
            ctx.beginPath();
            ctx.moveTo(GUTTER, y);
            ctx.lineTo(GUTTER - 12, y);
            ctx.lineTo(GUTTER, y + dir * 10);
            ctx.fill();
        }

        // Playhead.
        ctx.fillStyle = COLORS.playhead;
        const px = this.timeToX(this.playhead);
        if (px >= GUTTER && px <= this.width) ctx.fillRect(Math.round(px), top, 1.5, bottom - top);
        ctx.fillRect(Math.round(this.overviewTimeToX(this.playhead)), 0, 1.5, OVERVIEW_H);
    }

    // ----- interaction -----

    /** Which handle is under (x, y): 'start' | 'end' (time) | 'pitchMax' | 'pitchMin' | null. */
    hitHandle(x, y) {
        const candidates = [];
        if (x >= GUTTER) {
            const inOverview = y < OVERVIEW_H;
            const toX = inOverview ? (t) => this.overviewTimeToX(t) : (t) => this.timeToX(t);
            candidates.push(['start', Math.abs(x - toX(this.crop.start))], ['end', Math.abs(x - toX(this.crop.end))]);
        }
        if (y >= this.rollTop - HANDLE_HIT) {
            candidates.push(['pitchMax', Math.abs(y - this.pitchCropTopY)], ['pitchMin', Math.abs(y - this.pitchCropBottomY)]);
        }
        const [best] = candidates.filter(([, d]) => d <= HANDLE_HIT).sort((a, b) => a[1] - b[1]);
        return best ? best[0] : null;
    }

    /** The note under (x, y) and which part: 'start' | 'end' (resize) | 'move'. */
    noteAt(x, y) {
        if (y < this.rollTop || x < GUTTER) return null;
        const midi = this.rowAt(y);
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const n = this.notes[i];
            if (n.midi !== midi) continue;
            const x1 = this.timeToX(n.start);
            const x2 = this.timeToX(n.start + n.duration);
            if (x < x1 - 2 || x > x2 + 2) continue;
            const edges = x2 - x1 >= EDGE_HIT * 3;
            const part = edges && x - x1 < EDGE_HIT ? 'start' : edges && x2 - x < EDGE_HIT ? 'end' : 'move';
            return { note: n, part };
        }
        return null;
    }

    localPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    pointerDown(e) {
        if (!this.duration) return;
        const { x, y } = this.localPoint(e);
        if (this.editing && e.button === 0 && this.editPointerDown(e, x, y)) return;
        const handle = this.hitHandle(x, y);
        if (!handle && x < GUTTER) return;
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer: drag still works */ }
        if (handle === 'pitchMax' || handle === 'pitchMin') this.drag = { type: 'pitch', handle };
        else if (handle) this.drag = { type: 'crop', handle, overview: y < OVERVIEW_H };
        else if (y < OVERVIEW_H) {
            this.drag = { type: 'overview' };
            this.moveViewTo(this.overviewXToTime(x));
        } else this.drag = { type: 'main', startX: x, viewStart: this.view.start, moved: false };
    }

    pointerMove(e) {
        const { x, y } = this.localPoint(e);
        if (!this.drag) {
            const hit = this.editing && this.duration ? this.noteAt(x, y) : null;
            if (hit) {
                this.canvas.style.cursor = hit.part === 'move' ? 'move' : 'ew-resize';
                this.setHover(null);
                return;
            }
            const handle = this.duration ? this.hitHandle(x, y) : null;
            const inRoll = y >= this.rollTop && x >= GUTTER;
            const hoverX = inRoll ? this.timeToX(this.snap(this.xToTime(x), this.snapTargets(), e.altKey).t) : x;
            this.setHover(this.editing && inRoll && !handle ? { midi: this.rowAt(y), x: hoverX } : null);
            this.canvas.style.cursor = handle ? (handle.startsWith('pitch') ? 'ns-resize' : 'ew-resize')
                : this.editing && inRoll ? 'crosshair' : 'default';
            return;
        }
        this.drag.free = e.altKey;
        this.dragMove(x, y);
    }

    /** Apply the current drag at (x, y). Also called while auto-scrolling. */
    dragMove(x, y) {
        const d = this.drag;
        if (!d || d.type === 'none') return;
        if (d.type === 'note' || d.type === 'create' || d.type === 'box') {
            this.editPointerMove(d, x, y);
            this.updateAutoScroll(x, y);
        } else if (d.type === 'pitch') {
            const above = Math.max(this.minMidi, Math.min(this.maxMidi + 1, this.boundaryMidiAt(y)));
            const { min, max } = this.pitchCrop;
            const next = d.handle === 'pitchMax'
                ? { min, max: Math.max(min, above - 1) }
                : { min: Math.min(max, above), max };
            if (next.min !== min || next.max !== max) {
                this.pitchCrop = next;
                this.onPitchCropChange?.(next.min, next.max);
                this.draw();
            }
        } else if (d.type === 'crop') {
            const t = Math.max(0, Math.min(this.duration, d.overview ? this.overviewXToTime(x) : this.xToTime(x)));
            if (d.handle === 'start') this.crop.start = Math.min(t, this.crop.end - 0.1);
            else this.crop.end = Math.max(t, this.crop.start + 0.1);
            this.onCropChange?.(this.crop.start, this.crop.end);
            this.draw();
            if (!d.overview) this.updateAutoScroll(x, y);
        } else if (d.type === 'overview') {
            this.moveViewTo(this.overviewXToTime(x));
        } else {
            if (Math.abs(x - d.startX) > 3) d.moved = true;
            if (d.moved) {
                const span = this.view.end - this.view.start;
                const dt = ((x - d.startX) / this.plotWidth) * span;
                this.follow = false;
                this.setView(d.viewStart - dt, d.viewStart - dt + span);
            }
        }
    }

    pointerUp(e) {
        const d = this.drag;
        this.drag = null;
        this.scroll = null;
        if (d?.type === 'note' || d?.type === 'create') {
            if (d.changed) this.onEdit?.();
            else if (d.type === 'create') {
                this.select(null);
                this.onSeek?.(Math.max(0, Math.min(this.duration, d.rawT0)));
            }
            this.draw();
            return;
        }
        if (d?.type === 'box') {
            this.selectInBox(d);
            return;
        }
        if (d?.type === 'main' && !d.moved) {
            const { x } = this.localPoint(e);
            this.onSeek?.(Math.max(0, Math.min(this.duration, this.xToTime(x))));
        }
    }

    // ----- scrolling while dragging past an edge -----

    updateAutoScroll(x, y) {
        let speed = 0;
        if (x > this.width - EDGE_ZONE) speed = Math.min(2, (x - (this.width - EDGE_ZONE)) / EDGE_ZONE);
        else if (x < GUTTER + EDGE_ZONE) speed = -Math.min(2, (GUTTER + EDGE_ZONE - x) / EDGE_ZONE);
        this.scroll = speed ? { speed, x, y } : null;
        // One loop at a time: autoScrollStep re-schedules itself while scrolling.
        if (this.scroll && !this.scrollFrame) {
            this.scrollLast = performance.now();
            this.scrollFrame = requestAnimationFrame((now) => this.autoScrollStep(now));
        }
    }

    autoScrollStep(now) {
        if (!this.scroll || !this.drag) {
            this.scrollFrame = null;
            return;
        }
        const seconds = Math.min(0.1, Math.max(0, (now - this.scrollLast) / 1000));
        this.scrollLast = now;
        const span = this.view.end - this.view.start;
        const before = this.view.start;
        // Speed 1 (pointer at the edge) moves a fifth of the view per second; up to 2 further out.
        const shift = this.scroll.speed * span * AUTO_SCROLL_RATE * seconds;
        this.follow = false;
        this.setView(this.view.start + shift, this.view.end + shift);
        if (this.view.start !== before) this.dragMove(this.scroll.x, this.scroll.y);
        this.scrollFrame = this.scroll ? requestAnimationFrame((t) => this.autoScrollStep(t)) : null;
    }

    // ----- snapping -----

    /** Index of the first onset at or after t. */
    lowerBound(t, list = this.onsets) {
        let lo = 0, hi = list.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (list[mid] < t) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    /** Sorted times to snap to: onsets, plus starts and ends of notes not being dragged. */
    snapTargets(exclude = new Set()) {
        const times = [...this.onsets];
        for (const n of this.notes) if (!exclude.has(n)) times.push(n.start, n.start + n.duration);
        return Float64Array.from(times).sort();
    }

    /** The nearest target within SNAP_PX of t: { t, target } (target null if nothing was close). */
    snap(t, targets, free = false) {
        if (!this.snapping || free || !targets.length) return { t, target: null };
        const i = this.lowerBound(t, targets);
        let best = null;
        for (const c of [targets[i - 1], targets[i]]) {
            if (c === undefined) continue;
            if (best === null || Math.abs(c - t) < Math.abs(best - t)) best = c;
        }
        const px = Math.abs(this.timeToX(best) - this.timeToX(t));
        return px <= SNAP_PX ? { t: best, target: best } : { t, target: null };
    }

    // ----- note editing -----

    /** Start an edit drag if (x, y) is on a note or empty piano roll. Returns true if it did. */
    editPointerDown(e, x, y) {
        const hit = this.noteAt(x, y);
        if (!hit) {
            // Crop handles still work in edit mode; otherwise empty roll space draws a note.
            if (this.hitHandle(x, y) || y < this.rollTop || x < GUTTER) return false;
        }
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        const t = this.xToTime(x);
        if (hit && e.shiftKey) {
            // Shift+click toggles a note in the selection.
            const next = new Set(this.selection);
            if (next.has(hit.note)) next.delete(hit.note); else next.add(hit.note);
            this.select([...next]);
            this.drag = { type: 'none' };
        } else if (hit) {
            const n = hit.note;
            if (!this.selection.has(n)) this.select(n);
            this.onAudition?.(n.midi);
            // Moving drags every selected note; resizing changes only this one.
            const moving = hit.part === 'move' ? [...this.selection] : [n];
            this.drag = {
                type: 'note', note: n, part: hit.part, startX: x, grabT: t, startRow: this.rowAt(y),
                origs: new Map(moving.map((m) => [m, { start: m.start, duration: m.duration, midi: m.midi }])),
                targets: this.snapTargets(new Set(moving)), changed: false,
            };
        } else if (e.shiftKey) {
            this.drag = { type: 'box', t0: t, t1: t, y0: y, y1: y };
        } else {
            const targets = this.snapTargets();
            const start = this.snap(t, targets, e.altKey);
            this.drag = { type: 'create', startX: x, rawT0: t, t0: start.t, snappedTo: start.target, midi: this.rowAt(y),
                targets, note: null, changed: false };
        }
        return true;
    }

    editPointerMove(d, x, y) {
        if (d.type === 'box') {
            d.t1 = this.xToTime(x);
            d.y1 = y;
            this.draw();
            return;
        }
        if (d.type !== 'note' && d.type !== 'create') return;
        if (!d.changed && Math.abs(x - d.startX) <= 3 && (d.type === 'create' || this.rowAt(y) === d.startRow)) return;
        if (!d.changed) {
            this.onEditStart?.();
            d.changed = true;
            if (d.type === 'create') {
                d.note = { midi: d.midi, start: d.t0, duration: MIN_NOTE, velocity: 0.8 };
                this.notes.push(d.note);
                this.select(d.note);
                this.onAudition?.(d.midi);
            }
        }
        const raw = Math.max(0, this.xToTime(x));
        if (d.type === 'create') {
            const end = this.snap(raw, d.targets, d.free);
            d.snappedTo = end.target ?? null;
            d.note.start = Math.min(d.t0, end.t);
            d.note.duration = Math.max(MIN_NOTE, Math.abs(end.t - d.t0));
        } else if (d.part === 'move') {
            const lead = d.origs.get(d.note);
            const dtRaw = raw - d.grabT;
            // Snap the grabbed note's start or end, whichever is closer to a target.
            const byStart = this.snap(lead.start + dtRaw, d.targets, d.free);
            const byEnd = this.snap(lead.start + lead.duration + dtRaw, d.targets, d.free);
            let dt = dtRaw;
            d.snappedTo = null;
            if (byStart.target !== null && (byEnd.target === null || Math.abs(byStart.t - lead.start - dtRaw) <= Math.abs(byEnd.t - lead.start - lead.duration - dtRaw))) {
                dt = byStart.t - lead.start;
                d.snappedTo = byStart.target;
            } else if (byEnd.target !== null) {
                dt = byEnd.t - lead.start - lead.duration;
                d.snappedTo = byEnd.target;
            }
            const origs = [...d.origs.values()];
            dt = Math.max(dt, -Math.min(...origs.map((o) => o.start)));
            let dm = this.rowAt(y) - d.startRow;
            dm = Math.max(dm, this.minMidi - Math.min(...origs.map((o) => o.midi)));
            dm = Math.min(dm, this.maxMidi - Math.max(...origs.map((o) => o.midi)));
            for (const [n, o] of d.origs) {
                n.start = o.start + dt;
                n.midi = o.midi + dm;
            }
            if (d.note.midi !== d.lastMidi) {
                if (d.lastMidi !== undefined) this.onAudition?.(d.note.midi);
                d.lastMidi = d.note.midi;
            }
        } else {
            const n = d.note;
            const { start, duration } = d.origs.get(n);
            const edge = this.snap(d.part === 'start' ? start + raw - d.grabT : start + duration + raw - d.grabT, d.targets, d.free);
            d.snappedTo = edge.target;
            if (d.part === 'start') {
                n.start = Math.max(0, Math.min(start + duration - MIN_NOTE, edge.t));
                n.duration = start + duration - n.start;
            } else {
                n.duration = Math.max(MIN_NOTE, edge.t - start);
            }
        }
        this.draw();
    }

    /** Select the notes that overlap the box drawn by a Shift+drag. */
    selectInBox(d) {
        const t1 = Math.min(d.t0, d.t1);
        const t2 = Math.max(d.t0, d.t1);
        const top = this.rowAt(Math.min(d.y0, d.y1));
        const bottom = this.rowAt(Math.max(d.y0, d.y1));
        this.select(this.notes.filter((n) => n.midi <= top && n.midi >= bottom && n.start < t2 && n.start + n.duration > t1));
    }

    moveViewTo(t) {
        const span = this.view.end - this.view.start;
        this.follow = false;
        this.setView(t - span / 2, t + span / 2);
    }

    wheel(e) {
        if (!this.duration) return;
        e.preventDefault();
        const { x } = this.localPoint(e);
        const span = this.view.end - this.view.start;
        const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
        if (horizontal) {
            const delta = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / this.plotWidth * span;
            this.follow = false;
            this.setView(this.view.start + delta, this.view.end + delta);
        } else {
            const factor = Math.exp(e.deltaY * 0.0025);
            const anchor = this.xToTime(Math.max(GUTTER, x));
            const newSpan = span * factor;
            const ratio = (anchor - this.view.start) / span;
            this.setView(anchor - ratio * newSpan, anchor + (1 - ratio) * newSpan);
        }
    }
}
