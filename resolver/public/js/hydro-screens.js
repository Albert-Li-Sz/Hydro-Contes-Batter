// Hydro big-screen administration page: pick a screen in the side menu, then edit its settings and link.
const runtime = JSON.parse(document.getElementById('screens-runtime').textContent);
const $ = (id) => document.getElementById(id);
const message = $('message');
let config = structuredClone(runtime.config);
let linkBase = runtime.linkBase;
let dirty = false;

const hints = {
    scoreboard: '完整榜单，按页自动滚动。',
    leaders: '前 12 名，适合奖牌争夺阶段。',
    tiles: 'ICPC Tools 方块榜：实时方块榜横向翻列，按通过数分组与按队名排列纵向滚动。',
    'first-solves': '各题首个通过的选手。',
    queue: '最近的提交及评测结果，每 3 秒刷新。结果与公开榜一致：比赛中错误结果只显示为未通过，封榜后的提交显示为待定。会公开显示谁在何时提交了哪道题，比赛中如不希望选手看到，请只在裁判室使用。',
    clock: '比赛已进行时间。',
    countdown: '距目标时间的倒计时，到点后转为正计时。',
    message: '全屏文字公告，可换行。',
    resolver: '跟随一场滚榜会话的进度同步显示，没有控制权，也看不到尚未揭晓的内容。',
};

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

function select(options, value, onChange) {
    const field = el('select', { class: 'select' });
    for (const [optionValue, label] of options) field.add(new Option(label, optionValue));
    field.value = value;
    field.addEventListener('change', () => { onChange(field.value); changed(); });
    return field;
}

function changed() {
    dirty = true;
    refreshMenu();
    $('save-status').textContent = '有未保存的更改';
}

const toLocalInput = (iso) => {
    if (!iso) return '';
    const date = new Date(iso);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const linkFor = (type) => new URL(`${linkBase}/${type}`, location.href).href;

function card(type) {
    const item = config.items[type];
    const fields = el('div', { class: 'resolver-fields resolver-two' });
    if (runtime.standingsTypes.includes(type)) {
        const options = runtime.boards.map((board) => [board.id, board.name]);
        if (!runtime.boards.some((board) => board.id === item.boardId)) options.push([item.boardId, `${item.boardId}（已不存在）`]);
        fields.append(el('label', { text: '分榜' }, select(options, item.boardId, (value) => { item.boardId = value; })));
    }
    if (runtime.variants[type]) {
        fields.append(el('label', { text: '样式' }, select(runtime.variants[type], item.variant, (value) => { item.variant = value; })));
    }
    if (type === 'countdown') {
        const time = el('input', { class: 'textbox', type: 'datetime-local' });
        time.value = toLocalInput(item.targetTime);
        const update = () => { time.disabled = item.target !== 'custom'; time.required = item.target === 'custom'; };
        time.addEventListener('input', () => { item.targetTime = time.value ? new Date(time.value).toISOString() : null; changed(); });
        fields.append(el('label', { text: '倒计时到' }, select([['end', '比赛结束'], ['start', '比赛开始'], ['custom', '指定时间']], item.target, (value) => {
            item.target = value;
            update();
        })), el('label', { text: '指定时间' }, time));
        update();
    }
    if (type === 'message') {
        const text = el('textarea', { class: 'textbox', maxlength: '2000' });
        text.value = item.text;
        text.addEventListener('input', () => { item.text = text.value; changed(); });
        fields.append(el('label', { text: '公告文字' }, text));
    }
    if (type === 'resolver') {
        const options = [['', '不显示（等待滚榜）'], ...runtime.sessions.map((session) => [session.id,
            `${session.board} · ${session.rehearsal ? '彩排' : '正式'} · ${new Date(session.createdAt).toLocaleString('zh-CN')}`])];
        if (item.sessionId && !runtime.sessions.some((session) => session.id === item.sessionId)) options.push([item.sessionId, '其他管理员的会话或已删除的会话']);
        fields.append(el('label', { text: '跟随的滚榜会话' }, select(options, item.sessionId, (value) => { item.sessionId = value; })));
    }
    const link = el('input', { class: 'textbox', readonly: '', 'aria-label': `${runtime.labels[type]}链接` });
    link.value = linkFor(type);
    link.dataset.type = type;
    const copy = el('button', { class: 'button', type: 'button', text: '复制链接' });
    copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(link.value); copy.textContent = '已复制'; } catch { link.select(); copy.textContent = '请手动复制'; }
        setTimeout(() => { copy.textContent = '复制链接'; }, 2000);
    });
    const open = el('a', { class: 'button', target: '_blank', rel: 'noopener', text: '新窗口打开', href: link.value });
    open.dataset.type = type;
    const body = el('div', { class: 'section__body' }, el('p', { class: 'resolver-muted', text: hints[type] || '' }));
    if (fields.childElementCount) body.append(fields);
    body.append(el('div', { class: 'screen-link' }, link, copy, open));
    return el('section', { class: 'section visible screen-card', id: `screen-${type}`, 'data-type': type, hidden: '' },
        el('div', { class: 'section__header' }, el('h2', { class: 'section__title', text: runtime.labels[type] })), body);
}

async function request(body) {
    const response = await fetch(runtime.base, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((typeof data.error === 'string' ? data.error : data.error?.message) || `请求失败（${response.status}），请检查登录状态`);
    return data;
}

function showError(error) {
    message.textContent = error.message || String(error);
    message.hidden = false;
}

$('contest-title').textContent = runtime.title;
$('back-link').href = runtime.contestUrl;
$('locale').value = config.locale;
$('locale').addEventListener('change', () => { config.locale = $('locale').value; changed(); });
$('screen-panel').append(...runtime.types.map(card));

// Side menu: one entry per screen; the chosen screen's settings show on the left.
const summary = (type) => {
    const item = config.items[type];
    const parts = [];
    if (runtime.standingsTypes.includes(type)) parts.push(runtime.boards.find((board) => board.id === item.boardId)?.name || item.boardId);
    if (runtime.variants[type]) parts.push(runtime.variants[type].find(([value]) => value === item.variant)?.[1] || item.variant);
    if (type === 'countdown') parts.push({ end: '到比赛结束', start: '到比赛开始', custom: '到指定时间' }[item.target]);
    if (type === 'message') parts.push(item.text.trim() ? item.text.trim().split('\n')[0].slice(0, 16) : '未填写');
    if (type === 'resolver') parts.push(item.sessionId ? '已选择会话' : '未选择会话');
    return parts.filter(Boolean).join(' · ');
};
const menuLinks = new Map(runtime.types.map((type) => {
    const note = el('small', { class: 'screens-menu-note' });
    const link = el('a', { class: 'menu__link', href: `#screen-${type}` }, el('span', { text: runtime.labels[type] }), note);
    link.addEventListener('click', (event) => { event.preventDefault(); choose(type, true); });
    $('screen-menu').append(el('li', { class: 'menu__item' }, link));
    return [type, { link, note }];
}));
const refreshMenu = () => { for (const [type, { note }] of menuLinks) note.textContent = summary(type); };
function choose(type, focus = false) {
    if (!runtime.types.includes(type)) type = runtime.types[0];
    for (const section of $('screen-panel').children) section.hidden = section.dataset.type !== type;
    for (const [key, { link }] of menuLinks) {
        link.classList.toggle('active', key === type);
        if (key === type) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    history.replaceState(null, '', `#screen-${type}`);
    if (focus && matchMedia('(max-width: 1024px)').matches) $('screen-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
choose(location.hash.replace(/^#screen-/, ''));
refreshMenu();
addEventListener('hashchange', () => choose(location.hash.replace(/^#screen-/, '')));
$('save').addEventListener('click', async () => {
    message.hidden = true;
    for (const field of document.querySelectorAll('#screen-panel input[required]')) {
        if (field.checkValidity()) continue;
        choose(field.closest('[data-type]').dataset.type);
        field.reportValidity();
        return;
    }
    $('save').disabled = true;
    try {
        config = (await request({ config: JSON.stringify(config) })).config;
        dirty = false;
        $('save-status').textContent = `已保存 ${new Date().toLocaleTimeString('zh-CN')}`;
    } catch (error) { showError(error); } finally { $('save').disabled = false; }
});
$('reset-token').addEventListener('click', () => $('reset-confirm').showModal());
$('reset-confirm').addEventListener('close', async () => {
    if ($('reset-confirm').returnValue !== 'confirm') return;
    try {
        linkBase = (await request({ operation: 'reset_token' })).linkBase;
        for (const node of document.querySelectorAll('#screen-panel .screen-link [data-type]')) {
            if (node.tagName === 'INPUT') node.value = linkFor(node.dataset.type);
            else node.href = linkFor(node.dataset.type);
        }
        $('save-status').textContent = '已生成新链接，旧链接已失效';
    } catch (error) { showError(error); }
});
addEventListener('beforeunload', (event) => { if (dirty) event.preventDefault(); });
