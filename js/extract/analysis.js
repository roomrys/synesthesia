// Debugging aid: turn an extractor's result into numbers you can inspect or share.
// Contains no audio, only per-frame measurements, settings and the notes found.

import { midiToName } from './music.js';

const round = (v, places = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** places) / 10 ** places : null);

/** One-line summary of why frames were rejected, or '' if the extractor gives no stats. */
export function summarizeStats(stats) {
    if (!stats?.frames) return '';
    const pct = (k) => Math.round((100 * stats[k]) / stats.frames);
    const parts = [
        `${pct('pitched')}% had a clear pitch`,
        `${pct('unclear')}% unclear pitch`,
        `${pct('silent')}% too quiet`,
    ];
    if (stats.outOfRange) parts.push(`${pct('outOfRange')}% outside the note range`);
    if (stats.shortNotesDropped) parts.push(`${stats.shortNotesDropped} too-short notes dropped`);
    return `Frames: ${parts.join(', ')}.`;
}

/** Build the analysis object for export. */
export function buildAnalysis(noteSet, { title, clipDuration }) {
    const track = noteSet.pitchTrack;
    const frames = [];
    if (track) {
        for (let i = 0; i < track.midi.length; i++) {
            frames.push([
                round(track.startSeconds + i * track.hopSeconds),
                round(track.midi[i], 2),
                round(track.candidateMidi?.[i], 2),
                round(track.aperiodicity?.[i]),
                round(track.loudness?.[i], 5),
            ]);
        }
    }
    return {
        format: 'synesthesia-analysis',
        version: 1,
        note: 'Per-frame measurements from the note detector. Contains no audio.',
        title,
        createdAt: new Date().toISOString(),
        clipDuration: round(clipDuration),
        range: noteSet.range,
        extractor: noteSet.extractor,
        stats: noteSet.stats ?? null,
        notes: noteSet.notes.map((n) => ({ ...n, name: midiToName(n.midi), start: round(n.start), duration: round(n.duration), velocity: round(n.velocity), confidence: round(n.confidence) })),
        frameColumns: ['time', 'acceptedMidi', 'candidateMidi', 'aperiodicity', 'loudness'],
        frames,
    };
}

export function analysisBlob(analysis) {
    const { frames, ...rest } = analysis;
    // One frame per line keeps the file readable.
    const head = JSON.stringify(rest, null, 2).slice(0, -2);
    const body = frames.map((f) => '    ' + JSON.stringify(f)).join(',\n');
    return new Blob([`${head},\n  "frames": [\n${body}${body ? '\n' : ''}  ]\n}\n`], { type: 'application/json' });
}
