// Plays the song and the detected notes together on one AudioContext clock.
// Notes are scheduled a short time ahead in a loop, so pausing and seeking
// take effect straight away.

const LOOKAHEAD = 0.2;      // seconds of notes scheduled ahead
const TICK_MS = 25;
const START_DELAY = 0.05;   // small delay so the first note isn't late

export class Player {
    /** @param {{create: Function}} voiceImpl  A Voice implementation. */
    constructor(voiceImpl) {
        this.voiceImpl = voiceImpl;
        this.clip = null;
        this.notes = [];
        this.length = 0;          // seconds
        this.position = 0;        // seconds, when paused
        this.playing = false;
        this.onStop = null;       // called when playback stops by itself
    }

    async init() {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.songGain = this.ctx.createGain();
        this.notesGain = this.ctx.createGain();
        this.songGain.connect(this.ctx.destination);
        this.notesGain.connect(this.ctx.destination);
        this.voice = await this.voiceImpl.create(this.ctx, this.notesGain);
    }

    /** @param {import('./types.js').AudioClip|null} clip */
    setClip(clip) {
        this.pause();
        this.clip = clip;
        this.buffer = null;
        if (clip && clip.samples.length) {
            this.buffer = this.ctx.createBuffer(1, clip.samples.length, clip.sampleRate);
            this.buffer.copyToChannel(clip.samples, 0);
        }
        this.position = 0;
        this.updateLength();
    }

    /** @param {import('./types.js').Note[]} notes  Sorted by start. */
    setNotes(notes) {
        const wasPlaying = this.playing;
        const t = this.currentTime;
        if (wasPlaying) this.pause();
        this.notes = notes;
        this.updateLength();
        if (wasPlaying) this.play(t, this.until);
    }

    updateLength() {
        const notesEnd = this.notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
        this.length = Math.max(this.clip?.duration ?? 0, notesEnd);
    }

    get currentTime() {
        if (!this.playing) return this.position;
        return Math.min(this.until, this.ctx.currentTime - this.startedAt);
    }

    /** Play from `from` until `until` (seconds). */
    async play(from = this.position, until = this.length) {
        this.pause();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        from = Math.max(0, Math.min(from, until));
        if (until - from < 0.01) {
            this.position = from;
            return;
        }
        const t0 = this.ctx.currentTime + START_DELAY;
        this.startedAt = t0 - from;
        this.until = until;
        this.playing = true;

        if (this.buffer && from < this.buffer.duration) {
            this.source = this.ctx.createBufferSource();
            this.source.buffer = this.buffer;
            this.source.connect(this.songGain);
            this.source.start(t0, from, Math.min(until, this.buffer.duration) - from);
        }

        // Notes already sounding at `from` play their remaining part.
        this.nextNote = 0;
        while (this.nextNote < this.notes.length && this.notes[this.nextNote].start < from) {
            const n = this.notes[this.nextNote++];
            const remaining = Math.min(n.start + n.duration, until) - from;
            if (remaining > 0.03) this.voice.scheduleNote({ ...n, start: from, duration: remaining }, t0);
        }
        this.tick();
        this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    tick() {
        const now = this.ctx.currentTime;
        const horizon = now + LOOKAHEAD - this.startedAt;   // song time we schedule up to
        while (this.nextNote < this.notes.length && this.notes[this.nextNote].start < Math.min(horizon, this.until)) {
            const n = this.notes[this.nextNote++];
            const when = Math.max(now, this.startedAt + n.start);
            const duration = Math.min(n.duration, this.until - n.start);
            if (duration > 0) this.voice.scheduleNote({ ...n, duration }, when);
        }
        if (now - this.startedAt >= this.until) {
            this.pause();
            this.position = this.until;
            this.onStop?.();
        }
    }

    pause() {
        if (!this.playing) return;
        this.position = this.currentTime;
        this.playing = false;
        clearInterval(this.timer);
        if (this.source) {
            try { this.source.stop(); } catch { /* already stopped */ }
            this.source.disconnect();
            this.source = null;
        }
        this.voice.stopAll();
    }

    seek(t) {
        const target = Math.max(0, Math.min(t, this.length));
        if (this.playing) this.play(target, target < this.until ? this.until : this.length);
        else this.position = target;
    }

    setSongVolume(v) { this.songGain.gain.value = v; }
    setNotesVolume(v) { this.notesGain.gain.value = v; }
}
