// Source: an audio file on this computer, decoded in memory.

import { toMono } from '../dsp.js';
import { makeClip } from '../types.js';

const DECODE_RATE = 48000;

export default {
    id: 'file',
    name: 'Audio file',
    kind: 'file',
    startLabel: 'Open an audio file',
    accept: 'audio/*',

    isSupported() {
        return typeof OfflineAudioContext !== 'undefined';
    },

    /** @param {File|Blob} file */
    async open(file) {
        const ctx = new OfflineAudioContext(1, 1, DECODE_RATE);
        let buffer;
        try {
            buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        } catch {
            throw new Error('This file could not be decoded as audio.');
        }
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        return makeClip(toMono(channels), buffer.sampleRate, file.name ?? 'Audio file');
    },
};
