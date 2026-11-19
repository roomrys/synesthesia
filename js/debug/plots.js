// Canvas plots for the debug pages: heatmaps on a shared time axis, and line
// plots. No dependencies; the pages decide what to plot.

/** Magma-like colour map: t in 0..1 to [r, g, b]. */
const STOPS = [
    [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129],
    [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191],
];
export function magma(t) {
    const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(x));
    const f = x - i;
    return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
}

/** Diverging map for signed values in -1..1: blue (negative), black (0), orange (positive). */
export function diverging(t) {
    const a = Math.min(1, Math.abs(t));
    return t >= 0 ? [Math.round(255 * a), Math.round(150 * a), Math.round(40 * a)] : [Math.round(60 * a), Math.round(140 * a), Math.round(255 * a)];
}

/** A level (magnitude) as 0..1 on a dB scale: `rangeDb` below `ref` is 0, `ref` is 1. */
export function dbLevel(value, ref, rangeDb = 80) {
    if (!(value > 0) || !(ref > 0)) return 0;
    return Math.max(0, Math.min(1, 1 + (20 * Math.log10(value / ref)) / rangeDb));
}

/**
 * An image with one column per frame and one row per row index (row 0 at the top).
 * `color(f, r)` returns [r, g, b]. Returns an offscreen canvas to draw scaled.
 */
export function heatImage(frames, rows, color) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, frames);
    canvas.height = Math.max(1, rows);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) {
        for (let f = 0; f < frames; f++) {
            const [cr, cg, cb] = color(f, r);
            const i = 4 * (r * canvas.width + f);
            img.data[i] = cr;
            img.data[i + 1] = cg;
            img.data[i + 2] = cb;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

/**
 * The visible time range, shared by every plot on a page. Listeners are called
 * on every change; `cursor` is a time the user picked (or null).
 */
export class TimeView {
    constructor() {
        this.duration = 1;
        this.t0 = 0;
        this.t1 = 1;
        this.cursor = null;       // the playhead
        this.listeners = new Set();
    }

    onChange(fn) { this.listeners.add(fn); }
    changed() { for (const fn of this.listeners) fn(this); }

    reset(duration) {
        this.duration = Math.max(0.01, duration);
        this.t0 = 0;
        this.t1 = this.duration;
        this.changed();
    }

    clamp() {
        const span = Math.min(this.duration, Math.max(0.05, this.t1 - this.t0));
        this.t0 = Math.max(0, Math.min(this.duration - span, this.t0));
        this.t1 = this.t0 + span;
    }

    zoomAt(t, factor) {
        this.t0 = t - (t - this.t0) * factor;
        this.t1 = t + (this.t1 - t) * factor;
        this.clamp();
        this.changed();
    }

    panBy(dt) {
        this.t0 += dt;
        this.t1 += dt;
        this.clamp();
        this.changed();
    }

    setCursor(t) {
        this.cursor = t;
        this.changed();
    }

    /** x in a plot area from `left` to `left + width`. */
    x(t, left, width) { return left + ((t - this.t0) / (this.t1 - this.t0)) * width; }
    time(x, left, width) { return this.t0 + ((x - left) / width) * (this.t1 - this.t0); }
}

/**
 * Scroll to zoom, drag to pan, click to pick a time, on any plot canvas.
 *
 * `grab(at)` lets the page offer something to drag instead of panning: it gets
 * { t, x, y, width, height } (CSS pixels within the canvas, t = time under the
 * pointer) and returns null or { cursor, drag(at), end?() }. `onPick(t)` is
 * called for a click that didn't drag.
 */
export function attachTimeControls(canvas, view, plotLeft, { grab = () => null, onPick = () => {} } = {}) {
    let drag = null;
    const at = (e) => {
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        return { x, y: e.clientY - r.top, width: r.width, height: r.height, t: view.time(x, plotLeft, r.width - plotLeft) };
    };
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const a = at(e);
        const width = a.width - plotLeft;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) view.panBy((e.deltaX / width) * (view.t1 - view.t0));
        else view.zoomAt(a.t, Math.exp(e.deltaY * 0.002));
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
        const a = at(e);
        drag = { x: e.clientX, moved: false, handle: a.x >= plotLeft ? grab(a) : null };
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
        const a = at(e);
        if (!drag) {
            canvas.style.cursor = (a.x >= plotLeft && grab(a)?.cursor) || 'default';
            return;
        }
        if (drag.handle) {
            drag.handle.drag(a);
            return;
        }
        const dx = e.clientX - drag.x;
        if (Math.abs(dx) > 3) drag.moved = true;
        if (!drag.moved) return;
        view.panBy((-dx / (a.width - plotLeft)) * (view.t1 - view.t0));
        drag.x = e.clientX;
    });
    const finish = (e) => {
        if (!drag) return;
        if (drag.handle) drag.handle.end?.();
        else if (!drag.moved) {
            const a = at(e);
            if (a.x >= plotLeft) onPick(a.t);
        }
        drag = null;
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => { drag = null; });
}

/** Shade outside the time crop and draw its handles (yellow, as on the note extractor). */
export function drawCrop(ctx, view, rect, crop) {
    if (!crop) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    const x0 = view.x(crop.start, rect.x, rect.width);
    const x1 = view.x(crop.end, rect.x, rect.width);
    if (x0 > rect.x) ctx.fillRect(rect.x, rect.y, Math.min(x0, rect.x + rect.width) - rect.x, rect.height);
    if (x1 < rect.x + rect.width) ctx.fillRect(Math.max(x1, rect.x), rect.y, rect.x + rect.width - Math.max(x1, rect.x), rect.height);
    ctx.fillStyle = ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 2;
    for (const x of [x0, x1]) {
        if (x < rect.x - 1 || x > rect.x + rect.width + 1) continue;
        ctx.beginPath();
        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + rect.height);
        ctx.stroke();
        ctx.fillRect(x - 4, rect.y + rect.height / 2 - 10, 8, 20);   // grip
    }
    ctx.restore();
}

/** Size a canvas to its CSS box at the device pixel ratio; returns a context scaled to CSS pixels. */
export function fitCanvas(canvas, cssHeight) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvas.parentElement.clientWidth;
    canvas.style.height = `${cssHeight}px`;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(cssHeight * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(cssHeight * ratio);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width, height: cssHeight };
}

/**
 * Draw the visible part of a heat image (one column per frame, frame f centred
 * at f·hop) into the rectangle, with crisp pixels.
 */
export function drawHeat(ctx, image, view, rect, hopSeconds) {
    const first = view.t0 / hopSeconds + 0.5;
    const count = (view.t1 - view.t0) / hopSeconds;
    ctx.imageSmoothingEnabled = count > rect.width * 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.drawImage(image, first, 0, count, image.height, rect.x, rect.y, rect.width, rect.height);
}

/** Time ticks along the top of a plot area, and faint vertical grid lines. */
export function drawTimeGrid(ctx, view, rect, { labels = true } = {}) {
    const span = view.t1 - view.t0;
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60];
    const step = steps.find((s) => span / s <= rect.width / 70) ?? 60;
    ctx.save();
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1; t += step) {
        const x = view.x(t, rect.x, rect.width);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + rect.height);
        ctx.stroke();
        if (labels) {
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.fillText(step < 1 ? t.toFixed(step < 0.1 ? 2 : 1) : `${Math.round(t)}`, x + 2, rect.y + 2);
        }
    }
    ctx.restore();
}

/** The playhead (`view.cursor`): a white line with a grip at the top, to drag. */
export function drawMarkers(ctx, view, rect) {
    const t = view.cursor;
    if (t === null || t < view.t0 || t > view.t1) return;
    const x = view.x(t, rect.x, rect.width);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x, rect.y + rect.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 6, rect.y);
    ctx.lineTo(x + 6, rect.y);
    ctx.lineTo(x, rect.y + 8);
    ctx.fill();
    ctx.restore();
}

/** Labels in the left gutter: `marks` are [{ y, text }] in CSS pixels. */
export function drawGutter(ctx, rect, marks, title) {
    ctx.save();
    ctx.fillStyle = '#16161f';
    ctx.fillRect(0, rect.y, rect.x, rect.height);
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textBaseline = 'middle';
    for (const m of marks) if (m.y >= rect.y && m.y <= rect.y + rect.height) ctx.fillText(m.text, 4, m.y);
    if (title) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(title, 4, rect.y + 2);
    }
    ctx.restore();
}
