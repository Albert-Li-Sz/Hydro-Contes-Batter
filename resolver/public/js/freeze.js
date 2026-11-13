// HydroXCPCIO: explicit freeze selection and Hydro's inclusive visible boundary.
export const FREEZE_DEFAULTS = Object.freeze({ freezeMode: 'feed', freezeMinutes: 60 });

export function judgementVisible(contest, submission, frozen = true) {
  if (submission.status === 'pending') return false;
  if (!frozen) return true;
  const boundary = contest.durationMs - contest.freezeDurationMs;
  if (contest.scoringMode === 'hydro') return submission.contestTime <= boundary;
  return submission.contestTime < boundary || (submission.status === 'failed' && !submission.penalty);
}

export function normalizeFreezeOptions(raw = {}) {
  const n = Number(raw.freezeMinutes);
  return { freezeMode: ['custom', 'none'].includes(raw.freezeMode) ? raw.freezeMode : 'feed',
    freezeMinutes: raw.freezeMinutes != null && raw.freezeMinutes !== '' && Number.isFinite(n) ? Math.max(0, n) : 60 };
}

/** Submissions without a final judgement; the final CCS export should contain none. */
export function unjudgedCount(contest) {
  return (contest?.submissions || []).filter((s) => s.status === 'pending').length;
}

export function withFreezeOptions(contest, options) {
  // Like ICPC Tools `--test`, unjudged submissions are discarded before resolving;
  // otherwise they would stay pending with no step that can ever reveal them.
  const unjudged = unjudgedCount(contest);
  if (unjudged) contest = { ...contest, submissions: contest.submissions.filter((s) => s.status !== 'pending'), discardedUnjudged: unjudged };
  if (contest.missingSubmissionTimes > 0) {
    throw Object.assign(new Error(`有 ${contest.missingSubmissionTimes} 条提交缺少时间或含无效时间，无法可靠计算排名，请重新导出完整事件流`), { status: 400, expose: true });
  }
  if (options.freezeMode === 'none') return { ...contest, freezeDurationMs: 0, freezeSource: 'none' };
  if (options.freezeMode !== 'custom') {
    if (contest.freezeDurationMs > 0 || !(contest.durationMs > 0)) return contest;
    if (contest.scoringMode === 'hydro') {
      throw Object.assign(new Error('比赛未设置封榜时间，请指定本次滚榜的封榜点'), { status: 400, expose: true });
    }
    // Final CCS exports often replace the freeze duration with zero and omit
    // its history. Reconstruct locally; never rewrite the shared/live contest.
    return { ...contest, freezeDurationMs: Math.min(60 * 60000, contest.durationMs), freezeSource: 'fallback' };
  }
  const freezeDurationMs = Math.round(options.freezeMinutes * 60000);
  if (freezeDurationMs <= 0 || freezeDurationMs > contest.durationMs) {
    throw Object.assign(new Error('封榜时长须大于 0 且不超过比赛时长'), { status: 400, expose: true });
  }
  return { ...contest, freezeDurationMs, freezeSource: 'custom' };
}

/** Count hidden work on the import page, excluding non-penalty errors and already solved cells. */
export function frozenPendingCount(contest, options) {
  const c = withFreezeOptions(contest, options);
  const teams = new Map((c.teams || []).map((team) => [team.id, new Map()]));
  const problems = new Set((c.problems || []).map((problem) => problem.id));
  for (const s of (c.submissions || []).slice().sort((a, b) => a.contestTime - b.contestTime)) {
    const cells = teams.get(s.teamId);
    if (!cells || !problems.has(s.problemId) || !Number.isFinite(s.contestTime) || s.contestTime < 0 ||
        (c.durationMs > 0 && s.contestTime >= c.durationMs)) continue;
    const cell = cells.get(s.problemId) || { solved: false, pending: 0 };
    cells.set(s.problemId, cell);
    if (cell.solved) continue;
    const visible = judgementVisible(c, s);
    if (!visible) cell.pending++;
    else if (s.status === 'solved') { cell.solved = true; cell.pending = 0; }
  }
  let pending = 0;
  for (const cells of teams.values()) for (const cell of cells.values()) pending += cell.pending;
  return pending;
}
