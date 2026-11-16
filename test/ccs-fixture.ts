import type { CcsSource } from '../lib/ccs/model';
import { normalizeSettings, defaultSettings } from '../lib/settings';
import { resolverBoards } from '../lib/resolver-data';
import { demoData } from './fixture';

export function ccsFixture(): CcsSource {
    const full = demoData();
    const begin = full.contest.start_time * 1000;
    const settings = normalizeSettings({ ...defaultSettings, ccsApi: true, publicAccess: true, showIdentity: true });
    const records = full.submissions.map((s, i) => ({
        rid: `${Math.floor((begin + s.timestamp) / 1000).toString(16)}${i.toString(16).padStart(16, '0')}`,
        submissionId: `s${i}`, uid: Number(s.team_id), teamUid: Number(s.team_id), pid: 100 + s.problem_id,
        lang: 'cc.cc17o2', submittedAt: begin + s.timestamp,
        judgings: [{ status: 1, startAt: begin + s.timestamp + 1000, judgeAt: begin + s.timestamp + 2000, time: 12, cases: [{ status: 1, time: 12 }] }],
    }));
    full.submissions.forEach((s, i) => { s.submission_id = records[i].rid; });
    return {
        now: begin + 18_000_000 + 10_000,
        contest: { id: '68ea00000000000000000000', domainId: 'system', title: '测试比赛', beginAt: begin, endAt: begin + 18_000_000, lockAt: null, unlocked: false, allowTeam: false },
        meta: {}, settings, full, public: structuredClone(full), publicVisible: true,
        boards: resolverBoards(full, settings, true), publicBoards: resolverBoards(full, settings, true),
        logoNames: {}, logoIndex: {},
        problems: [100, 101, 102].map((pid, i) => ({ pid, label: String.fromCharCode(65 + i), title: `题目${i}`, timeLimitMs: 1000, memoryMb: 256, testCount: 1, color: '#abcdef', colorName: '蓝', attachments: [] })),
        languages: [{ key: 'cc.cc17o2', display: 'C++17', extension: 'cpp', compile: 'g++ foo.cpp', execute: './foo' }],
        records, clarifications: [],
        persons: full.teams.map(t => ({ uid: Number(t.team_id), name: t.name, teamUid: Number(t.team_id), role: 'contestant' })),
        accounts: full.teams.map(t => ({ uid: Number(t.team_id), uname: `u${t.team_id}`, name: t.name, teamUid: Number(t.team_id), type: 'team' })),
        teamOfUser: new Map(), awardOverrides: [], comments: [],
    };
}
