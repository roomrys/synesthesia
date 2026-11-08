# Architecture

This document describes how Synesthesia is put together, with a focus on the
**note extractor**: a page that listens to audio, detects the notes being played
or sung, and saves those notes and their timings so they can later be shown on
the fretboard.

Status markers: ✅ built · 🚧 in progress · 📝 planned

---

## Pages

| Page | Status | Purpose |
|---|---|---|
| `index.html` | ✅ | The fretboard. Highlight every position of the notes you choose, colour-coded by note name. |
| `extract.html` | 🚧 | The note extractor. Turn audio into a note file. |

Both are static pages with no build step, hosted on GitHub Pages.

---

## Principles

1. **Audio stays in memory.** Audio is held in the page's memory only while
   you work with it. It is never written to disk and never uploaded anywhere.
   **Clear** (or closing the tab) discards it. The only thing that can be saved is
   the extracted **notes and timings**.
2. **No build step.** Plain HTML, CSS and ES modules. Third-party libraries load
   from a CDN at pinned versions.
3. **Swappable implementations, chosen by config.** Anything that has a real
   alternative (pitch detection, synth, file format, storage) sits behind a small
   interface. Swapping is a config change, and adding an implementation means
   adding a file plus one registry line. Nothing existing is rewritten.
4. **Each third-party library is imported in exactly one adapter file.** Nothing
   else in the codebase knows the library exists.
5. **A pure core.** Data types, extractors, DSP, music helpers and codecs don't
   touch the DOM, so they can be tested in Node.
6. **One clock.** The song and the playback of detected notes are scheduled on
   the same `AudioContext`, so they stay in sync.

---

## Data flow

```
 SOURCES                        CORE (no DOM)                                  OUTPUT
┌──────────────┐
│ Browser tab  │─┐
│ Microphone   │─┼─► AudioClip ──► Extractor ──► NoteSet ──► Crop ──► Codec ──► Storage
│ Audio file   │─┘   (in memory)   + range       {notes,               (JSON)    (chosen folder,
└──────────────┘                     filter       pitchTrack}                      or download)
                         │                           │
                         ▼                           ▼
              ┌──────────── Player (one AudioContext) ─────────────┐
              │  song:  AudioBufferSourceNode ─┐                   │
              │                                ├─► mix ─► speakers │
              │  notes: Voice (synth) ─────────┘                   │
              └───────────────────────┬────────────────────────────┘
                                      │ currentTime
                                      ▼
          Timeline: waveform · piano roll · pitch track · crop handles · playhead
```

1. A **Source** produces an `AudioClip`: mono samples held in memory.
2. An **Extractor** turns the clip into a `NoteSet`. A shared wrapper validates
   the result and applies the note range filter.
3. The **Player** plays the song and a synth **Voice** playing the detected
   notes together, so you can hear where the transcription is right or wrong.
4. The **Timeline** draws the waveform, the notes (in the fretboard's note
   colours) and the playhead, and lets you set crop start and end.
5. **Crop** trims the notes to the chosen region and re-times them so the
   region starts at 0.
6. A **Codec** encodes the notes, and **Storage** saves the file.

Extraction runs on the whole clip, so you can see where the music starts before
you crop.

---

## Data types

Defined once in `js/extract/types.js` (JSDoc typedefs). These shapes are the
contract between modules, and implementations depend on them, not on each other.

```js
/** Mono audio held in memory. */
AudioClip = {
  samples: Float32Array,   // -1..1
  sampleRate: number,      // Hz
  duration: number,        // seconds
  label?: string,
}

/** One detected note. Notes may overlap in time (chords). */
Note = {
  midi: number,            // integer MIDI note number (60 = C4, 69 = A4)
  start: number,           // seconds
  duration: number,        // seconds
  velocity: number,        // 0..1, relative loudness
  confidence?: number,     // 0..1, extractor-specific
  part?: string,           // 📝 future: instrument / guitar part
}

/** Output of an extractor. */
NoteSet = {
  notes: Note[],                         // sorted by start
  range: { minMidi: number, maxMidi: number },
  extractor: { id: string, options: object },
  pitchTrack?: {                         // optional, for debugging/visualising
    hopSeconds: number,
    midi: Float32Array,                  // fractional MIDI per frame, NaN = no pitch
    confidence: Float32Array,
  },
}
```

---

## Interfaces

Each implementation is an ES module whose default export is an object with the
interface's methods. `load(kind)` checks the required methods exist before
returning it.

### Source 🚧
Produces an `AudioClip`.

```js
{
  id, name,
  isSupported(): boolean,
  start({ onLevel }): Promise<void>,   // begin capturing into memory (live sources)
  stop(): Promise<AudioClip>,          // stop and return the clip
  open?(file: File): Promise<AudioClip> // file sources
}
```

| id | Status | Notes |
|---|---|---|
| `tab` | 🚧 | Audio from another browser tab via `getDisplayMedia` (Chrome/Edge). |
| `mic` | 📝 | `getUserMedia`, with echo cancellation, noise suppression and auto-gain turned off. |
| `file` | 📝 | Decodes a local audio file with `decodeAudioData`. |

Live sources collect raw samples with an `AudioWorklet` (`capture-worklet.js`)
and mix them down to mono.

### Extractor 🚧
Turns audio into notes.

```js
{
  id, name, description,
  defaults: object,                    // extractor-specific options
  extract(clip: AudioClip, {
    minMidi, maxMidi,                  // range hint (also enforced by the wrapper)
    options,                           // overrides for `defaults`
    onProgress?: (fraction) => void,
    signal?: AbortSignal,
  }): Promise<NoteSet>
}
```

Extractors resample internally to whatever rate suits them. Always call
extractors through `runExtractor()` in `extractors/index.js`, which validates the
output, filters to the requested range and sorts the notes.

| id | Status | Notes |
|---|---|---|
| `yin` | 🚧 | Our own YIN implementation. One note at a time; best on a single voice or instrument. |
| `pitchy` | 📝 | McLeod pitch method via [pitchy](https://github.com/ianprime0509/pitchy) (MIT). |
| `basic-pitch` | 📝 | Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Apache-2.0). Handles chords; better on full mixes. |

### Voice 🚧
Plays notes so you can check a transcription by ear.

```js
{
  id, name,
  create(audioContext, destination: AudioNode): Promise<{
    scheduleNote(note: Note, when: number): void,   // `when` on the AudioContext clock
    stopAll(): void,
    dispose(): void,
  }>
}
```

| id | Status | Notes |
|---|---|---|
| `tone` | 🚧 | [Tone.js](https://tonejs.github.io) (MIT) polyphonic synth, using our `AudioContext`. |

### Codec 🚧
Converts between a `NoteSet` and a file.

```js
{
  id, name, extension, mimeType,
  encode(noteSet, meta: { title, duration }): Blob,
  decode(bytes: ArrayBuffer): { noteSet, meta },
}
```

| id | Status | Notes |
|---|---|---|
| `json` | 🚧 | The Synesthesia note file, below. Human-readable, keeps confidence and extractor settings. |
| `midi` | 📝 | Standard MIDI file, read and write. Lets the fretboard load any MIDI file. |

### Storage 🚧
Saves and opens note files.

```js
{
  id, name,
  isSupported(): boolean,
  save(filename: string, blob: Blob): Promise<void>,
  open(): Promise<File>,
}
```

| id | Status | Notes |
|---|---|---|
| `folder` | 🚧 | File System Access API (Chrome/Edge). You choose a folder once (we suggest `Documents/Synesthesia`). The page remembers it in IndexedDB and saves there by default. |
| `download` | 🚧 | Fallback for other browsers: a normal download, and a file picker to open. |

A web page can't write to a fixed path such as `~/.synesthesia`, so the user
picks the folder once.

---

## Registry and config

`js/extract/registry.js` lists every implementation, loaded lazily:

```js
export const registry = {
  source:    { tab: () => import('./sources/tab.js') },
  extractor: { yin: () => import('./extractors/yin.js') },
  voice:     { tone: () => import('./voices/tone.js') },
  codec:     { json: () => import('./codecs/json.js') },
  storage:   { folder: () => import('./storage/folder.js'),
               download: () => import('./storage/download.js') },
};
```

`js/extract/config.js` chooses which ones are active:

```js
export const config = {
  source: ['tab'],
  extractor: 'yin',
  voice: 'tone',
  codec: 'json',
  storage: ['folder', 'download'],   // a list means "first one that isSupported()"
};
```

- **Swap:** edit `config.js`.
- **Add:** add a module and one registry line.
- **Override per visit:** query parameters override the config, e.g.
  `extract.html?extractor=pitchy`, for comparing implementations.
- **Lazy loading:** modules that aren't selected are never fetched, so an unused
  library costs nothing.

---

## Note file format (JSON, version 1)

Saved as `<title>.synesthesia.json`. Times are in seconds, relative to the crop
start.

```json
{
  "format": "synesthesia-notes",
  "version": 1,
  "title": "my-song",
  "createdAt": "2026-11-08T12:00:00.000Z",
  "duration": 42.5,
  "range": { "minMidi": 40, "maxMidi": 88 },
  "extractor": { "id": "yin", "options": { "threshold": 0.15 } },
  "notes": [
    { "midi": 64, "name": "E4", "start": 0.512, "duration": 0.25, "velocity": 0.8, "confidence": 0.93 }
  ]
}
```

- `name` is for readability only; `midi` is what counts.
- Readers must ignore unknown fields, so new fields (such as `part`) can be
  added without bumping `version`. Bump `version` only for breaking changes.

---

## File layout

```
index.html                 fretboard
extract.html               note extractor
architecture.md            this document
css/
  style.css                fretboard styles
  extract.css              extractor styles
js/
  app.js, click.js, ...    fretboard
  extract/
    main.js                page wiring and UI state
    config.js              which implementations are active
    registry.js            all implementations + load(kind)
    types.js               shared data types (JSDoc)
    dsp.js                 resampling, RMS                     (pure)
    music.js               MIDI ↔ name, note colours           (pure)
    player.js              song + voice playback on one clock
    timeline.js            canvas: waveform, piano roll, crop, playhead
    capture-worklet.js     AudioWorklet for live sources
    sources/               tab.js, mic.js, file.js
    extractors/            index.js (runExtractor), yin.js     (pure)
    voices/                tone.js
    codecs/                json.js                             (pure)
    storage/               folder.js, download.js
test/
  *.test.mjs               Node tests (node --test)
```

---

## Testing

- **Contract tests** (`node --test`): one suite per interface, run against every
  registered implementation of the pure kinds. For example, every extractor must
  turn a synthetic 440 Hz tone into `A4` with the right timing, ignore silence,
  and respect the range. Every codec must round-trip a `NoteSet`
  (`decode(encode(x))` equals `x`).
- **By ear:** play the detected notes over the song in the extractor page.
- **Round trip:** save a note file, load it back in the extractor, and play it
  over the song.

---

## Running locally

ES modules don't load from `file://`, so serve the folder over HTTP:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/extract.html
```

---

## Browser support

| Feature | Chrome / Edge | Firefox / Safari |
|---|---|---|
| Fretboard | ✅ | ✅ |
| Tab audio source | ✅ | ❌ |
| Mic / file sources | ✅ | ✅ |
| Remembered save folder | ✅ | ❌ (download fallback) |

---

## Roadmap

1. 🚧 **Extract and save:** tab source, YIN extractor, timeline with playback of
   song plus detected notes, crop, save JSON, load JSON back to check it.
2. 📝 **Note range filter in the UI:** low and high note controls, live in the
   piano roll.
3. 📝 **More sources and extractors:** mic, audio file, pitchy, Basic Pitch.
4. 📝 **Fretboard integration:** load note files (JSON and MIDI) into
   `index.html`, map notes to string and fret positions, and replay them in time
   (play, pause, scrub). Start by lighting every position of each note, then add
   smarter fingering.
5. 📝 **MIDI codec:** read and write `.mid`.
6. 📝 **Parts:** separate notes by instrument or guitar part (`Note.part`).
