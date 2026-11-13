// Canvas tablature on a time axis: six string lines (string 1 at the top, as in
// tab notation), each note as its fret number in its note colour, with a bar
// for how long it rings.
//
// Mouse: scroll to zoom, horizontal scroll or drag empty space to pan, click to
// jump. The strip at the top shows the whole tab: click or drag it to move the
// view. The yellow handles crop the tab (what loops and what is saved), as on
// the note extractor page; dragging one past an edge scrolls. Hover a note to
// see every other place it could be played (faint dashed boxes); click one to
// move the note there. Drag a note left or right to change its time.
// Double-click a string to add a note there.
//
// The view changes note objects in place only while dragging a note's time, and
// reports through callbacks; everything else is a request to the page.

import { midiToName, noteColor } from '../extract/music.js';
import { positionsFor, stringCount } from './guitar.js';

const GUTTER = 44;
const OVERVIEW_H = 26;      // the whole tab, at the top
const RULER = 22;
const TOP = OVERVIEW_H + RULER;
const BOTTOM = 26;          // strip for notes the guitar can't play
const MIN_SPAN = 0.5;
const BOX_H = 18;
const DRAG_PX = 3;
const HANDLE_HIT = 7;
const EDGE_ZONE = 30;           // pixels from the left/right edge where dragging a handle scrolls
const AUTO_SCROLL_RATE = 0.2;   // views per second at the edge (doubles far past it)

const COLORS = {
    background: '#0d0d12',
    string: '#5a5a70',
    grid: '#23232e',
    text: '#b8b8cc',
    dim: '#6a6a80',
    playhead: '#ffffff',
    selected: '#ffffff',
    fixed: '#ffd400',
    ghost: 'rgba(255, 255, 255, 0.55)',
    unplayable: '#ff5a6e',
    panel: '#16161e',
    view: '#8a8aa8',
    crop: '#ffd400',
    outside: 'rgba(0, 0, 0, 0.6)',
};

function formatTime(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(s < 10 && m === 0 ? 1 : 0)}`;
}

function niceStep(span, pixels) {
    const target = span / Math.max(1, pixels / 90);
    return [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s >= target) ?? 600;
}

export class TabView {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{ guitar, onSeek?, onSelect?, onChoose?, onMoveStart?, onMove?, onAdd?, onAudition? }} options
     *   onChoose(note, position): a ghost position was clicked.
     *   onMoveStart(note) / onMove(note): a note's time is being dragged / was dropped.
     *   onAdd(string, time): double-click on an empty part of a string.
     *   onCropChange({start, end}): a crop handle was dragged.
     */
    constructor(canvas, { guitar, onSeek, onSelect, onChoose, onMoveStart, onMove, onAdd, onAudition, onCropChange } = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.guitar = guitar;
        Object.assign(this, { onSeek, onSelect, onChoose, onMoveStart, onMove, onAdd, onAudition, onCropChange });
        this.crop = { start: 0, end: 0 };   // what loops and what is saved
        this.notes = [];
        this.unplayable = [];
        this.duration = 0;
        this.view = { start: 0, end: 1 };
        this.playhead = 0;
        this.follow = false;
        this.selected = null;
        this.hover = null;          // note whose alternatives are shown
        this.hoverGhost = null;     // { note, string, fret } under the pointer

        new ResizeObserver(() => this.resize()).observe(canvas);
        canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
        canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
        canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
        canvas.addEventListener('pointerleave', () => { if (!this.drag) this.setHover(null, null); });
        canvas.addEventListener('dblclick', (e) => this.doubleClick(e));
        canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
        this.resize();
    }

    // ----- data -----

    /** Show placed notes and unplayable ones. Keeps the view unless `fit`. */
    setNotes(notes, unplayable = [], { fit = false } = {}) {
        this.notes = notes;
        this.unplayable = unplayable;
        const end = [...notes, ...unplayable].reduce((m, n) => Math.max(m, n.start + n.duration), 0);
        this.duration = Math.max(end, this.minDuration ?? 0);
        if (!notes.includes(this.selected)) this.selected = null;
        if (!notes.includes(this.hover)) this.setHover(null, null);
        if (fit) this.view = { start: 0, end: Math.max(MIN_SPAN, this.duration) };
        this.draw();
    }

    /** At least this long, e.g. a file's stated duration. */
    setMinDuration(seconds) {
        this.minDuration = seconds;
    }

    select(note) {
        this.selected = note;
        this.draw();
    }

    setCrop(range) {
        this.crop = { ...range };
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

    setHover(note, ghost) {
        if (note === this.hover && ghost?.string === this.hoverGhost?.string && ghost?.note === this.hoverGhost?.note) return;
        this.hover = note;
        this.hoverGhost = ghost;
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
        this.draw();
    }

    get plotWidth() { return this.width - GUTTER; }
    get rowHeight() { return (this.height - TOP - BOTTOM) / stringCount(this.guitar); }
    stringY(string) { return TOP + (string - 0.5) * this.rowHeight; }
    stringAt(y) {
        const s = Math.floor((y - TOP) / this.rowHeight) + 1;
        return s >= 1 && s <= stringCount(this.guitar) ? s : null;
    }
    timeToX(t) { return GUTTER + ((t - this.view.start) / (this.view.end - this.view.start)) * this.plotWidth; }
    xToTime(x) { return this.view.start + ((x - GUTTER) / this.plotWidth) * (this.view.end - this.view.start); }
    overviewTimeToX(t) { return GUTTER + (t / Math.max(1e-9, this.duration)) * this.plotWidth; }
    overviewXToTime(x) { return ((x - GUTTER) / this.plotWidth) * this.duration; }

    setView(start, end) {
        const total = Math.max(MIN_SPAN, this.duration);
        const span = Math.min(Math.max(MIN_SPAN, end - start), total);
        start = Math.max(0, Math.min(start, total - span));
        this.view = { start, end: start + span };
        this.draw();
    }

    /** Box for a fret number at a time on a string. */
    boxAt(string, fret, start) {
        const w = fret >= 10 ? 22 : 16;
        return { x: this.timeToX(start), y: this.stringY(string) - BOX_H / 2, w, h: BOX_H };
    }

    /** Other positions for a note, at the same time. */
    ghostsFor(note) {
        return positionsFor(this.guitar, note.midi).filter((p) => p.string !== note.string)
            .map((p) => ({ note, string: p.string, fret: p.fret }));
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
            ctx.fillText('Open a notes file or a MIDI file', width / 2, height / 2);
            return;
        }
        this.renderOverview();
        this.renderGrid();
        this.renderNotes();
        this.renderGhosts();
        this.renderUnplayable();
        this.renderCrop();
        ctx.fillStyle = COLORS.playhead;
        const px = this.timeToX(this.playhead);
        if (px >= GUTTER && px <= width) ctx.fillRect(Math.round(px), OVERVIEW_H, 1.5, height - OVERVIEW_H);
        ctx.fillRect(Math.round(this.overviewTimeToX(this.playhead)), 0, 1.5, OVERVIEW_H);
    }

    /** The whole tab: notes as ticks, and a box for the part in view. */
    renderOverview() {
        const { ctx } = this;
        ctx.fillStyle = COLORS.panel;
        ctx.fillRect(GUTTER, 0, this.plotWidth, OVERVIEW_H);
        const rows = stringCount(this.guitar);
        const rowH = (OVERVIEW_H - 6) / rows;
        for (const n of this.notes) {
            ctx.fillStyle = noteColor(n.midi);
            const x = this.overviewTimeToX(n.start);
            ctx.fillRect(x, 3 + (n.string - 1) * rowH, Math.max(1, this.overviewTimeToX(n.start + n.duration) - x), Math.max(1, rowH - 1));
        }
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

    /** Shade outside the crop, and draw its yellow handles (in the main area and the overview). */
    renderCrop() {
        const { ctx } = this;
        const top = OVERVIEW_H;
        ctx.fillStyle = COLORS.outside;
        const cs = Math.max(GUTTER, this.timeToX(this.crop.start));
        const ce = Math.min(this.width, this.timeToX(this.crop.end));
        if (cs > GUTTER) ctx.fillRect(GUTTER, top, cs - GUTTER, this.height - top);
        if (ce < this.width) ctx.fillRect(Math.max(GUTTER, ce), top, this.width - Math.max(GUTTER, ce), this.height - top);
        const os = this.overviewTimeToX(this.crop.start);
        const oe = this.overviewTimeToX(this.crop.end);
        ctx.fillRect(GUTTER, 0, os - GUTTER, OVERVIEW_H);
        ctx.fillRect(oe, 0, this.width - oe, OVERVIEW_H);
        ctx.fillStyle = COLORS.crop;
        for (const [t, dir] of [[this.crop.start, 1], [this.crop.end, -1]]) {
            const x = this.timeToX(t);
            if (x >= GUTTER - 1 && x <= this.width + 1) {
                ctx.fillRect(Math.round(x) - 1, top, 2, this.height - top);
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x + dir * 10, top);
                ctx.lineTo(x, top + 12);
                ctx.fill();
            }
            ctx.fillRect(Math.round(this.overviewTimeToX(t)) - 1, 0, 2, OVERVIEW_H);
        }
    }

    renderGrid() {
        const { ctx } = this;
        // Time ruler and grid.
        const step = niceStep(this.view.end - this.view.start, this.plotWidth);
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        for (let t = Math.ceil(this.view.start / step) * step; t <= this.view.end; t += step) {
            const x = Math.round(this.timeToX(t)) + 0.5;
            ctx.fillStyle = COLORS.grid;
            ctx.fillRect(x, TOP - 4, 1, this.height - TOP + 4);
            ctx.fillStyle = COLORS.text;
            ctx.fillText(formatTime(t), x + 3, OVERVIEW_H + 15);
        }
        // Strings, labelled with their open note (e B G D A E).
        ctx.textAlign = 'right';
        ctx.font = '12px system-ui, sans-serif';
        this.guitar.strings.forEach((open, i) => {
            const y = Math.round(this.stringY(i + 1)) + 0.5;
            ctx.fillStyle = COLORS.string;
            ctx.fillRect(GUTTER, y, this.plotWidth, 1);
            ctx.fillStyle = COLORS.text;
            const name = midiToName(open).replace(/-?\d+$/, '');
            ctx.fillText(i === 0 ? name.toLowerCase() : name, GUTTER - 8, y + 4);
        });
        ctx.fillStyle = COLORS.dim;
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText('can’t', GUTTER - 6, this.height - BOTTOM / 2 - 1);
        ctx.fillText('play', GUTTER - 6, this.height - BOTTOM / 2 + 9);
    }

    renderNotes() {
        const { ctx } = this;
        const visible = this.notes.filter((n) => n.start + n.duration >= this.view.start && n.start <= this.view.end);
        // How long each note rings: a bar along its string.
        for (const n of visible) {
            const x1 = this.timeToX(n.start);
            const x2 = this.timeToX(n.start + n.duration);
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = noteColor(n.midi);
            ctx.fillRect(x1, this.stringY(n.string) - 2, Math.max(2, x2 - x1), 4);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center';
        ctx.font = 'bold 12px system-ui, sans-serif';
        const sounding = (n) => this.playing && this.playhead >= n.start && this.playhead < n.start + n.duration;
        for (const n of visible) {
            const b = this.boxAt(n.string, n.fret, n.start);
            ctx.fillStyle = noteColor(n.midi);
            ctx.globalAlpha = this.hover === n || sounding(n) ? 1 : 0.85;
            ctx.beginPath();
            ctx.roundRect(b.x, b.y, b.w, b.h, 4);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#000';
            ctx.fillText(String(n.fret), b.x + b.w / 2, b.y + b.h / 2 + 4);
            if (n.fixed) {
                // A small yellow tab under notes placed by hand.
                ctx.fillStyle = COLORS.fixed;
                ctx.fillRect(b.x + 3, b.y + b.h + 1, b.w - 6, 2);
            }
            if (n === this.selected || sounding(n)) {
                ctx.strokeStyle = COLORS.selected;
                ctx.lineWidth = n === this.selected ? 2 : 1;
                ctx.beginPath();
                ctx.roundRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3, 5);
                ctx.stroke();
            }
        }
    }

    /** The other places the hovered (or selected) note could be played. */
    renderGhosts() {
        const owner = this.hover ?? this.selected;
        if (!owner) return;
        const { ctx } = this;
        ctx.textAlign = 'center';
        ctx.font = '12px system-ui, sans-serif';
        ctx.setLineDash([3, 2]);
        for (const g of this.ghostsFor(owner)) {
            const b = this.boxAt(g.string, g.fret, owner.start);
            const active = this.hoverGhost && this.hoverGhost.note === owner && this.hoverGhost.string === g.string;
            ctx.fillStyle = COLORS.background;
            ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.strokeStyle = active ? noteColor(owner.midi) : COLORS.ghost;
            ctx.lineWidth = active ? 2 : 1;
            ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
            ctx.fillStyle = active ? noteColor(owner.midi) : COLORS.ghost;
            ctx.fillText(String(g.fret), b.x + b.w / 2, b.y + b.h / 2 + 4);
        }
        ctx.setLineDash([]);
    }

    renderUnplayable() {
        const { ctx } = this;
        const y = this.height - BOTTOM + 4;
        ctx.fillStyle = COLORS.grid;
        ctx.fillRect(GUTTER, this.height - BOTTOM, this.plotWidth, 1);
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        for (const n of this.unplayable) {
            if (n.start + n.duration < this.view.start || n.start > this.view.end) continue;
            const x = this.timeToX(n.start);
            ctx.fillStyle = COLORS.unplayable;
            ctx.fillRect(x, y, Math.max(2, this.timeToX(n.start + n.duration) - x), 3);
            ctx.fillText(midiToName(n.midi), x + 2, y + 15);
        }
    }

    // ----- interaction -----

    localPoint(e) {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    within(b, x, y) {
        return x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1;
    }

    noteAt(x, y) {
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const n = this.notes[i];
            if (this.within(this.boxAt(n.string, n.fret, n.start), x, y)) return n;
        }
        return null;
    }

    /** A ghost of the hovered or selected note under (x, y). */
    ghostAt(x, y) {
        for (const owner of [this.hover, this.selected]) {
            if (!owner) continue;
            for (const g of this.ghostsFor(owner)) {
                if (this.within(this.boxAt(g.string, g.fret, owner.start), x, y)) return g;
            }
        }
        return null;
    }

    /** The crop handle under (x, y): 'start' | 'end' | null. */
    hitHandle(x, y) {
        if (x < GUTTER - HANDLE_HIT) return null;
        const toX = y < OVERVIEW_H ? (t) => this.overviewTimeToX(t) : (t) => this.timeToX(t);
        const [best] = [['start', Math.abs(x - toX(this.crop.start))], ['end', Math.abs(x - toX(this.crop.end))]]
            .filter(([, d]) => d <= HANDLE_HIT).sort((a, b) => a[1] - b[1]);
        return best ? best[0] : null;
    }

    moveViewTo(t) {
        const span = this.view.end - this.view.start;
        this.follow = false;
        this.setView(t - span / 2, t + span / 2);
    }

    pointerDown(e) {
        if (!this.duration || e.button !== 0) return;
        const { x, y } = this.localPoint(e);
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        const ghost = this.ghostAt(x, y);
        if (ghost) {
            this.drag = { type: 'ghost', ghost };
            return;
        }
        const note = this.noteAt(x, y);
        if (note) {
            this.select(note);
            this.onSelect?.(note);
            this.onAudition?.(note.midi);
            this.drag = { type: 'note', note, startX: x, grabT: this.xToTime(x), origStart: note.start, moved: false };
            return;
        }
        // A note or ghost under the pointer wins over a crop handle on top of it.
        const handle = this.hitHandle(x, y);
        if (handle) {
            this.drag = { type: 'crop', handle, overview: y < OVERVIEW_H };
            return;
        }
        if (y < OVERVIEW_H && x >= GUTTER) {
            this.drag = { type: 'overview' };
            this.moveViewTo(this.overviewXToTime(x));
            return;
        }
        this.drag = { type: 'pan', startX: x, viewStart: this.view.start, moved: false };
    }

    pointerMove(e) {
        const { x, y } = this.localPoint(e);
        const d = this.drag;
        if (!d) {
            const ghost = this.ghostAt(x, y);
            const note = ghost ? ghost.note : this.noteAt(x, y);
            // Keep showing a note's alternatives while the pointer moves between them.
            const keep = !note && this.hover && this.nearAlternatives(this.hover, x, y);
            this.setHover(note ?? (keep ? this.hover : null), ghost);
            const handle = !ghost && !note && this.hitHandle(x, y);
            this.canvas.style.cursor = ghost ? 'pointer' : note || handle ? 'ew-resize' : 'default';
            return;
        }
        this.dragMove(x, y);
    }

    /** Apply the current drag at (x, y). Also called while auto-scrolling. */
    dragMove(x, y) {
        const d = this.drag;
        if (!d) return;
        if (d.type === 'crop') {
            const t = Math.max(0, Math.min(this.duration, d.overview ? this.overviewXToTime(x) : this.xToTime(x)));
            if (d.handle === 'start') this.crop.start = Math.min(t, this.crop.end - 0.1);
            else this.crop.end = Math.max(t, this.crop.start + 0.1);
            this.onCropChange?.({ ...this.crop });
            this.draw();
            if (!d.overview) this.updateAutoScroll(x, y);
            return;
        }
        if (d.type === 'overview') {
            this.moveViewTo(this.overviewXToTime(x));
            return;
        }
        if (d.type === 'note') {
            if (!d.moved && Math.abs(x - d.startX) <= DRAG_PX) return;
            if (!d.moved) {
                d.moved = true;
                this.onMoveStart?.(d.note);
            }
            d.note.start = Math.max(0, d.origStart + this.xToTime(x) - d.grabT);
            this.draw();
        } else if (d.type === 'pan') {
            if (Math.abs(x - d.startX) > DRAG_PX) d.moved = true;
            if (d.moved) {
                const span = this.view.end - this.view.start;
                const start = d.viewStart - ((x - d.startX) / this.plotWidth) * span;
                this.follow = false;
                this.setView(start, start + span);
            }
        }
    }

    pointerUp(e) {
        const d = this.drag;
        this.drag = null;
        this.scroll = null;
        if (!d) return;
        if (d.type === 'ghost') {
            this.onChoose?.(d.ghost.note, { string: d.ghost.string, fret: d.ghost.fret });
        } else if (d.type === 'note' && d.moved) {
            this.onMove?.(d.note);
        } else if (d.type === 'pan' && !d.moved) {
            const { x } = this.localPoint(e);
            this.select(null);
            this.onSelect?.(null);
            this.onSeek?.(Math.max(0, Math.min(this.duration, this.xToTime(x))));
        }
    }

    /** Is (x, y) in the column of a note's alternatives (so hovering can travel between them)? */
    nearAlternatives(note, x, y) {
        const b = this.boxAt(note.string, note.fret, note.start);
        return x >= b.x - 4 && x <= b.x + 26 && y >= TOP && y <= this.height - BOTTOM;
    }

    doubleClick(e) {
        if (!this.duration) return;
        const { x, y } = this.localPoint(e);
        if (y < TOP) return;
        if (this.noteAt(x, y) || this.ghostAt(x, y) || x < GUTTER) return;
        const string = this.stringAt(y);
        if (string) this.onAdd?.(string, Math.max(0, this.xToTime(x)));
    }

    // ----- scrolling while dragging a handle past an edge -----

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
        const shift = this.scroll.speed * span * AUTO_SCROLL_RATE * seconds;
        this.follow = false;
        this.setView(this.view.start + shift, this.view.end + shift);
        if (this.view.start !== before) this.dragMove(this.scroll.x, this.scroll.y);
        this.scrollFrame = this.scroll ? requestAnimationFrame((t) => this.autoScrollStep(t)) : null;
    }

    wheel(e) {
        if (!this.duration) return;
        e.preventDefault();
        const { x } = this.localPoint(e);
        const span = this.view.end - this.view.start;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
            const delta = ((e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / this.plotWidth) * span;
            this.follow = false;
            this.setView(this.view.start + delta, this.view.end + delta);
        } else {
            const factor = Math.exp(e.deltaY * 0.0025);
            const anchor = this.xToTime(Math.max(GUTTER, x));
            const ratio = (anchor - this.view.start) / span;
            const next = span * factor;
            this.setView(anchor - ratio * next, anchor + (1 - ratio) * next);
        }
    }
}
