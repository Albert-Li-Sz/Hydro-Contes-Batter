export interface Medals {
    gold: number;
    silver: number;
    bronze: number;
}

export interface ManualBoard {
    id: string;
    name: string;
    teamIds: string[];
    medals?: Medals;
}

export interface BoardSettings {
    medals: Medals;
    unofficialAwards: boolean;
    schoolBoards: boolean;
    participationBoards: boolean;
    manualBoards: ManualBoard[];
    publicAccess: boolean;
    replaceNative: boolean;
    /** Show Hydro's private display name and school to viewers without PERM_VIEW_USER_PRIVATE_INFO. */
    showIdentity: boolean;
}

export const defaultSettings: BoardSettings = {
    medals: { gold: 1, silver: 2, bronze: 3 },
    unofficialAwards: false,
    schoolBoards: true,
    participationBoards: true,
    manualBoards: [],
    publicAccess: false,
    replaceNative: true,
    showIdentity: false,
};

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
    return value as Record<string, unknown>;
}

function medals(value: unknown, label: string): Medals {
    const input = object(value, label);
    const result = {} as Medals;
    for (const key of ['gold', 'silver', 'bronze'] as const) {
        const count = input[key];
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 100000) {
            throw new Error(`${label}.${key} 必须是 0 至 100000 的整数`);
        }
        result[key] = count;
    }
    return result;
}

export function normalizeSettings(value: unknown): BoardSettings {
    const input = object(value, '榜单设置');
    for (const key of ['schoolBoards', 'participationBoards']) {
        if (typeof input[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
    }
    for (const key of ['publicAccess', 'replaceNative', 'unofficialAwards', 'showIdentity']) {
        if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
    }
    if (!Array.isArray(input.manualBoards) || input.manualBoards.length > 50) {
        throw new Error('手动分榜必须是数组，最多 50 个');
    }
    const ids = new Set<string>();
    const manualBoards = input.manualBoards.map((value, index): ManualBoard => {
        const board = object(value, `手动分榜 ${index + 1}`);
        if (typeof board.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(board.id) || ids.has(board.id)) {
            throw new Error('分榜标识应为 1 至 48 位小写字母、数字、下划线或连字符，且不能重复');
        }
        ids.add(board.id);
        if (typeof board.name !== 'string' || !board.name.trim() || board.name.trim().length > 64) {
            throw new Error('分榜名称应为 1 至 64 个字符');
        }
        if (!Array.isArray(board.teamIds) || board.teamIds.length > 10000
            || board.teamIds.some((id) => typeof id !== 'string' || !/^\d{1,16}$/.test(id))) {
            throw new Error('分榜成员必须是 Hydro 用户 ID 字符串数组，最多 10000 人');
        }
        return {
            id: board.id,
            name: board.name.trim(),
            teamIds: [...new Set(board.teamIds as string[])],
            ...(board.medals === undefined ? {} : { medals: medals(board.medals, board.name) }),
        };
    });
    return {
        medals: medals(input.medals, '奖牌数量'),
        unofficialAwards: input.unofficialAwards === undefined ? false : input.unofficialAwards as boolean,
        schoolBoards: input.schoolBoards as boolean,
        participationBoards: input.participationBoards as boolean,
        manualBoards,
        // Anything that widens who can see what stays off unless it was saved explicitly.
        publicAccess: input.publicAccess === true,
        replaceNative: input.replaceNative === undefined ? true : input.replaceNative as boolean,
        showIdentity: input.showIdentity === true,
    };
}

export function validateMembers(settings: BoardSettings, knownIds: Set<string>) {
    for (const board of settings.manualBoards) {
        const unknownIds = board.teamIds.filter((id) => !knownIds.has(id));
        if (unknownIds.length) throw new Error(`${board.name} 包含未参加本场比赛的用户：${unknownIds.join(', ')}`);
    }
}

/** Compared the way viewers read them: width, case and spacing differences do not make a name distinct. */
export function boardNameKey(name: string): string {
    return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Checked on save only, so settings stored before this rule existed still load. */
export function checkBoardNames(settings: BoardSettings, reserved: string[] = []) {
    const taken = new Set(reserved.map(boardNameKey));
    for (const board of settings.manualBoards) {
        const key = boardNameKey(board.name);
        if (taken.has(key)) throw new Error(`分榜名称“${board.name}”与其他榜单重复，请改用不同的名称`);
        taken.add(key);
    }
}

export function pruneMembers(settings: BoardSettings, knownIds: Set<string>): BoardSettings {
    return { ...settings, manualBoards: settings.manualBoards.map((board) => ({ ...board, teamIds: board.teamIds.filter((id) => knownIds.has(id)) })) };
}

export function toScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
