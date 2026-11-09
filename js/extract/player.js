// Plays the song and the detected notes together, with looping and a speed control.
//
// The song plays through an <audio> element fed from an in-memory WAV blob, so
// the browser can change speed without changing pitch (preservesPitch). It is
// routed into our AudioContext. Notes are scheduled a short time ahead against
// the song's own clock (audio.currentTime) and scaled by the speed, so they stay
// in sync at any speed. With no audio (a notes file on its own), a clock based
// on the AudioContext stands in.

import { encodeWav } from './dsp.js';

const LOOKAHEAD = 0.2;   // seconds of real time scheduled ahead
const TICK_MS = 25;

export class Player {
    /** @param {{create: Function}} voiceImpl  A Voice implementation. */
    constructor(voiceImpl) {
        this.voiceImpl = voiceImpl;
        this.clip = null;
        this.notes = [];
        this.length = 0;          // seconds
        this.position = 0;        // song time when paused
        this.playing = false;
        this.rate = 1;
        this.loop = null;         // { start, end } while looping
        this.until = 0;
        this.token = 0;           // cancels a play() that is still starting
        this.onStop = null;       // called when playback stops by itself
    }

    async init() {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.songGain = this.ctx.createGain();
        this.notesGain = this.ctx.createGain();
        this.songGain.connect(this.ctx.destination);
        this.notesGain.connect(this.ctx.destination);
        this.voice = await this.voiceImpl.create(this.ctx, this.notesGain);

        this.audio = new Audio();
        this.audio.preservesPitch = true;
        this.audio.preload = 'auto';
        this.ctx.createMediaElementSource(this.audio).connect(this.songGain);
    }

    /** @param {import('./types.js').AudioClip|null} clip */
    setClip(clip) {
        this.pause();
        this.clip = clip;
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = null;
        if (clip && clip.samples.length) {
            this.url = URL.createObjectURL(encodeWav(clip.samples, clip.sampleRate));
            this.audio.src = this.url;
        } else {
            this.audio.removeAttribute('src');
            this.audio.load();
        }
        this.position = 0;
        this.updateLength();
    }

    /** @param {import('./types.js').Note[]} notes  Sorted by start. */
    setNotes(notes) {
        this.notes = notes;
        this.updateLength();
        if (this.playing && this.started) this.restart(this.currentTime);
    }

    updateLength() {
        const notesEnd = this.notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
        this.length = Math.max(this.clip?.duration ?? 0, notesEnd);
    }

    /** Song time now. */
    get currentTime() {
        if (!this.playing || !this.started) return this.position;
        return Math.min(this.until, this.songNow());
    }

    songNow() {
        if (this.useAudio) return this.audio.currentTime;
        return this.clockOrigin + (this.ctx.currentTime - this.clockStart) * this.rate;
    }

    /** Loop between start and end (song seconds), or pass null to stop looping. */
    setLoop(range) {
        this.loop = range;
        if (!this.playing) return;
        const t = this.currentTime;
        if (range && (t < range.start || t >= range.end)) this.play(range.start);
        else this.until = range ? range.end : this.length;
    }

    setRate(rate) {
        if (this.playing && this.started) {
            this.clockOrigin = this.songNow();
            this.clockStart = this.ctx.currentTime;
        }
        this.rate = rate;
        this.audio.playbackRate = rate;
    }

    /** Play from `from`. Stops at the loop end (and jumps back) or the end of the song. */
    async play(from = this.position) {
        this.pause();
        const token = ++this.token;
        const until = this.loop ? this.loop.end : this.length;
        from = Math.max(0, Math.min(from, until));
        this.position = from;
        if (until - from < 0.01) return;
        this.playing = true;
        this.started = false;
        this.until = until;
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        this.useAudio = Boolean(this.url) && from < this.clip.duration - 0.01;
        if (this.useAudio) {
            this.audio.playbackRate = this.rate;
            this.audio.currentTime = from;
            try {
                await this.audio.play();
            } catch (err) {
                if (token === this.token) { this.playing = false; throw err; }
                return;
            }
            if (token !== this.token) { this.audio.pause(); return; }
        }
        this.clockOrigin = from;
        this.clockStart = this.ctx.currentTime;
        this.started = true;

        // Notes already sounding at `from` play their remaining part.
        const now = this.ctx.currentTime;
        this.nextNote = 0;
        while (this.nextNote < this.notes.length && this.notes[this.nextNote].start < from) {
            const n = this.notes[this.nextNote++];
            const remaining = Math.min(n.start + n.duration, until) - from;
            if (remaining > 0.03) this.voice.scheduleNote({ ...n, start: from, duration: remaining / this.rate }, now);
        }
        this.tick();
        this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    restart(from) {
        this.play(from);
    }

    tick() {
        if (!this.playing || !this.started) return;
        // Song audio ended but notes continue: switch to the stand-in clock.
        if (this.useAudio && this.audio.ended) {
            this.clockOrigin = this.clip.duration;
            this.clockStart = this.ctx.currentTime;
            this.useAudio = false;
        }
        const song = this.songNow();
        if (song >= this.until - 0.005) {
            if (this.loop) {
                this.play(this.loop.start);
            } else {
                this.pause();
                this.position = this.until;
                this.onStop?.();
            }
            return;
        }
        const now = this.ctx.currentTime;
        const horizon = Math.min(this.until, song + LOOKAHEAD * this.rate);
        while (this.nextNote < this.notes.length && this.notes[this.nextNote].start < horizon) {
            const n = this.notes[this.nextNote++];
            if (n.start + n.duration <= song) continue;   // already over (e.g. after a stall)
            const when = now + Math.max(0, n.start - song) / this.rate;
            const duration = (Math.min(n.start + n.duration, this.until) - Math.max(n.start, song)) / this.rate;
            if (duration > 0) this.voice.scheduleNote({ ...n, duration }, when);
        }
    }

    pause() {
        this.token++;
        if (this.playing && this.started) this.position = this.currentTime;
        this.playing = false;
        this.started = false;
        clearInterval(this.timer);
        if (!this.audio.paused) this.audio.pause();
        this.voice.stopAll();
    }

    seek(t) {
        const target = Math.max(0, Math.min(t, this.length));
        if (this.playing) {
            // Seeking outside a loop leaves the loop region playing from its start.
            this.play(this.loop && (target < this.loop.start || target >= this.loop.end) ? this.loop.start : target);
        } else {
            this.position = target;
        }
    }

    setSongVolume(v) { this.songGain.gain.value = v; }
    setNotesVolume(v) { this.notesGain.gain.value = v; }
}
