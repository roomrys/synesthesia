# Tab converter and tabs editor

A note file says which pitches to play and when. A guitar can play most pitches
in several places, so before the fretboard can show a song, every note needs a
**string and fret**. The tab converter chooses them automatically. The tabs
editor (`tabs.html`) shows the result as tablature and lets you change it.

Status markers: ✅ built · 🚧 in progress · 📝 planned

---

## Types ✅

```js
/** From js/tabs/guitar.js: the MIDI note of each open string, string 1 (high E) first. */
Guitar = { strings: number[], frets: number }

/** Where a note is played. String 1 is the highest-pitched string, as in tab notation. */
Position = { string: number, fret: number }       // fret 0 = open string

/** A Note (see js/extract/README.md) with a position. */
TabNote = Note & Position & { fixed?: boolean }    // fixed: chosen by hand, keep it

TabResult = {
  notes: TabNote[],          // every playable note, with a position
  unplayable: Note[],        // notes the guitar can't play (out of range, too many at once)
  fingering: { id: string, options: object },
}
```

```js
// js/tabs/guitar.js (pure; the fretboard can use it later too)
STANDARD = { strings: [64, 59, 55, 50, 45, 40], frets: 21 }
midiAt(guitar, string, fret): number          // string 1..6, fret 0..frets
positionsFor(guitar, midi): Position[]        // every position that plays this pitch
```

Tuning and capo are part of the `Guitar`, which belongs to the fretboard, not
the note file. Only standard tuning is used for now; a tuning or capo feature
later passes a different `Guitar` and needs no changes here.

---

## Interface: Fingering ✅

The algorithm that chooses positions is swappable, like the extractor's
detectors. It is chosen in config and listed in the registry.

```js
{
  id, name, description,
  defaults: object,                       // algorithm-specific options (weights, reach…)
  settings?: [{ key, label, min, max, step, format?(value), help? }],
  assign(notes: Note[], guitar: Guitar, { options }): TabResult,
}
```

Rules every fingering must follow (checked by contract tests):

- `midiAt(guitar, string, fret) === note.midi` for every placed note.
- Notes that sound at the same time are on **different strings**.
- Notes that already have a `string` and `fret` (chosen by hand) **keep them**.
  The algorithm only places the others, around them.
- Notes it can't place go in `unplayable`. None are dropped silently.

| id | Status | Notes |
|---|---|---|
| `path` | ✅ | The default: the cheapest path through the possible positions (below). |
| `lowest` | ✅ | The lowest fret for every note. A simple baseline for tests and comparisons. |

### `path`: the cheapest path through the possible positions

1. **Group notes into events:** notes starting within about 30 ms of each other
   are one chord.
2. **Candidates per event:** for each note, every position that plays its pitch
   (`positionsFor`). For a chord, the combinations that use different strings and
   whose fretted notes fit within the hand's reach (about 4 frets). Each event
   keeps its best few candidates.
3. **Cost of one candidate:** the stretch across its frets, a small cost for high
   frets, and a small bonus for open strings.
4. **Cost between neighbouring events:** the hand sits in a position covering
   `reach` frets (one finger per fret). Notes inside it cost nothing to reach; a
   note outside makes the hand shift the least it can, which costs a fixed amount
   plus a little per fret, and less after a rest. Jumping across strings costs a
   little too. Open strings don't need the hand, so it stays where it was.
   (An earlier version measured the change in the average fret instead. That let
   the hand creep up one string a fret at a time almost for free, and the
   settings barely changed anything.)
5. **Dynamic programming** (the Viterbi algorithm) finds the sequence of
   candidates with the lowest total cost. (Carrying the hand through open strings
   makes this a close approximation rather than exact.) Fixed notes allow only their own
   position. This takes time proportional to the number of events times the
   square of the candidates kept per event, which is fast for whole songs.

The weights are `defaults`, exposed as `settings` so they can be tuned the way
the extractor's detectors are.

Possible later refinements: avoiding a string that is still ringing, and
preferring positions inside a recognised scale shape.

---

## Existing libraries

Checked in November 2026. None does what we need well enough to adopt, but some
are worth learning from, and one is a good fit for reading MIDI files.

**Choosing positions (fingering)**

| Library | Language, license | Notes |
|---|---|---|
| [tutts](https://www.pkgstats.com/pkg:tutts) | TypeScript, license not stated | A port of tuttut: positions as hidden states, Viterbi decoding, the same idea as `path`. Version 0.1.0 with very few users. Worth reading, and a candidate for a second registered fingering once its license is confirmed. |
| [tuttut](https://pypi.org/project/tuttut/), [tabsynth](https://pypi.org/project/tabsynth/), [tayuya](https://git.vipul.xyz/github-mirrors/tayuya) | Python | Dynamic-programming (tuttut, tabsynth) or simpler converters. Python, so references only. |
| [tabify](https://www.npmjs.com/package/tabify) | JavaScript (Node), BSD-2-Clause | A MIDI-to-tab command-line tool, untouched for about 12 years. |
| [guitar-tab-generator](https://docs.rs/crate/guitar-tab-generator/2.0.0) | Rust (WebAssembly), GPL-3.0 | Fingering by difficulty. GPL doesn't fit this BSD-licensed repo. |
| [MIDI-to-Tab](https://arxiv.org/html/2408.05024v1), [MIDI2Tab](https://arxiv.org/html/2510.10619v1) | Research | Machine-learning models. Interesting for a future fingering, too heavy for now. |

**Our choice:** write `path` ourselves. It's a few hundred lines, it fits our
`Fingering` interface, and it supports hand-fixed notes, which none of the above
do.

**Showing tabs**

[VexFlow](https://github.com/0xfe/vexflow) (MIT) and
[alphaTab](https://alphatab.net/) (MPL-2.0) render real tablature. Both lay notes
out in bars and beats, but our notes have times in seconds and no tempo or beat
grid yet. So the tabs view draws its own time-based tab on a canvas, like the
extractor's timeline. Exporting to one of these (for printing, or for Guitar Pro
files) becomes possible once there's a beat grid.

**Reading MIDI files**

[@tonejs/midi](https://github.com/Tonejs/Midi) (MIT) parses `.mid` files into
notes with times in seconds, which is exactly our `Note` shape. It would sit
behind a `midi` codec (the codec interface already exists), so the tabs view can
open MIDI files as well as `.synesthesia` files.

---

## Tabs editor (`tabs.html`) ✅

- **Tablature:** six lines (string 1 at the top, as in tab notation), with fret
  numbers placed along a time axis. You can scroll, zoom and play back, as on the
  extractor's timeline.
- **Hover a note** to see every other place it could be played, as faint numbers
  on the other strings. **Click one** to move the note there. The note is then
  fixed: saved with its `string` and `fret`, and kept when the converter runs
  again.
- **Edit** notes, with undo and redo: type a fret number for the selected note
  (it stays on its string and changes pitch), ↑ and ↓ move it to the next string
  with the same pitch, F fixes or unfixes it, Delete removes it, dragging it
  sideways changes its time, and double-clicking a string adds a note.
- **Fix all / Unfix all** keep every position, or let the fingering choose them
  all again. If you put a note on a string another note at the same time is
  using, that note is unfixed and moves aside.
- **Tune the fingering** with sliders built from its `settings`, remembered per
  fingering in `localStorage` as a convenience.
- **Play** the notes with the extractor's player and synth voice, at 25–150% speed.
- **Crop** as on the note extractor page: drag the yellow handles (in the tab or
  in the strip at the top that shows the whole tab; dragging past an edge
  scrolls), or use Start here / End here (`[` `]`), Fit to notes and Reset.
  **Loop crop** (L) repeats the crop, which is the whole tab until you move it.
- **Place notes again** at any time. Only notes you haven't fixed are moved; the
  page also does this after every edit and settings change, so the rest of the
  tab adapts. The status says how many notes moved.
- **Open** a `.synesthesia` note file, or a `.mid` file through the `midi` codec.
- **Save** writes the notes inside the crop, re-timed to start at 0:00, with the positions you fixed (see the note file
  format in [architecture.md](../../architecture.md)), and keeps the song details
  of the file you opened.
- Notes the guitar can't play are listed in red under the strings.

---

## Files ✅

```
js/tabs/
  guitar.js                Guitar, STANDARD, midiAt, positionsFor   (pure)
  index.js                 runFingering(): validates a TabResult against the rules above
  fingerings/path.js       the default                              (pure)
  fingerings/lowest.js     baseline                                 (pure)
  tabview.js               canvas tablature: strings, frets, alternatives, editing
  main.js                  the editor page
tabs.html, css/tabs.css
js/extract/codecs/midi.js  .mid files via @tonejs/midi
```

Fingerings are listed in the shared registry (`js/extract/registry.js`, kind
`fingering`) and chosen in `config.js` (`fingering: 'path'`), or per visit with
`tabs.html?fingering=lowest`. The registry, config, player and voices still live
in `js/extract/`; they move to a shared folder when the fretboard needs them.

---

## Tests ✅

- **Contract tests** for every fingering:
  - every placed note has the right pitch;
  - chords use different strings;
  - fixed notes are kept;
  - the low E (MIDI 40) is played on the open low E string;
  - a pitch below the guitar's range ends up in `unplayable`;
  - more simultaneous notes than strings puts the extras in `unplayable`.
- **`path` only:** a one-octave scale stays in one position (no hand jump over 4
  frets); a repeated note stays on the same string; a melody stays in position
  through an open string; chords stay within reach; each setting changes the
  result for a melody that could be played in more than one way.
- **The page** (`tabs-page.test.js`): notes go in through the MIDI codec, a ghost
  click moves a note and fixes it, typing a fret changes its pitch, undo restores
  the converter's choice, chords use different strings, placing again reports
  that nothing moved, the crop handles set the loop, only the crop is saved, and
  Reset loops the whole tab.
