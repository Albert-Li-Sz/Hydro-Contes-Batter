import { describe, expect, it } from 'vitest';
import { contestOverview } from '../lib/overview';
import { demoData } from './fixture';

const begin = Date.UTC(2026, 10, 16, 1, 0, 0);
const at = (minute: number) => begin + minute * 60_000;
const overview = (now: number, data = demoData()) => contestOverview({
    title: '测试比赛', beginAt: begin, endAt: at(300), lockAt: at(240), now, data,
});

describe('contest overview', () => {
    it('follows the contest clock: before, running, frozen, ended', () => {
        expect(overview(at(-5)).status).toBe('before');
        expect(overview(at(100)).status).toBe('running');
        expect(overview(at(250)).status).toBe('frozen');
        expect(overview(at(300)).status).toBe('ended');
        expect(contestOverview({ title: 't', beginAt: begin, endAt: at(300), lockAt: null, now: at(250), data: demoData() }).status).toBe('running');
    });

    it('counts teams, schools, problems and runs, with rates in percent', () => {
        const data = demoData();
        data.teams.push({ team_id: '9', name: '未报学校', organization: '未填写学校', group: ['official'] });
        data.submissions.push(
            { submission_id: 'w1', team_id: '8', problem_id: 0, timestamp: 700_000, status: 'WRONG_ANSWER' },
            { submission_id: 'late', team_id: '8', problem_id: 0, timestamp: 300 * 60_000, status: 'CORRECT' }, // after the end
        );
        const result = overview(at(300), data);
        expect(result).toMatchObject({
            teams: 9, officialTeams: 7, unofficialTeams: 2,
            schools: 3, // blank and 未填写学校 are not schools
            problems: 3, solvedProblems: 3,
            submissions: 15, accepted: 14, acceptRate: 93.3,
            solvedTeams: 7, solvedTeamsRate: 77.8, averageSolved: 1.6,
        });
    });

    it('ranks official teams by solved count and penalty, with first solves and schools', () => {
        const result = overview(at(300));
        expect(result.topTeams.map((team) => [team.rank, team.name, team.solved, team.penaltyMinutes])).toEqual([
            [1, '林澈', 3, 110], [2, '陈言', 3, 130], [3, '周宁', 2, 60], [4, '许青', 2, 70], [5, '沈星', 1, 40], [6, '陆川', 0, 0],
        ]);
        expect(result.problemStats.map((problem) => [problem.label, problem.solvedTeams, problem.attemptedTeams, problem.firstSolve?.team, problem.firstSolve?.minute]))
            .toEqual([['A', 5, 5, '林澈', 10], ['B', 4, 4, '许青', 10], ['C', 5, 5, '沈星', 40]]);
        expect(result.problemStats[0].color).toBe('#e8794c');
        expect(result.schoolStats.map((school) => [school.name, school.teams, school.solvedTeams, school.solved, school.bestRank])).toEqual([
            ['南京晓庄学院', 3, 3, 6, 1], ['南京邮电大学', 2, 2, 5, 2], ['东南大学', 2, 2, 3, 4],
        ]);
        expect(result.histogram).toEqual([{ solved: 0, teams: 1 }, { solved: 1, teams: 2 }, { solved: 2, teams: 3 }, { solved: 3, teams: 2 }]);
        expect(result.verdicts.find((item) => item.key === 'ok')?.count).toBe(14);
        expect(result.recentAccepts[0]).toMatchObject({ minute: 80, team: '陈言', problem: 'C', firstSolve: false });
    });

    it('charges 20 minutes per wrong run before the accept, ties share a rank, starred first solves follow the setting', () => {
        const data = demoData();
        data.submissions.push(
            { submission_id: 'x1', team_id: '8', problem_id: 0, timestamp: 700_000, status: 'WRONG_ANSWER' },
            { submission_id: 'x2', team_id: '8', problem_id: 0, timestamp: 800_000, status: 'COMPILATION_ERROR' }, // no penalty
            { submission_id: 'x3', team_id: '8', problem_id: 0, timestamp: 1_000_000, status: 'CORRECT' },
            { submission_id: 'x4', team_id: '8', problem_id: 0, timestamp: 1_100_000, status: 'WRONG_ANSWER' }, // after the accept
            { submission_id: 'x5', team_id: '6', problem_id: 0, timestamp: 300_000, status: 'CORRECT' }, // starred, earliest
            { submission_id: 'x6', team_id: '7', problem_id: 1, timestamp: 2_000_000, status: 'PENDING' },
        );
        const result = overview(at(300), data);
        expect(result.topTeams.find((team) => team.name === '陆川')).toMatchObject({ solved: 1, penaltyMinutes: 36 }); // 1000 s + 1200 s
        expect(result.problemStats[0].firstSolve?.team).toBe('林澈');
        expect(result.pending).toBe(1);
        expect(result.verdicts.find((item) => item.key === 'pending')?.count).toBe(1);
        const starred = contestOverview({ title: 't', beginAt: begin, endAt: at(300), lockAt: at(240), now: at(300), data, unofficialFirstSolve: true });
        expect(starred.problemStats[0].firstSolve).toMatchObject({ team: '江屿', minute: 5 });
        // Equal solved count and penalty share a rank; ties are listed by name (pinyin: 陆 before 沈).
        const tied = demoData();
        tied.submissions.push({ submission_id: 't1', team_id: '8', problem_id: 2, timestamp: 2_400_000, status: 'CORRECT' });
        expect(overview(at(300), tied).topTeams.slice(4).map((team) => [team.rank, team.name])).toEqual([[5, '陆川'], [5, '沈星']]);
    });

    it('builds a cumulative trend over the elapsed time only', () => {
        const result = overview(at(30));
        expect(result.trend).toHaveLength(30);
        expect(result.trend.at(-1)).toEqual({ minute: 30, submissions: 7, accepted: 7 }); // a run at 30:00 counts
        expect(result.trend.every((point, index) => !index || point.submissions >= result.trend[index - 1].submissions)).toBe(true);
        const ended = overview(at(400));
        expect(ended.trend).toHaveLength(60);
        expect(ended.trend.at(-1)).toMatchObject({ minute: 300, submissions: 14, accepted: 14 });
        expect(overview(at(-1)).trend).toEqual([]);
    });
});
