// Timbre: a harmonic comb for pitched sounds, fixed shapes for percussive ones.
//
// Partial k of a string sits at k·f0·√(1 + B·k²) (B = inharmonicity: stiff
// strings run slightly sharp higher up) with strength k^-slope. Each partial is
// drawn with the representation's kernel, so it smears exactly as the analysis
// does. Percussive sounds are smooth bumps on a log-frequency scale:
//   mute: a muted-string scratch, broadband (snare, hi-hat)
//   slap: a low thump with some string noise (kick)
//   tap:  a body knock around the guitar's body resonance

import { midiToHz } from '../../music.js';

const defaults = {
    partials: 20,
    slope: 1.2,              // partial k has strength k^-slope
    inharmonicity: 5e-5,     // B
    muteHz: 1500, muteOctaves: 1.6,
    slapHz: 90, slapOctaves: 0.6,
    tapHz: 200, tapOctaves: 0.6,
};

/** A bump centred on `centre` Hz, `octaves` wide (standard deviation in octaves). */
function bump(hz, centre, octaves) {
    const d = Math.log2(hz / centre) / octaves;
    return Math.exp(-0.5 * d * d);
}

export default {
    id: 'harmonic',
    name: 'Harmonic comb',
    description: 'Partials at (slightly sharp) whole multiples of the pitch, fading with height.',
    defaults,

    /** The sine partials of a pitched sound, up to `maxHz`: [{ hz, amp }] (amp of a unit template before scaling). */
    partials(member, sound, { maxHz = Infinity } = {}) {
        if (!('midi' in sound)) return [];
        const p = { ...defaults, ...member.profile.params };
        const f0 = midiToHz(sound.midi);
        const out = [];
        for (let k = 1; k <= p.partials; k++) {
            const hz = k * f0 * Math.sqrt(1 + p.inharmonicity * k * k);
            if (hz > maxHz) break;
            out.push({ hz, amp: k ** -p.slope });
        }
        return out;
    },

    render(member, sound, axis) {
        const out = new Float32Array(axis.hz.length);
        if ('midi' in sound) {
            for (const { hz, amp } of this.partials(member, sound, { maxHz: axis.hz[axis.hz.length - 1] })) {
                const shape = axis.kernel(hz);
                for (let i = 0; i < out.length; i++) out[i] += amp * shape[i];
            }
            return out;
        }
        const p = { ...defaults, ...member.profile.params };
        for (let i = 0; i < out.length; i++) {
            const hz = axis.hz[i];
            const noise = bump(hz, p.muteHz, p.muteOctaves);
            if (sound.technique === 'mute') out[i] = noise;
            else if (sound.technique === 'slap') out[i] = bump(hz, p.slapHz, p.slapOctaves) + 0.3 * noise;
            else if (sound.technique === 'tap') out[i] = bump(hz, p.tapHz, p.tapOctaves) + 0.15 * noise;
        }
        return out;
    },
};
