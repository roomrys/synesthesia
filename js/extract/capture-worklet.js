// AudioWorklet that mixes its input down to mono and posts the samples to the
// main thread in chunks. Samples are only ever held in memory.

const CHUNK = 4096;
const QUANTUM = 128;

class CaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Float32Array(CHUNK);
        this.filled = 0;
        this.running = true;
        this.port.onmessage = (event) => {
            if (event.data === 'stop') {
                this.flush();
                this.running = false;
                this.port.postMessage('stopped');
            }
        };
    }

    push(value) {
        this.buffer[this.filled++] = value;
        if (this.filled === CHUNK) this.flush();
    }

    flush() {
        if (!this.filled) return;
        const chunk = this.buffer.slice(0, this.filled);
        this.port.postMessage(chunk, [chunk.buffer]);
        this.filled = 0;
    }

    process(inputs) {
        if (!this.running) return false;
        const channels = inputs[0];
        if (!channels || channels.length === 0) {
            // No input this quantum: keep the timeline continuous with silence.
            for (let i = 0; i < QUANTUM; i++) this.push(0);
            return true;
        }
        const length = channels[0].length;
        for (let i = 0; i < length; i++) {
            let sum = 0;
            for (let c = 0; c < channels.length; c++) sum += channels[c][i];
            this.push(sum / channels.length);
        }
        return true;
    }
}

registerProcessor('capture-processor', CaptureProcessor);
