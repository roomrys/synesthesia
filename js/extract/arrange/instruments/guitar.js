// Instrument: a guitar. What it can play, and how hard combinations are to play.
//
// Pitches come from the tuning (js/tabs/guitar.js); the percussive sounds are a
// muted-string scratch, a thumb slap and a body tap. Playability uses the same
// hand costs as the tabs page's `path` fingering (js/tabs/hand.js): notes that
// sound together must be on different strings, within the hand's reach.
// Percussive sounds don't take a string for now.

import { STANDARD, pitchRange } from '../../../tabs/guitar.js';
import { candidatesFor, moveCost, nextHand } from '../../../tabs/hand.js';
import path from '../../../tabs/fingerings/path.js';

const TECHNIQUES = ['mute', 'slap', 'tap'];

const defaults = {
    guitar: STANDARD,
    percussion: true,      // include the percussive sounds
    ...path.defaults,      // reach, stretch, height, open, move, stringChange, keep
};

export default {
    id: 'guitar',
    name: 'Guitar',
    description: 'Six strings in the given tuning, plus muted scratches, slaps and taps.',
    defaults,

    defaultProfile: { timbre: 'harmonic', instrument: 'guitar', name: 'Steel-string guitar', params: {} },

    sounds(options = defaults) {
        const { min, max } = pitchRange(options.guitar);
        const out = [];
        for (let midi = min; midi <= max; midi++) out.push({ midi });
        if (options.percussion) for (const technique of TECHNIQUES) out.push({ technique });
        return out;
    },

    playability: {
        /** Ways to play these sounds at once, cheapest first. [] = impossible. */
        states(sounds, options = defaults) {
            const pitched = sounds.filter((s) => 'midi' in s);
            const techniques = sounds.filter((s) => !('midi' in s)).map((s) => s.technique);
            if (new Set(techniques).size !== techniques.length) return [];
            if (new Set(pitched.map((s) => s.midi)).size !== pitched.length) return [];
            const event = { notes: pitched.map((s) => ({ midi: s.midi })) };
            return candidatesFor(event, options.guitar, options)
                .filter((c) => c.chosen.every((p) => p.string !== null))
                .map((fingering) => ({ fingering, techniques }));
        },
        cost(state) {
            return state.fingering.cost;
        },
        /** Moving the hand from one state to the next, `gap` seconds of rest apart. */
        transition(prev, next, gap, options = defaults) {
            const hand = nextHand(null, prev.fingering, options);
            return moveCost(hand, prev.fingering, next.fingering, gap, options).cost;
        },
    },
};
