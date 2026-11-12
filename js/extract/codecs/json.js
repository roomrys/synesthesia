// The Synesthesia note file (JSON, version 1). See architecture.md for the format.

import { midiToName } from '../music.js';

const FORMAT = 'synesthesia-notes';
const VERSION = 1;

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

function encodeNote(n) {
    const out = {
        midi: n.midi,
        name: midiToName(n.midi),
        start: round(n.start, 3),
        duration: round(n.duration, 3),
        velocity: round(n.velocity, 3),
    };
    if (n.confidence !== undefined) out.confidence = round(n.confidence, 3);
    if (n.part !== undefined) out.part = n.part;
    // A position chosen by hand on the tabs page (string 1 = highest-pitched).
    if (n.fixed && Number.isInteger(n.string) && Number.isInteger(n.fret)) {
        out.string = n.string;
        out.fret = n.fret;
    }
    return out;
}

/** Keep only string-able name/value pairs from a file's "extra" section. */
function readExtra(extra) {
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {};
    const out = {};
    for (const [key, value] of Object.entries(extra)) {
        if (value === null || typeof value === 'object') continue;
        out[key] = String(value);
    }
    return out;
}

export default {
    id: 'json',
    name: 'Synesthesia notes (JSON)',
    extension: '.synesthesia',   // JSON inside; kept short for file pickers (max 16 chars)
    mimeType: 'application/json',

    /**
     * @param {import('../types.js').NoteSet} noteSet
     * @param {{title: string, duration: number, song?: {title?: string, artist?: string},
     *          source?: {type?: string, label?: string, start?: number, length?: number},
     *          extra?: Object<string, string>}} meta
     * @returns {Blob}
     */
    encode(noteSet, { title, duration, song, source, extra }) {
        const header = {
            format: FORMAT,
            version: VERSION,
            title,
            createdAt: new Date().toISOString(),
            duration: round(duration, 3),
            range: noteSet.range,
            extractor: noteSet.extractor,
        };
        // Optional song details, and where the notes sit in the audio they came from.
        if (song && (song.title || song.artist)) header.song = { title: song.title ?? '', artist: song.artist ?? '' };
        if (source) {
            header.source = { type: source.type ?? '', label: source.label ?? '' };
            if (source.start !== undefined) header.source.start = round(source.start, 3);
            if (source.length !== undefined) header.source.length = round(source.length, 3);
        }
        // Free-form details: { name: value } strings, such as tuning or capo.
        if (extra && Object.keys(extra).length) header.extra = { ...extra };
        // One note per line keeps files readable and diffable.
        const headerText = JSON.stringify(header, null, 2).slice(0, -2);
        const notesText = noteSet.notes.map((n) => '    ' + JSON.stringify(encodeNote(n))).join(',\n');
        const text = `${headerText},\n  "notes": [\n${notesText}${notesText ? '\n' : ''}  ]\n}\n`;
        return new Blob([text], { type: this.mimeType });
    },

    /**
     * @param {ArrayBuffer|string} bytes
     * @returns {{noteSet: import('../types.js').NoteSet, meta: {title: string, duration: number, createdAt: string}}}
     */
    decode(bytes) {
        const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('This file is not valid JSON.');
        }
        if (data.format !== FORMAT) throw new Error('This is not a Synesthesia notes file.');
        if (!(data.version <= VERSION)) throw new Error(`This notes file is version ${data.version}; this page reads up to version ${VERSION}.`);
        if (!Array.isArray(data.notes)) throw new Error('This notes file has no notes list.');

        const notes = data.notes.map((n) => {
            const note = { midi: n.midi, start: n.start, duration: n.duration, velocity: n.velocity ?? 0.8 };
            if (n.confidence !== undefined) note.confidence = n.confidence;
            if (n.part !== undefined) note.part = n.part;
            if (Number.isInteger(n.string) && Number.isInteger(n.fret)) Object.assign(note, { string: n.string, fret: n.fret, fixed: true });
            return note;
        });
        return {
            noteSet: {
                notes,
                range: data.range ?? { minMidi: 0, maxMidi: 127 },
                extractor: data.extractor ?? { id: 'unknown', options: {} },
            },
            meta: {
                title: data.title ?? '', duration: data.duration ?? 0, createdAt: data.createdAt,
                song: data.song ?? null, source: data.source ?? null,
                extra: readExtra(data.extra),
            },
        };
    },
};
