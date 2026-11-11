# Tab converter and tabs editor

A note file says which pitches to play and when. A guitar can play most pitches
in several places, so before the fretboard can show a song, every note needs a
**string and fret**. The tab converter chooses them automatically. The tabs
editor (`tabs.html`) shows the result as tablature and lets you change it.

Status markers: ✅ built · 🚧 in progress · 📝 planned

---

## Types 📝

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

## Interface: Fingering 📝

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
| `path` | 📝 | The default: the cheapest path through the possible positions (below). |
| `lowest` | 📝 | The lowest fret for every note. A simple baseline for tests and comparisons. |

### `path`: the cheapest path through the possible positions

1. **Group notes into events:** notes starting within about 30 ms of each other
   are one chord.
2. **Candidates per event:** for each note, every position that plays its pitch
   (`positionsFor`). For a chord, the combinations that use different strings and
   whose fretted notes fit within the hand's reach (about 4 frets). Each event
   keeps its best few candidates.
3. **Cost of one candidate:** the stretch across its frets, a small cost for high
   frets, and a small bonus for open strings.
4. **Cost between neighbouring events:** how far the hand moves (the change in
   its average fretted position) and how many strings change.
5. **Dynamic programming** (the Viterbi algorithm) finds the sequence of
   candidates with the lowest total cost. Fixed notes allow only their own
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

## Tabs editor (`tabs.html`) 📝

- **Tablature:** six lines (string 1 at the top, as in tab notation), with fret
  numbers placed along a time axis. You can scroll, zoom and play back, as on the
  extractor's timeline.
- **Hover a note** to see every other place it could be played, as faint numbers
  on the other strings. **Click one** to move the note there. The note is then
  fixed: saved with its `string` and `fret`, and kept when the converter runs
  again.
- **Edit** notes: add, delete, and change pitch and timing.
- **Re-run the converter** at any time. Only notes you haven't fixed are moved.
- **Open** a `.synesthesia` note file, or a `.mid` file through the `midi` codec.
- **Save** writes the note file with the positions you fixed (see the note file
  format in [architecture.md](../../architecture.md)).

---

## Files 📝

```
js/tabs/
  guitar.js                Guitar, STANDARD, midiAt, positionsFor   (pure)
  index.js                 runFingering(): validates a TabResult against the rules above
  fingerings/path.js       the default                              (pure)
  fingerings/lowest.js     baseline                                 (pure)
  main.js                  the editor page
tabs.html
js/extract/codecs/midi.js  📝 .mid files via @tonejs/midi
```

The registry and config move from `js/extract/` to a shared folder and gain a
`fingering` kind, so all pages pick implementations the same way.

---

## Tests 📝

- **Contract tests** for every fingering:
  - every placed note has the right pitch;
  - chords use different strings;
  - fixed notes are kept;
  - the low E (MIDI 40) is played on the open low E string;
  - a pitch below the guitar's range ends up in `unplayable`;
  - more simultaneous notes than strings puts the extras in `unplayable`.
- **`path` only:** a one-octave scale stays in one position (no hand jump over 4
  frets); a repeated note stays on the same string.
