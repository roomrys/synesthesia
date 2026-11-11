// Storage fallback for any browser: save as a download, open with a file picker.

export default {
    id: 'download',
    name: 'Downloads',

    isSupported() {
        return typeof document !== 'undefined';
    },

    async folderName() {
        return null;
    },

    async save(filename, blob) {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return { filename, location: 'your downloads' };
    },

    open({ accept = { 'application/json': ['.json'] } } = {}) {
        return new Promise((resolve, reject) => {
            const input = Object.assign(document.createElement('input'), {
                type: 'file',
                accept: Object.values(accept).flat().join(','),
            });
            input.addEventListener('change', () => (input.files[0] ? resolve(input.files[0]) : reject(new Error('No file chosen'))));
            input.addEventListener('cancel', () => reject(new DOMException('No file chosen', 'AbortError')));
            input.click();
        });
    },
};
