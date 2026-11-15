// Contest judge monitoring page: polls the plugin's monitor data and redraws (text only, no HTML).
const runtime = JSON.parse(document.getElementById('monitor-runtime').textContent);
const $ = (id) => document.getElementById(id);
const recordBase = runtime.contestUrl.replace(/\/contest\/[^/]+$/, '/record/');

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
}

const duration = (seconds) => {
    if (seconds == null) return '—';
    if (seconds < 60) return `${Math.round(seconds)} 秒`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes} 分 ${Math.floor(seconds % 60)} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
};

function card(label, value, note = '', level = '') {
    return el('div', { class: `monitor-card${level ? ` monitor-${level}` : ''}` },
        el('div', { class: 'monitor-card__value', text: String(value) }),
        el('div', { class: 'monitor-card__label', text: label }),
        ...note ? [el('div', { class: 'monitor-card__note', text: note })] : []);
}

function recordLink(id) {
    return el('a', { href: `${recordBase}${id}`, target: '_blank', rel: 'noopener', text: id.slice(-6) });
}

function rows(tbody, items, empty, build) {
    tbody.replaceChildren(...(items.length ? items.map(build) : [el('tr', {}, el('td', { colspan: '6', class: 'resolver-muted', text: empty }))]));
}

function chart(svg, timeline) {
    const width = 720;
    const height = 140;
    const top = 16; // room for the scale label above the bars
    const max = Math.max(1, ...timeline.map((bucket) => bucket.submitted));
    const step = width / Math.max(1, timeline.length);
    svg.setAttribute('viewBox', `0 0 ${width} ${height + 18}`);
    const scale = (value) => (value / max) * (height - top);
    const NS = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs, text) => {
        const node = document.createElementNS(NS, tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
        if (text) node.textContent = text;
        return node;
    };
    const nodes = [];
    timeline.forEach((bucket, index) => {
        const x = index * step + 1;
        const w = Math.max(1, step - 2);
        const total = scale(bucket.submitted);
        const ok = scale(bucket.accepted);
        const bar = make('rect', { x, y: height - total, width: w, height: total, class: 'monitor-bar' });
        bar.append(make('title', {}, `第 ${bucket.minute} 分钟：提交 ${bucket.submitted}，通过 ${bucket.accepted}`));
        nodes.push(bar, make('rect', { x, y: height - ok, width: w, height: ok, class: 'monitor-bar--ok' }));
    });
    if (timeline.length) {
        nodes.push(make('text', { x: 0, y: height + 14, class: 'monitor-axis' }, `第 ${timeline[0].minute} 分钟`));
        nodes.push(make('text', { x: width, y: height + 14, class: 'monitor-axis', 'text-anchor': 'end' }, `第 ${timeline.at(-1).minute} 分钟`));
        nodes.push(make('text', { x: 4, y: 12, class: 'monitor-axis' }, `最多 ${max}`));
    }
    svg.replaceChildren(...nodes);
}

function render(data) {
    const s = data.summary;
    $('alerts').replaceChildren(...data.alerts.map((alert) => el('li', { class: `monitor-alert monitor-${alert.level}`, text: alert.text })));
    $('cards').replaceChildren(
        card('待评测', s.pending, `全站评测队列 ${s.queueLength}`, s.pending ? 'warning' : ''),
        card('最久等待', duration(s.oldestPendingSeconds), '', s.oldestPendingSeconds > 180 ? 'error' : ''),
        card('平均评测耗时', duration(s.averageLatencySeconds), `P95 ${duration(s.p95LatencySeconds)} · 最近 15 分钟 ${s.judgedRecently} 条`),
        card('系统错误', s.systemErrors, '', s.systemErrors ? 'error' : ''),
        card('在线评测机', `${s.judgesOnline}/${data.judges.length}`, '', s.judgesOnline ? '' : 'error'),
        card('提交 / 通过', `${s.total} / ${s.accepted}`),
    );
    chart($('chart'), data.timeline);
    rows($('pending'), data.pending, '没有待评测的提交', (item) => el('tr', {},
        el('td', {}, recordLink(item.id)), el('td', { text: item.team }), el('td', { text: item.problem }),
        el('td', { text: item.lang }), el('td', { text: item.status }),
        el('td', { class: item.ageSeconds > 180 ? 'monitor-late' : '', text: duration(item.ageSeconds) })));
    const shown = data.categories.filter((category) => data.perProblem.some((problem) => problem.counts[category.key]));
    $('problems').replaceChildren(
        el('thead', {}, el('tr', {}, el('th', { text: '题目' }), el('th', { text: '提交' }), el('th', { text: '通过队数' }),
            ...shown.map((category) => el('th', { text: category.label })))),
        el('tbody', {}, ...data.perProblem.map((problem) => el('tr', {},
            el('td', { text: problem.label }), el('td', { text: String(problem.total) }), el('td', { text: String(problem.solvedTeams) }),
            ...shown.map((category) => el('td', {
                class: category.key === 'SE' && problem.counts.SE ? 'monitor-late' : '',
                text: String(problem.counts[category.key] || 0),
            }))))),
    );
    rows($('judges'), data.judges, 'Hydro 没有收到评测机上报', (judge) => el('tr', {},
        el('td', { text: judge.mid }), el('td', { class: judge.online ? 'monitor-online' : 'monitor-late', text: judge.online ? '在线' : '离线' }),
        el('td', { text: `${duration(judge.lastSeenSeconds)}前` })));
    rows($('languages'), data.languages, '还没有提交', (item) => el('tr', {}, el('td', { text: item.lang }), el('td', { text: String(item.count) })));
    rows($('system-errors'), data.systemErrors, '没有系统错误', (item) => el('tr', {},
        el('td', {}, recordLink(item.id)), el('td', { text: item.team }), el('td', { text: item.problem }), el('td', { text: item.lang })));
    $('updated').textContent = `更新于 ${new Date(data.now).toLocaleTimeString('zh-CN')}`;
}

async function poll() {
    try {
        const response = await fetch(runtime.dataUrl, { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        render(await response.json());
    } catch (error) {
        $('updated').textContent = `更新失败（${error.message || error}），稍后重试`;
    } finally {
        setTimeout(poll, runtime.refreshMs);
    }
}

$('contest-title').textContent = runtime.title;
$('back-link').href = runtime.contestUrl;
poll();
