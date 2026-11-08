// Which implementations are active. This is the only file to edit to swap one.
//
// - A single id picks that implementation.
// - `storage` is a fallback list: the first one the browser supports is used.
// - `sources` lists every source offered on the page (unsupported ones are hidden).
//
// Any key can be overridden for one visit with a query parameter,
// e.g. extract.html?extractor=yin&sources=tab,file

export const config = {
    sources: ['tab', 'file'],
    extractor: 'yin',
    voice: 'tone',
    codec: 'json',
    storage: ['folder', 'download'],
};
