// Multiplexer: greedy, one step (onset) at a time.
//
// At each step, add the candidate that raises the objective's score the most,
// as long as the member can still play everything chosen for it at once. Stop
// at `maxPerOnset` notes, or when the next one would add less than `minGain`
// times what the first one added.
//
// Pitched notes and percussive hits are chosen separately (pitches first), each
// with its own limit and its own first gain: they use different resources
// (strings, and the hand on the body), and a loud kick under a chord would
// otherwise make every chord note look too weak to keep. Every kept sound must
// also add at least `minShare` to the score on its own (with `energy`, a share
// of the frame), so noise that leaks into pitches at a drum hit isn't kept just
// because nothing else pitched starts there.

const defaults = {
    maxPerOnset: 6,
    minGain: 0.1,
    minShare: 0.02,
};

const settings = [
    {
        key: 'maxPerOnset', label: 'Notes at once', min: 1, max: 6, step: 1,
        format: (v) => `${v}`,
        help: 'The most notes to start at the same moment.',
    },
    {
        key: 'minGain', label: 'Weakest note', min: 0, max: 0.6, step: 0.01,
        format: (v) => v.toFixed(2),
        help: 'Keep adding notes while each adds at least this much, compared with the first one at that moment.',
    },
    {
        key: 'minShare', label: 'Smallest share', min: 0, max: 0.2, step: 0.005,
        format: (v) => `${(v * 100).toFixed(1)}%`,
        help: 'Every kept sound must account for at least this share of its moment. Lower it to keep quiet notes under loud ones.',
    },
];

/** Group candidates that start together into steps. */
export function stepsOf(candidates) {
    const byStart = new Map();
    for (const c of candidates) {
        if (!byStart.has(c.start)) byStart.set(c.start, []);
        byStart.get(c.start).push(c);
    }
    const starts = [...byStart.keys()].sort((a, b) => a - b);
    const lastEnd = Math.max(0, ...candidates.map((c) => c.start + c.duration));
    return starts.map((start, i) => ({ start, end: starts[i + 1] ?? lastEnd, candidates: byStart.get(start) }));
}

export default {
    id: 'greedy',
    name: 'Greedy',
    description: 'At each onset, the notes that add the most, one at a time.',
    defaults,
    settings,

    choose(candidates, { objective, context, ensemble, options } = {}) {
        const o = { ...defaults, ...options };
        const choices = [];
        for (const step of stepsOf(candidates)) {
            const chosen = [];
            let current = 0;
            const states = new Map();
            const gains = new Map();
            const firsts = new Map();
            const pitched = (c) => 'midi' in c.sound;
            for (const group of [step.candidates.filter(pitched), step.candidates.filter((c) => !pitched(c))]) {
                let remaining = group;
                let first = null;
                let count = 0;
                while (count < o.maxPerOnset && remaining.length) {
                    let best = null;
                    for (const c of remaining) {
                        const member = ensemble[c.member];
                        const sounds = [...chosen, c].filter((x) => x.member === c.member).map((x) => x.sound);
                        const possible = member.instrument.playability.states(sounds, member.options);
                        if (!possible.length) continue;
                        const gain = objective.score([...chosen, c], step, context) - current;
                        if (!best || gain > best.gain) best = { c, gain, state: possible[0] };
                    }
                    if (!best || best.gain <= 0 || best.gain < o.minShare) break;
                    if (first !== null && best.gain < o.minGain * first) break;
                    first ??= best.gain;
                    chosen.push(best.c);
                    count++;
                    current += best.gain;
                    states.set(best.c.member, best.state);
                    gains.set(best.c, best.gain);
                    firsts.set(best.c, first);
                    remaining = remaining.filter((x) => x !== best.c);
                }
            }
            for (const c of chosen) {
                choices.push({ candidate: c, member: c.member, state: states.get(c.member), weight: Math.min(1, gains.get(c) / firsts.get(c)) });
            }
        }
        return choices;
    },
};
