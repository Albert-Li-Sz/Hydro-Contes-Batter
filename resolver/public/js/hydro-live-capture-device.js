// 画面采集 on a contestant computer: captures the screen and the webcam once, and sends them to
// whoever Hydro lets watch (the OBS overlay, the director, the management page). The video goes
// straight to the viewer over WebRTC; Hydro only passes the handshake.
const runtime = JSON.parse(document.getElementById('capture-runtime').textContent);
const $ = (id) => document.getElementById(id);
const socketUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${runtime.ws}`;

const state = { socket: null, profile: null, screen: null, webcam: null, sessions: new Map(), stopped: false, retry: 0, connected: false };
// The contestant's own capture window (opened from the contest's prompt) tells the contest pages it is capturing.
const channel = runtime.channel && 'BroadcastChannel' in window ? new BroadcastChannel(runtime.channel) : null;
const pageTitle = document.title;

$('device-name').textContent = runtime.name;
$('device-seat').textContent = runtime.seat ? `座位 ${runtime.seat}` : '';
$('device-contest').textContent = runtime.contest;

function setStatus(text, tone = '') {
    $('status').textContent = text;
    $('status').dataset.tone = tone;
}

function announce() {
    channel?.postMessage({ type: 'alive', streams: [...state.screen ? ['screen'] : [], ...state.webcam ? ['webcam'] : []], connected: state.connected });
}
channel?.addEventListener('message', (event) => { if (event.data?.type === 'ping') announce(); });
setInterval(announce, 2000);

function render() {
    const recording = !!state.screen || !!state.webcam;
    // The tab and the window title say it too, so it is not closed by mistake.
    document.title = recording ? `● 正在录制 · 请勿关闭 · ${pageTitle}` : pageTitle;
    $('recording').hidden = !recording;
    document.body.dataset.recording = String(recording);
    announce();
    $('screen-video').srcObject = state.screen;
    $('webcam-video').srcObject = state.webcam;
    $('screen-state').textContent = state.screen ? '正在采集' : '未采集';
    $('webcam-state').textContent = state.webcam ? '正在采集' : '未采集';
    $('screen-tile').dataset.on = String(!!state.screen);
    $('webcam-tile').dataset.on = String(!!state.webcam);
    $('start').hidden = !!state.screen && !!state.webcam;
    $('start').textContent = state.screen || state.webcam ? '补全采集' : '开始采集';
    const watching = [...state.sessions.values()];
    $('watching').textContent = watching.length
        ? `正在被观看：${watching.filter((s) => s.stream === 'screen').length} 路屏幕，${watching.filter((s) => s.stream === 'webcam').length} 路摄像头`
        : '当前没有人观看';
}

function send(message) {
    if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(message));
}

function reportStatus() {
    const settings = state.screen?.getVideoTracks()[0]?.getSettings();
    send({
        type: 'status',
        streams: [...state.screen ? ['screen'] : [], ...state.webcam ? ['webcam'] : []],
        screen: settings?.width ? `${settings.width}×${settings.height}` : '',
    });
}

/** Screen and webcam: tried at once (works when the browser is started with the flags on the management page), else on a click. */
async function capture(fromClick = false) {
    if (!state.profile) return;
    const { screen, webcam } = state.profile;
    const problems = [];
    if (!state.screen) {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                // Chrome opens its picker on 整个屏幕 and leaves out this window and tab switching.
                video: { width: { ideal: screen.width }, height: { ideal: screen.height }, frameRate: { ideal: screen.frameRate, max: screen.frameRate }, displaySurface: 'monitor' },
                audio: false, monitorTypeSurfaces: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', systemAudio: 'exclude',
            });
            const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
            if (surface && surface !== 'monitor') {
                for (const track of stream.getTracks()) track.stop();
                throw Object.assign(new Error('请选择“整个屏幕”，不要只共享窗口或标签页'), { name: 'WrongSurface' });
            }
            state.screen = stream;
            state.screen.getVideoTracks()[0].addEventListener('ended', () => {
                state.screen = null;
                for (const session of [...state.sessions.values()]) if (session.stream === 'screen') session.end('选手机停止了屏幕共享');
                render();
                reportStatus();
                setStatus('屏幕共享已停止，请点击“补全采集”重新开始', 'warn');
            });
        } catch (error) {
            problems.push(error.name === 'WrongSurface' ? error.message
                : error.name === 'NotAllowedError' && fromClick ? '没有共享屏幕。请再次点击按钮，在弹出的窗口中选择“整个屏幕”并点击“分享”'
                    : fromClick ? `屏幕：${error.message || error.name}` : '请点击下方按钮，在弹出的窗口中选择“整个屏幕”并点击“分享”');
        }
    }
    if (!state.webcam) {
        try {
            state.webcam = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: webcam.width }, height: { ideal: webcam.height }, frameRate: { ideal: webcam.frameRate } },
                audio: webcam.audio,
            });
        } catch (error) {
            problems.push(error.name === 'NotFoundError' ? '没有找到摄像头' : `摄像头：${error.message || error.name}`);
        }
    }
    render();
    reportStatus();
    if (problems.length) setStatus(problems.join('；'), 'warn');
    else setStatus('正在采集，请保持此页面打开', 'ok');
    // Keep the screen awake while capturing.
    navigator.wakeLock?.request('screen').catch(() => {});
}

/** New quality settings for what is already being captured; the webcam is opened again when its sound is turned on or off. */
async function applyProfile(previous) {
    const { screen, webcam } = state.profile;
    const video = (settings) => ({ width: { ideal: settings.width }, height: { ideal: settings.height }, frameRate: { ideal: settings.frameRate, max: settings.frameRate } });
    await state.screen?.getVideoTracks()[0]?.applyConstraints(video(screen)).catch(() => {});
    if (state.webcam && previous.webcam?.audio !== webcam.audio) {
        for (const session of [...state.sessions.values()]) if (session.stream === 'webcam') session.end('摄像头设置已更新');
        for (const track of state.webcam.getTracks()) track.stop();
        state.webcam = null;
    } else await state.webcam?.getVideoTracks()[0]?.applyConstraints(video(webcam)).catch(() => {});
}

async function answer(message) {
    const source = message.stream === 'screen' ? state.screen : state.webcam;
    if (!source) {
        send({ type: 'ended', session: message.session, reason: message.stream === 'screen' ? '该设备没有在采集屏幕' : '该设备没有在采集摄像头' });
        return;
    }
    const pc = new RTCPeerConnection({ iceServers: state.profile?.iceServers || [] });
    const session = {
        stream: message.stream, pc,
        end: (reason) => {
            if (!state.sessions.has(message.session)) return;
            state.sessions.delete(message.session);
            pc.close();
            send({ type: 'ended', session: message.session, reason });
            render();
        },
    };
    state.sessions.set(message.session, session);
    render();
    pc.onicecandidate = (event) => send({ type: 'ice', session: message.session, candidate: event.candidate ? event.candidate.toJSON() : null });
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') session.end('点对点连接失败');
    };
    try {
        await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        for (const transceiver of pc.getTransceivers()) {
            const kind = transceiver.receiver.track?.kind;
            const track = kind === 'audio' ? source.getAudioTracks()[0] : source.getVideoTracks()[0];
            if (track) {
                await transceiver.sender.replaceTrack(track);
                transceiver.direction = 'sendonly';
            } else transceiver.direction = 'inactive';
        }
        const local = await pc.createAnswer();
        await pc.setLocalDescription(local);
        send({ type: 'answer', session: message.session, sdp: local.sdp });
        // Screens are text: a steady bitrate keeps code readable; the webcam needs less.
        for (const sender of pc.getSenders()) {
            if (sender.track?.kind !== 'video') continue;
            const parameters = sender.getParameters();
            if (!parameters.encodings?.length) continue;
            parameters.encodings[0].maxBitrate = message.stream === 'screen' ? (state.profile.screen.height >= 1080 ? 3_000_000 : 1_800_000) : 900_000;
            if (message.stream === 'screen') parameters.degradationPreference = 'maintain-resolution';
            sender.setParameters(parameters).catch(() => {});
        }
    } catch (error) {
        session.end(`无法开始传输：${error.message || error}`);
    }
}

function connect() {
    if (state.stopped) return;
    const socket = new WebSocket(socketUrl);
    state.socket = socket;
    setStatus('正在连接 Hydro…');
    socket.onopen = () => { state.retry = 0; state.connected = true; announce(); };
    socket.onmessage = async (event) => {
        if (event.data === 'ping') { socket.send('pong'); return; }
        if (event.data === 'pong') return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'config') {
            // On connecting (with the device's name), and again whenever a manager changes the settings.
            const previous = state.profile;
            state.profile = { ...previous, ...message };
            if (typeof message.name === 'string') $('device-name').textContent = message.name;
            if (typeof message.seat === 'string') $('device-seat').textContent = message.seat ? `座位 ${message.seat}` : '';
            if (previous) await applyProfile(previous);
            await capture();
        } else if (message.type === 'offer') {
            await answer(message);
        } else if (message.type === 'ice' && message.candidate) {
            await state.sessions.get(message.session)?.pc.addIceCandidate(message.candidate).catch(() => {});
        } else if (message.type === 'stop') {
            const session = state.sessions.get(message.session);
            if (session) { state.sessions.delete(message.session); session.pc.close(); render(); }
        }
    };
    socket.onclose = (event) => {
        state.connected = false;
        for (const session of state.sessions.values()) session.pc.close();
        state.sessions.clear();
        render();
        const reason = String(event.reason || '').replace(/^\w*Error:\s*/, '');
        // 4004: the link was regenerated, the device deleted or capture turned off; 4009: opened elsewhere.
        if (event.code === 4004 || event.code === 4009) {
            state.stopped = true;
            setStatus(reason || '采集链接已失效，请向管理员获取新的链接', 'bad');
            return;
        }
        // 4000: refused when connecting (invalid link, capture off, or a server error); 4005: capture
        // turned off for the contest. Both retry slowly, so the page reconnects once it is back on.
        const waiting = event.code === 4000 || event.code === 4005;
        state.retry = waiting ? 6 : Math.min(state.retry + 1, 6);
        setStatus(`${reason || '与 Hydro 的连接已断开'}，${state.retry * 5} 秒后重试…`, waiting ? 'bad' : 'warn');
        setTimeout(connect, state.retry * 5000);
    };
}

$('start').addEventListener('click', () => capture(true));
setInterval(() => {
    if (state.socket?.readyState === WebSocket.OPEN) { state.socket.send('ping'); reportStatus(); }
}, 15000);
// Closing this window (or the whole browser) while recording: the browser asks first. Its wording is
// the browser's own; the page above says what closing means.
window.addEventListener('beforeunload', (event) => {
    if (state.screen || state.webcam) { event.preventDefault(); event.returnValue = '正在录制屏幕和摄像头，关闭后录制会中断'; }
});
window.addEventListener('pagehide', () => channel?.postMessage({ type: 'closed' }));
if (runtime.window) document.body.classList.add('capture-window');
render();
connect();
