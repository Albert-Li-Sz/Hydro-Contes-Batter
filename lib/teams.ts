/**
 * Hydro team contests (Hydro 5.1, `tdoc.allowTeam`): a team is a virtual user whose contest status
 * carries `displayName` and the member user ids in `members`. A participant who attends alone has
 * no members and stays a one-person team, as in every contest before.
 */

export interface TeamEntry {
    uid: number;
    displayName?: string;
    members?: number[];
}

export interface TeamUser {
    _id: number;
    uname: string;
    displayName?: string;
    school?: string;
}

export function isTeamEntry(entry: TeamEntry): entry is TeamEntry & { members: number[] } {
    return Array.isArray(entry.members) && entry.members.length > 0;
}

/** Member ids to load with the participants (only team contests have any). */
export function memberIds(tdoc: object, entries: TeamEntry[]) {
    // `allowTeam` exists from Hydro 5.1 on; older versions have no team contests.
    if (!(tdoc as { allowTeam?: unknown }).allowTeam) return [];
    return [...new Set(entries.flatMap((entry) => (isTeamEntry(entry) ? entry.members : [])))];
}

/** A member's name: the private display name only where identity may be shown (as Hydro's board). */
const personName = (user: TeamUser, identity: boolean) => (identity && user.displayName) || user.uname;

/** The school most members share; ties go to the earlier member. */
function teamSchool(members: TeamUser[]) {
    const counts = new Map<string, number>();
    for (const member of members) {
        const school = (member.school || '').trim();
        if (school) counts.set(school, (counts.get(school) || 0) + 1);
    }
    let best = '';
    for (const [school, count] of counts) if (count > (counts.get(best) || 0)) best = school;
    return best;
}

export function describeTeam(entry: TeamEntry, users: Record<number, TeamUser | undefined>, identity: boolean) {
    const user = users[entry.uid];
    if (!user) return null;
    if (!isTeamEntry(entry)) {
        return { name: personName(user, identity), school: identity ? user.school : undefined, members: undefined };
    }
    const members = entry.members.map((uid) => users[uid]).filter((member): member is TeamUser => !!member && !!member._id);
    return {
        // Team names are public in Hydro (its board shows them to everyone); the virtual user's
        // generated login name is only a fallback.
        name: user.displayName || entry.displayName || user.uname,
        school: identity ? teamSchool(members) : undefined,
        members: members.map((member) => personName(member, identity)),
    };
}
