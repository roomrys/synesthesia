// Fingering: the cheapest path through the possible positions.
//
// 1. Notes that start together are one event (a chord, or a single note).
// 2. Each event gets candidate fingerings: every way to put its notes on
//    different strings, with hand-fixed notes forced. Candidates that stretch
//    beyond the hand's reach are dropped; the cheapest few are kept.
// 3. Each candidate has a cost of its own (stretch, height up the neck, minus a
//    bonus for open strings) and a cost from the previous event's candidate.
//    The hand sits in a position covering `reach` frets (one finger per fret).
//    Notes inside it are free to reach; a note outside makes the hand shift,
//    which costs a fixed amount plus a little per fret (cheaper after a rest).
//    Jumping across strings costs a little too. Open strings don't need the
//    hand, so it stays where it was.
// 4. Dynamic programming (Viterbi) finds the sequence with the lowest total.
//
// Notes that can't be placed (out of range, or more notes than strings) are
// skipped at a high cost and reported as unplayable. See js/tabs/README.md.

import { positionsFor } from '../guitar.js';
import { groupEvents, hasFixedPosition } from '../index.js';

const SKIP_COST = 100;          // per note left unplayed; far above any real fingering
const MAX_COMBINATIONS = 4000;  // per event, a safety limit for huge chords

/** Candidate fingerings for one event. */
function candidatesFor(event, guitar, o) {
    const fixed = event.notes.filter((n) => hasFixedPosition(n, guitar));
    // Highest notes first: they usually want the high strings, which finds good candidates early.
    const free = event.notes.filter((n) => !hasFixedPosition(n, guitar)).sort((a, b) => b.midi - a.midi);
    const options = free.map((n) => positionsFor(guitar, n.midi));
    const start = fixed.map((n) => ({ note: n, string: n.string, fret: n.fret }));
    const out = [];
    let explored = 0;

    const fretted = (list) => list.filter((p) => p && p.fret > 0).map((p) => p.fret);
    const withinReach = (list) => {
        const frets = fretted(list);
        return !frets.length || Math.max(...frets) - Math.min(...frets) <= o.reach;
    };

    const visit = (i, chosen, used) => {
        if (explored > MAX_COMBINATIONS) return;
        if (i === free.length) {
            explored++;
            out.push(scoreCandidate(chosen, o));
            return;
        }
        let placedAny = false;
        for (const p of options[i]) {
            if (used.has(p.string)) continue;
            const next = [...chosen, { note: free[i], string: p.string, fret: p.fret }];
            if (!withinReach(next)) continue;
            placedAny = true;
            used.add(p.string);
            visit(i + 1, next, used);
            used.delete(p.string);
        }
        // Skip a note only when it can't go anywhere (keeps the search small).
        if (!placedAny) visit(i + 1, [...chosen, { note: free[i], string: null, fret: null }], used);
    };
    visit(0, start, new Set(start.map((p) => p.string)));

    out.sort((a, b) => a.cost - b.cost);
    return out.slice(0, Math.max(1, o.keep));
}

/** A candidate's own cost, and where it puts the hand. */
function scoreCandidate(chosen, o) {
    const played = chosen.filter((p) => p.string !== null);
    const frets = played.filter((p) => p.fret > 0).map((p) => p.fret);
    const span = frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
    const skipped = chosen.length - played.length;
    const opens = played.length - frets.length;
    const avgFret = frets.length ? frets.reduce((a, b) => a + b, 0) / frets.length : 0;
    const avgString = played.length ? played.reduce((a, p) => a + p.string, 0) / played.length : null;
    const cost = SKIP_COST * skipped
        + o.stretch * Math.max(0, span - 1)
        + o.height * avgFret
        - o.open * opens;
    const lo = frets.length ? Math.min(...frets) : null;
    const hi = frets.length ? Math.max(...frets) : null;
    return { chosen, cost, lo, hi, across: avgString };
}

const SHIFT_BASE = 1;        // any change of hand position
const SHIFT_PER_FRET = 0.3;  // plus this per fret moved

/**
 * Where the hand goes for candidate `b`, from position `hand` (the lowest fret it
 * covers, or null before the first fretted note): it stays if b's frets fit in
 * its `reach`, otherwise it shifts the least it can.
 */
function nextHand(hand, b, o) {
    if (b.lo === null) return hand;
    const width = Math.max(1, o.reach - 1);
    if (hand === null) return b.lo;
    if (b.lo >= hand && b.hi <= hand + width) return hand;
    return b.lo < hand || b.hi - b.lo > width ? b.lo : b.hi - width;
}

/** Cost of going from candidate a (hand at `hand`) to b, `gap` seconds of rest apart. */
function moveCost(hand, a, b, gap, o) {
    let cost = 0;
    const to = nextHand(hand, b, o);
    if (hand !== null && to !== hand) {
        const d = Math.abs(to - hand);
        cost += (o.move * (SHIFT_BASE + SHIFT_PER_FRET * d)) / (1 + Math.max(0, gap));
    }
    if (a.across !== null && b.across !== null) cost += o.stringChange * Math.abs(a.across - b.across);
    return { cost, hand: to };
}

export default {
    id: 'path',
    name: 'Easiest path',
    description: 'Keeps the hand still: small jumps, chords within reach, lower frets and open strings preferred.',
    defaults: { reach: 4, move: 1, stretch: 0.5, height: 0.08, open: 0.3, stringChange: 0.25, keep: 24 },
    settings: [
        { key: 'reach', label: 'Hand reach', min: 2, max: 7, step: 1, format: (v) => `${v} frets`,
            help: 'How many frets the hand covers without moving, and the widest stretch in a chord.' },
        { key: 'move', label: 'Avoid moving', min: 0, max: 3, step: 0.1, format: (v) => v.toFixed(1),
            help: 'How much to avoid moving the hand along the neck between notes.' },
        { key: 'height', label: 'Prefer low frets', min: 0, max: 0.5, step: 0.01, format: (v) => v.toFixed(2),
            help: 'How much to prefer positions near the nut.' },
        { key: 'open', label: 'Prefer open strings', min: 0, max: 2, step: 0.1, format: (v) => v.toFixed(1),
            help: 'A bonus for playing a note on an open string.' },
        { key: 'stringChange', label: 'Avoid string jumps', min: 0, max: 2, step: 0.05, format: (v) => v.toFixed(2),
            help: 'How much to avoid jumping across strings between notes.' },
    ],

    assign(notes, guitar, { options }) {
        const o = { ...this.defaults, ...options };
        const events = groupEvents(notes);
        if (!events.length) return { notes: [], unplayable: [] };

        const candidates = events.map((e) => candidatesFor(e, guitar, o));
        // Viterbi: best[i][k] = cheapest total ending with candidate k at event i. Each entry
        // also remembers where the hand is on that path, carried through open-string events.
        let best = candidates[0].map((c) => ({ total: c.cost, from: -1, hand: nextHand(null, c, o) }));
        const back = [best];
        for (let i = 1; i < events.length; i++) {
            const gap = events[i].start - events[i - 1].end;
            const prev = candidates[i - 1];
            best = candidates[i].map((c) => {
                let total = Infinity;
                let from = 0;
                let hand = null;
                prev.forEach((p, j) => {
                    const step = moveCost(back[i - 1][j].hand, p, c, gap, o);
                    const t = back[i - 1][j].total + step.cost;
                    if (t < total) { total = t; from = j; hand = step.hand; }
                });
                return { total: total + c.cost, from, hand };
            });
            back.push(best);
        }

        // Walk back from the cheapest end.
        let k = best.reduce((m, b, i) => (b.total < best[m].total ? i : m), 0);
        const placed = [];
        const unplayable = [];
        for (let i = events.length - 1; i >= 0; i--) {
            for (const p of candidates[i][k].chosen) {
                if (p.string === null) unplayable.push(p.note);
                else placed.push({ ...p.note, string: p.string, fret: p.fret, fixed: Boolean(p.note.fixed) && hasFixedPosition(p.note, guitar) });
            }
            k = back[i][k].from;
        }
        return { notes: placed, unplayable };
    },
};
