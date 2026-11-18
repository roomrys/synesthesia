// Multiplexer: greedy, one step (onset) at a time.
//
// At each step, add the candidate that raises the objective's score the most,
// as long as the member can still play everything chosen for it at once. Stop
// at `maxPerOnset` notes, or when the next one would add less than `minGain`
// times what the first one added.

const defaults = {
    maxPerOnset: 6,
    minGain: 0.1,
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
            let remaining = [...step.candidates];
            let current = 0;
            let first = null;
            const states = new Map();
            const gains = new Map();
            while (chosen.length < o.maxPerOnset && remaining.length) {
                let best = null;
                for (const c of remaining) {
                    const member = ensemble[c.member];
                    const sounds = [...chosen, c].filter((x) => x.member === c.member).map((x) => x.sound);
                    const possible = member.instrument.playability.states(sounds, member.options);
                    if (!possible.length) continue;
                    const gain = objective.score([...chosen, c], step, context) - current;
                    if (!best || gain > best.gain) best = { c, gain, state: possible[0] };
                }
                if (!best || best.gain <= 0) break;
                if (first !== null && best.gain < o.minGain * first) break;
                first ??= best.gain;
                chosen.push(best.c);
                current += best.gain;
                states.set(best.c.member, best.state);
                gains.set(best.c, best.gain);
                remaining = remaining.filter((x) => x !== best.c);
            }
            for (const c of chosen) {
                choices.push({ candidate: c, member: c.member, state: states.get(c.member), weight: Math.min(1, gains.get(c) / first) });
            }
        }
        return choices;
    },
};
