// Reserved team tag understood by the pinned XCPCIO engine extension.
export const AWARD_EXEMPT_TAG = 'hydro:award-exempt';

/** Apply eligibility after XCPCIO has calculated results for the current group.
 * Score order, ranks, ties and first solves stay with the upstream engine.
 * Awards use the rank among eligible teams, so excluded teams consume no slots.
 */
export function applyAwardEligibility(rank) {
    if (!rank.teams.some((team) => team.tag.includes(AWARD_EXEMPT_TAG))) return rank;
    const awards = rank.contest.awards?.get(rank.options.group) || [];
    let position = 0;
    let previous;
    let awardRank = 0;
    for (const team of rank.teams) {
        team.awards = [];
        if (team.tag.includes(AWARD_EXEMPT_TAG)) continue;
        position++;
        if (!previous || !team.isEqualRank(previous)) awardRank = position;
        if (team.solvedProblemNum > 0) {
            team.awards = awards.filter((award) => awardRank >= award.minRank && awardRank <= award.maxRank)
                .map((award) => award.medalType);
        }
        previous = team;
    }
    return rank;
}
