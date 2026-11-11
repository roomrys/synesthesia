// Song details guessed from where the audio came from (a file name or a tab title).
// Only a starting point: the page shows the guesses in editable fields.

// Browsers sometimes label a shared tab with an internal id instead of its title.
const NOT_A_TITLE = /^(web-contents-media-stream|screen:|window:|browser tab$)/i;

// Bracketed extras that aren't part of the song name: "(Official Video)", "[HD]", …
const EXTRAS = /\s*[([][^)\]]*\b(official|video|audio|lyrics?|hd|hq|4k|remaster(ed)?|visuali[sz]er|explicit)\b[^)\]]*[)\]]/gi;

const DASH = /\s+[-–—]\s+/;

/**
 * Guess { song, artist } from a label. Returns null when the label tells us nothing.
 * Handles "Artist - Song", "Song – song by Artist", a trailing " - Site" or " | Site",
 * file extensions, underscores and bracketed extras.
 */
export function guessSongInfo(label, { isFile = false } = {}) {
    let text = String(label ?? '').trim();
    if (!text || NOT_A_TITLE.test(text)) return null;
    if (isFile) text = text.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_+/g, ' ');
    text = text.replace(/^\(\d+\)\s*/, '');               // unread-count prefix, e.g. "(3) "
    text = text.split(/\s+\|\s+/)[0];                      // "… | Site"
    text = text.replace(EXTRAS, '').replace(/\s{2,}/g, ' ').trim();

    const songBy = /^(.*?)\s+[-–—]\s+song(?: and lyrics)? by\s+(.*)$/i.exec(text);
    if (songBy) return { song: songBy[1].trim(), artist: songBy[2].trim() };

    let parts = text.split(DASH).map((p) => p.trim()).filter(Boolean);
    // Drop a trailing one-word site name: "Artist - Song - Site".
    if (parts.length >= 3 && /^\S{1,15}$/.test(parts[parts.length - 1])) parts = parts.slice(0, -1);
    if (parts.length === 2) return { artist: parts[0], song: parts[1] };
    if (!parts.length) return null;
    return { song: parts.join(' - '), artist: '' };
}
