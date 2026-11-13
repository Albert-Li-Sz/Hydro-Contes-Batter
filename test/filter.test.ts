import { describe, expect, it } from 'vitest';
import { bulkSelection, filterMembers } from '../client/member-filter.mjs';
import { buildRosterTeam, defaultProfileFields, rosterFields } from '../lib/roster';
import { replacementRequest } from '../lib/access';
import { demoRoster } from './fixture';

const ids = (teams: ReturnType<typeof demoRoster>) => teams.map((team) => team.team_id);
describe('成员批量筛选', () => {
    it('多学校取并集，与参赛资格取交集', () => {
        expect(ids(filterMembers(demoRoster(), { rules: [
            { field: 'school', operator: 'is', values: ['南京晓庄学院', '南京邮电大学'] },
            { field: 'participation', operator: 'is', values: ['正式参赛'] },
        ] }))).toEqual(['1', '2', '3', '7']);
    });
    it('可用年级、班级、专业、用户组和用户名筛选', () => {
        expect(ids(filterMembers(demoRoster(), { rules: [{ field: 'profile:grade', operator: 'is', values: ['2026级'] }] }))).toEqual(['1', '3', '5', '7']);
        expect(ids(filterMembers(demoRoster(), { rules: [{ field: 'profile:class', operator: 'is', values: ['计科一班'] }, { field: 'userGroup', operator: 'is', values: ['新生组'] }] }))).toEqual(['1', '3']);
        expect(ids(filterMembers(demoRoster(), { rules: [{ field: 'username', operator: 'contains', values: ['USER2'] }] }))).toEqual(['2']);
    });
    it('支持任一条件、排除、空字段和全文搜索', () => {
        expect(ids(filterMembers(demoRoster(), { mode: 'any', rules: [
            { field: 'school', operator: 'is', values: ['东南大学'] }, { field: 'id', operator: 'is', values: ['１'] },
        ] }))).toEqual(['1', '5', '6']);
        expect(ids(filterMembers(demoRoster(), { rules: [{ field: 'school', operator: 'not', values: ['南京晓庄学院', '南京邮电大学', '东南大学'] }] }))).toEqual(['8']);
        expect(ids(filterMembers(demoRoster(), { rules: [{ field: 'profile:missing', operator: 'empty' }] }))).toHaveLength(8);
        expect(ids(filterMembers(demoRoster(), { rules: [{ field: 'school', operator: 'empty' }] }))).toEqual(['8']);
        expect(ids(filterMembers(demoRoster(), { query: '软件二班' }))).toEqual(['5', '6', '7', '8']);
    });
    it('搜索“正式”不会匹配非正式选手', () => {
        expect(ids(filterMembers(demoRoster(), { query: '正式' }))).toEqual(['1', '2', '3', '5', '7', '8']);
        expect(ids(filterMembers(demoRoster(), { query: '非正式' }))).toEqual(['4', '6']);
        expect(ids(filterMembers(demoRoster(), { query: 'official' }))).toEqual([]);
        expect(ids(filterMembers(demoRoster(), { rules: [{ field: 'participation', operator: 'contains', values: ['正式'] }] }))).toEqual(['1', '2', '3', '5', '7', '8']);
    });
    it('全选和取消仅影响匹配成员，替换会清除其他成员', () => {
        const original = new Set(['1', '8']); const matches = demoRoster().filter((team) => ['1', '2'].includes(team.team_id));
        expect([...bulkSelection(original, matches, 'add')]).toEqual(['1', '8', '2']);
        expect([...bulkSelection(original, matches, 'remove')]).toEqual(['8']);
        expect([...bulkSelection(original, matches, 'replace')]).toEqual(['1', '2']);
        expect([...original]).toEqual(['1', '8']);
        expect([...bulkSelection(original, [], 'add')]).toEqual(['1', '8']);
    });
    it('仅提取明确公开的资料字段，忽略私密字段和对象', () => {
        const team = buildRosterTeam({ _id: 1, uname: 'one', school: '学校', grade: '2026', password: 'secret',
            billing: { private: true }, getFields: () => ['grade', 'billing'] }, false,
        [...defaultProfileFields, { key: 'password', label: '密码' }, { key: 'billing', label: '账单' }]);
        expect(team.fields['profile:grade']).toEqual(['2026']);
        expect(team.fields['profile:password']).toBeUndefined();
        expect(team.fields['profile:billing']).toEqual([]);
        expect(JSON.stringify(team)).not.toContain('secret');
        expect(rosterFields([team], defaultProfileFields).some((field) => field.key === 'profile:grade')).toBe(true);
    });
});

describe('默认榜单路径匹配', () => {
    const tid = '68ea00000000000000000000';
    it('只接管默认榜和增强榜，保留分榜与 JSON 参数', () => {
        expect(replacementRequest(`/contest/${tid}/scoreboard`, 'group=manual-one&json=true')?.query).toBe('group=manual-one&json=true');
        expect(replacementRequest(`/contest/${tid}/scoreboard/xcpcio-plus`, '')?.enhanced).toBe(true);
        expect(replacementRequest(`/contest/${tid}/scoreboard`, 'view=csv')).toBeNull();
        expect(replacementRequest(`/contest/${tid}/scoreboard/csv`, '')).toBeNull();
        expect(replacementRequest(`/contest/${tid}/management`, '')).toBeNull();
        expect(replacementRequest('/contest/invalid/scoreboard', '')).toBeNull();
    });
    it('实时榜继续走 Hydro 原有鉴权', () => {
        for (const realtime of ['true', '1', 'on', 'yes', 'TRUE']) expect(replacementRequest(`/contest/${tid}/scoreboard`, `realtime=${realtime}`)).toBeNull();
        for (const realtime of ['false', '0', 'off', 'no', '']) expect(replacementRequest(`/contest/${tid}/scoreboard`, `realtime=${realtime}`)?.query).toBe('');
    });
});
