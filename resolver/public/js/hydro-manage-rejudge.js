// /manage batch rejudge: a contest, chosen problems (searched by number, id or title) or a whole
// domain, filtered by results, with accepted submissions optionally kept.
import { $, adminPassword, el, field, formatTime, get, input, notify, openDialog, post, runtime } from './hydro-manage-common.js';

const statusLabel = new Map(runtime.statuses.map(([code, short, label]) => [code, `${short} ${label}`]));
const state = { domain: runtime.domainId, scope: 'contest', contests: [], problems: [], picked: new Map() };
const scopes = [['contest', '按比赛'], ['problems', '按题目'], ['domain', '整个域']];

const status = el('p', { class: 'resolver-muted', role: 'status', hidden: true });
const domain = input({ value: runtime.domainId, 'aria-label': '域 ID', required: true });
const contest = el('select', { class: 'select', 'aria-label': '比赛' });
const skipAccepted = el('input', { type: 'checkbox', checked: true });
const statuses = el('div', { class: 'manage-statuses' }, ...runtime.statuses.map(([code, short, label]) => el('label', {},
    el('input', { type: 'checkbox', value: code }), el('span', { text: `${short} ${label}` }))));
const result = el('div');

// Scope: contest problems, searched problems, or everything in the domain.
const scopeBox = el('div', { class: 'manage-tabs', role: 'radiogroup', 'aria-label': '重测范围' });
const contestPanel = el('div');
const problemPanel = el('div');
const domainPanel = el('div', { class: 'manage-alert manage-alert--error' },
    el('strong', { text: '将重测整个域的全部提交' }),
    el('div', { text: '包括比赛内外的所有提交（已取消、Hack、自测与数据生成除外），仍按下方的结果类型与“AC 不参与重测”筛选。数量可能很大，评测队列会被占用较长时间；开始前需要输入管理员密码。' }));
const contestProblems = el('div');
const search = input({ type: 'search', placeholder: '输入题号、题目 ID 或标题搜索，如 1001、P1001、最短路', 'aria-label': '搜索题目', autocomplete: 'off' });
const searchResults = el('ul', { class: 'manage-search', role: 'listbox', hidden: true });
const picked = el('div', { class: 'manage-picked' });

for (const [value, label] of scopes) {
    scopeBox.append(el('button', { type: 'button', role: 'radio', text: label, 'data-scope': value, onclick: () => setScope(value) }));
}

const quick = (text, codes) => el('button', {
    class: 'link', type: 'button', text,
    onclick: () => { for (const box of statuses.querySelectorAll('input')) box.checked = codes.includes(Number(box.value)); syncAccepted(); },
});

contestPanel.append(
    el('div', { class: 'resolver-fields' }, field('比赛', contest)),
    el('h3', {}, '题目',
        el('span', { class: 'manage-quick' },
            el('button', { class: 'link', type: 'button', text: '全选', onclick: () => checkProblems(true) }),
            el('button', { class: 'link', type: 'button', text: '清空', onclick: () => checkProblems(false) }))),
    contestProblems,
);
problemPanel.append(
    el('p', { class: 'resolver-muted manage-small', text: '搜索并点选题目，可多选；重测这些题目在该域内的全部提交（含比赛内的提交）。' }),
    el('div', { class: 'manage-search-box' }, search, searchResults),
    picked,
);

$('manage-root').replaceChildren(
    el('p', { class: 'resolver-muted', text: '按比赛、题目或整个域批量重测，与 Hydro 题目页的“重测”相同：重测任务优先级低于新提交，比赛中的提交按比赛设置显示结果。重测提交后榜单会随新结果更新。' }),
    el('div', { class: 'manage-group' }, el('h3', { text: '域' }),
        el('form', { class: 'manage-toolbar', onsubmit: (event) => { event.preventDefault(); loadContests(); } },
            domain, el('button', { class: 'button', type: 'submit', text: '切换域' }))),
    el('div', { class: 'manage-group' }, el('h3', { text: '范围' }), scopeBox, contestPanel, problemPanel, domainPanel),
    el('div', { class: 'manage-group' }, el('h3', {}, '评测结果',
        el('span', { class: 'manage-quick' },
            quick('常见错误', [2, 3, 4, 5, 6]), quick('TLE / MLE', [3, 4]), quick('系统错误', [8, 10]), quick('清空（全部结果）', []))),
        el('p', { class: 'resolver-muted manage-small', text: '不选表示全部结果（已取消的提交始终不重测）。' }),
        statuses,
        el('label', { class: 'checkbox', style: 'margin-top:12px' }, skipAccepted, 'AC 不参与重测（已通过的提交保持原结果）')),
    status,
    el('div', { class: 'resolver-actions' },
        el('button', { class: 'button', type: 'button', text: '预览数量', onclick: () => preview() }),
        el('button', { class: 'button primary', type: 'button', text: '开始重测', onclick: () => run() })),
    result,
);

function setScope(scope) {
    state.scope = scope;
    for (const button of scopeBox.children) {
        button.setAttribute('aria-checked', String(button.dataset.scope === scope));
        button.setAttribute('aria-selected', String(button.dataset.scope === scope));
    }
    contestPanel.hidden = scope !== 'contest';
    problemPanel.hidden = scope !== 'problems';
    domainPanel.hidden = scope !== 'domain';
    result.replaceChildren();
    notify(status, '');
}

function syncAccepted() {
    const accepted = statuses.querySelector('input[value="1"]');
    if (accepted.checked && skipAccepted.checked) skipAccepted.checked = false;
}
statuses.querySelector('input[value="1"]').addEventListener('change', syncAccepted);
skipAccepted.addEventListener('change', () => { if (skipAccepted.checked) statuses.querySelector('input[value="1"]').checked = false; });

function checkProblems(checked) {
    for (const box of contestProblems.querySelectorAll('input[type=checkbox]')) box.checked = checked;
}

function renderContestProblems() {
    if (!contest.value) {
        contestProblems.replaceChildren(el('p', { class: 'resolver-muted', text: state.contests.length ? '请选择比赛' : `域 ${state.domain} 中没有比赛，可改为“按题目”或“整个域”` }));
        return;
    }
    contestProblems.replaceChildren(
        el('p', { class: 'resolver-muted manage-small', text: '不选表示比赛的全部题目。' }),
        el('div', { class: 'manage-problems' }, ...state.problems.map((problem) => el('label', { title: problem.title },
            el('input', { type: 'checkbox', value: problem.pid }), el('strong', { text: problem.label }), el('span', { text: problem.title })))),
    );
}

const problemName = (problem) => `${problem.pid || `#${problem.docId}`} ${problem.title}`;

function renderPicked() {
    picked.replaceChildren(...state.picked.size ? [...state.picked.values()].map((problem) => el('span', { class: 'manage-tag manage-chip' },
        el('span', { text: problemName(problem) }),
        el('button', { type: 'button', class: 'manage-chip__remove', 'aria-label': `移除 ${problemName(problem)}`, text: '×', onclick: () => { state.picked.delete(problem.docId); renderPicked(); renderResults(lastResults); } })))
        : [el('span', { class: 'resolver-muted manage-small', text: '尚未选择题目' })]);
}

let lastResults = [];
function renderResults(problems) {
    lastResults = problems;
    searchResults.hidden = !search.value.trim();
    searchResults.replaceChildren(...problems.length ? problems.map((problem, index) => {
        const chosen = state.picked.has(problem.docId);
        return el('li', {
            role: 'option', 'aria-selected': String(chosen), tabindex: '-1', 'data-index': index, class: chosen ? 'is-picked' : undefined,
            onmousedown: (event) => event.preventDefault(),
            onclick: () => toggle(problem),
        }, el('strong', { text: problem.pid || `#${problem.docId}` }), el('span', { text: problem.title }), el('small', { text: chosen ? '已选' : `#${problem.docId}` }));
    }) : [el('li', { class: 'manage-dim', text: '没有匹配的题目' })]);
}

function toggle(problem) {
    if (state.picked.has(problem.docId)) state.picked.delete(problem.docId);
    else state.picked.set(problem.docId, problem);
    renderPicked();
    renderResults(lastResults);
}

let searchTimer = 0;
let searchSeq = 0;
search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    if (!search.value.trim()) { renderResults([]); return; }
    searchTimer = setTimeout(async () => {
        const seq = ++searchSeq;
        try {
            const data = await get({ domain: state.domain, search: search.value.trim() });
            if (seq === searchSeq) renderResults(data.problems);
        } catch (error) { notify(status, error.message, true); }
    }, 200);
});
search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (lastResults.length) toggle(lastResults[0]);
    } else if (event.key === 'Escape') { search.value = ''; renderResults([]); }
});
search.addEventListener('blur', () => { setTimeout(() => { searchResults.hidden = true; }, 150); });
search.addEventListener('focus', () => { if (search.value.trim()) searchResults.hidden = false; });

async function loadContests() {
    if (!domain.reportValidity()) return;
    try {
        const data = await get({ domain: domain.value.trim() });
        const changed = data.domainId !== state.domain;
        state.domain = data.domainId;
        state.contests = data.contests;
        contest.replaceChildren(new Option(data.contests.length ? '请选择比赛' : '（没有比赛）', ''), ...data.contests.map((tdoc) => new Option(
            `${tdoc.title} · ${tdoc.rule.toUpperCase()} · ${formatTime(tdoc.beginAt)} · ${tdoc.problems} 题`, tdoc.id)));
        state.problems = [];
        if (changed) { state.picked.clear(); renderPicked(); search.value = ''; renderResults([]); }
        renderContestProblems();
        notify(status, '');
    } catch (error) { notify(status, error.message, true); }
}

contest.addEventListener('change', async () => {
    state.problems = [];
    if (contest.value) {
        try { state.problems = (await get({ domain: state.domain, contest: contest.value })).problems; } catch (error) { notify(status, error.message, true); }
    }
    renderContestProblems();
});

function selection() {
    const body = {
        domain: state.domain, scope: state.scope,
        statuses: [...statuses.querySelectorAll('input:checked')].map((box) => Number(box.value)),
        skipAccepted: skipAccepted.checked,
    };
    if (state.scope === 'contest') {
        body.contest = contest.value || null;
        body.pids = [...contestProblems.querySelectorAll('input:checked')].map((box) => Number(box.value));
    } else if (state.scope === 'problems') body.pids = [...state.picked.keys()];
    return body;
}

const scopeName = () => (state.scope === 'contest' ? contest.selectedOptions[0]?.textContent.split(' · ')[0] : state.scope === 'domain' ? `整个域 ${state.domain}` : `域 ${state.domain} 的所选题目`);

function describe(summary, title) {
    const statusRows = Object.entries(summary.byStatus).sort((a, b) => b[1] - a[1]);
    const shown = summary.byProblem.slice(0, 60);
    return el('div', { class: 'manage-group', style: 'margin-top:18px' },
        el('h3', { text: title }),
        el('div', { class: 'resolver-stats' },
            el('div', {}, el('strong', { text: summary.total }), el('span', { text: '提交' })),
            el('div', {}, el('strong', { text: summary.byProblem.length }), el('span', { text: '题目' }))),
        summary.total ? el('div', { class: 'manage-scroll' }, el('table', { class: 'data-table' },
            el('thead', {}, el('tr', {}, el('th', { text: '按结果' }), el('th', { text: '数量' }))),
            el('tbody', {}, ...statusRows.map(([code, count]) => el('tr', {}, el('td', { text: statusLabel.get(Number(code)) || `状态 ${code}` }), el('td', { text: count })))))) : null,
        shown.length ? el('p', { class: 'resolver-muted' }, '按题目：', ...shown.map((problem) => el('span', { class: 'manage-tag', title: problem.title || undefined, text: `${problem.label} × ${problem.count}` })),
            summary.byProblem.length > shown.length ? el('span', { text: `……共 ${summary.byProblem.length} 题` }) : null) : null,
    );
}

async function preview() {
    try {
        const summary = await post('preview', selection());
        notify(status, '');
        result.replaceChildren(describe(summary, `将要重测 · ${scopeName()}`));
        return summary;
    } catch (error) {
        notify(status, error.message, true);
        result.replaceChildren();
        return null;
    }
}

async function run() {
    const summary = await preview();
    if (!summary) return;
    if (!summary.total) { notify(status, '没有符合条件的提交', true); return; }
    const whole = state.scope === 'domain';
    const password = whole ? adminPassword() : null;
    openDialog({
        title: whole ? '确认重测整个域' : '确认重测',
        confirm: `重测 ${summary.total} 条提交`,
        body: [
            el('p', { text: `将重测 ${scopeName()} 中 ${summary.byProblem.length} 道题的 ${summary.total} 条提交。原评测结果会被清空并重新排队，期间这些提交显示为等待评测。` }),
            whole ? el('div', { class: 'resolver-fields' }, field('管理员密码', password)) : null,
        ],
        submit: async () => {
            const done = await post('run', whole ? { ...selection(), password: password.value } : selection());
            result.replaceChildren(describe(done, `已加入评测队列 ${done.queued} 条`));
            notify(status, done.failed.length ? `部分题目已跳过：${done.failed.join('；')}` : `已提交重测 ${done.queued} 条，可在“评测机控制”或评测记录中查看进度`, !!done.failed.length);
        },
    });
    password?.focus();
}

setScope('contest');
renderPicked();
loadContests();
