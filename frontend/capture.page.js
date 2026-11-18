import { addPage, AutoloadPage } from '@hydrooj/ui-default';
import { installCapturePrompt } from './capture-prompt';

// 画面采集: contest pages of a contestant whose contest records screens and webcams (lib/live/capture-routes.ts sets UiContext.xcpcioCapture).
let cleanup;
addPage(new AutoloadPage('xcpcioCapture', () => {
    cleanup?.();
    cleanup = undefined;
    const info = window.UiContext?.xcpcioCapture;
    if (info && typeof info.url === 'string' && typeof info.channel === 'string') cleanup = installCapturePrompt(info);
}));
