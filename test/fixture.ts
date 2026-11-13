import type { BoardData } from '../lib/board';
import { buildRosterTeam, defaultProfileFields } from '../lib/roster';

export function demoRoster() {
    return demoData().teams.map((team) => buildRosterTeam({
        _id: Number(team.team_id), uname: `user${team.team_id}`, displayName: team.name, school: team.organization,
        group: Number(team.team_id) % 2 ? ['新生组'] : ['校队组'],
        grade: Number(team.team_id) % 2 ? '2026级' : '2025级',
        class: Number(team.team_id) < 5 ? '计科一班' : '软件二班',
        department: '信息工程学院', major: Number(team.team_id) < 5 ? '计算机科学与技术' : '软件工程',
        getFields: () => ['grade', 'class', 'department', 'major'],
    }, team.group.includes('unofficial'), defaultProfileFields));
}

export function demoData(): BoardData {
    const teams = [
        ['1', '林澈', '南京晓庄学院', 'official'], ['2', '周宁', '南京晓庄学院', 'official'],
        ['3', '陈言', '南京邮电大学', 'official'], ['4', '苏禾', '南京邮电大学', 'unofficial'],
        ['5', '许青', '东南大学', 'official'], ['6', '江屿', '东南大学', 'unofficial'],
        ['7', '沈星', '南京晓庄学院', 'official'], ['8', '陆川', '', 'official'],
    ].map(([team_id, name, organization, group]) => ({ team_id, name, organization, group: [group] }));
    const solves = [
        ['1', 0, 600], ['1', 1, 1800], ['1', 2, 4200],
        ['2', 0, 1200], ['2', 1, 2400], ['3', 0, 900], ['3', 1, 2100], ['3', 2, 4800],
        ['4', 0, 1500], ['4', 2, 3000], ['5', 1, 600], ['5', 2, 3600], ['6', 0, 1800], ['7', 2, 2400],
    ] as const;
    return {
        contest: {
            contest_name: 'Hydro XCPCIO 增强榜 · 功能演示',
            start_time: 1793062800, end_time: 1793080800, frozen_time: 0,
            problem_quantity: 3, problem_id: ['A', 'B', 'C'], penalty: 1200,
            organization: '学校',
            status_time_display: { correct: true, incorrect: true, pending: true },
            balloon_color: [{ color: '#fff', background_color: '#e8794c' }, { color: '#fff', background_color: '#3b82f6' }, { color: '#fff', background_color: '#a855f7' }],
        },
        teams,
        submissions: solves.map(([id, problem, second], index) => ({
            submission_id: `s-${index}`, team_id: id, problem_id: problem, timestamp: second * 1000, status: 'CORRECT',
        })),
    };
}
