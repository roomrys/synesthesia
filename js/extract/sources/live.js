// Shared helper for live sources: collect a MediaStream's audio into memory.

import { makeClip } from '../types.js';

const WORKLET_URL = new URL('../capture-worklet.js', import.meta.url);

/**
 * Start collecting audio from `stream`. Returns a session with stop() -> AudioClip.
 * @param {MediaStream} stream
 * @param {{onLevel?: (info: {peak: number, seconds: number}) => void, onEnded?: () => void, label?: string}} callbacks
 */
export async function captureStream(stream, { onLevel, onEnded, label } = {}) {
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(WORKLET_URL);
    const input = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'capture-processor', { numberOfOutputs: 1 });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    // The worklet has to be connected to the output to be processed; the gain keeps it silent.
    input.connect(worklet).connect(mute).connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume();

    const chunks = [];
    let total = 0;
    let stopped = false;
    let resolveStopped;
    const stoppedPromise = new Promise((resolve) => { resolveStopped = resolve; });

    worklet.port.onmessage = (event) => {
        if (event.data === 'stopped') return resolveStopped();
        const chunk = event.data;
        chunks.push(chunk);
        total += chunk.length;
        if (onLevel) {
            let peak = 0;
            for (let i = 0; i < chunk.length; i++) peak = Math.max(peak, Math.abs(chunk[i]));
            onLevel({ peak, seconds: total / ctx.sampleRate });
        }
    };

    // The user can end sharing from the browser's own UI.
    for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => { if (!stopped) onEnded?.(); });
    }

    return {
        sampleRate: ctx.sampleRate,
        async stop() {
            if (stopped) throw new Error('Already stopped');
            stopped = true;
            worklet.port.postMessage('stop');
            await Promise.race([stoppedPromise, new Promise((r) => setTimeout(r, 500))]);
            input.disconnect();
            worklet.disconnect();
            stream.getTracks().forEach((t) => t.stop());
            await ctx.close();

            const samples = new Float32Array(total);
            let offset = 0;
            for (const chunk of chunks) {
                samples.set(chunk, offset);
                offset += chunk.length;
            }
            chunks.length = 0;
            return makeClip(samples, ctx.sampleRate, label);
        },
    };
}
