// Projector: non-negative least squares, frame by frame.
//
// For each frame v, find h >= 0 minimising ½‖v − W·h‖² + λ‖h‖₁, where W is the
// dictionary (unit-length columns) and λ = sparsity·‖v‖, so the penalty scales
// with loudness. Solved by coordinate descent on the Gram matrix WᵀW, starting
// from the previous frame's answer (neighbouring frames are similar).

const defaults = {
    sparsity: 0.02,
    sweeps: 60,            // most per frame
    tolerance: 1e-4,       // stop when no activation moves more than this times ‖v‖
};

const settings = [
    {
        key: 'sparsity', label: 'Sparsity', min: 0, max: 0.2, step: 0.005,
        format: (v) => v.toFixed(3),
        help: 'How strongly to prefer explaining each moment with few sounds. Raise it if quiet stray notes appear.',
    },
];

export default {
    id: 'nnls',
    name: 'Non-negative least squares',
    description: 'The closest non-negative mix of templates for every frame.',
    defaults,
    settings,

    async project(spectrogram, dictionary, { options, onProgress, signal } = {}) {
        const o = { ...defaults, ...options };
        const W = dictionary.columns;
        const n = W.length;
        const bins = dictionary.hz.length;
        const frames = spectrogram.frames;

        const G = new Float64Array(n * n);
        for (let a = 0; a < n; a++) {
            for (let b = a; b < n; b++) {
                let s = 0;
                for (let i = 0; i < bins; i++) s += W[a][i] * W[b][i];
                G[a * n + b] = s;
                G[b * n + a] = s;
            }
        }

        const values = Array.from({ length: n }, () => new Float32Array(frames.length));
        const h = new Float64Array(n);
        const Gh = new Float64Array(n);   // G·h, kept up to date
        const b = new Float64Array(n);

        for (let f = 0; f < frames.length; f++) {
            if (f % 500 === 0) {
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                onProgress?.(f / frames.length);
                await new Promise((r) => setTimeout(r));
            }
            const v = frames[f];
            let norm = 0;
            for (let i = 0; i < bins; i++) norm += v[i] * v[i];
            norm = Math.sqrt(norm);
            if (norm < 1e-9) {
                h.fill(0);
                Gh.fill(0);
                continue;
            }
            for (let j = 0; j < n; j++) {
                let s = 0;
                const w = W[j];
                for (let i = 0; i < bins; i++) s += w[i] * v[i];
                b[j] = s;
            }
            const lambda = o.sparsity * norm;
            for (let sweep = 0; sweep < o.sweeps; sweep++) {
                let moved = 0;
                for (let j = 0; j < n; j++) {
                    const g = Gh[j] - b[j] + lambda;
                    const next = Math.max(0, h[j] - g / G[j * n + j]);
                    const d = next - h[j];
                    if (d === 0) continue;
                    h[j] = next;
                    for (let k = 0; k < n; k++) Gh[k] += d * G[k * n + j];
                    moved = Math.max(moved, Math.abs(d));
                }
                if (moved < o.tolerance * norm) break;
            }
            for (let j = 0; j < n; j++) values[j][f] = h[j];
        }
        onProgress?.(1);
        return { activations: { hopSeconds: spectrogram.hopSeconds, values } };
    },
};
