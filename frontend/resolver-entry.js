/** Add one entry after CCS, including when CCS finishes loading later. */
export function installResolverEntry(url) {
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
            document.getElementById('xcpcio-resolver-entry')?.remove();
            return;
        }
        const ccs = document.querySelector('#contest-reset');
        const management = document.querySelector(`a[href$="/contest/${currentContest}/management"]`);
        const anchor = (ccs || management)?.closest('li');
        if (!anchor) return;
        let entry = document.getElementById('xcpcio-resolver-entry');
        if (!entry) {
            entry = document.createElement('li');
            entry.id = 'xcpcio-resolver-entry';
            entry.className = 'menu__item';
            const link = document.createElement('a');
            link.className = 'menu__link';
            link.href = url;
            link.setAttribute('data-no-instant', '');
            const icon = document.createElement('span');
            icon.className = 'icon icon-statistics';
            link.append(icon, document.createTextNode(' 滚榜'));
            entry.append(link);
        }
        if (anchor.nextElementSibling !== entry) anchor.after(entry);
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
        document.getElementById('xcpcio-resolver-entry')?.remove();
    };
}
