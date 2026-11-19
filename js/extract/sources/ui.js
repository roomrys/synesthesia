// Buttons for the audio sources, shared by every page that takes audio
// (extract.html, debug/arrange.html), so a new source shows up on all of them.

/**
 * One button per source: live sources call `onLive(source)`; file sources open
 * a file picker and call `onFile(source, file)`. Returns the elements to append.
 */
export function sourceButtons(sources, { onLive, onFile }) {
    const out = [];
    for (const source of sources) {
        const button = document.createElement('button');
        button.textContent = source.startLabel ?? source.name;
        button.dataset.source = source.id;
        if (source.kind === 'live') {
            button.addEventListener('click', () => onLive(source));
        } else {
            const input = Object.assign(document.createElement('input'), { type: 'file', accept: source.accept ?? '', hidden: true });
            input.addEventListener('change', () => {
                if (input.files[0]) onFile(source, input.files[0]);
                input.value = '';
            });
            button.addEventListener('click', () => input.click());
            out.push(input);
        }
        out.push(button);
    }
    return out;
}

/**
 * The hint under the buttons: how to use the tab source, or why a configured
 * tab source is missing, instead of hiding it silently.
 */
export function sourceHint(sources, config, { page = 'extract.html' } = {}) {
    const tab = sources.find((s) => s.id === 'tab');
    if (tab) return tab.hint ?? '';
    if (config.sources.includes('tab')) {
        return window.isSecureContext
            ? 'Listening to a tab needs Chrome or Edge on a computer.'
            : `Listening to a tab only works on https or localhost. Open this page at http://localhost:8000/${page}.`;
    }
    if (/[?&]sources=/.test(location.search)) {
        return 'Only some audio sources are on, because the address sets “sources”. Remove it from the address to listen to a tab.';
    }
    return '';
}

/** Why a live source couldn't start, in words. `cancelled` means the person said no, which isn't an error. */
export function liveError(err) {
    const cancelled = err?.name === 'NotAllowedError' || err?.name === 'AbortError';
    return { cancelled, message: cancelled ? 'Sharing was cancelled.' : (err?.message ?? String(err)) };
}
