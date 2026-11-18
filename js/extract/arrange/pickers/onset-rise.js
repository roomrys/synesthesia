// Picker: a candidate wherever a sound's activation rises at an onset.
//
// For each onset (plus the start of the clip), and each dictionary column:
//   before = the lowest activation in the `lookback` before the onset (0 at the start)
//   peak   = the highest activation from the onset until the next onset, at most `lookahead`
//   rise   = peak − before
// A column is a candidate if its peak is above `floorDb` (absolute, so silence
// and faint noise give nothing) and its rise is at least `minRise` times the
// biggest rise at that onset. A sound that was already ringing must rise by at
// least `restrike` of its peak, so beating between partials, or a drum hit over
// a held note, doesn't count as playing it again. It ends when its activation falls below
// `endRatio` of its peak, or when the same column starts again.
//
// Where the analysis window only partly covers a tone (its start or end), the
// spectrum broadens and the projection explains the edge with the neighbouring
// semitones. So a pitched candidate is dropped when an adjacent semitone of the
// same member is `neighbourRatio` times stronger at its peak.

const defaults = {
    lookback: 0.15,
    lookahead: 0.2,
    floorDb: -50,          // peaks below this (relative to full scale) are silence
    minRise: 0.1,
    restrike: 0.3,
    endRatio: 0.3,
    minSeconds: 0.05,
    neighbourRatio: 2,     // 0 = off
};

const settings = [
    {
        key: 'floorDb', label: 'Quiet cutoff', min: -80, max: -20, step: 1,
        format: (v) => `${v} dB`,
        help: 'Ignore sounds quieter than this. Lower it to keep quiet notes.',
    },
    {
        key: 'restrike', label: 'Re-strike', min: 0, max: 0.9, step: 0.05,
        format: (v) => `${Math.round(v * 100)}%`,
        help: 'A note that is still ringing counts as played again only if it rises by this share of its peak. Lower = more re-strikes.',
    },
    {
        key: 'minRise', label: 'Smallest start', min: 0, max: 0.6, step: 0.01,
        format: (v) => v.toFixed(2),
        help: 'A sound must rise at least this much, compared with the strongest one starting at the same moment.',
    },
];

export default {
    id: 'onset-rise',
    name: 'Rise at onsets',
    description: 'Every sound whose activation jumps at an onset.',
    defaults,
    settings,

    pick(activations, dictionary, { rhythm, options } = {}) {
        const o = { ...defaults, ...options };
        const H = activations.values;
        const hop = activations.hopSeconds;
        const frames = H[0]?.length ?? 0;
        if (!frames) return [];
        const floor = 10 ** (o.floorDb / 20);
        const frameOf = (t) => Math.max(0, Math.min(frames - 1, Math.round(t / hop)));

        // Column of each pitched sound, for the neighbour check.
        const columnOf = new Map();
        dictionary.labels.forEach((l, j) => { if ('midi' in l.sound) columnOf.set(`${l.member}/${l.sound.midi}`, j); });
        const louderNeighbour = (j, f) => {
            const { member, sound } = dictionary.labels[j];
            if (!o.neighbourRatio || !('midi' in sound)) return false;
            return [-1, 1].some((d) => {
                const k = columnOf.get(`${member}/${sound.midi + d}`);
                return k !== undefined && H[k][f] > o.neighbourRatio * H[j][f];
            });
        };

        // The start of the clip counts as an onset if something is already sounding.
        const times = [...rhythm.onsets];
        const soundingAtStart = H.some((a) => a[0] >= floor);
        if (soundingAtStart && (!times.length || times[0] > o.minSeconds)) times.unshift(0);

        const candidates = [];
        times.forEach((t, i) => {
            const fo = frameOf(t);
            const next = i + 1 < times.length ? frameOf(times[i + 1]) : frames - 1;
            const last = Math.min(next, fo + Math.round(o.lookahead / hop));
            const first = Math.max(0, fo - Math.round(o.lookback / hop));
            const found = [];
            for (let j = 0; j < H.length; j++) {
                const a = H[j];
                let before = Infinity;
                if (t === 0) before = 0;
                else for (let f = first; f <= fo; f++) before = Math.min(before, a[f]);
                let peak = 0, at = fo;
                for (let f = fo; f <= Math.max(fo, last); f++) if (a[f] > peak) { peak = a[f]; at = f; }
                // Still rising where the next onset cuts the look-ahead: that rise belongs to the next onset.
                if (last === next && at === last && last + 1 < frames && a[last + 1] > a[last]) continue;
                const rise = peak - before;
                if (peak >= floor && rise > 0 && rise >= o.restrike * peak && !louderNeighbour(j, at)) found.push({ column: j, rise, peak, at });
            }
            const top = Math.max(0, ...found.map((c) => c.rise));
            for (const c of found) {
                if (c.rise < o.minRise * top) continue;
                const label = dictionary.labels[c.column];
                candidates.push({ column: c.column, member: label.member, sound: label.sound, start: t, strength: c.rise, peakFrame: c.at });
            }
        });

        // Ends: the activation falls away, or the same column starts again.
        const nextStart = new Map();
        const out = [];
        for (let k = candidates.length - 1; k >= 0; k--) {
            const c = candidates[k];
            const a = H[c.column];
            const restart = nextStart.get(c.column) ?? Infinity;
            const limit = a[c.peakFrame] * o.endRatio;
            let f = c.peakFrame;
            while (f + 1 < frames && a[f + 1] >= limit && (f + 1) * hop < restart) f++;
            const end = Math.min(restart, (f + 1) * hop);
            nextStart.set(c.column, c.start);
            if (end - c.start >= o.minSeconds) out.push({ ...c, duration: end - c.start });
        }
        return out.reverse();
    },
};
