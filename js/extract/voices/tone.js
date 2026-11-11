// Voice: Tone.js synths. This is the only file that imports Tone.js.
//
// We keep our own pool of Tone.Synth voices instead of using Tone.PolySynth:
// PolySynth delays future notes with a JavaScript timer, whereas Tone.Synth
// schedules straight onto the audio clock, which is sample-accurate and also
// works in an OfflineAudioContext (used by the tests).

const TONE_URL = 'https://cdn.jsdelivr.net/npm/tone@15.1.22/+esm';
const POOL_SIZE = 24;
const RELEASE = 0.12;

export default {
    id: 'tone',
    name: 'Synth (Tone.js)',

    /**
     * @param {BaseAudioContext} audioContext  Shared with the song so both use one clock.
     * @param {AudioNode} destination
     */
    async create(audioContext, destination) {
        const Tone = await import(TONE_URL);
        Tone.setContext(audioContext);

        const output = new Tone.Gain(Tone.dbToGain(-8));
        output.connect(destination);
        const pool = Array.from({ length: POOL_SIZE }, () => {
            const synth = new Tone.Synth({
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.005, decay: 0.1, sustain: 0.6, release: RELEASE },
            });
            synth.connect(output);
            return { synth, busyUntil: 0 };
        });

        // A free voice, or else the one that frees up soonest.
        const pick = (when) => pool.find((v) => v.busyUntil <= when)
            ?? pool.reduce((a, b) => (a.busyUntil <= b.busyUntil ? a : b));

        return {
            /** @param {import('../types.js').Note} note  @param {number} when  AudioContext time */
            scheduleNote(note, when) {
                const duration = Math.max(0.03, note.duration);
                const voice = pick(when);
                voice.busyUntil = when + duration + RELEASE;
                const hz = Tone.Frequency(note.midi, 'midi').toFrequency();
                // Keep quiet notes audible: map 0..1 to 0.3..1.
                voice.synth.triggerAttackRelease(hz, duration, when, 0.3 + 0.7 * note.velocity);
            },
            stopAll() {
                const now = audioContext.currentTime;
                for (const voice of pool) {
                    voice.synth.envelope.cancel(now);
                    voice.synth.triggerRelease(now);
                    voice.busyUntil = 0;
                }
            },
            dispose() {
                pool.forEach((v) => v.synth.dispose());
                output.dispose();
            },
        };
    },
};
