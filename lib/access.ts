/** Run before Hydro constructs its native scoreboard handler and enforces its route checker. */
export function replacementRequest(path: string, querystring: string) {
    const match = /^\/contest\/([a-f\d]{24})\/scoreboard(?:\/(xcpcio-plus))?\/?$/i.exec(path);
    if (!match) return null;
    const query = new URLSearchParams(querystring);
    // Same truthiness as Hydro's Types.Boolean, so every spelling the native handler accepts stays with it.
    const realtime = query.get('realtime');
    if (realtime && !['false', 'off', 'no', '0'].includes(realtime)) return null;
    const explicitView = query.get('view');
    if (explicitView && !['default', 'xcpcio-plus'].includes(explicitView)) return null;
    query.delete('realtime'); query.delete('view');
    return { tid: match[1], enhanced: !!match[2] || explicitView === 'xcpcio-plus', query: query.toString() };
}
