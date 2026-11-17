// /manage batch rejudge: by contest, problems and results, with accepted submissions optionally kept.
import { $, el, field, formatTime, get, input, notify, openDialog, post, runtime } from './hydro-manage-common.js';

const statusLabel = new Map(runtime.statuses.map(([code, short, label]) => [code, `${short} ${label}`]));
const state = { domain: runtime.domainId, contests: [], problems: [] };

const status = el('p', { class: 'resolver-muted', role: 'status', hidden: true });
const domain = input({ value: runtime.domainId, 'aria-label': '域 ID', required: true });
const contest = el('select', { class: 'select', 'aria-label': '比赛' });
const problemBox = el('div');
const problemIds = el('textarea', { class: 'textbox', rows: 2, placeholder: '题号，如 1001, P1002, 1003；用逗号或换行分隔' });
const skipAccepted = el('input', { type: 'checkbox', checked: true });
const statuses = el('div', { class: 'manage-statuses' }, ...runtime.statuses.map(([code, short, label]) => el('label', {},
    el('input', { type: 'checkbox', value: code }), el('span', { text: `${short} ${label}` }))));
const result = el('div');

const quick = (text, codes) => el('button', {
    class: 'link', type: 'button', text,
    onclick: () => { for (const box of statuses.querySelectorAll('input')) box.checked = codes.includes(Number(box.value)); syncAccepted(); },
});

$('manage-root').replaceChildren(
    el('p', { class: 'resolver-muted', text: '按比赛、题目和评测结果批量重测，与 Hydro 题目页的“重测”相同：重测任务优先级低于新提交，比赛中的提交按比赛设置显示结果。重测提交后榜单会随新结果更新。' }),
    el('div', { class: 'manage-group' }, el('h3', { text: '范围' }),
        el('form', { class: 'manage-toolbar', onsubmit: (event) => { event.preventDefault(); loadContests(); } },
            domain, el('button', { class: 'button', type: 'submit', text: '加载比赛' })),
        el('div', { class: 'resolver-fields' }, field('比赛', contest))),
    el('div', { class: 'manage-group' }, el('h3', {}, '题目',
        el('span', { class: 'manage-quick', id: 'problem-quick' },
            el('button', { class: 'link', type: 'button', text: '全选', onclick: () => checkProblems(true) }),
            el('button', { class: 'link', type: 'button', text: '清空', onclick: () => checkProblems(false) }))), problemBox),
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

function syncAccepted() {
    const accepted = statuses.querySelector('input[value="1"]');
    if (accepted.checked && skipAccepted.checked) skipAccepted.checked = false;
}
statuses.querySelector('input[value="1"]').addEventListener('change', syncAccepted);
skipAccepted.addEventListener('change', () => { if (skipAccepted.checked) statuses.querySelector('input[value="1"]').checked = false; });

function checkProblems(checked) {
    for (const box of problemBox.querySelectorAll('input[type=checkbox]')) box.checked = checked;
}

function renderProblems() {
    $('problem-quick').hidden = !contest.value;
    if (!contest.value) {
        problemBox.replaceChildren(el('div', { class: 'resolver-fields' }, field('题号', problemIds, '未选择比赛时按题目重测该域内的全部提交（含比赛内的提交）')));
        return;
    }
    problemBox.replaceChildren(
        el('p', { class: 'resolver-muted manage-small', text: '不选表示比赛的全部题目。' }),
        el('div', { class: 'manage-problems' }, ...state.problems.map((problem) => el('label', { title: problem.title },
            el('input', { type: 'checkbox', value: problem.pid }), el('strong', { text: problem.label }), el('span', { text: problem.title })))),
    );
}

async function loadContests() {
    if (!domain.reportValidity()) return;
    try {
        const data = await get({ domain: domain.value.trim() });
        state.domain = data.domainId;
        state.contests = data.contests;
        contest.replaceChildren(new Option('不限比赛（按题号重测）', ''), ...data.contests.map((tdoc) => new Option(
            `${tdoc.title} · ${tdoc.rule.toUpperCase()} · ${formatTime(tdoc.beginAt)} · ${tdoc.problems} 题`, tdoc.id)));
        state.problems = [];
        renderProblems();
        notify(status, data.contests.length ? '' : `域 ${data.domainId} 中没有比赛，可按题号重测`);
    } catch (error) { notify(status, error.message, true); }
}

contest.addEventListener('change', async () => {
    state.problems = [];
    if (contest.value) {
        try { state.problems = (await get({ domain: state.domain, contest: contest.value })).problems; } catch (error) { notify(status, error.message, true); }
    }
    renderProblems();
});

function selection() {
    const body = {
        domain: state.domain,
        contest: contest.value || null,
        statuses: [...statuses.querySelectorAll('input:checked')].map((box) => Number(box.value)),
        skipAccepted: skipAccepted.checked,
    };
    if (contest.value) body.pids = [...problemBox.querySelectorAll('input:checked')].map((box) => Number(box.value));
    else body.problems = problemIds.value.split(/[\s,，;；]+/).map((id) => id.trim()).filter(Boolean);
    return body;
}

function describe(summary, title) {
    const statusRows = Object.entries(summary.byStatus).sort((a, b) => b[1] - a[1]);
    return el('div', { class: 'manage-group', style: 'margin-top:18px' },
        el('h3', { text: title }),
        el('div', { class: 'resolver-stats' },
            el('div', {}, el('strong', { text: summary.total }), el('span', { text: '提交' })),
            el('div', {}, el('strong', { text: summary.byProblem.length }), el('span', { text: '题目' }))),
        summary.total ? el('div', { class: 'manage-scroll' }, el('table', { class: 'data-table' },
            el('thead', {}, el('tr', {}, el('th', { text: '按结果' }), el('th', { text: '数量' }))),
            el('tbody', {}, ...statusRows.map(([code, count]) => el('tr', {}, el('td', { text: statusLabel.get(Number(code)) || `状态 ${code}` }), el('td', { text: count })))))) : null,
        summary.byProblem.length ? el('p', { class: 'resolver-muted' }, '按题目：', ...summary.byProblem.map((problem) => el('span', { class: 'manage-tag', text: `${problem.label} × ${problem.count}` }))) : null,
    );
}

async function preview() {
    try {
        const summary = await post('preview', selection());
        notify(status, '');
        result.replaceChildren(describe(summary, '将要重测'));
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
    const scope = contest.value ? contest.selectedOptions[0].textContent.split(' · ')[0] : `域 ${state.domain}`;
    openDialog({
        title: '确认重测',
        confirm: `重测 ${summary.total} 条提交`,
        body: [el('p', { text: `将重测 ${scope} 中 ${summary.byProblem.length} 道题的 ${summary.total} 条提交。原评测结果会被清空并重新排队，期间这些提交显示为等待评测。` })],
        submit: async () => {
            const done = await post('run', selection());
            result.replaceChildren(describe(done, `已加入评测队列 ${done.queued} 条`));
            notify(status, done.failed.length ? `部分题目已跳过：${done.failed.join('；')}` : `已提交重测 ${done.queued} 条，可在“评测机控制”或评测记录中查看进度`, !!done.failed.length);
        },
    });
}

loadContests();
