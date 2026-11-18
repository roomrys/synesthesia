// Hand costs for playing notes on a guitar, shared by the `path` fingering and
// the arrangement extractor's guitar instrument (js/extract/arrange). Pure.
//
// A candidate is one way to play an event (notes that start together): each note
// on a different string, within the hand's reach. Its cost covers stretch,
// height up the neck and open strings; moving between candidates costs a hand
// shift and string jumps. See js/tabs/README.md.

import { positionsFor } from './guitar.js';
import { hasFixedPosition } from './index.js';

export const SKIP_COST = 100;          // per note left unplayed; far above any real fingering
export const MAX_COMBINATIONS = 4000;  // per event, a safety limit for huge chords

/** Candidate fingerings for one event. */
export function candidatesFor(event, guitar, o) {
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
export function scoreCandidate(chosen, o) {
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

export const SHIFT_BASE = 1;        // any change of hand position
export const SHIFT_PER_FRET = 0.3;  // plus this per fret moved

/**
 * Where the hand goes for candidate `b`, from position `hand` (the lowest fret it
 * covers, or null before the first fretted note): it stays if b's frets fit in
 * its `reach`, otherwise it shifts the least it can.
 */
export function nextHand(hand, b, o) {
    if (b.lo === null) return hand;
    const width = Math.max(1, o.reach - 1);
    if (hand === null) return b.lo;
    if (b.lo >= hand && b.hi <= hand + width) return hand;
    return b.lo < hand || b.hi - b.lo > width ? b.lo : b.hi - width;
}

/** Cost of going from candidate a (hand at `hand`) to b, `gap` seconds of rest apart. */
export function moveCost(hand, a, b, gap, o) {
    let cost = 0;
    const to = nextHand(hand, b, o);
    if (hand !== null && to !== hand) {
        const d = Math.abs(to - hand);
        cost += (o.move * (SHIFT_BASE + SHIFT_PER_FRET * d)) / (1 + Math.max(0, gap));
    }
    if (a.across !== null && b.across !== null) cost += o.stringChange * Math.abs(a.across - b.across);
    return { cost, hand: to };
}
