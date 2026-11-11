// Storage: a folder on this computer chosen once and remembered (File System
// Access API, Chrome / Edge). The folder handle is kept in IndexedDB.

const DB_NAME = 'synesthesia';
const STORE = 'handles';
const KEY = 'notesFolder';

function idb(mode, fn) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, 1);
        open.onupgradeneeded = () => open.result.createObjectStore(STORE);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const tx = open.result.transaction(STORE, mode);
            const request = fn(tx.objectStore(STORE));
            tx.oncomplete = () => { open.result.close(); resolve(request?.result); };
            tx.onerror = () => reject(tx.error);
        };
    });
}

async function getFolder() {
    try {
        return await idb('readonly', (store) => store.get(KEY));
    } catch {
        return undefined;
    }
}

async function ensurePermission(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
}

async function exists(folder, name) {
    try {
        await folder.getFileHandle(name);
        return true;
    } catch {
        return false;
    }
}

/** "song.synesthesia" -> "song-2.synesthesia", ... until unused. */
async function uniqueName(folder, filename) {
    if (!(await exists(folder, filename))) return filename;
    const dot = filename.indexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : '';
    for (let i = 2; ; i++) {
        const candidate = `${stem}-${i}${ext}`;
        if (!(await exists(folder, candidate))) return candidate;
    }
}

const storage = {
    id: 'folder',
    name: 'Folder on this computer',

    isSupported() {
        return typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
    },

    /** Name of the remembered folder, if any. */
    async folderName() {
        return (await getFolder())?.name ?? null;
    },

    /** Ask the user to choose the folder notes are saved to. */
    async pickFolder() {
        const handle = await window.showDirectoryPicker({ id: 'synesthesia-notes', mode: 'readwrite', startIn: 'documents' });
        await idb('readwrite', (store) => store.put(handle, KEY));
        return handle.name;
    },

    /** Save into the remembered folder (asking for one the first time). Never overwrites. */
    async save(filename, blob) {
        let folder = await getFolder();
        if (!folder) {
            await storage.pickFolder();
            folder = await getFolder();
        }
        if (!(await ensurePermission(folder))) throw new Error('Permission to save to the folder was not granted.');
        const name = await uniqueName(folder, filename);
        const file = await folder.getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(blob);
        await writable.close();
        return { filename: name, location: folder.name };
    },

    /** Pick a file to open, starting in the remembered folder. */
    async open({ accept = { 'application/json': ['.json'] }, description = 'Synesthesia notes' } = {}) {
        const folder = await getFolder();
        const [handle] = await window.showOpenFilePicker({
            id: 'synesthesia-open',
            startIn: folder ?? 'documents',
            types: [{ description, accept }],
        });
        return handle.getFile();
    },
};

export default storage;
