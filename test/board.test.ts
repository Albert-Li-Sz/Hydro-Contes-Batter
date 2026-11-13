import { describe, expect, it } from 'vitest';
import { createContest, createSubmissions, createTeams, MedalType, Rank } from './engine';
import { patchBoardEngine } from '../lib/patch-engine.mjs';
import { enhanceBoard, schoolGroup } from '../lib/board';
import { defaultSettings, normalizeSettings, toScriptJson, validateMembers } from '../lib/settings';
import { demoData } from './fixture';

function rankFor(group = 'all', settings = defaultSettings, data = demoData()) {
    const result = enhanceBoard(data, settings);
    const contest = createContest(result.contest as never);
    const rank = new Rank(contest, createTeams(result.teams), createSubmissions(result.submissions, contest));
    rank.options.setGroup(group); rank.buildRank(); return rank;
}

describe('分榜与奖项', () => {
    it('总榜显示金银铜，零过题不获奖', () => {
        const rank = rankFor();
        expect(rank.teams[0].id).toBe('1');
        expect(rank.teams[0].awards).toContain(MedalType.GOLD);
        expect(rank.teams.find((team) => team.id === '3')!.awards).toContain(MedalType.SILVER);
        expect(rank.teams.find((team) => team.id === '7')!.awards).toContain(MedalType.BRONZE);
        expect(rank.teams.find((team) => team.id === '4')!.awards).toEqual([]);
        expect(rank.teams.find((team) => team.id === '8')!.awards).not.toContain(MedalType.BRONZE);
    });
    it('学校榜在学校内独立排名、计算奖牌与一血', () => {
        const group = schoolGroup('南京邮电大学');
        const rank = rankFor(group);
        expect(rank.teams.map((team) => team.id)).toEqual(['3', '4']);
        expect(rank.teams[0].rank).toBe(1);
        expect(rank.teams[0].awards).toContain(MedalType.GOLD);
        expect(rank.teams[0].problemStatistics[0].isFirstSolved).toBe(true);
        expect(rankFor().teams.find((team) => team.id === '3')!.problemStatistics[0].isFirstSolved).toBe(false);
    });
    it('正式/非正式状态与学校及手动分组相互独立', () => {
        expect(rankFor('unofficial').teams.map((team) => team.id)).toEqual(['4', '6']);
        expect(rankFor('official').teams.some((team) => team.id === '4')).toBe(false);
        const settings = normalizeSettings({ ...defaultSettings, manualBoards: [{ id: 'one', name: '一组', teamIds: ['1', '4'] }, { id: 'two', name: '二组', teamIds: ['4'] }] });
        const team = enhanceBoard(demoData(), settings).teams.find((team) => team.team_id === '4')!;
        expect(team.group).toContain('unofficial');
        expect(team.group).toContain('manual-one');
        expect(team.group).toContain('manual-two');
    });
    it('手动榜可以覆盖奖牌数量，空榜不崩溃', () => {
        const settings = normalizeSettings({ ...defaultSettings, manualBoards: [{ id: 'test', name: '测试', teamIds: ['2', '3'], medals: { gold: 0, silver: 1, bronze: 1 } }, { id: 'empty', name: '空榜', teamIds: [] }] });
        expect(rankFor('manual-test', settings).teams[0].awards).toContain(MedalType.SILVER);
        expect(rankFor('manual-empty', settings).teams).toEqual([]);
    });
    it('罚时按秒比较：同一分钟内先通过者名次靠前，不并列', () => {
        const data = demoData();
        data.submissions = [
            { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 630000, status: 'CORRECT' },
            { submission_id: 'b', team_id: '2', problem_id: 0, timestamp: 605000, status: 'CORRECT' },
        ];
        const rank = rankFor('all', defaultSettings, data);
        expect(rank.teams.slice(0, 2).map((team) => [team.id, team.rank, team.penaltyToMinute])).toEqual([['2', 1, 10], ['1', 2, 10]]);
    });
    it('不显示身份时不生成学校榜，也不输出学校', () => {
        const hidden = enhanceBoard(demoData(), defaultSettings, { identity: false });
        expect(Object.keys(hidden.contest.group as object).some((id) => id.startsWith('school-'))).toBe(false);
        expect(hidden.teams.every((team) => team.organization === '')).toBe(true);
    });
    it('并列名次获得相同奖牌', () => {
        const data = demoData();
        data.submissions = [
            { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 600000, status: 'CORRECT' },
            { submission_id: 'b', team_id: '2', problem_id: 0, timestamp: 600000, status: 'CORRECT' },
        ];
        const rank = rankFor('all', defaultSettings, data);
        expect(rank.teams.slice(0, 2).map((team) => team.rank)).toEqual([1, 1]);
        expect(rank.teams.slice(0, 2).every((team) => team.awards.includes(MedalType.GOLD))).toBe(true);
    });
    it('学校名称空白归一化，未填写学校有单独分榜', () => {
        expect(schoolGroup(' 南京晓庄学院 ')).toBe(schoolGroup('南京晓庄学院'));
        expect(rankFor(schoolGroup('未填写学校')).teams.map((team) => team.id)).toEqual(['8']);
    });
    it('封榜后的结果不计入奖牌，重判后重新计算一血', () => {
        const data = demoData();
        data.submissions = data.submissions.map((submission) => ({ ...submission, status: 'FROZEN' }));
        const frozen = enhanceBoard(data, defaultSettings);
        expect(frozen.contest.medal).toMatchObject({ all: { gold: 0, silver: 0, bronze: 0 } });
        const rejudged = demoData();
        rejudged.submissions = rejudged.submissions.map((submission) => submission.team_id === '1' && submission.problem_id === 0 ? { ...submission, status: 'WRONG_ANSWER' } : submission);
        expect(rankFor('all', defaultSettings, rejudged).teams.find((team) => team.id === '3')!.problemStatistics[0].isFirstSolved).toBe(true);
    });
    it('重复使用数据不污染原始结果', () => {
        const data = demoData(); const before = JSON.stringify(data);
        enhanceBoard(data, defaultSettings); enhanceBoard(data, defaultSettings);
        expect(JSON.stringify(data)).toBe(before);
    });
    it('默认排除打星选手，金牌名额顺延，成绩和首次通过保留', () => {
        const data = demoData(); data.teams[0].group = ['unofficial'];
        const rank = rankFor('all', defaultSettings, data);
        const star = rank.teams.find((team) => team.id === '1')!;
        expect(star.rank).toBe(1);
        expect(star.solvedProblemNum).toBe(3);
        expect(star.awards).toEqual([]);
        expect(star.problemStatistics[0].isFirstSolved).toBe(true);
        expect(rank.teams.find((team) => team.id === '3')!.awards).toContain(MedalType.GOLD);
        expect(rank.teams.find((team) => team.id === '7')!.awards).toContain(MedalType.BRONZE);
    });
    it('开启后打星选手正常授奖，其他奖牌随设置重新计算', () => {
        const data = demoData(); data.teams[0].group = ['unofficial'];
        const rank = rankFor('all', { ...defaultSettings, unofficialAwards: true }, data);
        expect(rank.teams[0].id).toBe('1');
        expect(rank.teams[0].awards).toContain(MedalType.GOLD);
        expect(rank.teams.find((team) => team.id === '3')!.awards).toContain(MedalType.SILVER);
    });
    it('全是打星的分榜默认无奖牌，允许参与后独立授奖及首次通过', () => {
        const excluded = rankFor('unofficial');
        expect(excluded.teams).toHaveLength(2);
        expect(excluded.teams.every((team) => team.awards.length === 0)).toBe(true);
        expect(excluded.teams[0].problemStatistics[0].isFirstSolved).toBe(true);
        const allowed = rankFor('unofficial', { ...defaultSettings, unofficialAwards: true });
        expect(allowed.teams[0].awards).toContain(MedalType.GOLD);
        expect(allowed.teams[1].awards).toContain(MedalType.SILVER);
    });
    it('手动分榜自定义奖牌也跳过打星，切换后不会沿用其他分榜的奖项', () => {
        const settings = normalizeSettings({ ...defaultSettings, manualBoards: [{ id: 'mixed', name: '混合榜', teamIds: ['4', '7'], medals: { gold: 1, silver: 0, bronze: 0 } }] });
        const result = enhanceBoard(demoData(), settings);
        const contest = createContest(result.contest as never);
        const rank = new Rank(contest, createTeams(result.teams), createSubmissions(result.submissions, contest));
        for (const group of ['all', 'manual-mixed', 'unofficial', 'manual-mixed']) {
            rank.options.setGroup(group); rank.buildRank();
            expect(rank.teams.filter((team) => team.isUnofficial).every((team) => !team.awards.length)).toBe(true);
            if (group === 'manual-mixed') expect(rank.teams.find((team) => team.id === '7')!.awards).toContain(MedalType.GOLD);
        }
    });
    it('奖项边界并列时，打星不占名额且不影响符合条件选手并列同奖', () => {
        const data = demoData(); data.teams[2].group = ['unofficial'];
        data.submissions = ['1', '2', '3'].map((team_id) => ({ submission_id: `tie-${team_id}`, team_id, problem_id: 0, timestamp: 600000, status: 'CORRECT' }));
        const rank = rankFor('all', { ...defaultSettings, medals: { gold: 1, silver: 0, bronze: 0 } }, data);
        expect(rank.teams.find((team) => team.id === '3')!.awards).toEqual([]);
        expect(['1', '2'].every((id) => rank.teams.find((team) => team.id === id)!.awards.includes(MedalType.GOLD))).toBe(true);
        expect(rank.teams.find((team) => team.id === '8')!.awards).not.toContain(MedalType.GOLD);
    });
});

describe('设置验证', () => {
    it('拒绝非法奖牌数量和重复分榜标识', () => {
        expect(() => normalizeSettings({ ...defaultSettings, medals: { gold: -1, silver: 2, bronze: 3 } })).toThrow();
        expect(() => normalizeSettings({ ...defaultSettings, manualBoards: [{ id: 'x', name: '甲', teamIds: [] }, { id: 'x', name: '乙', teamIds: [] }] })).toThrow();
    });
    it('拒绝其他比赛成员，去重成员 ID', () => {
        const settings = normalizeSettings({ ...defaultSettings, manualBoards: [{ id: 'a', name: '甲', teamIds: ['1', '1', '999'] }] });
        expect(settings.manualBoards[0].teamIds).toEqual(['1', '999']);
        expect(() => validateMembers(settings, new Set(['1']))).toThrow('999');
    });
    it('安全嵌入含 HTML 的名称', () => {
        const value = { name: '</script><script>alert(1)</script>\u2028' };
        const json = toScriptJson(value);
        expect(json).not.toContain('<'); expect(JSON.parse(json)).toEqual(value);
    });
    it('旧配置默认打星不参与奖项，拒绝非布尔设置', () => {
        const { unofficialAwards, ...legacy } = defaultSettings;
        expect(normalizeSettings(legacy).unofficialAwards).toBe(false);
        expect(() => normalizeSettings({ ...defaultSettings, unofficialAwards: 'false' })).toThrow('unofficialAwards');
    });
    it('上游引擎入口不匹配时中断构建，避免静默授奖错误', () => {
        expect(() => patchBoardEngine('class Unsupported {}')).toThrow('无法扩展');
        expect(() => patchBoardEngine('buildRank(){} buildRank(){}')).toThrow('无法扩展');
    });
});
