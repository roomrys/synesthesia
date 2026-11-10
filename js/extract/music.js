// Music helpers: MIDI <-> note names, frequencies, and the fretboard's note colours.

export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Same colours as css/style.css (.noteA, .noteASharp, ...), indexed by pitch class (C = 0).
export const PITCH_CLASS_COLORS = [
    'rgb(127, 255, 0)',  // C
    'rgb(0, 255, 0)',    // C#
    'rgb(0, 255, 127)',  // D
    'rgb(0, 255, 255)',  // D#
    'rgb(0, 127, 255)',  // E
    'rgb(0, 0, 255)',    // F
    'rgb(127, 0, 255)',  // F#
    'rgb(255, 0, 255)',  // G
    'rgb(255, 0, 127)',  // G#
    'rgb(255, 0, 0)',    // A
    'rgb(255, 127, 0)',  // A#
    'rgb(255, 255, 0)',  // B
];

const mod12 = (n) => ((n % 12) + 12) % 12;

export function pitchClass(midi) {
    return mod12(Math.round(midi));
}

export function midiToName(midi) {
    const m = Math.round(midi);
    return PITCH_CLASSES[mod12(m)] + (Math.floor(m / 12) - 1);
}

export function nameToMidi(name) {
    const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
    if (!match) throw new Error(`Not a note name: ${name}`);
    const [, letter, accidental, octave] = match;
    let pc = PITCH_CLASSES.indexOf(letter.toUpperCase());
    if (accidental === '#') pc += 1;
    if (accidental === 'b') pc -= 1;
    return (Number(octave) + 1) * 12 + pc;
}

export function midiToHz(midi) {
    return 440 * 2 ** ((midi - 69) / 12);
}

export function hzToMidi(hz) {
    return 69 + 12 * Math.log2(hz / 440);
}

/**
 * How far above a note its overtones sound, in semitones (not rounded):
 * harmonic 2 is +12, 3 is +19.02, 4 is +24, 5 is +27.86, 6 is +31.02, 7 is +33.69, 8 is +36.
 * Returns [{ harmonic, semitones }] for harmonics 2..count.
 */
export function overtones(count = 8) {
    return Array.from({ length: count - 1 }, (_, i) => ({ harmonic: i + 2, semitones: 12 * Math.log2(i + 2) }));
}

export function noteColor(midi) {
    return PITCH_CLASS_COLORS[pitchClass(midi)];
}
