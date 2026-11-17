import { describe, expect, it } from 'vitest';
import {
    defaultJudgeRule, dispatchFor, emptyDaemonConfig, judgeConfig, judgePassword, normalizeJudgeRule, readDaemonConfig, checkJudgeName,
} from '../lib/manage/judges';
import { groupByProblem, normalizeRejudgeSelection, rejudgeFilter } from '../lib/manage/rejudge';
import { normalizeTeamEdit, normalizeUserEdit, PRIV_EDIT_SYSTEM, protectedReason, searchPattern, uidList } from '../lib/manage/users';

describe('用户与队伍配置', () => {
    it('只接受可修改的资料，空密码表示不修改', () => {
        expect(normalizeUserEdit({ displayName: ' 林澈 ', mail: 'lin@example.com', password: '', school: '东南大学', uname: 'hack', _id: 1 }))
            .toEqual({ displayName: '林澈', mail: 'lin@example.com', school: '东南大学' });
        expect(normalizeUserEdit({ password: 'secret1' })).toEqual({ password: 'secret1' });
        expect(() => normalizeUserEdit({ password: '123' })).toThrow('6 至 255');
        expect(() => normalizeUserEdit({ mail: 'not-a-mail' })).toThrow('邮箱格式无效');
        expect(() => normalizeUserEdit({ uname: 'x' })).toThrow('没有需要保存的修改');
    });

    it('保护系统账号、超级管理员和当前账号，系统管理员需先撤权才能删除', () => {
        expect(protectedReason({ _id: 1, uname: 'Hydro', priv: 0 }, 2, 'edit')).toMatch('系统内置');
        expect(protectedReason({ _id: 2, uname: 'root', priv: -1 }, 3, 'edit')).toMatch('超级管理员');
        expect(protectedReason({ _id: 5, uname: 'me', priv: 0 }, 5, 'delete')).toMatch('当前登录');
        expect(protectedReason({ _id: 5, uname: 'me', priv: 0 }, 5, 'edit')).toBeNull();
        expect(protectedReason({ _id: 6, uname: 'ops', priv: PRIV_EDIT_SYSTEM }, 2, 'delete')).toMatch('系统管理员');
        expect(protectedReason({ _id: 7, uname: 'player', priv: 0 }, 2, 'delete')).toBeNull();
    });

    it('队伍：队名不能为空，队员去重且受人数上限约束，受邀者不重复列入', () => {
        expect(normalizeTeamEdit({ displayName: '星火', members: [7, 8, 7], invite: [8, 9], memberPassword: '' }, 3))
            .toEqual({ displayName: '星火', members: [7, 8], invite: [9] });
        expect(() => normalizeTeamEdit({ displayName: '  ' })).toThrow('队名不能为空');
        expect(() => normalizeTeamEdit({ members: [] })).toThrow('至少需要一名队员');
        expect(() => normalizeTeamEdit({ members: [1, 2, 3, 4] }, 3)).toThrow('不能超过 3 人');
        expect(normalizeTeamEdit({ memberPassword: 'team-pass' })).toEqual({ memberPassword: 'team-pass' });
    });

    it('批量编号与搜索', () => {
        expect(uidList(['3', 3, 4])).toEqual([3, 4]);
        expect(() => uidList([-1001])).toThrow('编号无效');
        expect(uidList([-1001], '队伍', true)).toEqual([-1001]);
        expect(searchPattern('a.b')!.test('axb')).toBe(false);
        expect(searchPattern('  ')).toBeNull();
    });
});

describe('评测机控制', () => {
    it('分流规则收窄评测机自身的取题条件与并发', () => {
        const daemon = readDaemonConfig(emptyDaemonConfig(), { key: 'config', concurrency: 8, lang: ['cc', 'java', 'py3'], prio: -50 });
        expect(dispatchFor(defaultJudgeRule(), daemon)).toEqual({
            query: { type: { $in: ['judge', 'generate'] }, priority: { $gt: -50 }, lang: { $in: ['cc', 'java', 'py3'] } }, concurrency: 8,
        });
        const rule = normalizeJudgeRule({ concurrency: '3', langs: 'java, py3, rs', scope: 'new' });
        expect(dispatchFor(rule, daemon)).toEqual({
            query: { type: { $in: ['judge', 'generate'] }, priority: { $gt: -50 }, lang: { $in: ['java', 'py3'] }, 'meta.rejudge': { $ne: true } }, concurrency: 3,
        });
        // The cap never raises the daemon's own concurrency; a paused judge takes nothing.
        expect(dispatchFor(normalizeJudgeRule({ concurrency: 32 }), daemon).concurrency).toBe(8);
        expect(dispatchFor(normalizeJudgeRule({ enabled: false }), daemon).concurrency).toBe(0);
        expect(dispatchFor(normalizeJudgeRule({ scope: 'rejudge', langs: ['go'] }), emptyDaemonConfig()).query)
            .toEqual({ type: { $in: ['judge', 'generate'] }, lang: { $in: ['go'] }, 'meta.rejudge': true });
    });

    it('设置校验', () => {
        expect(() => normalizeJudgeRule({ concurrency: 0 })).toThrow('并发上限');
        expect(() => normalizeJudgeRule({ langs: ['c++; drop'] })).toThrow('语言代码无效');
        expect(normalizeJudgeRule({ scope: 'bogus' }).scope).toBe('all');
        expect(checkJudgeName(' judge-1 ')).toBe('judge-1');
        expect(() => checkJudgeName('1judge')).toThrow('字母开头');
    });

    it('每次生成新密码，配置为 hydrojudge 的 judge.yaml', () => {
        const a = judgePassword();
        expect(a).toMatch(/^[A-Za-z2-9]{24}$/);
        expect(judgePassword()).not.toBe(a);
        expect(judgeConfig({ serverUrl: 'https://oj.example.com', uname: 'judge-1', password: 'p"w' })).toBe([
            'hosts:', '  hydro:', '    type: hydro', '    server_url: "https://oj.example.com/"', '    uname: "judge-1"', '    password: "p\\"w"', '    detail: true', '',
        ].join('\n'));
    });
});

describe('批量重测', () => {
    const special = ['pretest', 'generate'];

    it('按比赛、题目与结果筛选，AC 不参与重测时排除通过的提交', () => {
        const selection = normalizeRejudgeSelection({ contest: '6740a0000000000000000001', pids: [1001], statuses: [1, 3, 4], skipAccepted: true });
        expect(rejudgeFilter(selection, 'tid', special)).toEqual({ contest: 'tid', 'files.hack': { $exists: false }, pid: { $in: [1001] }, status: { $in: [3, 4] } });
        const all = normalizeRejudgeSelection({ contest: '6740a0000000000000000001', skipAccepted: false });
        expect(rejudgeFilter(all, 'tid', special).status).toEqual({ $nin: [9] });
        const noAc = normalizeRejudgeSelection({ pids: [5] });
        expect(rejudgeFilter(noAc, null, special)).toEqual({ contest: { $nin: special }, 'files.hack': { $exists: false }, pid: { $in: [5] }, status: { $nin: [9, 1] } });
    });

    it('拒绝不完整或矛盾的条件', () => {
        expect(() => normalizeRejudgeSelection({ statuses: [2] })).toThrow('请选择比赛或至少一道题目');
        expect(() => normalizeRejudgeSelection({ pids: [1], statuses: [1], skipAccepted: true })).toThrow('没有需要重测的提交');
        expect(() => normalizeRejudgeSelection({ pids: [1], statuses: [99] })).toThrow('结果类型无效');
        expect(() => normalizeRejudgeSelection({ contest: 'x' })).toThrow('比赛编号无效');
    });

    it('按题目分组，Hydro 的评测队列每次只处理一道题', () => {
        const groups = groupByProblem([{ pid: 1 }, { pid: 2 }, { pid: 1 }]);
        expect([...groups].map(([pid, list]) => [pid, list.length])).toEqual([[1, 2], [2, 1]]);
    });
});
