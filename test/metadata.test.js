import { test, assertEqual } from './runner.js';
import { guessSongInfo } from '../js/extract/metadata.js';

const guess = (label, opts) => JSON.stringify(guessSongInfo(label, opts));

test('metadata: artist and song from "Artist - Song", with extras and a site name dropped', () => {
    assertEqual(guess('Some Band - Their Song (Official Video) - Site'), '{"artist":"Some Band","song":"Their Song"}');
    assertEqual(guess('(2) Some Band – Their Song [HD]'), '{"artist":"Some Band","song":"Their Song"}');
    assertEqual(guess('Their Song | Some Site'), '{"song":"Their Song","artist":""}');
});

test('metadata: "Song - song by Artist" style titles', () => {
    assertEqual(guess('Their Song - song and lyrics by Some Band'), '{"song":"Their Song","artist":"Some Band"}');
});

test('metadata: file names lose the extension and underscores', () => {
    assertEqual(guess('some_band - their_song.mp3', { isFile: true }), '{"artist":"some band","song":"their song"}');
    assertEqual(guess('practice take.wav', { isFile: true }), '{"song":"practice take","artist":""}');
});

test('metadata: internal tab ids give no guess', () => {
    assertEqual(guessSongInfo('web-contents-media-stream://123:4'), null);
    assertEqual(guessSongInfo(''), null);
});
