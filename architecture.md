# Architecture

How Synesthesia is put together: the pages, the principles they share, and how
the components connect. Each component has its own README with the details.

Status markers: ✅ built · 🚧 in progress · 📝 planned

---

## Pages

| Page | Status | Purpose |
|---|---|---|
| `index.html` | ✅ / 🚧 | The fretboard. Highlight every position of the notes you choose, colour-coded by note name. Next: play a note file back on the neck. |
| `extract.html` | 🚧 | The note extractor. Turn audio into a note file. |
| `tabs.html` | 🚧 | The tabs editor. Open a note file or MIDI file, see where each note will be played, and change it. |

All are static pages with no build step, hosted on GitHub Pages.

---

## Components

```
                 audio (in memory only)
                          │
                          ▼
            ┌──────────────────────────┐   note file    ┌──────────────────────────┐
            │  Note extractor          │  (.synesthesia)│  Tab converter           │
            │  extract.html            │ ─────────────► │  notes → string + fret   │
            │  js/extract/             │                │  js/tabs/                │
            └──────────────────────────┘                └────────────┬─────────────┘
                                                                     │ positioned notes
                                          ┌──────────────────────────┴─────────────┐
                                          ▼                                        ▼
                            ┌──────────────────────────┐            ┌──────────────────────────┐
                            │  Fretboard playback      │            │  Tabs editor             │
                            │  index.html              │            │  tabs.html               │
                            │  js/fretboard/           │            │  js/tabs/                │
                            └──────────────────────────┘            └──────────────────────────┘
```

| Component | Status | Details |
|---|---|---|
| Note extractor | 🚧 | [js/extract/README.md](js/extract/README.md): sources, detectors, the timeline editor, playback, saving. |
| Fretboard | ✅ / 📝 | [js/fretboard/README.md](js/fretboard/README.md): the neck today, and the goals for positions, open strings and playback. |
| Tab converter and tabs editor | 🚧 | [js/tabs/README.md](js/tabs/README.md): choosing a string and fret for every note, and changing them by hand. |

The **note file** is the contract between them: the extractor writes it, and the
converter, the fretboard and the tabs editor read it.

---

## Principles

1. **Audio stays in memory.** Audio is held in the page's memory only while
   you work with it. It is never written to disk and never uploaded anywhere.
   **Clear** (or closing the tab) discards it. The only thing that can be saved is
   **notes and timings**.
2. **No build step.** Plain HTML, CSS and ES modules. Third-party libraries load
   from a CDN at pinned versions.
3. **Swappable implementations, chosen by config.** Anything that has a real
   alternative (pitch detection, synth, file format, storage, fingering) sits
   behind a small interface. Swapping is a config change, and adding an
   implementation means adding a file plus one registry line. Nothing existing is
   rewritten.
4. **Each third-party library is imported in exactly one adapter file.** Nothing
   else in the codebase knows the library exists.
5. **A pure core.** Data types, detectors, DSP, music helpers, codecs and the tab
   converter don't touch the DOM, so they are easy to test.
6. **Notes follow the song's clock.** Notes are scheduled a little ahead against
   the playback position, scaled by the playback speed, so they stay in sync when
   slowed down, looped or seeked.

---

## Note file format (JSON, version 1)

Saved as `<title>.synesthesia`. The contents are plain JSON; the extension is kept
short because browser file pickers reject extensions over 16 characters. The open
dialog also accepts `.json`. Times are in seconds, relative to the crop start.

```json
{
  "format": "synesthesia-notes",
  "version": 1,
  "title": "my-song",
  "createdAt": "2026-11-08T12:00:00.000Z",
  "duration": 42.5,
  "range": { "minMidi": 40, "maxMidi": 88 },
  "extractor": { "id": "yin", "options": { "threshold": 0.15 } },
  "song": { "title": "Their Song", "artist": "Some Band" },
  "source": { "type": "tab", "label": "Some Band - Their Song", "start": 12.34, "length": 215.2 },
  "extra": { "tuning": "Drop D", "capo": "2" },
  "notes": [
    { "midi": 64, "name": "E4", "start": 0.512, "duration": 0.25, "velocity": 0.8, "confidence": 0.93 }
  ]
}
```

- `name` is for readability only; `midi` is what counts.
- `song` and `source` are optional. `source.type` is the source id (`tab` or
  `file`), and `label` is the tab title or file name as captured. `start` is
  where the saved region (time 0 of the notes) began in that audio, and `length`
  is the length of that audio. Together they make it possible to line the notes
  up with the same audio again later.
- `extra` is optional: free-form details as `{ "name": "value" }` strings.
- Notes may have `string` and `fret` (see [js/tabs/README.md](js/tabs/README.md)):
  a position chosen by hand on the tabs page. The tab converter keeps those and
  only chooses positions for notes without them.
- Readers must ignore unknown fields, so new fields (such as `part`) can be
  added without bumping `version`. Bump `version` only for breaking changes.

---

## Repository layout

```
index.html                 fretboard
extract.html               note extractor
tabs.html                  tabs editor
architecture.md            this document
css/                       style.css (fretboard), extract.css (extractor), tabs.css
js/
  app.js, click.js, ...    fretboard (today; see js/fretboard/README.md)
  fretboard/               README.md: the fretboard today and later
  extract/                 note extractor (README.md inside)
  tabs/                    tab converter and tabs editor (README.md inside)
test/
  run.html                 browser test page
  run-headless.sh          runs run.html in headless Chrome and prints results
  runner.js, signals.js    tiny test runner, synthetic audio
  *.test.js                tests
```

Modules that more than one page needs (`music.js`, `player.js`, the voices and
codecs) live in `js/extract/` today. They move to a shared folder when the
fretboard starts using them.

---

## Testing

Tests run **in the browser**, with no Node and no build step. They import the
same modules the pages use, and the browser provides Web Audio (resampling,
decoding, offline rendering), which Node lacks.

```sh
test/run-headless.sh          # headless Chrome, prints results, non-zero exit on failure
# or serve the repo and open http://localhost:8000/test/run.html
```

Each component's README lists what its tests cover.

---

## Running locally

ES modules don't load from `file://`, so serve the folder over HTTP:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/ or http://localhost:8000/extract.html
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

Built:

- 🚧 **Note extractor:** see [js/extract/README.md](js/extract/README.md#roadmap).

Next:

1. 🚧 **Tabs view:** a string and fret for every note (the tab converter), and
   `tabs.html` to see and change them. Opens note files and MIDI files. See
   [js/tabs/README.md](js/tabs/README.md).
2. 📝 **Fretboard positions and open strings:** open-ended for now; see
   [js/fretboard/README.md](js/fretboard/README.md).
3. 📝 **Fretboard playback:** play a note file on the neck, with upcoming notes
   shown ahead of time. Open-ended for now.
4. 📝 **Tunings and capo:** a property of the fretboard, passed to the converter.
