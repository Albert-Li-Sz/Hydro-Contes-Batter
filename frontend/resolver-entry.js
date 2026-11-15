const entryIds = ['xcpcio-resolver-entry', 'xcpcio-screens-entry', 'xcpcio-live-entry', 'xcpcio-monitor-entry'];
const entries = (url, { live = true } = {}) => [
    [entryIds[0], url, 'icon-statistics', '滚榜'],
    [entryIds[1], url.replace(/\/resolver$/, '/screens'), 'icon-preview', '大屏'],
    ...live ? [[entryIds[2], url.replace(/\/resolver$/, '/live'), 'icon-play', '直播']] : [],
    [entryIds[3], url.replace(/\/resolver$/, '/monitor'), 'icon-stopwatch', '评测监控'],
];
const removeEntries = () => { for (const id of entryIds) document.getElementById(id)?.remove(); };

/** Add the entries after CCS, including when CCS finishes loading later. */
export function installResolverEntry(url, options = {}) {
    let stopped = false;
    let scheduled = false;
    const update = () => {
        scheduled = false;
        if (stopped) return;
        const currentContest = /\/contest\/([a-f\d]{24})(?:\/|$)/i.exec(location.pathname)?.[1];
        const targetContest = /\/contest\/([a-f\d]{24})\/resolver$/i.exec(url)?.[1];
        const currentDomain = /^\/d\/([^/]+)\//.exec(location.pathname)?.[1];
        const targetDomain = /^\/d\/([^/]+)\//.exec(url)?.[1];
        if (!currentContest || currentContest !== targetContest || (currentDomain && currentDomain !== targetDomain)) {
            removeEntries();
            return;
        }
        const ccs = document.querySelector('#contest-reset');
        const management = document.querySelector(`a[href$="/contest/${currentContest}/management"]`);
        const anchor = (ccs || management)?.closest('li');
        if (!anchor) return;
        // 滚榜, 大屏, 直播 and 评测监控 (same permission), right after CCS / management.
        let previous = anchor;
        for (const [id, href, iconName, label] of entries(url, options)) {
            let entry = document.getElementById(id);
            if (!entry) {
                entry = document.createElement('li');
                entry.id = id;
                entry.className = 'menu__item';
                const link = document.createElement('a');
                link.className = 'menu__link';
                link.href = href;
                link.setAttribute('data-no-instant', '');
                const icon = document.createElement('span');
                icon.className = `icon ${iconName}`;
                link.append(icon, document.createTextNode(` ${label}`));
                entry.append(link);
            }
            if (previous.nextElementSibling !== entry) previous.after(entry);
            previous = entry;
        }
    };
    const observer = new MutationObserver(() => {
        if (!scheduled) {
            scheduled = true;
            queueMicrotask(update);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    update();
    return () => {
        stopped = true;
        observer.disconnect();
        removeEntries();
    };
}
