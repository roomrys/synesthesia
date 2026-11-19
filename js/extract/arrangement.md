# Arrangement extractor (plan)

A polyphonic extractor built from math, with no trained model and no hand
annotations. The goal is an **arrangement**, not a transcription: notes for one
instrument (for now, a guitar) that keep as much of the whole song as possible,
the way a fingerstyle cover does. That means the riffs, the chords, the sung
melody, the one-off licks and the groove. It doesn't try to find the guitar
part that is actually in the recording.

Every step is behind an interface, so the instrument, its timbre, and each
method can be swapped and compared, as the extractor's sources and detectors
already are.

Status markers: ✅ built · 🚧 in progress · 📝 planned

---

## The objective

"Keeping the song" doesn't mean keeping the most physical energy. A
reduced-order model such as truncated SVD keeps whatever carries the most
variance and throws away rare events as noise. For an arrangement, the rare
events (a one-off riff, a quiet vocal line) are often what make the song
recognisable, and the loud steady parts (strumming, bass roots) are the most
generic. So the objective has three parts:

1. **Layers:** the song is split into layers (stage 2), such as a repeating
   riff, a chord progression, the vocal line, a one-off fill, or the rhythm.
   One-off material is a layer of its own, not leftover noise.
2. **Distinctiveness, not loudness:** within a layer, each note is weighted by
   how much it makes that layer *that layer*. One measure is
   **leave-one-out**: remove the note and see how much closer the layer gets to
   the other layers. If dropping the last note of riff A makes it nearly the same
   as riff B, that note defines A and gets a high weight, wherever it falls in
   time and however quiet it is. Notes that are shared everywhere, such as a
   common root, get low weights. For a repeating layer, notes that stay the same
   every time form its backbone, and notes that change are its variations.
3. **Fairness across layers:** the score is a sum over layers of a concave
   function (such as log) of each layer's weighted share kept. The first notes
   *chosen* from a layer add more to the score than the last ones chosen. Order
   of choice follows weight, not time, so a layer's defining notes go in first.
   With a limited note budget, this plays *something* from every layer sounding
   at a moment, instead of spending everything on the loudest one.

A **density** setting (the note budget) plays the role that choosing a rank does
in a truncated SVD. The score plotted against density shows what each extra note
buys.

This all comes from the audio alone. If a hand-made note file happens to exist
for a song, it can be compared as an optional extra check (note F-measure with
about 50 ms onset tolerance). Nothing in the pipeline depends on one. Listening
with the existing player remains the final judge.

---

## Pipeline

```
AudioClip
   │
   ▼
Representation ──► Spectrogram ─────────────────────────────┐
   │                                                         │
   ▼                                                         ▼
Rhythm ──► onsets, beats, bars          Ensemble: [Instrument + TimbreProfile]
   │                                                         │ Timbre.render()
   │                                                         ▼
   │                                                    Dictionary
   │                                                         │
   │                   Projector (stage 1) ◄─────────────────┘
   │                        │ activations H, residual
   ▼                        ▼
Picker ─────────────► Candidate[]
                            │
                            ▼
                LayerFinder (stage 2) ──► Layer[]  ── denoise? ──► back to Picker
                            │
                            ▼
            Multiplexer (stage 3), scored by Objective,
            limited by each Instrument's playability
                            │
                            ▼
                          NoteSet  (notes with part, layer, technique)
```

The whole pipeline is one registered extractor, **`arrange`** ✅
(`js/extract/extractors/arrange.js`). Its options name the implementation used
at each step, and hold each step's own options under keys prefixed with the
step's name. They're flat, so they fit the page's sliders and the note file
records exactly how the notes were made:

```js
{
  representation: 'stft-log',
  rhythm: 'flux',
  ensemble: [{ instrument: 'guitar', profile: 'default' }],
  projector: 'nnls',
  picker: 'onset-rise',
  layers: 'none',
  objective: 'energy',
  multiplexer: 'greedy',
  'projector.sparsity': 0.02,     // each step's own options, prefixed
  'picker.floorDb': -50,
  // …
}
```

Its `settings` (sliders on the page) are the default implementations'
`settings`, with keys prefixed the same way. An ensemble entry is
`{ instrument, profile?, label?, options? }`. `profile` is `'default'` (the
instrument's own) or a saved `TimbreProfile`. Members get unique labels
(`guitar`, `guitar 2`).

`runPipeline(clip, options, { trace: true })` also returns a **trace**: the
output of every step (spectrogram, dictionary, activations, residual,
candidates, layers, weights, choices, per-step scores) plus anything an
implementation adds under its own id (such as the loss at each NMF
iteration). The extractor doesn't ask for one. The [debug page](#debug-page-debugarrangehtml-)
does.

The stages map onto implementations. **Stage 1 alone** is
`layers: 'none'` (one layer per ensemble member), `objective: 'energy'` and
`multiplexer: 'greedy'`, which picks up to N notes per onset by how much they
explain. Stages 2 and 3 are better implementations of the same steps, not a
different pipeline.

**Stage 1 is built** ✅. On synthetic audio it finds a C major triad, all six
notes of an E minor chord strummed on six strings, melodies with their timing,
and repeated notes. A noise burst over a held note comes out as `mute`, `slap`
and `tap`, not as new notes. Percussive choices stay in the trace and aren't
saved yet (they need the note format change below). A 30-second clip takes
about 2.5 s. Known weakness: a faint octave ghost (G5 over G4) can get through
at about a tenth of the main note's weight.

---

## Types ✅

Defined in `js/extract/arrange/types.js`, alongside the extractor's own types.
The full list there also has `Axis`, `Member`, `Step` and `Choice`.

```js
/** A time-frequency picture of the clip. */
Spectrogram = {
  hopSeconds: number,
  hz: Float32Array,            // the centre frequency of each bin (any spacing)
  frames: Float32Array[],      // magnitude per bin, one array per frame
}

/** Something an instrument can sound: a pitch, or a percussive technique. */
Sound = { midi: number } | { technique: 'mute' | 'slap' | 'tap' }

/** Numbers that describe how one particular instrument sounds. Saved as a file. */
TimbreProfile = {
  timbre: string,              // the Timbre model id these params are for
  instrument: string,          // the Instrument id
  name: string,                // e.g. "My nylon-string guitar"
  params: object,              // model-specific (brightness, inharmonicity, body resonances…)
}

/** One member of the ensemble that the song is arranged for. */
Member = { label: string, instrument: Instrument, profile: TimbreProfile }

/** Every template the projector may use, with what each one is. */
Dictionary = {
  hz: Float32Array,            // matches the Spectrogram
  columns: Float32Array[],     // one template spectrum per entry in `labels`
  labels: { member: number, sound: Sound }[],
}

/** How strongly each dictionary column sounds in each frame. */
Activations = { hopSeconds, values: Float32Array[] }   // values[column][frame] ≥ 0

/** A possible note: one dictionary column switching on at one time. */
Candidate = {
  column: number, member: number, sound: Sound,
  start: number, duration: number,   // seconds
  strength: number,                  // how much the activation rose
  peakFrame: number,                 // where the activation peaks
}

/** A layer of the song (stage 2). Not an instrument: see Note.part. */
Layer = {
  id: string,
  kind: 'repeating' | 'one-off' | 'rhythm' | string,
  members: Map<number, number>,      // candidate index → how much it belongs (0..1)
  occurrences: { start: number, end: number }[],
}
```

---

## Interfaces ✅

Each one is an ES module whose default export has `id`, `name`,
`description`, `defaults` and optional `settings`, as extractors do. They're
listed in `js/extract/arrange/registry.js`, and `loadStep(kind, id)` loads one
lazily and checks its members, as `loadImpl` does in `js/extract/registry.js`.
Every method takes `{ options, onProgress?, signal? }` where it can be slow.
In the tables, ✅ is built and the rest are 📝 planned.

### Representation
Turns audio into a spectrogram.

```js
analyse(clip: AudioClip, { options }): Promise<Spectrogram>
kernel(hz, { options }): Float32Array      // how a steady unit sine at `hz` looks
resynthesize?(clip, mask: Float32Array[], { options }): Promise<Float32Array>   // for listening on the debug page
```

`kernel` is what timbres draw partials with, so templates smear exactly as the
analysis does. `stft-log` computes it by analysing a synthetic sine, then
caches it.

`resynthesize` applies a soft mask (values 0..1, one per bin and frame, such as
the reconstruction divided by the original) to the clip's own transform. It
keeps the original phase and transforms back to samples. That's how the debug
page plays the guitar-space version, the residual, or one layer.

| id | Notes |
|---|---|
| `stft-log` ✅ | The same analysis as `spectrum.js` (4096-point FFT at 16 kHz every 10 ms), mapped to a log-frequency axis with three bins per semitone from C1 up to 8 kHz. Magnitudes are absolute (a full-scale sine reads as 1), not normalised to the clip's peak, so quiet audio stays quiet. `resynthesize` reads the mask off the log axis at every FFT bin, scales each frame's own transform (keeping its phase), and overlap-adds the frames back at 16 kHz. A mask of ones gives the clip back. |
| `multires` | Long windows for low notes, short ones for high notes, so low notes don't smear (see README). |
| `cqt` | Constant-Q transform. |

### Rhythm
Finds where things happen.

```js
analyse(clip, spectrogram, { options }): Promise<{ onsets: number[], beats: number[], bars: number[] }>
```

It gets the clip as well as the spectrogram, because onsets need a shorter
window than the spectrogram's.

| id | Notes |
|---|---|
| `flux` ✅ | The spectral-flux onsets from `spectrum.js` (`spectralFlux`, shared with the timeline's onset ticks), on the spectrogram's frame times. 📝 Next: tempo from the autocorrelation of onset strength, then beats and bars. |

### Instrument
What an instrument can play. It knows nothing about how it sounds.

```js
{
  sounds(options): Sound[],                       // every pitch and technique it can make
  playability: {
    states(sounds: Sound[], options): State[],    // ways to play these at once, cheapest first; [] = impossible
    cost(state, options): number,                 // how awkward that way is
    transition(prev, next, gapSeconds, options): number,   // cost of moving between them
  },
  defaultProfile: TimbreProfile,
}
```

`options` are the member's: the instrument's `defaults` plus the ensemble
entry's `options`. `State` is up to the instrument. For a guitar it is the
strings and frets used.

| id | Notes |
|---|---|
| `guitar` ✅ | Built on `js/tabs/guitar.js` (`Guitar`, `positionsFor`). `sounds()` is every pitch from the tuning plus `mute`, `slap` and `tap`. Playability uses the `path` fingering's candidates and costs, moved into `js/tabs/hand.js` so both use them. Its options include the `path` weights (reach and so on) and the `guitar` (tuning and frets). Percussive sounds don't take a string yet. |

Other instruments (bass, piano, ukulele) are new modules with their own
sounds and playability.

### Timbre
How an instrument sounds: renders a template for a sound from a profile, and
can fit a profile to a recording.

```js
render(member: Member, sound: Sound, axis: Axis): Float32Array   // axis = { hz, kernel }
partials?(member, sound, { maxHz }): { hz, amp }[]   // a pitched sound's sine partials, for synthesis
fit?(spectrogram, member, activations?, { options }): TimbreProfile   // 📝
```

| id | Notes |
|---|---|
| `harmonic` ✅ | A harmonic comb: partial k at k·f0·√(1 + Bk²) (string inharmonicity), partial strengths falling with a brightness slope, optional body resonances, optional per-string differences (the same pitch sounds darker on a lower string). Percussive sounds are fixed shapes: `mute` short and broadband, `slap` a low thump with string noise, `tap` a body resonance. |

**Tuning to a specific instrument:** `fit()` adjusts the profile's numbers to
match a recording, with no annotations. It alternates two steps: project with
the current templates, then update the parameters to reduce what's left over.
The recording can be:
- **of the instrument itself**, such as a minute of your own guitar played alone,
  saved as a named profile (`.timbre.json`, through the existing Storage) and
  reused;
- **the song**, to adapt a profile to the guitar sound in that recording, held
  close to the starting profile so it can't drift into explaining other
  instruments.

Partials stay at their harmonic positions in every case. Only their strengths
and the shape parameters change.

### Building the dictionary ✅
Not swappable. `buildDictionary(ensemble, axis)` renders every `sound()` of
every member with its timbre, scales each template to unit length, and labels
each column. It keeps each template's scale (`scales`), so an activation can be
turned back into a level.

### Synthesis ✅
Not swappable. `synthesize(trace, { rate, length })` in `synthesis.js` makes
audio from the dictionary and activations alone: "a guitar playing
everything".
- **Pitched sounds:** additive synthesis from the timbre's `partials()`, with
  amplitudes following the activations.
- **Percussive sounds:** noise shaped by their templates.
- **Levels:** a played sound projects back at about the level it was played at
  (tested).
- **What it's for:** the debug page, to hear and see what the projection
  decided. It sounds organ-like rather than plucked where the activations
  follow held notes (a voice). Several members simply add
their columns. The projector then decides which member each part of the sound
belongs to by timbre.

### Projector (stage 1)
Explains the spectrogram as a non-negative mix of dictionary columns.

```js
project(spectrogram, dictionary, { options }): Promise<{
  activations: Activations,
  residual?: Float32Array[],       // what the dictionary can't explain
}>
```

A plain orthogonal projection doesn't work: templates share partials, so they
aren't orthogonal, and projecting gives negative amounts of notes.

| id | Notes |
|---|---|
| `nnls` ✅ | Non-negative least squares per frame, with a sparsity penalty that scales with the frame's loudness. Solved by coordinate descent on WᵀW, starting from the previous frame's answer. |
| `nmf-fixed` | Multiplicative updates with the dictionary fixed and a β-divergence (KL or Itakura–Saito) that suits audio better than squared error. |

Drums are kept, not removed. They project onto the instrument's percussive
sounds (`mute`, `slap`, `tap`), so the groove survives as dead notes and slaps.
Without those columns, a kick would leak into a stray low E and a cymbal into a
scatter of wrong pitches. That would add noise and lose the groove.

### Picker
Turns activations into candidate notes.

```js
pick(activations, dictionary, { rhythm, spectrogram, ensemble, options }): Candidate[]
```

| id | Notes |
|---|---|
| `onset-rise` ✅ | At each onset (and the start of the clip, if something is already sounding), every column whose activation rose is a candidate, with these rules. **Floor:** its peak is above an absolute floor (−50 dB), so silence and faint noise give nothing. **Relative rise:** it rose at least a tenth as much as the strongest rise there. **Re-strike:** a sound that was already ringing must rise by 30% of its peak, so beating between partials, or a drum hit over a held note, doesn't replay it. **Neighbours:** a pitch is dropped when an adjacent semitone is twice as strong. Where the window only partly covers a tone, the spectrum broadens and the fit explains the edge with neighbouring semitones. **Next onset:** a rise still climbing where the next onset cuts the look-ahead belongs to that onset. A candidate ends when its activation falls below 30% of its peak, or when the same column starts again. |

### LayerFinder (stage 2)
Splits the candidates into layers, and can clean up the activations using
repetition.

```js
find(candidates, { rhythm, activations, ensemble, options }): Layer[]
denoise?(activations, layers, { rhythm }): Activations     // then pick again
```

| id | Notes |
|---|---|
| `none` ✅ | One layer per ensemble member. Makes stage 1 work on its own. |
| `bar-nmf` | Cut the activations into bars using `rhythm.bars`, flatten each bar into a row (sound × sub-beat), and factor the bar matrix with NMF. Components are the repeating layers, and what doesn't factor well becomes one-off layers. Percussive columns form the rhythm layer. `denoise` averages bars that share a layer, so noise cancels and real notes get stronger. |
| `bar-svd` | The same with SVD, for exploring (its parts can be negative). |
| `nmfd` | Convolutive NMF: templates that are short note sequences, with the times when each one fires. |
| `repet` | REPET-style: separates the repeating background from the non-repeating foreground (often the vocal line). |

Fourier over time is useful *inside* these, for finding the period (tempo, bar
length), but not as the basis for layers. Its sinusoids span the whole song and
don't know *where* things happen. Riffs repeat at irregular places and are shaped
like note sequences, not sinusoids.

### Objective
What a choice of notes is worth. Split into a one-off preparation and a
per-step score, so both greedy and dynamic-programming multiplexers can use it.

```js
prepare(candidates, layers, { spectrogram, activations, dictionary, options }): Context   // e.g. distinctiveness weights
score(chosen: Candidate[], step: Step, context): number    // Step = { start, end, candidates }
```

| id | Notes |
|---|---|
| `energy` ✅ | How much of the spectrogram the chosen candidates explain, at the frame where the step's strongest candidate peaks. That way a short hit counts as much as a chord that takes a moment to fill the window. Sounds that aren't candidates at the step (still ringing from earlier) are taken out first, so they don't inflate the score of notes that share their partials. The baseline, and what stage 1's greedy cap uses. |
| `fair-distinct` | The objective above: leave-one-out distinctiveness weights within layers, then a concave sum over layers. Settings: the concave function's strength, and an optional bonus for a layer (such as the melody). |

### Multiplexer (stage 3)
Chooses what to play over time.

```js
choose(candidates, {
  layers, objective, context, ensemble,
  density,                          // the note budget
  options,
}): Choice[]   // { candidate, member, state } for every note kept
```

Every multiplexer must respect each member's playability: every chosen
moment has a `state` from `instrument.playability.states()`.

| id | Notes |
|---|---|
| `greedy` ✅ | At each onset, add candidates one at a time by score gained, keeping only playable combinations. Stop at `maxPerOnset` (6), when the next would add less than `minGain` (a tenth) of what the first added, or when it would add less than `minShare` (2% of the frame). Pitched notes and percussive hits are chosen separately, each with its own limits. Otherwise a kick under every chord makes the chord notes look too weak to keep. Stage 1's default. On the chords-bass-and-drums test clip, some quiet top-line notes under loud drums fall below `minShare`: energy isn't importance, which is what `fair-distinct` is for. |
| `viterbi` | Dynamic programming over the whole song. Each step's candidates are playable subsets, scored by `objective.score` minus a switching cost (so the arrangement doesn't flicker between layers) minus playability `cost` and `transition`. Exact for a per-step score. |
| `beam` | Beam search, for objectives that don't split into steps. |

---

## Debug page (`debug/arrange.html`) 🚧

A separate page for seeing inside the pipeline. It shows far more than the
production page should. `extract.html` only gains `arrange` in its detector
list, and keeps its current spectrogram and harmonic-sum layers.

**Built:**
- **Audio:** the same sources as `extract.html` (a browser tab, an audio file,
  and any added later), through the shared buttons in
  `js/extract/sources/ui.js`. Or test clips: a C major triad, a six-string
  E minor, a melody, a drum hit over a held note, and chords with bass and
  drums. **Clear audio** drops the clip and everything computed from it.
  `?preset=band&cursor=2.3` opens a test clip, with a moment picked for the
  frame slice.
- **Playback and crops, as on `extract.html`:** the song with the kept notes on
  the synth, with Loop crop, Speed, Follow and the volumes.
  - **Time crop:** yellow handles on every plot, plus Start/End here (`[` `]`),
    Fit to audio and Reset. It starts fitted to the audio and sets what loops.
  - **Pitch crop:** handles on the activations, plus Fit to notes. Notes outside
    it are dimmed and not played, and it fits the notes after each run unless
    you've moved it.
  - **Playhead:** click to move it, or drag its grip to scrub. The frame slice
    shows the moment under it.
- **Controls:** a box per step, with its implementation and an input for every
  option, plus the ensemble's instrument options and timbre parameters. Each
  box shows how long its step took, or "reused".
- **Views 1–3.**

- **Synthesised view:** the spectrogram of the synthesis (red) over the
  original (blue). White is where they agree.
- **Listening (view 7):** **Guitar space**, **Residual** and **Synthesised**
  volume sliders sit beside Song and Notes, so any mix of them can play.
  Guitar space and the residual are the recording filtered: they keep its own
  sound, so a voice that guitar notes explain still sounds like the voice.
  Synthesised is the templates themselves.
  - The two are made with `resynthesize` and the soft mask
    `min(1, reconstruction / original)` (`explainedMask` in `dictionary.js`),
    or one minus it, so they add up to the song.
  - They're computed the first time a slider goes up, once per projection.
  - The player takes them as stems: extra channels of the song's WAV, so they
    stay sample-locked to it at any speed, each with its own gain.

**Not yet:** listening to one layer (once there are layers), views 4–6 and 8,
and export.

- **Where:** `debug/` holds pages for looking under the hood, reached by URL and
  not linked from the production pages. Other debug pages (onsets, fingering)
  can go there later.
- **Same rules as the other pages:** no build step, and audio in memory only. It
  opens audio with the existing `file` and `tab` sources (it can't take audio
  from `extract.html`, because nothing is stored between pages). It runs the
  same pipeline modules, unchanged, with `trace: true`.
- **Pipeline controls:** a dropdown per step listing the registered
  implementations, and the sliders from each one's `settings`. Changing one
  re-runs from that step onward and keeps the earlier steps' results. That's
  `runPipeline`'s `reuse`: each step has a key made of its implementation, its
  options and its inputs' keys. A step whose key hasn't changed returns its
  earlier output.

**Views.** They share one time axis (zoom, scroll and playhead move together)
and can be shown or hidden:

1. **Spectrogram and reconstruction:** the original spectrogram, the
   guitar-space reconstruction (dictionary × activations), and the residual,
   stacked on the same scale, with a linear or log scale. This is the main
   comparison for stage 1.
2. **Activations:** sound × time, with the percussive sounds in their own rows.
   Onsets are ticks, candidates are outlines, and chosen notes are filled in
   their note colour (📝 coloured by layer once there are layers). Hovering
   shows the activation and the candidate's numbers, and whether it was kept.
3. **Frame slice:** click a time to see the spectrum of that frame. It shows the
   original and the reconstruction as lines, and the strongest templates (up to
   eight), each as its own line. The legend gives the share of the frame the
   reconstruction explains, and each template's activation and share.
4. **Dictionary and timbre:** every template, the profile's parameters as live
   sliders (re-projecting as they change), and the fit's loss at each
   iteration.
5. **Layers:** the bar-against-bar self-similarity matrix, each layer as a
   small piano roll, when each layer sounds, and each note's distinctiveness
   weight as shading.
6. **Objective and multiplexer:** the score against density (what each extra
   note buys), the per-step score split into its terms (layer shares,
   switching cost, playability cost) over time, and the instrument state over
   time (for the guitar, where the hand is).
7. **Listen:** play the original, the reconstruction, the residual, one
   layer, or the chosen notes on the synth, through `resynthesize` and the
   existing player.
8. **Compare:** run two configurations on the same clip (A and B), shown side by
   side or as a difference, with both scores.

**Export:** the trace can be saved as JSON for comparing runs offline, without
the spectrograms, reconstruction and residual. Magnitudes can be turned back
into rough audio, and the principle is that only notes and timings leave the
page. The candidates, layers, weights, scores and timbre profile are fine.

---

## Changes to the note format 📝

Readers already ignore unknown fields, so none of this needs a new version.

- **`technique`** (`'mute' | 'slap' | 'tap'`): a percussive hit. These notes have
  no pitch (`midi: null`). This touches:
  - the note checks in `runExtractor()` and the range filter (keep percussive
    notes);
  - the timeline (a percussion row);
  - the synth voice (a short noise burst);
  - the MIDI codec (General MIDI percussion, or skip them);
  - the tabs view (an `x` on a string, placed by the fingering).
- **`part`**: which ensemble member plays the note (its `label`). This is what
  `part` already means: the MIDI codec puts tracks there.
- **`layer`**: the stage 2 layer the note came from, for showing and filtering
  layers on the timeline.

---

## Files

Built ✅ (planned modules in brackets):

```
js/extract/extractors/arrange.js     the `arrange` extractor: runs the pipeline
js/extract/arrange/
  types.js                           the types above (JSDoc)
  registry.js                        every implementation, lazily loaded; loadStep
  pipeline.js                        runPipeline, stepOptions, resolveEnsemble (pure)
  dictionary.js                      buildDictionary, reconstruct, explainedMask (pure)
  synthesis.js                       synthesize: audio from templates and activations (pure)
  representations/                   stft-log.js [multires.js, cqt.js]
  rhythm/                            flux.js
  instruments/                       guitar.js
  timbres/                           harmonic.js
  projectors/                        nnls.js [nmf-fixed.js]
  pickers/                           onset-rise.js
  layers/                            none.js [bar-nmf.js, …]
  objectives/                        energy.js [fair-distinct.js]
  multiplexers/                      greedy.js [viterbi.js, beam.js]
js/tabs/hand.js                      guitar hand costs, shared with the `path` fingering
test/arrange.test.js                 contract suites for every step, and the pipeline
```

The debug page 🚧:

```
debug/arrange.html                   the debug page
js/debug/
  arrange.js                         its wiring, controls and views
  plots.js                           shared canvas plots: a TimeView shared by every
                                     plot, heatmaps, colour maps, axes
  test-signals.js                    synthetic test clips (plucked chords, drums)
css/debug.css
test/debug-page.test.js
```

Everything under `arrange/` is pure (no DOM), so it can move into a worker if
whole songs are slow.

---

## Tests ✅

One contract suite per interface, run against every registered
implementation, as for the extractor's interfaces (`test/arrange.test.js`).
Built so far, except where marked 📝:

- **Representation:** a 440 Hz tone peaks at the bin nearest 440 Hz, at about
  its amplitude, and so does the kernel.
- **Rhythm:** onsets at note starts.
- **Instrument:** every sound can be played alone, with finite costs. For the
  guitar, a six-note E minor chord is on six different strings, and seven notes
  or a note below the low E can't be played.
- **Timbre:** templates are non-negative and peak at the fundamental (within a
  third of a semitone, since low notes smear). 📝 `fit()` recovers the
  parameters of a spectrogram rendered from a known profile.
- **Dictionary:** one unit-length, labelled column per sound.
- **Projector:** a mix of two known templates comes back as those two
  activations. Activations are never negative. A noise burst lands on the
  percussive columns, not on pitches.
- **Picker:** a candidate starts at its onset and ends when the sound fades.
- **LayerFinder:** every candidate belongs to a layer. 📝 A synthetic song with a
  repeated bar and one different bar gives a repeating layer and a one-off
  layer.
- **Objective:** nothing chosen scores 0, and the real note explains most of
  its frame. 📝 Spreading a budget across layers scores higher than spending it
  on one. In a synthetic pair of riffs that differ only in their last note,
  that note gets the highest weight.
- **Multiplexer:** every choice is playable together. 📝 Within the budget, and
  `viterbi` never scores below `greedy` on the same input.
- **End to end:** `arrange` passes the extractor contract tests (440 Hz → A4,
  low E without an octave error, and so on). It finds a C major triad and a
  six-string E minor chord, and a drum hit over a held note is percussive, not
  a new note. The trace has every step.
- **Debug page:** like `page.test.js`, load it in an iframe. Run a test chord
  and check every view draws, and that clicking a moment fills the frame slice
  with the chord's notes. Change a late step's option and check the analysis
  and projection are reused. Open a generated WAV file. Switch Hear to guitar
  space and the residual while playing.
- **Resynthesis:** a mask of all ones gives back the original samples, and two
  halves add up to it.

---

## Open questions

- **The vocal line:** a singer's notes overlap the guitar's range. Is it found
  well enough as a layer by `repet`, or does it need pitch-glide and vibrato
  cues?
- **Members with similar timbres:** with two guitars, the projector can't tell
  them apart by timbre. The multiplexer may need to assign notes to members
  itself, by playability.
- **Sounds no member can make** (breath, synth pads, reverb tails) go to the
  residual. Do they need their own "background" columns so they don't leak into
  real notes?
- **How many rounds** of denoise and pick again are worth it?
- **Speed:** a whole song in the browser, at about 50 pitches × 100 frames a
  second. Measure early. Move to a worker if needed.

## Order of work

1. ✅ **The skeleton:** types, the registry, the pipeline, `buildDictionary`, and
   the contract test suites. Implementations: `stft-log`, `flux` (onsets only),
   `guitar` (sharing the `path` costs with js/tabs), `harmonic`, `nnls`,
   `onset-rise`, `none`, `energy`, `greedy`. That is stage 1, shipped as
   `arrange`.
2. 🚧 **The debug page** with the trace, pipeline controls and views 1–3 (built)
   (spectrogram and reconstruction, activations, frame slice), then listening
   (view 7).
3. **Percussive notes:** the note format changes above, across the extractor
   and the tabs view.
4. **Timbre fitting:** `harmonic.fit()`, named profiles saved and opened through
   Storage, adapting to the song, and the dictionary view (4).
5. **Stage 2:** beats and bars in `flux`, `bar-nmf` with `denoise`, the `layer`
   field, and the layers view (5).
6. **Stage 3:** `fair-distinct` and `viterbi`, and the objective view (6).
7. **Alternatives where the results call for them:** `multires`/`cqt`,
   `nmf-fixed`, `nmfd`, `repet`, `beam`, and more instruments, compared with
   view 8.
