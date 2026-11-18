// 画面采集 management: capture devices (one per seat), their links and status, settings, and a
// preview of any device's screen or webcam for checking the setup before and during the contest.
import {
    $, copyText, el, field, formatTime, get, input, notify, openDialog, post, runtime,
} from './hydro-manage-common.js';
import { CaptureViewer, socketUrl } from './hydro-capture-viewer.js';

const state = { devices: [], teams: [], settings: null, screenNow: false, contest: null, selected: new Set(), filter: 'all', loadFailed: false };
const previews = new Map();
let viewer = null;

$('contest-title').textContent = runtime.title;
$('back-link').href = runtime.contestUrl;

const status = el('p', { class: 'resolver-muted', role: 'status', hidden: true });
const switchBox = el('div', { class: 'manage-alert capture-switch', role: 'status' });
const stats = el('div', { class: 'resolver-stats' });
const settingsBox = el('div');
const table = el('table', { class: 'data-table' });
const grid = el('div', { class: 'capture-grid' });
const filter = el('select', { class: 'select', 'aria-label': '筛选设备', style: 'width:auto;margin:0' },
    new Option('全部设备', 'all'), new Option('在线', 'online'), new Option('离线', 'offline'), new Option('未绑定队伍', 'unbound'));
filter.addEventListener('change', () => { state.filter = filter.value; renderTable(); });

$('manage-root').replaceChildren(
    ...window.isSecureContext ? [] : [el('p', { class: 'manage-alert manage-alert--error', role: 'alert',
        text: '当前地址无法采集屏幕或摄像头。请为选手机配置浏览器信任的 HTTPS 站点，使用 HTTPS 重新打开本页后再复制采集链接。' })],
    switchBox,
    stats,
    el('div', { class: 'manage-group' }, el('h3', { text: '采集设置' }), settingsBox),
    el('div', { class: 'manage-group' },
        el('div', { class: 'manage-toolbar' },
            el('h3', { text: '采集设备', style: 'margin:0' }), el('span', { class: 'manage-spacer' }), filter,
            el('button', { class: 'button primary', type: 'button', text: '按座位批量添加', onclick: () => createFromSeats() }),
            el('button', { class: 'button', type: 'button', text: '添加设备', onclick: () => deviceDialog(null) }),
            el('button', { class: 'button', type: 'button', text: '导出采集链接', onclick: () => exportLinks() }),
            el('button', { class: 'button manage-danger', type: 'button', text: '删除所选', onclick: () => removeSelected() })),
        status,
        el('div', { class: 'manage-scroll' }, table)),
    el('div', { class: 'manage-group' },
        el('div', { class: 'manage-toolbar' }, el('h3', { text: '画面预览', style: 'margin:0' }), el('span', { class: 'manage-spacer' }),
            el('button', { class: 'button', type: 'button', text: '预览在线摄像头', onclick: () => previewAll('webcam') }),
            el('button', { class: 'button', type: 'button', text: '关闭全部预览', onclick: () => closeAll() })),
        el('p', { class: 'resolver-muted manage-small', text: '管理员赛中可预览屏幕。每路预览占用选手机的上传带宽。' }),
        grid),
    el('details', { class: 'manage-group' }, el('summary', { text: '选手端操作' }),
        el('ol', { class: 'resolver-muted', style: 'padding-left:20px;line-height:1.8' },
            el('li', { text: '启用画面采集和入场提示。选手使用 Chrome 或 Edge 登录 HTTPS 比赛地址。' }),
            el('li', { text: '从提示进入采集窗口，点击「开始采集」，选择「整个屏幕」并分享。如启用了摄像头，按浏览器提示授权。' }),
            el('li', { text: '采集期间保持窗口打开。设备会按队伍或座位自动匹配。' })),
        el('p', { class: 'resolver-muted manage-small', text: '使用内置 STUN 时，请放行插件配置中的 UDP 端口（默认 3478）。网络完全隔离时需配置 TURN。' })),
);

const absolute = (path) => new URL(path, location.href).href;
const tag = (text, tone = '') => el('span', { class: `manage-tag ${tone}`, text });
const streamName = { screen: '屏幕', webcam: '摄像头' };

function renderStats() {
    const online = state.devices.filter((device) => device.online);
    stats.replaceChildren(...[
        [state.devices.length, '采集设备'],
        [online.length, '在线'],
        [online.filter((device) => device.streams.includes('screen')).length, '正在采集屏幕'],
        [online.filter((device) => device.streams.includes('webcam')).length, '正在采集摄像头'],
        [state.devices.filter((device) => device.team).length, '已对应队伍'],
    ].map(([value, label]) => el('div', {}, el('strong', { text: value }), el('span', { text: label }))));
}

/** The contest's on/off switch: off by default, so nothing is captured until a manager decides to. */
function renderSwitch() {
    const enabled = state.settings.enabled;
    const toggle = el('button', { class: `button${enabled ? ' manage-danger' : ' primary'}`, type: 'button', text: enabled ? '停用画面采集' : '启用画面采集' });
    toggle.addEventListener('click', () => {
        const apply = async () => {
            await post('settings', { settings: { enabled: !enabled } });
            notify(status, enabled ? '已停用画面采集，所有采集页已断开' : '已启用画面采集，已打开的采集页会在半分钟内自动连接');
            await load();
        };
        if (!enabled) { apply().catch((error) => notify(status, error.message, true)); return; }
        openDialog({
            title: '停用画面采集',
            confirm: '停用',
            body: [el('p', { text: '所有选手机的采集页立即断开，导播台和直播画面中的队伍画面随即停止。采集设备和链接保留，重新启用后自动恢复。' })],
            submit: apply,
        });
    });
    switchBox.classList.toggle('manage-alert--error', !enabled);
    switchBox.replaceChildren(
        el('div', {},
            el('strong', { text: enabled ? '画面采集已启用' : '画面采集未启用' }),
            enabled ? null : el('div', { class: 'manage-small', text: '启用后，已打开的采集页会自动连接。' })),
        toggle,
    );
}

function renderSettings() {
    const settings = { ...state.settings };
    const box = (key, label, hint) => {
        const node = el('input', { type: 'checkbox', checked: settings[key] });
        node.addEventListener('change', () => { settings[key] = node.checked; });
        return el('label', { class: 'checkbox' }, node, label, hint ? el('span', { class: 'resolver-muted manage-small', text: ` ${hint}` }) : null);
    };
    const choice = (key, options) => {
        const node = el('select', { class: 'select' }, ...options.map(([value, label]) => new Option(label, String(value), false, settings[key] === value)));
        node.addEventListener('change', () => { settings[key] = Number(node.value); });
        return node;
    };
    const ice = el('textarea', { class: 'textbox', rows: 3, placeholder: '每行一个，例如\nstun:192.168.1.10:3478\nturn:192.168.1.10:3478 用户名 密码', spellcheck: 'false' });
    ice.value = settings.iceServers.map((server) => [server.urls[0], server.username, server.credential].filter(Boolean).join(' ')).join('\n');
    const saved = el('span', { class: 'resolver-muted', role: 'status' });
    const save = el('button', { class: 'button primary', type: 'button', text: '保存设置' });
    save.addEventListener('click', async () => {
        save.disabled = true;
        try {
            // The on/off switch above has its own button; this form never changes it.
            const { enabled: _enabled, ...rest } = settings;
            const result = await post('settings', { settings: { ...rest, iceServers: ice.value } });
            state.settings = result.settings;
            saved.textContent = `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}，正在采集的选手机立即使用新的设置`;
            saved.classList.remove('manage-error');
            await load();
        } catch (error) { saved.textContent = error.message; saved.classList.add('manage-error'); } finally { save.disabled = false; }
    });
    settingsBox.replaceChildren(
        el('div', { class: 'resolver-checks' },
            box('prompt', '选手进入比赛时弹窗提示开启画面采集'),
            box('webcam', '采集摄像头'),
            box('screenDuringContest', '比赛进行中直播画面可以使用屏幕', '选手能看到直播时请关闭，以免公开选手代码。'),
            box('webcamAudio', '摄像头同时采集声音')),
        el('div', { class: 'resolver-fields resolver-two', style: 'margin-top:12px' },
            field('屏幕分辨率', choice('screenHeight', [[720, '720p（推荐）'], [1080, '1080p']])),
            field('屏幕帧率', choice('screenFps', [[5, '5 帧'], [10, '10 帧'], [15, '15 帧（推荐）'], [30, '30 帧']])),
            field('摄像头分辨率', choice('webcamHeight', [[360, '360p'], [480, '480p（推荐）'], [720, '720p']])),
            field('STUN / TURN 服务器', ice, '选手机和 OBS 电脑在同一局域网时可以留空；不同网段需要 STUN，网络互相隔离时需要 TURN 中转')),
        el('p', { class: 'resolver-muted manage-small', text: state.screenNow ? '当前直播画面可以使用屏幕。' : '当前直播画面不提供屏幕，屏幕在比赛结束后自动提供。' }),
        el('div', { class: 'resolver-actions' }, save, saved),
    );
}

function visibleDevices() {
    return state.devices.filter((device) => state.filter === 'all' || (state.filter === 'online' ? device.online : state.filter === 'offline' ? !device.online : !device.team));
}

function renderTable() {
    const rows = visibleDevices();
    const all = el('input', { type: 'checkbox', 'aria-label': '全选', checked: rows.length > 0 && rows.every((device) => state.selected.has(device.id)) });
    all.addEventListener('change', () => {
        for (const device of rows) if (all.checked) state.selected.add(device.id); else state.selected.delete(device.id);
        renderTable();
    });
    table.replaceChildren(
        el('thead', {}, el('tr', {}, el('th', { class: 'col-check' }, all),
            ...['座位', '名称', '队伍', '状态', '画面', '最近联系', '客户端'].map((text) => el('th', { text })), el('th', { class: 'col-actions', text: '' }))),
        el('tbody', {}, ...rows.length ? rows.map((device) => {
            const box = el('input', { type: 'checkbox', checked: state.selected.has(device.id), 'aria-label': `选择 ${device.name}` });
            box.addEventListener('change', () => { if (box.checked) state.selected.add(device.id); else state.selected.delete(device.id); });
            return el('tr', { class: state.selected.has(device.id) ? 'is-selected' : undefined },
                el('td', { class: 'col-check' }, box),
                el('td', { class: 'manage-nowrap', text: device.seat || '—' }),
                el('td', { text: device.name }),
                el('td', {}, device.team ? device.team.name : el('span', { class: 'manage-dim', text: device.seat ? '没有队伍坐在这个座位' : '未绑定' }),
                    device.teamUid !== null ? el('span', { class: 'manage-tag', text: '手动绑定' }) : null),
                el('td', {}, device.online ? tag('在线', 'manage-tag--ok') : device.lastSeen ? tag('离线', 'manage-tag--bad') : tag('尚未打开', 'manage-tag--warn')),
                el('td', {}, ...device.streams.length ? device.streams.map((stream) => tag(streamName[stream])) : [el('span', { class: 'manage-dim', text: '—' })]),
                el('td', { class: 'manage-nowrap manage-small', text: formatTime(device.lastSeen) }),
                el('td', { class: 'manage-small', text: device.client ? [device.client.ip, device.client.screen && `屏幕 ${device.client.screen}`].filter(Boolean).join(' · ') : '—' }),
                el('td', { class: 'col-actions manage-nowrap' },
                    el('button', { class: 'button', type: 'button', text: '预览', disabled: !device.online, onclick: () => openPreview(device, device.streams.includes('webcam') ? 'webcam' : 'screen') }),
                    el('button', { class: 'button', type: 'button', text: '复制链接', onclick: () => copyLink(device) }),
                    el('button', { class: 'button', type: 'button', text: '设置', onclick: () => deviceDialog(device) }),
                    el('button', { class: 'button', type: 'button', text: '重新生成', onclick: () => regenerate(device) })),
            );
        }) : [el('tr', {}, el('td', { class: 'manage-empty', colspan: 9, text: state.devices.length ? '没有符合条件的设备' : '还没有采集设备。导入座位后点击“按座位批量添加”，或逐台添加。' }))]),
    );
}

async function load() {
    try {
        const data = await get();
        Object.assign(state, { devices: data.devices, teams: data.teams, screenNow: data.screenNow, contest: data.contest });
        const fresh = !state.settings;
        state.settings = data.settings;
        for (const id of [...state.selected]) if (!state.devices.some((device) => device.id === id)) state.selected.delete(id);
        if (state.loadFailed) { notify(status, ''); state.loadFailed = false; }
        renderSwitch();
        renderStats();
        if (fresh) renderSettings();
        renderTable();
    } catch (error) { notify(status, error.message, true); state.loadFailed = true; }
}

async function copyLink(device) {
    const url = absolute(device.url);
    notify(status, (await copyText(url)) ? `已复制 ${device.name} 的采集链接` : `请手动复制：${url}`);
}

function exportLinks() {
    const lines = ['座位,名称,队伍,采集链接', ...state.devices.map((device) => [device.seat, device.name, device.team?.name || '', absolute(device.url)]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))];
    const blob = new Blob([`\ufeff${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const link = el('a', { href: URL.createObjectURL(blob), download: `${runtime.title}-采集链接.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function createFromSeats() {
    try {
        const result = await post('create_from_seats', {});
        notify(status, result.created ? `已为 ${result.created} 个座位添加采集设备（共 ${result.seats} 个座位）` : `${result.seats} 个座位都已有采集设备`);
        await load();
    } catch (error) { notify(status, error.message, true); }
}

function deviceDialog(device) {
    const seat = input({ value: device?.seat || '', maxlength: 32, placeholder: '与 onsite-toolkit 导入的座位号一致，如 A-01' });
    const name = input({ value: device?.name || '', maxlength: 40, placeholder: '留空则使用座位号' });
    const team = el('select', { class: 'select' }, new Option('按座位自动对应', ''),
        ...state.teams.map((item) => new Option(`${item.name}${item.seat ? `（座位 ${item.seat}）` : ''}`, String(item.uid), false, device?.teamUid === item.uid)));
    openDialog({
        title: device ? `采集设备 ${device.name}` : '添加采集设备',
        confirm: device ? '保存' : '添加',
        body: [el('div', { class: 'resolver-fields' },
            field('座位号', seat), field('名称', name),
            field('对应队伍', team, '通常按座位自动对应；没有座位号或座位不准确时可手动指定'))],
        submit: async () => {
            const payload = { seat: seat.value, name: name.value, teamUid: team.value ? Number(team.value) : null };
            if (device) await post('update', { id: device.id, device: payload });
            else await post('create', payload);
            notify(status, device ? `已保存 ${payload.name || payload.seat}` : `已添加 ${payload.name || payload.seat}`);
            await load();
        },
    });
    seat.focus();
}

function regenerate(device) {
    openDialog({
        title: `重新生成 ${device.name} 的采集链接`,
        confirm: '重新生成',
        body: [el('p', { text: device.online ? '这台选手机当前在线，重新生成后采集页会立即断开，需要打开新的链接。' : '原来的采集链接会失效。' })],
        submit: async () => {
            const result = await post('regenerate', { id: device.id });
            notify(status, (await copyText(absolute(result.url))) ? `已重新生成并复制 ${device.name} 的新链接` : `已重新生成：${absolute(result.url)}`);
            await load();
        },
    });
}

function removeSelected() {
    const ids = [...state.selected];
    if (!ids.length) { notify(status, '请先勾选采集设备', true); return; }
    openDialog({
        title: `删除 ${ids.length} 台采集设备`,
        confirm: '删除',
        body: [el('p', { text: '删除后这些选手机的采集页立即断开，链接失效。可以之后重新添加。' })],
        submit: async () => {
            const result = await post('delete', { ids });
            for (const id of ids) closePreview(id);
            state.selected.clear();
            notify(status, `已删除 ${result.deleted} 台采集设备`);
            await load();
        },
    });
}

// ---------------------------------------------------------------- Preview

function ensureViewer() {
    viewer ||= new CaptureViewer(socketUrl(runtime.viewerWs));
    return viewer;
}

function openPreview(device, stream) {
    if (previews.has(device.id)) closePreview(device.id);
    if (previews.size >= 12) { notify(status, '同时最多预览 12 个画面，请先关闭一些', true); return; }
    const video = el('video', { muted: true, autoplay: true, playsinline: true });
    video.muted = true;
    const stateLine = el('div', { class: 'capture-state', text: '正在连接…' });
    const switcher = el('select', { class: 'select', style: 'width:auto;margin:0;height:auto;padding:0 4px;font-size:12px' },
        ...['webcam', 'screen'].map((value) => new Option(streamName[value], value, false, value === stream)));
    switcher.addEventListener('change', () => openPreview(device, switcher.value));
    const close = el('button', { class: 'link', type: 'button', text: '关闭', style: 'color:#fff', onclick: () => closePreview(device.id) });
    const tile = el('div', { class: 'capture-preview' }, video, stateLine,
        el('div', { class: 'capture-caption' }, el('span', { text: `${device.name}${device.team ? ` · ${device.team.name}` : ''}` }), el('span', {}, switcher, ' ', close)));
    grid.append(tile);
    const handle = ensureViewer().watch(device.id, stream, video, (value) => {
        stateLine.textContent = value === 'playing' ? '' : value === 'connecting' ? '正在连接…' : value;
        stateLine.hidden = value === 'playing';
    });
    previews.set(device.id, { tile, handle });
}

function closePreview(id) {
    const preview = previews.get(id);
    if (!preview) return;
    preview.handle.stop();
    preview.tile.remove();
    previews.delete(id);
}

function closeAll() {
    for (const id of [...previews.keys()]) closePreview(id);
}

function previewAll(stream) {
    const online = state.devices.filter((device) => device.online && device.streams.includes(stream)).slice(0, 12);
    if (!online.length) { notify(status, '没有在线并正在采集摄像头的设备', true); return; }
    for (const device of online) openPreview(device, stream);
}

window.addEventListener('beforeunload', () => { closeAll(); viewer?.close(); });
load();
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) load(); }, 4000);
