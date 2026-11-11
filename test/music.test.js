import { test, assertEqual, assertClose } from './runner.js';
import { midiToName, nameToMidi, midiToHz, hzToMidi, noteColor, overtones } from '../js/extract/music.js';

test('music: overtones sit at the octave, octave + fifth, two octaves…', () => {
    const o = overtones(8);
    assertEqual(o.map((x) => x.harmonic).join(','), '2,3,4,5,6,7,8');
    assertEqual(o.map((x) => Math.round(x.semitones)).join(','), '12,19,24,28,31,34,36');
    assertClose(o[5].semitones, 33.69, 0.01, 'harmonic 7 is flat of a semitone row:');
});

test('music: midi <-> name', () => {
    assertEqual(midiToName(69), 'A4');
    assertEqual(midiToName(60), 'C4');
    assertEqual(midiToName(40), 'E2');
    assertEqual(midiToName(61), 'C#4');
    assertEqual(nameToMidi('A4'), 69);
    assertEqual(nameToMidi('E2'), 40);
    assertEqual(nameToMidi('Db4'), 61);
    assertEqual(nameToMidi('C#4'), 61);
});

test('music: midi <-> Hz', () => {
    assertClose(midiToHz(69), 440, 1e-9);
    assertClose(midiToHz(40), 82.4069, 1e-3);
    assertClose(hzToMidi(440), 69, 1e-9);
});

test('music: colours match the fretboard', () => {
    assertEqual(noteColor(69), 'rgb(255, 0, 0)');      // A is red, as .noteA
    assertEqual(noteColor(64), 'rgb(0, 127, 255)');    // E, as .noteE
});
