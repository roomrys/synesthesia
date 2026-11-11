// Source: audio playing in another browser tab (Chrome / Edge).

import { captureStream } from './live.js';

let session = null;

export default {
    id: 'tab',
    name: 'Browser tab',
    kind: 'live',
    startLabel: 'Listen to a tab',
    hint: 'Choose the tab that is playing audio and make sure “Share tab audio” is on.',

    isSupported() {
        return Boolean(navigator.mediaDevices?.getDisplayMedia);
    },

    async start({ onLevel, onEnded } = {}) {
        if (session) throw new Error('Already listening');
        const stream = await navigator.mediaDevices.getDisplayMedia({
            // Chrome requires video to share a tab; we never use it.
            video: { displaySurface: 'browser' },
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            preferCurrentTab: false,
            selfBrowserSurface: 'exclude',
            surfaceSwitching: 'include',
            systemAudio: 'exclude',
        });
        if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach((t) => t.stop());
            throw new Error('No audio was shared. Choose a tab and turn on “Share tab audio”.');
        }
        const label = stream.getVideoTracks()[0]?.label || 'Browser tab';
        session = await captureStream(stream, { onLevel, onEnded, label });
    },

    async stop() {
        if (!session) throw new Error('Not listening');
        const s = session;
        session = null;
        return s.stop();
    },
};
