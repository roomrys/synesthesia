// The guitar: which pitch each string and fret plays. Pure.
//
// Strings are numbered as in tab notation: string 1 is the highest-pitched
// (high E in standard tuning). Fret 0 is the open string. Tuning and capo are
// properties of the guitar, so a different tuning is just a different Guitar.

/**
 * @typedef {Object} Guitar
 * @property {number[]} strings  MIDI note of each open string, string 1 first.
 * @property {number} frets      Highest fret.
 */

/**
 * @typedef {Object} Position
 * @property {number} string  1..strings.length, 1 = highest-pitched string.
 * @property {number} fret    0 = open string.
 */

/** Standard tuning, E A D G B E (high E first), 21 frets like the fretboard page. */
export const STANDARD = Object.freeze({ strings: Object.freeze([64, 59, 55, 50, 45, 40]), frets: 21 });

export function stringCount(guitar) {
    return guitar.strings.length;
}

/** The pitch played at a position. */
export function midiAt(guitar, string, fret) {
    return guitar.strings[string - 1] + fret;
}

/** Every position that plays this pitch, from string 1 down. */
export function positionsFor(guitar, midi) {
    const out = [];
    guitar.strings.forEach((open, i) => {
        const fret = midi - open;
        if (fret >= 0 && fret <= guitar.frets) out.push({ string: i + 1, fret });
    });
    return out;
}

/** Lowest and highest pitch the guitar can play. */
export function pitchRange(guitar) {
    return {
        min: Math.min(...guitar.strings),
        max: Math.max(...guitar.strings) + guitar.frets,
    };
}
