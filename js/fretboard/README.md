# Fretboard

`index.html`: a guitar neck where every position is coloured by its note name.
Today it highlights the notes you choose. Next it will play a note file back on
the neck, with upcoming notes shown ahead of time.

Status markers: ✅ built · 🚧 in progress · 📝 planned

---

## Today ✅

Plain scripts (not modules), loaded by `index.html`:

| File | What it does |
|---|---|
| `js/app.js` | Builds the neck: 21 frets × 6 strings of `.guitarNote` elements. Each has its string (`stringHighE` … `stringLowE`) and note name (`noteA`, `noteCSharp`, …) as classes, and the note name in `data-note`. |
| `js/click.js` | Clicking a position toggles it and updates the legend. |
| `js/keydown.js` | A note-name key toggles every position of that note (Shift for sharps), Backspace clears, the arrow keys shift the selection along the neck, and `r` reverses the neck. |
| `js/loaded.js` | The typed welcome text. |
| `css/style.css` | Layout and the note colours, which `js/extract/music.js` matches. |

Two limits matter for playback:

1. **There are no open strings.** The neck starts at fret 1.
2. **Positions only know their note name, not their pitch.** The E at fret 12
   on the high E string and the E at fret 12 on the low E string can't be told
   apart. Playback needs to light one exact string and fret.

---

## Later: positions, open strings and playback 📝

These come after the [tabs view](../tabs/README.md), and the design is still open.
The goals:

- **Exact positions:** every position knows its string, fret and exact pitch,
  so a note placed by the tab converter lights exactly one spot. The tab
  converter's guitar model (`js/tabs/guitar.js`) is the natural source for this.
- **Open strings:** some way to show a note played on an open string. Ideas so
  far: a circle per string at the strumming-hand end of the neck, or a line along
  the whole string.
- **Playback:** load a note file and play it on the neck, with upcoming notes
  shown ahead of time, in the spirit of Guitar Hero, and the neck moved to the
  bottom of the page to make room. The neck already uses left to right for frets
  and top to bottom for strings, so time needs another way in. Ideas so far:
  notes falling down lanes above the neck (one lane per fret), rings that shrink
  onto the exact position, or both.

Open questions: how upcoming notes are shown, where open strings go, and
whether colour (the note name) needs an octave hint, given that the string
already tells you the octave.
