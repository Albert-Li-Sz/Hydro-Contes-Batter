/**
 * Hydro STATUS codes as CCS judgement types. Penalties follow the plugin's one rule (index.ts
 * status map, Hydro's ACM rule): accepted, compile errors, format errors and cancelled records are
 * free, everything else judged costs 20 minutes, system errors and ignored records included.
 *
 * Simplified types carry the board's public masking: while the contest runs, viewers without
 * hidden-scoreboard access see a wrong result only as "rejected" (RE).
 */
import type { JudgementType } from './types';

/** Hydro @hydrooj/common STATUS. */
export const HYDRO = {
    WAITING: 0, ACCEPTED: 1, WRONG_ANSWER: 2, TIME_LIMIT_EXCEEDED: 3, MEMORY_LIMIT_EXCEEDED: 4, OUTPUT_LIMIT_EXCEEDED: 5,
    RUNTIME_ERROR: 6, COMPILE_ERROR: 7, SYSTEM_ERROR: 8, CANCELED: 9, ETC: 10, HACKED: 11,
    JUDGING: 20, COMPILING: 21, FETCHED: 22, IGNORED: 30, FORMAT_ERROR: 31, HACK_SUCCESSFUL: 32, HACK_UNSUCCESSFUL: 33,
} as const;

export const PENDING_STATUSES = new Set<number>([HYDRO.WAITING, HYDRO.JUDGING, HYDRO.COMPILING, HYDRO.FETCHED]);
export const isPending = (status: number) => PENDING_STATUSES.has(status);

export const judgementTypes: JudgementType[] = [
    { id: 'AC', name: '通过（Accepted）', penalty: false, solved: true, simplified_judgement_type_id: 'AC' },
    { id: 'RE', name: '未通过（Rejected）', penalty: true, solved: false, simplified_judgement_type_id: 'RE' },
    { id: 'WA', name: '答案错误（Wrong Answer）', penalty: true, solved: false, simplified_judgement_type_id: 'RE' },
    { id: 'TLE', name: '超时（Time Limit Exceeded）', penalty: true, solved: false, simplified_judgement_type_id: 'RE' },
    { id: 'MLE', name: '超内存（Memory Limit Exceeded）', penalty: true, solved: false, simplified_judgement_type_id: 'RE' },
    { id: 'OLE', name: '输出超限（Output Limit Exceeded）', penalty: true, solved: false, simplified_judgement_type_id: 'RE' },
    { id: 'RTE', name: '运行错误（Run-Time Error）', penalty: true, solved: false, simplified_judgement_type_id: 'RE' },
    { id: 'CE', name: '编译错误（Compile Error）', penalty: false, solved: false, simplified_judgement_type_id: 'CE' },
    { id: 'PE', name: '格式错误（Presentation Error）', penalty: false, solved: false, simplified_judgement_type_id: 'PE' },
    { id: 'JE', name: '系统错误（Judging Error）', penalty: true, solved: false, simplified_judgement_type_id: 'JE' },
    { id: 'SE', name: '已取消（Submission Error）', penalty: false, solved: false, simplified_judgement_type_id: 'SE' },
    { id: 'CS', name: '其他错误（Contact Staff）', penalty: true, solved: false, simplified_judgement_type_id: 'CS' },
];
const byId = new Map(judgementTypes.map((type) => [type.id, type]));

/** The CCS type of a judged Hydro status; null while pending. */
export function judgementTypeOf(status: number): string | null {
    switch (status) {
        case HYDRO.ACCEPTED: return 'AC';
        case HYDRO.WRONG_ANSWER: case HYDRO.HACKED: return 'WA';
        case HYDRO.TIME_LIMIT_EXCEEDED: return 'TLE';
        case HYDRO.MEMORY_LIMIT_EXCEEDED: return 'MLE';
        case HYDRO.OUTPUT_LIMIT_EXCEEDED: return 'OLE';
        case HYDRO.RUNTIME_ERROR: return 'RTE';
        case HYDRO.COMPILE_ERROR: return 'CE';
        case HYDRO.FORMAT_ERROR: return 'PE';
        case HYDRO.SYSTEM_ERROR: return 'JE';
        case HYDRO.CANCELED: return 'SE';
        case HYDRO.IGNORED: return 'RE';
        default: return isPending(status) ? null : 'CS';
    }
}

export const simplifiedOf = (typeId: string | null) => (typeId ? byId.get(typeId)?.simplified_judgement_type_id ?? typeId : null);
export const isSolved = (typeId: string | null) => !!typeId && !!byId.get(typeId)?.solved;
export const hasPenalty = (typeId: string | null) => !!typeId && !!byId.get(typeId)?.penalty;
