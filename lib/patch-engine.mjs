/** Extend only the pinned engine's public buildRank entry. Fail closed on
 * upstream changes instead of silently falling back to incorrect awards.
 */
export function patchBoardEngine(source) {
    const entry = /\bbuildRank\(\)\s*\{/g;
    if ([...source.matchAll(entry)].length !== 1 || source.includes('hydroBuildRank')) {
        throw new Error('无法扩展 XCPCIO 0.85.4 的奖项计算，请检查上游构建产物');
    }
    return 'import { applyAwardEligibility as __hydroApplyAwardEligibility } from "../award-policy.mjs";\n'
        + source.replace(entry, 'buildRank(){return __hydroApplyAwardEligibility(this.hydroBuildRank())}hydroBuildRank(){');
}
