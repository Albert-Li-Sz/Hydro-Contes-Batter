import { ResolverView } from './render/resolver-view.js';
import { actionIndicesFor } from './playback-model.js';

const runtime = JSON.parse(document.getElementById('resolver-runtime').textContent);
const form = document.getElementById('resolver-form');
const message = document.getElementById('message');
const startButton = document.getElementById('start-btn');
const previewStatus = document.getElementById('preview-status');
let view;
let game;
let actions = [];
let position = 0;
let requestNumber = 0;
let previewController;
let debounceTimer;
let lastFrame = performance.now();

function showError(error) {
    message.textContent = error.message || String(error);
    message.hidden = false;
}

async function request(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = typeof data.error === 'string' ? data.error : data.error?.message;
        throw new Error(detail || `请求失败（${response.status}），请检查登录状态`);
    }
    return data;
}

function readConfig() {
    const result = {};
    for (const [key, initial] of Object.entries(runtime.config)) {
        const field = form.elements.namedItem(key);
        if (field.type === 'checkbox') result[key] = field.checked;
        else if (field.type === 'number') result[key] = field.value === '' ? null : Number(field.value);
        else result[key] = field.value ?? initial;
    }
    return result;
}

function updateFreeze() {
    const custom = form.elements.freezeMode.value === 'custom';
    const field = form.elements.freezeAtSeconds;
    field.disabled = !custom;
    field.required = custom;
    field.max = runtime.durationSeconds - 1;
    if (!custom) field.value = runtime.contestFreezeAtSeconds ?? '';
    document.getElementById('freeze-hint').textContent = custom
        ? `有效范围为 0 至 ${runtime.durationSeconds - 1} 秒，仅作用于本次滚榜`
        : runtime.contestFreezeAtSeconds === null ? '比赛尚未设置封榜时间，请选择自定义' : `比赛开始后 ${runtime.contestFreezeAtSeconds} 秒封榜`;
    document.getElementById('rehearsal-note').hidden = runtime.ended && !form.elements.rehearsal.checked;
}

function updateStats(overview) {
    for (const [id, key] of Object.entries({ teams: 'teamCount', official: 'officialCount', problems: 'problemCount', pending: 'pendingCount' })) {
        document.getElementById(`stat-${id}`).textContent = overview[key] ?? '—';
    }
}

function updateOverview(overview) {
    updateStats(overview);
    document.getElementById('snapshot-time').textContent = `封榜时长 ${overview.durationSeconds - overview.freezeAtSeconds} 秒 · 数据读取于 ${new Date(overview.capturedAt).toLocaleString('zh-CN')}`;
    const warning = document.getElementById('unjudged-note');
    warning.hidden = !overview.unjudgedCount;
    warning.textContent = `本次彩排忽略 ${overview.unjudgedCount} 条尚未完成评测的提交`;
    document.getElementById('rehearsal-note').hidden = !overview.rehearsal;
}

function showPreviewPosition() {
    document.getElementById('preview-progress').textContent = game ? `${position + 1} / ${actions.length}` : '0 / 0';
    document.getElementById('preview-prev').disabled = !game || position <= 0;
    document.getElementById('preview-next').disabled = !game || position >= actions.length - 1;
    document.getElementById('preview-reset').disabled = !game;
}

function resetPreview() {
    if (!game) return;
    const index = game.steps.findIndex((step) => step.type === 'presentation' && step.screen === 'scoreboard');
    position = Math.max(0, actions.indexOf(index));
    view.seek(game.steps, actions[position]);
    showPreviewPosition();
}

async function refreshPreview() {
    const number = ++requestNumber;
    previewController?.abort();
    previewController = new AbortController();
    startButton.disabled = true;
    previewStatus.textContent = '正在读取比赛数据…';
    previewStatus.dataset.state = 'loading';
    message.hidden = true;
    try {
        const data = await request(`${runtime.base}/preview`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: JSON.stringify(readConfig()) }), signal: previewController.signal,
        });
        if (number !== requestNumber) return;
        updateOverview(data.overview);
        view?.dispose();
        game = data.game;
        actions = actionIndicesFor(game.steps);
        view = new ResolverView(document.getElementById('preview-screen'), game);
        await view.ready();
        if (number !== requestNumber) return;
        resetPreview();
        previewStatus.textContent = '预览已更新';
        previewStatus.dataset.state = 'ready';
        startButton.disabled = false;
    } catch (error) {
        if (error.name === 'AbortError' || number !== requestNumber) return;
        previewStatus.textContent = error.message;
        previewStatus.dataset.state = 'error';
        showError(error);
        game = null;
        view?.dispose();
        view = null;
        const canvas = document.getElementById('preview-screen');
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        showPreviewPosition();
    }
}

async function loadSessions() {
    const list = document.getElementById('session-list');
    try {
        const data = await request(`${runtime.base}/sessions`);
        list.replaceChildren();
        if (!data.sessions.length) {
            list.textContent = '还没有滚榜会话';
            return;
        }
        for (const session of data.sessions) {
            const row = document.createElement('div');
            row.className = 'resolver-session';
            const info = document.createElement('div');
            info.className = 'resolver-session-info';
            const title = document.createElement('strong');
            const board = runtime.boards.find((item) => item.id === session.config.boardId);
            title.textContent = `${board?.name || session.config.boardId} · ${session.config.rehearsal ? '彩排' : '正式滚榜'}`;
            const detail = document.createElement('small');
            detail.textContent = `${new Date(session.createdAt).toLocaleString('zh-CN')} · ${session.overview.teamCount} 支队伍 · ${session.config.mode === 'official' ? '分榜正式，其余非正式' : '仅滚所选榜单'}`;
            info.append(title, detail);
            const link = document.createElement('a');
            link.className = 'button';
            link.href = `${runtime.base}/sessions/${session.id}`;
            link.textContent = '继续滚榜';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'button';
            remove.textContent = '删除';
            remove.setAttribute('aria-label', `删除 ${title.textContent}`);
            remove.addEventListener('click', async () => {
                const dialog = document.getElementById('resolver-delete-confirm');
                dialog.returnValue = '';
                const confirmed = new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), { once: true }));
                dialog.showModal();
                if (!await confirmed) return;
                remove.disabled = true;
                try {
                    await request(`${runtime.base}/sessions/${session.id}/delete`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
                    });
                    await loadSessions();
                } catch (error) { showError(error); remove.disabled = false; }
            });
            row.append(info, link, remove);
            list.append(row);
        }
    } catch (error) { showError(error); }
}

document.getElementById('contest-title').textContent = runtime.title;
document.getElementById('back-link').href = runtime.contestUrl;
const select = form.elements.boardId;
for (const board of runtime.boards) select.add(new Option(board.name, board.id));
for (const [key, value] of Object.entries(runtime.config)) {
    const field = form.elements.namedItem(key);
    if (field.type === 'checkbox') field.checked = value;
    else field.value = value ?? '';
}
if (!runtime.ended) {
    form.elements.rehearsal.disabled = true;
    document.getElementById('rehearsal-hint').textContent = '比赛尚未结束，当前只能彩排';
}
updateFreeze();
updateStats(runtime.initialStats || {});
form.addEventListener('input', (event) => {
    if (event.target.name === 'boardId') {
        const board = runtime.boards.find((item) => item.id === select.value);
        for (const tier of ['gold', 'silver', 'bronze']) form.elements[`${tier}Count`].value = board.medals[tier];
    }
    updateFreeze();
    clearTimeout(debounceTimer);
    startButton.disabled = true;
    debounceTimer = setTimeout(refreshPreview, 300);
});
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    clearTimeout(debounceTimer);
    previewController?.abort();
    ++requestNumber;
    startButton.disabled = true;
    startButton.textContent = '正在创建…';
    message.hidden = true;
    try {
        const data = await request(`${runtime.base}/sessions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: JSON.stringify(readConfig()) }),
        });
        updateOverview(data.overview);
        location.assign(data.url);
    } catch (error) {
        showError(error);
        startButton.disabled = false;
        startButton.textContent = '开始滚榜';
    }
});
document.getElementById('refresh-preview').addEventListener('click', refreshPreview);
document.getElementById('refresh-sessions').addEventListener('click', loadSessions);
document.getElementById('preview-reset').addEventListener('click', resetPreview);
document.getElementById('preview-prev').addEventListener('click', () => {
    if (!game || position <= 0) return;
    view.seek(game.steps, actions[--position]);
    showPreviewPosition();
});
document.getElementById('preview-next').addEventListener('click', () => {
    if (!game || position >= actions.length - 1) return;
    view.applyStep(game.steps[actions[++position]]);
    showPreviewPosition();
});
function frame(now) {
    if (view) {
        view.update(Math.min(64, now - lastFrame));
        view.render(now);
    }
    lastFrame = now;
    requestAnimationFrame(frame);
}
window.addEventListener('pagehide', () => { previewController?.abort(); view?.dispose(); });
showPreviewPosition();
refreshPreview();
loadSessions();
requestAnimationFrame(frame);
