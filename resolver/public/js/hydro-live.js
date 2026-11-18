// Hydro live (ICPC Live) settings page: links to the director's console and the OBS overlay.
const runtime = JSON.parse(document.getElementById('live-runtime').textContent);
const $ = (id) => document.getElementById(id);
const absolute = (url) => new URL(url, location.href).href;

function showOverlay(url) {
    $('overlay-link').value = absolute(`${url}?noStatus`);
    $('open-overlay').href = absolute(url);
}

function showError(error) {
    $('message').textContent = error.message || String(error);
    $('message').hidden = false;
}

$('contest-title').textContent = runtime.title;
$('back-link').href = runtime.contestUrl;
$('open-admin').href = absolute(`${runtime.admin}/controls`);
// Hidden when the plugin setting turns 画面采集 off.
$('capture-card').hidden = !runtime.capture;
$('open-capture').href = absolute(`${runtime.base}/capture`);
showOverlay(runtime.overlay);

$('copy-overlay').addEventListener('click', async () => {
    const button = $('copy-overlay');
    try { await navigator.clipboard.writeText($('overlay-link').value); button.textContent = '已复制'; } catch { $('overlay-link').select(); button.textContent = '请手动复制'; }
    setTimeout(() => { button.textContent = '复制链接'; }, 2000);
});

$('reset-token').addEventListener('click', () => $('reset-confirm').showModal());
$('reset-confirm').addEventListener('close', async () => {
    if ($('reset-confirm').returnValue !== 'confirm') return;
    $('message').hidden = true;
    try {
        const response = await fetch(runtime.base, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ operation: 'reset_token' }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((typeof data.error === 'string' ? data.error : data.error?.message) || `请求失败（${response.status}），请检查登录状态`);
        showOverlay(data.overlay);
        $('save-status').textContent = '已生成新链接，旧链接已失效';
    } catch (error) { showError(error); }
});
