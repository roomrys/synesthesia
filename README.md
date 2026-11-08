# [synesthesia](https://roomrys.github.io/synesthesia)
Shred without the needing to memorize scales.
_https://roomrys.github.io/synesthesia_

Synesthesia allows users to highlight all notes that they want to include while soloing in a guitar-hero-esk style. Great for beginners who don't yet have scales memorized.

## Features

### Fretboard ✅
Press a note name on your keyboard to highlight every position of that note on the neck, colour-coded by note.
- Shift for sharps
- Backspace clears the selection
- `r` reverses the fretboard

### Note extractor 🚧
A new page (`extract.html`) that listens to audio, detects the notes, and saves the notes and their timings to a file on your computer. You can then load the file onto the fretboard.

- Listen to audio playing in another browser tab (Chrome/Edge), or open an audio file (microphone coming soon)
- Play the detected notes back over the audio to check them by ear
- Crop to the part you want, in time and in pitch
- Save the notes as a `.synesthesia` file (readable JSON) in a folder you choose

Audio is only held in memory while you use the page. It is never saved or uploaded; only the detected notes are saved.

## Roadmap
- [ ] Note extractor: listen to a browser tab, detect notes, play them back, crop, save
- [x] Note range filter: drag to keep only the notes you want
- [ ] More audio sources (microphone, audio file) and pitch detectors
- [ ] Load note files onto the fretboard and replay them in time
- [ ] MIDI file support
- [ ] Separate notes by instrument or part

See [architecture.md](architecture.md) for how it all fits together.

## Tests
```sh
test/run-headless.sh
```
Runs the browser tests in headless Chrome. You can also serve the repo and open `test/run.html`.

## Running locally
```sh
python3 -m http.server 8000
```
Then open http://localhost:8000 (fretboard) or http://localhost:8000/extract.html (note extractor).
