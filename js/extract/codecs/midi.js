// Standard MIDI files, through @tonejs/midi (MIT). The only file that imports it.
//
// Reading: notes from every track except percussion, with times in seconds
// (the file's tempo map is applied). Tracks become `part` when there's more
// than one. Writing: one track, at the library's default tempo; the title is
// the track and file name. Song details and positions are kept only in
// .synesthesia files.

import { Midi } from 'https://cdn.jsdelivr.net/npm/@tonejs/midi@2.0.28/+esm';

const PERCUSSION_CHANNEL = 9;

export default {
    id: 'midi',
    name: 'MIDI file',
    extension: '.mid',
    mimeType: 'audio/midi',
    details: false,   // song, source and extra details aren't stored

    encode(noteSet, { title = '', duration = 0 } = {}) {
        const midi = new Midi();
        midi.name = title;
        const track = midi.addTrack();
        track.name = title;
        for (const n of noteSet.notes) {
            track.addNote({ midi: n.midi, time: n.start, duration: n.duration, velocity: n.velocity });
        }
        // Keep silence at the end, so the file is as long as the region saved. The library
        // ends a track at its last event, so add a harmless "all notes off" there.
        const lastEnd = noteSet.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
        if (duration > lastEnd) track.addCC({ number: 123, value: 0, time: duration });
        return new Blob([midi.toArray()], { type: this.mimeType });
    },

    decode(bytes) {
        let midi;
        try {
            midi = new Midi(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
        } catch {
            throw new Error('This file is not a MIDI file.');
        }
        const tracks = midi.tracks.filter((t) => t.notes.length && t.channel !== PERCUSSION_CHANNEL && !t.instrument?.percussion);
        const notes = [];
        tracks.forEach((track, i) => {
            const part = tracks.length > 1 ? (track.name || track.instrument?.name || `Track ${i + 1}`) : undefined;
            for (const n of track.notes) {
                const note = { midi: n.midi, start: n.time, duration: n.duration, velocity: n.velocity };
                if (part) note.part = part;
                notes.push(note);
            }
        });
        notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
        const midis = notes.map((n) => n.midi);
        return {
            noteSet: {
                notes,
                range: notes.length ? { minMidi: Math.min(...midis), maxMidi: Math.max(...midis) } : { minMidi: 0, maxMidi: 127 },
                extractor: { id: 'midi-file', options: {} },
            },
            meta: {
                title: midi.name || tracks[0]?.name || '',
                duration: Math.max(midi.duration, ...midi.tracks.map((t) => t.endOfTrackTicks ? midi.header.ticksToSeconds(t.endOfTrackTicks) : 0)),
                song: null, source: null, extra: {},
            },
        };
    },
};
