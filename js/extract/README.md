# Note extractor

`extract.html` turns audio into a note file: it listens to audio from a browser
tab or a file, detects the notes (or lets you draw them), lets you check them by
ear against the song, and saves the notes and their timings. Audio is held in
memory only; see the principles in [architecture.md](../../architecture.md).

Status markers: ✅ built · 🚧 in progress · 📝 planned

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
              ┌──────────────── Player (one AudioContext) ──────────────┐
              │  song:  <audio> (in-memory WAV, preservesPitch) ─┐      │
              │                                                  ├─► mix│
              │  notes: Voice (synth), scheduled from song time ─┘      │
              └───────────────────────┬─────────────────────────────────┘
                                      │ song time (loop, speed)
                                      ▼
          Timeline: waveform · piano roll · pitch track · crop handles · playhead
```

1. A **Source** produces an `AudioClip`: mono samples held in memory.
2. An **Extractor** turns the clip into a `NoteSet`. A shared wrapper validates
   the result and applies the note range filter.
3. The **Player** plays the song and a synth **Voice** playing the detected
   notes together, so you can hear where the transcription is right or wrong.
   It can **loop** the time crop and change **speed** (25–150%) without changing
   pitch. For that, the song plays through an `<audio>` element fed from a WAV
   blob built in memory from the clip, using the browser's pitch-preserving
   playback. The blob is released when the clip is cleared or replaced.
4. The **Timeline** draws the waveform, the notes (in the fretboard's note
   colours) and the playhead. It has two crops: vertical handles set the
   **time** range, and horizontal handles set the **pitch** range (lowest and
   highest notes kept).
5. **Crop** keeps notes inside the pitch range, trims them to the time range,
   and re-times them so the region starts at 0.

The time crop starts fitted to the audio (`findAudibleRange` in `dsp.js`): from
the first to the last 20 ms window within 40 dB of the loudest, with 50 ms
padding before and 200 ms after. **Fit to audio** re-applies it, and **Reset**
selects the whole clip.

Detection always covers a wide pitch range (A1–E7). The pitch crop is an instant
filter that needs no re-run: by default it fits the detected notes, it survives
re-detection once you've moved it, and **Fit to notes** resets it. Notes outside
the pitch crop are dimmed, not played back, and not saved.

A **debug layer** (`spectrum.js`) can be drawn under the notes, on the same
pitch rows, to show what a detector has to work with. The clip is resampled to
16 kHz and peak-normalised, then analysed with a 4096-point Hann-windowed FFT
every 10 ms (coarser for long clips). Each frame is mapped to three bins per
semitone, and the levels are kept as bytes. Notes are drawn as outlines over the
layer. There are two layers:

- **Spectrogram:** the level at each pitch, from 80 dB below the peak to the
  peak. One note shows up as a stack: its own row plus overtones 12, 19, 24 and
  28 semitones above.
- **Harmonic sum** (salience): for each pitch, the levels at its first 10
  overtones added up, weighted 1/h. Each note's stack collapses onto its own
  row, so a chord shows as several bright rows. This is the first step of
  classical polyphonic detection. Fainter ghosts can appear 12 or 19 semitones
  above a real note.

**Edit notes** turns the piano roll into a note editor, to try where notes
really belong: drag on empty space to add a note, drag a note to move it (its
pitch plays as it changes rows), drag its ends to resize, and press Delete to
remove the selected notes. Shift+drag box-selects, Shift+click adds or removes
one note, and Cmd/Ctrl+A selects all. Dragging any selected note moves the whole
group. Undo and redo keep up to 200 steps. A single selected note, and a preview
that starts at the cursor, show where harmonics 2–8 sound (dashed, fading, at
their exact pitch from `overtones()` in `music.js`), so a note's whole stack can
be lined up with the spectrogram. The timeline changes note objects in place and
calls `onEditStart` (main.js copies the notes for undo) and `onEdit` (main.js
re-sorts, keeps the edited notes inside the pitch crop, and updates playback).

**Snapping:** while editing, note starts and ends snap (within 8 px) to
**onsets** and to the starts and ends of other notes. Snapping can be turned off,
and holding Alt places notes freely. Onsets are where notes seem to start, shown
as blue ticks under the waveform. `spectrum.js` finds them with spectral flux: a
64 ms window ending at each frame, the rise in log magnitude summed up to 5 kHz,
and peaks that stand out from the surrounding 100 ms. Peaks where the overall
level falls (a note ending in silence) are dropped, and the times are moved 20
ms earlier (the measured delay). The analysis is computed when a layer is shown
or editing starts. A tempo and beat grid could be added on top of the onsets
later.

**Dragging past the edge:** dragging a crop handle, a note, a new note or a
selection box past the left or right edge of the timeline scrolls it, faster the
further out the pointer is.

**Keep my notes for the next audio:** when this is ticked, new audio (from a
tab or a file) keeps the current notes instead of finding new ones, and turns
on edit mode. You can then select everything and drag the notes into line with
the new audio. This is useful when the same song is listened to again.

**Song details:** the Save panel has Song and Artist fields, guessed from the
file name or tab title by `guessSongInfo()` in `metadata.js`. It handles
"Artist - Song", a trailing site name and bracketed extras such as "(Official
Video)". Browsers sometimes label a shared tab with an internal id; then nothing
is guessed. The file name defaults to "artist-song". **+ Add detail** adds
free-form name and value rows (tuning, capo, tempo…), saved as `extra`.

Edited notes are saved like detected ones. Finding notes again replaces them,
after a confirmation.

The detector list also has **None (draw notes by hand)**, and it is the
default (`extractor: 'none'` in `config.js`), because YIN only finds one note at a
time and misses most of a full mix. Use `?extractor=yin` to start with YIN. None
isn't a registered extractor, because the contract tests require every extractor
to find notes. It is the `NO_EXTRACTOR` value in `registry.js`, handled by the
page: the timeline starts with no notes, the spectrogram is turned on if no
layer is showing, and edit mode is on. Its button, **Clear notes**, starts over.

The layers are computed when first shown and dropped with the clip. Below about
C3, the 256 ms window can't fully separate neighbouring semitones, so low notes
look smeared up and down. A multi-resolution transform (CQT) would fix that.

Finally, a **Codec** encodes the notes and **Storage** saves the file.

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
  kind: 'live' | 'file',
  startLabel?: string,                  // button text
  hint?: string,                        // shown under the buttons
  isSupported(): boolean,

  // kind: 'live'
  start({ onLevel, onEnded }): Promise<void>,  // begin capturing into memory
  stop(): Promise<AudioClip>,                  // stop and return the clip

  // kind: 'file'
  accept?: string,                      // file picker filter, e.g. 'audio/*'
  open(file: File): Promise<AudioClip>,
}
```

| id | Status | Notes |
|---|---|---|
| `tab` | 🚧 | Audio from another browser tab via `getDisplayMedia` (Chrome/Edge). Built; needs testing by hand (it can't run headless). |
| `file` | ✅ | Decodes a local audio file with `decodeAudioData`. |
| `mic` | 📝 | `getUserMedia`, with echo cancellation, noise suppression and auto-gain turned off. |

Live sources share `sources/live.js`, which collects raw samples with an
`AudioWorklet` (`capture-worklet.js`) and mixes them down to mono.

### Extractor 🚧
Turns audio into notes.

```js
{
  id, name, description,
  defaults: object,                    // extractor-specific options
  settings?: [{ key, label, min, max, step, format?(value), help? }],
                                       // tunable options; the page builds sliders from this
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

**Tuning:** the page shows a slider for each entry in `settings`. Changing one
re-runs detection, cancelling and replacing a run already in progress. Tuned
values are remembered per extractor in `localStorage`, as a convenience only.
The note file records the options that were used.

**Debugging:** extractors may return `stats` (e.g. why frames were rejected) and
extra per-frame arrays in `pitchTrack`. The page summarises `stats` in the status
line, draws rejected pitch guesses faintly on the timeline, and **Export analysis**
saves the per-frame numbers as `<name>.analysis.json`. That file contains no audio.

| id | Status | Notes |
|---|---|---|
| `yin` | ✅ | Our own YIN implementation. One note at a time; best on a single voice or instrument. |
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
| `tone` | ✅ | [Tone.js](https://tonejs.github.io) (MIT) synths on our `AudioContext`. Uses a pool of `Tone.Synth` voices rather than `Tone.PolySynth`, because PolySynth delays future notes with a JavaScript timer instead of scheduling them on the audio clock. |

The player schedules notes about 200 ms ahead in a loop, so a voice only ever
sees near-future notes, and `stopAll()` takes effect straight away.

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
| `json` | ✅ | The Synesthesia note file, below. Human-readable, keeps confidence and extractor settings. |
| `midi` | 📝 | Standard MIDI file, read and write. Lets the fretboard load any MIDI file. |

### Storage 🚧
Saves and opens note files.

```js
{
  id, name,
  isSupported(): boolean,
  save(filename: string, blob: Blob): Promise<{ filename, location }>,  // never overwrites
  open({ accept }): Promise<File>,
  folderName?(): Promise<string | null>,   // storages with a remembered folder
  pickFolder?(): Promise<string>,
}
```

| id | Status | Notes |
|---|---|---|
| `folder` | 🚧 | File System Access API (Chrome/Edge). You choose a folder once (we suggest `Documents/Synesthesia`). The page remembers it in IndexedDB, saves there, and opens files from there by default. If a name is taken it saves as `name-2`, and so on. Built; needs testing by hand. |
| `download` | 🚧 | Fallback for other browsers: a normal download, and a file picker to open. Built; needs testing by hand. |

A web page can't write to a fixed path such as `~/.synesthesia`, so the user
picks the folder once.

---

## Registry and config

`js/extract/registry.js` lists every implementation, loaded lazily:

```js
export const registry = {
  source:    { tab: () => import('./sources/tab.js'),
               file: () => import('./sources/file.js') },
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
  sources: ['tab', 'file'],          // every supported one is offered on the page
  extractor: 'none',                 // or 'yin'; 'none' = draw notes by hand
  voice: 'tone',
  codec: 'json',
  storage: ['folder', 'download'],   // fallback list: first one that isSupported()
};
```

Code gets implementations with `load(kind)` (one, honouring fallback lists) or
`loadAll('source')` (all supported). `loadImpl(kind, id)` loads a specific one
and checks it has the interface's required members.

- **Swap:** edit `config.js`.
- **Add:** add a module and one registry line.
- **Override per visit:** query parameters override the config, e.g.
  `extract.html?extractor=pitchy` or `?sources=file`, for comparing implementations.
- **Lazy loading:** modules that aren't selected are never fetched, so an unused
  library costs nothing. (The extractor dropdown lists every registered
  extractor, so those are loaded.)

---

## Files

```
extract.html               the page
css/extract.css            its styles
js/extract/
  main.js                  page wiring and UI state
  config.js                which implementations are active
  registry.js              all implementations + load(kind)
  types.js                 shared data types (JSDoc)
  dsp.js                   resampling, RMS, audible range       (pure)
  music.js                 MIDI ↔ name, note colours, overtones (pure)
  noteset.js               sort, range filter, crop             (pure)
  analysis.js              debug export of per-frame numbers    (pure)
  player.js                song + voice playback, loop, speed
  timeline.js              canvas: waveform, piano roll, crop, playhead, note editing
  spectrum.js              FFT, spectrogram, harmonic sum, onsets (pure)
  metadata.js              song and artist guessed from a label (pure)
  capture-worklet.js       AudioWorklet for live sources
  sources/                 live.js (shared), tab.js, file.js
  extractors/              index.js (runExtractor), yin.js      (pure)
  voices/                  tone.js
  codecs/                  json.js                              (pure)
  storage/                 folder.js, download.js
```

---

## Tests

- **Contract tests:** one suite per interface, run against every registered
  implementation. Every extractor must turn a synthetic 440 Hz tone into `A4`
  with the right timing, get a low E with harmonics right (no octave error),
  split a repeated note, ignore silence, respect the range, report progress and
  support cancelling. Every codec must round-trip a `NoteSet`. Every voice must
  make sound at the scheduled time (rendered offline), including chords.
- **End to end:** `page.test.js` loads `extract.html` in an iframe, opens
  generated WAV files, and checks detection, cropping, editing, layers, keeping
  notes for new audio and playback.
- **By hand:** tab capture and the save folder need real browser permission
  prompts, so check those by hand. Play the notes over the song to judge them by
  ear, and save and reopen a note file to check the round trip.

---

## Roadmap

1. 🚧 **Extract and save:** built and tested headless; tab capture and saving
   still need testing by hand.
2. ✅ **Note range filter:** the pitch crop.
3. ✅ **Debug layers and hand editing:** spectrogram, harmonic sum, note editing
   with snapping, groups and overtone guides, and no detector by default.
4. 🚧 **More sources and extractors:** mic, pitchy, Basic Pitch. YIN finds one
   note at a time, so chords and full mixes need a polyphonic extractor: Basic
   Pitch, or a classical one built on the harmonic-sum layer.
5. 📝 **MIDI codec:** read and write `.mid`.
6. 📝 **Parts:** separate notes by instrument or guitar part (`Note.part`).
7. 📝 **Beat grid:** a tempo and beats estimated from the onsets, to snap to.
