// /manage judge control: judge accounts, their configs (a new password per copy) and dispatch rules.
import {
    $, adminPassword, copyText, el, field, formatTime, get, input, notify, openDialog, post, runtime,
} from './hydro-manage-common.js';

const state = { judges: [], selected: new Set(), queued: 0, rejudges: 0, builtin: [] };
const scopes = new Map(runtime.scopes);
const langNames = new Map(runtime.langs);

const status = el('p', { class: 'resolver-muted', role: 'status', hidden: true });
const stats = el('div', { class: 'resolver-stats' });
const table = el('table', { class: 'data-table' });
const deleteButton = el('button', { class: 'button', type: 'button', text: '删除所选', disabled: true });
const uname = input({ placeholder: '例如 judge-1', maxlength: 31, required: true, pattern: '[A-Za-z][\\w\\-]{2,30}', 'aria-label': '评测机账号' });
const note = input({ placeholder: '备注（可选），如机房位置、配置', maxlength: 200, 'aria-label': '备注' });

$('manage-root').replaceChildren(
    el('p', { class: 'resolver-muted', text: '每台独立评测机（hydrojudge）使用一个评测账号登录 Hydro。添加后会生成 judge.yaml 配置；每次“复制配置”都会为该账号生成新密码，之前复制的配置随即失效，已连接的评测机不受影响，重启后需使用新配置。' }),
    stats,
    el('div', { class: 'manage-group' }, el('h3', { text: '添加评测机' }),
        el('form', { class: 'manage-toolbar', onsubmit: (event) => { event.preventDefault(); create(); } },
            uname, note, el('button', { class: 'button primary', type: 'submit', text: '添加并复制配置' }))),
    el('div', { class: 'manage-group' },
        el('div', { class: 'manage-toolbar' }, el('h3', { text: '评测机', style: 'margin:0' }), el('span', { class: 'manage-spacer' }), deleteButton),
        status,
        el('div', { class: 'manage-scroll' }, table)),
    el('div', { class: 'manage-group' }, el('h3', { text: '负载均衡说明' }),
        el('ul', { class: 'resolver-muted' },
            el('li', { text: 'Hydro 的评测队列由评测机主动领取：每台评测机按优先级领取与其条件匹配的任务，直到达到并发数。' }),
            el('li', { text: '并发上限：限制该评测机同时评测的任务数（不超过评测机自身配置）。性能强的机器设置更高的上限，即可分得更多任务。' }),
            el('li', { text: '语言：只领取所选语言的提交，可把 Java、Python 等较慢语言集中到指定机器。不选表示接受评测机支持的全部语言。' }),
            el('li', { text: '任务范围：可让部分机器只评新提交，其余机器处理批量重测，避免重测拖慢比赛中的评测。' }),
            el('li', { text: '暂停：评测机保持连接并完成手头任务，但不再领取新任务。设置保存后立即对所有已连接的评测机生效。' }),
            el('li', { text: '内置评测（hydrojudge 插件，与 Hydro 同进程运行）不经过评测账号，不受这里的设置影响。' }))),
);

const scopeText = (rule) => scopes.get(rule.scope) || rule.scope;
const ruleSummary = (rule) => {
    const parts = [];
    if (!rule.enabled) parts.push(el('span', { class: 'manage-tag manage-tag--warn', text: '已暂停' }));
    parts.push(el('span', { class: 'manage-tag', text: rule.concurrency ? `并发 ≤ ${rule.concurrency}` : '并发不限' }));
    if (rule.langs.length) parts.push(el('span', { class: 'manage-tag', title: rule.langs.map((lang) => langNames.get(lang) || lang).join('、'), text: `${rule.langs.length} 种语言` }));
    if (rule.scope !== 'all') parts.push(el('span', { class: 'manage-tag', text: scopeText(rule) }));
    return parts;
};

function renderStats() {
    const online = state.judges.filter((judge) => judge.connections.length).length;
    const busy = state.judges.reduce((sum, judge) => sum + judge.connections.reduce((total, connection) => total + connection.active, 0), 0);
    stats.replaceChildren(...[
        [`${online} / ${state.judges.length}`, '在线评测机'],
        [busy, '正在评测'],
        [state.queued, '排队任务'],
        [state.rejudges, '其中重测任务'],
    ].map(([value, label]) => el('div', {}, el('strong', { text: value }), el('span', { text: label }))));
}

function renderTable() {
    const all = el('input', { type: 'checkbox', 'aria-label': '选择全部评测机' });
    all.checked = state.judges.length > 0 && state.judges.every((judge) => state.selected.has(judge._id));
    all.addEventListener('change', () => {
        for (const judge of state.judges) if (all.checked) state.selected.add(judge._id); else state.selected.delete(judge._id);
        renderTable();
    });
    deleteButton.disabled = !state.selected.size;
    deleteButton.textContent = state.selected.size ? `删除所选（${state.selected.size}）` : '删除所选';
    table.replaceChildren(
        el('thead', {}, el('tr', {}, el('th', { class: 'col-check' }, all), ...['账号', '状态', '正在评测', '分流规则', '最近登录'].map((text) => el('th', { text })), el('th', { class: 'col-actions', text: '操作' }))),
        el('tbody', {}, ...state.judges.length ? state.judges.map((judge) => {
            const box = el('input', { type: 'checkbox', 'aria-label': `选择 ${judge.uname}` });
            box.checked = state.selected.has(judge._id);
            box.addEventListener('change', () => { if (box.checked) state.selected.add(judge._id); else state.selected.delete(judge._id); renderTable(); });
            const online = judge.connections.length;
            const active = judge.connections.reduce((sum, connection) => sum + connection.active, 0);
            const capacity = judge.connections.reduce((sum, connection) => sum + (connection.concurrency || 1), 0);
            const limit = judge.rule.enabled ? Math.min(capacity, judge.rule.concurrency ? judge.rule.concurrency * online : capacity) : 0;
            return el('tr', { 'data-id': judge._id, class: state.selected.has(judge._id) ? 'is-selected' : undefined },
                el('td', { class: 'col-check' }, box),
                el('td', {}, judge.uname, judge.rule.note ? el('div', { class: 'manage-dim manage-small', text: judge.rule.note }) : null),
                el('td', {}, online
                    ? el('span', { class: 'manage-tag manage-tag--ok', text: online > 1 ? `在线 ×${online}` : '在线', title: judge.connections.map((connection) => connection.ip).filter(Boolean).join('、') })
                    : el('span', { class: 'manage-tag', text: '离线' })),
                el('td', { class: 'manage-nowrap', text: online ? `${active} / ${limit}` : '—', title: online ? `评测机自身并发 ${capacity}` : undefined }),
                el('td', {}, ...ruleSummary(judge.rule)),
                el('td', { class: 'manage-nowrap manage-small', text: formatTime(judge.loginat) }),
                el('td', { class: 'col-actions' },
                    el('button', { class: 'button', type: 'button', text: '复制配置', onclick: () => copyConfig(judge) }),
                    el('button', { class: 'button', type: 'button', text: '设置', onclick: () => editRule(judge) }),
                    el('button', { class: 'button', type: 'button', text: judge.rule.enabled ? '暂停' : '恢复', onclick: () => saveRule(judge, { ...judge.rule, enabled: !judge.rule.enabled }) })),
            );
        }) : [el('tr', {}, el('td', { class: 'manage-empty', colspan: 7, text: '还没有评测机账号，在上方添加一台。' }))]),
    );
}

async function load() {
    try {
        const data = await get();
        Object.assign(state, { judges: data.judges, queued: data.queued, rejudges: data.rejudges, builtin: data.builtin });
        for (const id of [...state.selected]) if (!state.judges.some((judge) => judge._id === id)) state.selected.delete(id);
        renderStats();
        renderTable();
    } catch (error) { notify(status, error.message, true); }
}

function showConfig(title, config, copied) {
    const text = el('textarea', { class: 'textbox manage-config', readonly: true, spellcheck: 'false' });
    text.value = config;
    openDialog({
        title,
        confirm: '完成',
        body: [
            el('p', { class: copied ? 'resolver-muted' : 'manage-error', text: copied ? '配置已复制到剪贴板。保存为评测机上的 ~/.hydro/judge.yaml 后启动 hydrojudge。' : '浏览器未允许自动复制，请手动复制下面的内容。' }),
            text,
            el('p', { class: 'resolver-muted manage-small', text: '再次复制会生成新密码，此配置随即失效。' }),
        ],
    });
    if (!copied) { text.focus(); text.select(); }
}

async function create() {
    if (!uname.reportValidity()) return;
    try {
        const result = await post('create', { uname: uname.value.trim(), note: note.value, origin: location.origin });
        const copied = await copyText(result.config);
        uname.value = '';
        note.value = '';
        notify(status, `已添加评测机 ${result.uname}`);
        showConfig(`评测机 ${result.uname} 的配置`, result.config, copied);
        await load();
    } catch (error) { notify(status, error.message, true); }
}

async function copyConfig(judge) {
    if (judge.connections.length && !confirm(`${judge.uname} 当前在线。复制配置会更换它的密码：已连接的评测机继续工作，但重启后需使用新配置。继续？`)) return;
    try {
        const result = await post('copy', { uid: judge._id, origin: location.origin });
        showConfig(`评测机 ${judge.uname} 的配置（新密码）`, result.config, await copyText(result.config));
    } catch (error) { notify(status, error.message, true); }
}

async function saveRule(judge, rule) {
    try {
        await post('rule', { uid: judge._id, rule });
        notify(status, `已更新 ${judge.uname} 的设置`);
        await load();
    } catch (error) { notify(status, error.message, true); }
}

function editRule(judge) {
    const rule = judge.rule;
    const enabled = el('input', { type: 'checkbox', checked: rule.enabled });
    const concurrency = input({ type: 'number', min: 1, max: 256, step: 1, value: rule.concurrency ?? '', placeholder: '不限（使用评测机自身配置）' });
    const scope = el('select', { class: 'select' }, ...runtime.scopes.map(([value, label]) => new Option(label, value, false, value === rule.scope)));
    const memo = input({ value: rule.note, maxlength: 200 });
    const chosen = new Set(rule.langs);
    const known = [...runtime.langs, ...rule.langs.filter((lang) => !langNames.has(lang)).map((lang) => [lang, lang])];
    const langs = el('div', { class: 'manage-langs' }, ...known.map(([key, label]) => {
        const box = el('input', { type: 'checkbox', value: key, checked: chosen.has(key) });
        return el('label', { title: key }, box, el('span', { text: label }));
    }));
    openDialog({
        title: `评测机 ${judge.uname} 的设置`,
        confirm: '保存并生效',
        body: [el('div', { class: 'resolver-fields' },
            el('label', { class: 'checkbox' }, enabled, '接收新任务（取消即暂停）'),
            field('并发上限', concurrency, '同时评测的任务数，不超过评测机自身配置'),
            field('任务范围', scope),
            el('div', {}, '只评测这些语言', el('span', { class: 'resolver-muted manage-small', text: '（不选表示全部语言）' }), langs),
            field('备注', memo))],
        submit: async () => {
            await post('rule', {
                uid: judge._id,
                rule: {
                    enabled: enabled.checked, concurrency: concurrency.value === '' ? null : Number(concurrency.value), scope: scope.value, note: memo.value,
                    langs: [...langs.querySelectorAll('input:checked')].map((box) => box.value),
                },
            });
            notify(status, `已更新 ${judge.uname} 的设置`);
            await load();
        },
    });
}

deleteButton.addEventListener('click', () => {
    const judges = state.judges.filter((judge) => state.selected.has(judge._id));
    const password = adminPassword();
    openDialog({
        title: `删除 ${judges.length} 台评测机`,
        confirm: '确认删除',
        body: [
            el('p', { text: '评测账号会被删除，在线的评测机立即断开，其手头任务退回队列由其他评测机评测。' }),
            el('ul', { class: 'manage-list' }, ...judges.map((judge) => el('li', { text: judge.uname }))),
            el('div', { class: 'resolver-fields' }, field('管理员密码', password)),
        ],
        submit: async () => {
            const result = await post('delete', { uids: judges.map((judge) => judge._id), password: password.value });
            state.selected.clear();
            notify(status, `已删除 ${result.deleted.length} 台评测机${result.skipped.length ? `；跳过：${result.skipped.join('；')}` : ''}`, !!result.skipped.length);
            await load();
        },
    });
    password.focus();
});

load();
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) load(); }, 5000);
