/*
 * Port of ICPC Tools v2.6.1331 TitledPresentation, AbstractScoreboardPresentation (with
 * ShadedRectangle and TextImage), GroupLeaderboardPresentation and AllGroupsLeaderboardPresentation.
 */
import { Animator, Movement } from "./animator.js";
import { javaFont, stringWidth, drawString, TextHelper } from "./java-text.js";
import { Color, ICPCColors, JColor, darker, fillRect, drawLine, fillPath, strokePath, logoImage } from "./java-graphics.js";
import { JavaPresentation } from "./presentation-java.js";

const trunc = Math.trunc, f32 = Math.fround;
const BORDER = 8, CLOCK_MARGIN = 2, CUBE_INSET = 5, ARC = 7;
const ROW_MOVEMENT = new Movement(4, 7), BG_COLOR = new JColor(60, 60, 60);
const SR_BG = new JColor(40, 40, 40), SR_BG_TEXT = new JColor(196, 196, 196, 175);

/** ShadedRectangle's quadratic round rect. */
function shadedPath(w, h) {
  return [["M", [ARC, 0]], ["L", [w - ARC, 0]], ["Q", [w, 0], [w, ARC]], ["L", [w, h - ARC]], ["Q", [w, h], [w - ARC, h]],
    ["L", [ARC, h]], ["Q", [0, h], [0, h - ARC]], ["L", [0, ARC]], ["Q", [0, 0], [ARC, 0]], ["Z"]];
}

/** ShadedRectangle.getPaint */
export function shadedPaint(g, h, status, recent, fts, time) {
  let k;
  if (recent) {
    k = trunc(((time * 45.0) / 1000.0) % (ICPCColors.CCOUNT * 2));
    if (k > ICPCColors.CCOUNT - 1) k = ICPCColors.CCOUNT * 2 - 1 - k;
  } else k = trunc(ICPCColors.CCOUNT / 3);
  const c = status === "SUBMITTED" ? ICPCColors.PENDING[k] : status === "SOLVED" ? (fts ? ICPCColors.FIRST_TO_SOLVE[k] : ICPCColors.SOLVED[k])
    : status === "FAILED" ? ICPCColors.FAILED[k] : null;
  if (!c || !recent) return c && c.css();
  const gradient = g.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, c.css());
  gradient.addColorStop(1, darker(c, 0.55).css());
  return gradient;
}

/** ShadedRectangle.drawRoundRect(g, x, y, w, h, paint, outline, s) */
export function shadedRect(g, x, y, ww, hh, paint, outline, s, fonts = {}) {
  g.save();
  g.translate(x, y);
  let w = ww, h = hh;
  if (outline) {
    g.translate(1, 1);
    w -= 2;
    h -= 2;
  }
  fillPath(g, shadedPath(w, h), paint ?? SR_BG);
  if (outline) strokePath(g, shadedPath(w, h), outline, { width: 2 });
  if (s != null && fonts.dialog) {
    // A fresh image Graphics with no status font set keeps Java's default 12pt "Dialog".
    g.font = '12px "Lucida Grande", "DejaVu Sans", Arial, sans-serif';
    g.fillStyle = paint == null ? SR_BG_TEXT.css() : Color.WHITE.css();
    const width = g.measureText(s).width;
    g.fillText(s, trunc((w - width) / 2), paint == null ? trunc((h + 15) / 2) - 3 + 1 : trunc(h / 2) + 7 - 3 + 1);
  } else if (s != null) {
    if (paint == null) {
      const fm = { ...fonts.problemFont, fractional: true };
      drawString(g, fm, s, trunc((w - stringWidth(g, fm, s)) / 2), trunc((h + fm.height) / 2) - fm.descent + 1, SR_BG_TEXT.css());
    } else {
      const fm = { ...fonts.statusFont, fractional: true };
      drawString(g, fm, s, trunc((w - stringWidth(g, fm, s)) / 2), trunc(h / 2) + trunc(fm.height / 2) - fm.descent + 1, Color.WHITE.css());
    }
  }
  g.restore();
}

/** TextImage.drawString: fractional-metrics text whose top is at y. */
function textImage(g, font, s, x, y, color = Color.WHITE) {
  const fm = { ...font, fractional: true };
  drawString(g, fm, s, x, y + fm.ascent, color.css());
}

export class TitledPresentation extends JavaPresentation {
  constructor() {
    super();
    this.titleHeight = 20;
    this.headerHeight = 20;
    this.showClock = true;
  }
  setSize(w, h) {
    super.setSize(w, h);
    if (w && h) this.setup();
  }
  setup() {
    const size = trunc((this.height * 72.0 * 0.028) / 96);
    this.titleFont = javaFont(f32(size * f32(2.2)), true);
    this.clockFont = javaFont(f32(size * f32(1.25)), true);
  }
  getTitle() {
    return null;
  }
  drawHeader(g) {
    fillRect(g, 0, 0, this.width, this.headerHeight + 2, Color.BLACK);
    drawLine(g, 0, this.headerHeight - 1, this.width, this.headerHeight - 1, Color.WHITE);
  }
  paintHeader(g) {
    g.save();
    g.translate(0, this.titleHeight);
    g.beginPath();
    g.rect(0, 0, this.width, this.headerHeight);
    g.clip();
    this.drawHeader(g);
    g.restore();
    if (this.showClock) {
      const color = this.getContest().isFrozen(this.getTimeMs()) ? ICPCColors.YELLOW : Color.WHITE, fm = this.clockFont;
      let s = this.getContestTime();
      if (s != null) drawString(g, fm, s, trunc(this.width / 12) - trunc(stringWidth(g, fm, s) / 2), fm.ascent + CLOCK_MARGIN, color.css());
      s = this.getRemainingTime();
      if (s != null) drawString(g, fm, s, trunc((this.width * 11) / 12) - trunc(stringWidth(g, fm, s) / 2), fm.ascent + CLOCK_MARGIN, color.css());
    }
  }
  paint(g) {
    this.paintHeader(g);
    const s = this.getTitle();
    if (s != null) drawString(g, this.titleFont, s, trunc((this.width - stringWidth(g, this.titleFont, s)) / 2), this.titleFont.ascent, Color.WHITE.css());
    if (!this.getContest().getNumTeams()) return;
    g.save();
    g.translate(0, this.headerHeight + this.titleHeight);
    g.beginPath();
    g.rect(0, 0, this.width, this.height - this.headerHeight - this.titleHeight);
    g.clip();
    this.paintImpl(g);
    g.restore();
  }
}

export class AbstractScoreboard extends TitledPresentation {
  constructor() {
    super();
    this.teamsPerScreen = 12;
    this.rowHeight = 20;
    this.teamYmap = new Map();
    this.oldNumProblems = -1;
    this.image = () => null;
  }
  setup() {
    const size0 = trunc((this.height * 72.0 * 0.028) / 96);
    let headerFontSize = size0;
    this.headerHeight = trunc(this.height / 50.0);
    this.titleHeight = this.getTitle() == null ? 0 : trunc(this.height / 30.0);
    const tempRowHeight = f32(this.height / f32(this.teamsPerScreen)), size = f32(f32(f32(tempRowHeight * 36) * f32(0.95)) / 96);
    this.rowFont = javaFont(f32(size * f32(1.25)), true);
    this.statusFont = javaFont(f32(size * f32(0.7)), true);
    this.problemFont = javaFont(f32(size * f32(0.5)), false);
    this.rowHeight = f32((this.height - this.headerHeight - this.titleHeight) / f32(this.teamsPerScreen));
    this.cubeHeight = trunc(f32(this.rowHeight / f32(2.5))) - CUBE_INSET;
    let newCubeWidth = trunc(f32(f32(f32(this.rowHeight / f32(1.8)) - CUBE_INSET) * 10));
    this.oldNumProblems = this.getContest().getProblems().length;
    while (newCubeWidth > 30 && (newCubeWidth + CUBE_INSET) * this.oldNumProblems > this.width - this.rowHeight * 3 - 70) newCubeWidth -= 2;
    this.cubeWidth = newCubeWidth;
    headerFontSize = Math.min(headerFontSize, f32(size * f32(0.85)));
    this.headerFont = javaFont(headerFontSize, true);
    super.setup();
  }
  aboutToShow() {
    this.initTeamY();
  }
  incrementTimeMs(dt) {
    this.updateTeamY(dt);
  }
  getTeamY(team) {
    const anim = this.teamYmap.get(team.id);
    return anim ? anim.getValue() * this.rowHeight : 0.0;
  }
  initTeamY() {
    const teams = this.getContest().getOrderedTeams(), targets = this.getTeamYTargets(teams);
    teams.forEach((team, i) => this.teamYmap.set(team.id, new Animator(targets[i], ROW_MOVEMENT)));
  }
  getTeamYTargets(teams) {
    return teams.map((_, i) => i);
  }
  updateTeamY(dt) {
    const teams = this.getContest().getOrderedTeams(), targets = this.getTeamYTargets(teams);
    teams.forEach((team, i) => {
      const current = this.teamYmap.get(team.id);
      if (!current) this.teamYmap.set(team.id, new Animator(targets[i], ROW_MOVEMENT));
      else {
        current.setTarget(targets[i]);
        current.incrementTimeMs(dt);
      }
    });
  }
  drawHeader(g) {
    const fm = this.rowFont, fm2 = this.headerFont, w = this.width, y = this.headerHeight - 3, words = this.words, white = Color.WHITE.css();
    fillRect(g, 0, 0, w, this.headerHeight + 2, Color.BLACK);
    drawLine(g, 0, this.headerHeight - 1, w, this.headerHeight - 1, Color.WHITE);
    const rank = words.rank || "Rank", name = words.name || "Name", solved = words.solved || "Solved", time = words.time || "Time";
    drawString(g, fm2, rank, BORDER + trunc((stringWidth(g, fm, "199") - stringWidth(g, fm2, rank)) / 2), y, white);
    drawString(g, fm2, name, BORDER + stringWidth(g, fm, "199 ") + trunc(this.rowHeight), y, white);
    drawString(g, fm2, solved, w - BORDER - stringWidth(g, fm, " 9999") - trunc((stringWidth(g, fm2, solved) + stringWidth(g, fm, "99")) / 2), y, white);
    drawString(g, fm2, time, w - BORDER - trunc((stringWidth(g, fm2, time) + stringWidth(g, fm, "9999")) / 2), y, white);
  }
  drawRowBackground(g, y) {
    fillRect(g, 0, y, this.width, trunc(this.rowHeight), BG_COLOR);
  }
  drawTeamGrid(g, contest, team) {
    const fm = this.rowFont, standing = contest.getStanding(team), rh = this.rowHeight;
    let s = standing.rank;
    if (s != null) textImage(g, fm, s, BORDER + trunc((stringWidth(g, fm, "199") - stringWidth(g, fm, s)) / 2), 5);
    const img = logoImage(this.image(team.logo), trunc(rh) - 10, trunc(rh) - 10);
    if (img) g.drawImage(img, BORDER + stringWidth(g, fm, "199 ") + trunc(f32(rh - img.width) / 2), trunc(f32(rh - img.height) / 2));
    s = team.displayName || team.name || "";
    const xx = BORDER + stringWidth(g, fm, "199 ") + trunc(rh);
    new TextHelper(g, fm, s).drawFit(xx, 5, trunc(this.width - BORDER * 2 - stringWidth(g, fm, "199 9 9999 ") - rh));
    if (standing.numSolved > 0) {
      s = String(standing.numSolved);
      textImage(g, fm, s, this.width - BORDER - stringWidth(g, fm, " 9999") - trunc((stringWidth(g, fm, "99") + stringWidth(g, fm, s)) / 2), 5);
    }
    if (standing.time > 0) {
      s = String(standing.time);
      textImage(g, fm, s, this.width - BORDER - trunc((stringWidth(g, fm, "9999") + stringWidth(g, fm, s)) / 2), 5);
    }
  }
  drawTeamAndProblemGrid(g, contest, team) {
    this.drawTeamGrid(g, contest, team);
    const fm = this.rowFont, indent = BORDER + stringWidth(g, fm, "199 ") + trunc(this.rowHeight), rowH = trunc(f32(this.rowHeight * f32(0.6)));
    const problems = contest.getProblems(), y = rowH + trunc(CUBE_INSET / 2) - 1;
    for (let i = 0; i < problems.length; i++) {
      const xx = indent + i * (this.cubeWidth + CUBE_INSET), r = contest.getResult(team, i);
      if (r.status !== "UNATTEMPTED") {
        let s = "";
        if (r.numSubmissions > 0) {
          s = String(r.numSubmissions);
          if (r.hasTime) s += `\u200A-\u200A${r.contestTimeMin}`;
        }
        const paint = shadedPaint(g, this.cubeHeight, r.status, contest.isRecentResult(r, Date.now()), r.firstToSolve, this.getTimeMs());
        shadedRect(g, xx, y, this.cubeWidth, this.cubeHeight, paint, r.firstToSolve ? ICPCColors.SOLVED_COLOR : null, s, this);
      } else shadedRect(g, xx, y, this.cubeWidth, this.cubeHeight, null, null, problems[i].label, this);
    }
  }
  paintImpl(g) {
    const contest = this.getContest(), teams = contest.getOrderedTeams();
    for (let i = 0; i < this.teamsPerScreen; i += 2) this.drawRowBackground(g, trunc(this.rowHeight * i));
    for (let i = teams.length - 1; i >= 0; i--) {
      const y = this.getTeamY(teams[i]);
      if (y + this.rowHeight > 0 && y < this.height - this.headerHeight) {
        g.save();
        g.translate(0, trunc(y));
        this.drawTeamAndProblemGrid(g, contest, teams[i]);
        g.restore();
      }
    }
  }
}

const groupIdsOf = (team) => (Array.isArray(team.groupIds) && team.groupIds.length ? team.groupIds : null);

/** GroupLeaderboardPresentation; a fixed group may be chosen in the program item. */
export class GroupLeaderboard extends AbstractScoreboard {
  constructor() {
    super();
    this.teamsPerScreen = 10;
    this.recentGroups = [];
    this.currentGroupId = null;
    this.currentGroupName = null;
  }
  groupName(id) {
    return (this.getContest().getGroups().find((g) => g.id === id) || {}).name || id;
  }
  aboutToShow() {
    const contest = this.getContest(), fixed = this.item?.groupId;
    this.currentGroupId = null;
    this.currentGroupName = "<n/a>";
    if (fixed) {
      this.currentGroupId = fixed;
      this.currentGroupName = this.groupName(fixed);
    } else {
      const teams = contest.c.teams || [];
      for (let i = 0; i < teams.length; i++) {
        const groupIds = groupIdsOf(teams[i]);
        if (!groupIds) continue;
        for (const groupId of groupIds)
          if (!this.recentGroups.includes(groupId)) {
            this.currentGroupId = groupId;
            this.currentGroupName = this.groupName(groupId);
            this.recentGroups.push(groupId);
            i += teams.length;
          }
      }
      if (this.currentGroupId == null) {
        if (!this.recentGroups.length) return;
        this.currentGroupId = this.recentGroups.shift();
        this.currentGroupName = this.groupName(this.currentGroupId);
      }
    }
    super.aboutToShow();
  }
  getTitle() {
    if (this.currentGroupName == null) return this.words.titleGroupLeaderboard || "Leaders";
    return (this.words.titleGroupLeaderboardSubs || "{0} Leaders").replace("{0}", this.currentGroupName);
  }
  getTeamYTargets(teams) {
    let count = 0;
    return teams.map((team) => {
      let target = 0;
      for (const groupId of groupIdsOf(team) || []) {
        if (this.currentGroupId == null || this.currentGroupId.toLowerCase() === String(groupId).toLowerCase()) {
          target = count++;
          continue;
        }
        target = this.teamsPerScreen * 2;
      }
      return target;
    });
  }
}

/** AllGroupsLeaderboardPresentation */
export class AllGroupsLeaderboard extends AbstractScoreboard {
  constructor() {
    super();
    this.teamsPerScreen = 10;
    this.groupIds = [];
  }
  aboutToShow() {
    this.groupIds = [];
    for (const team of this.getContest().c.teams || [])
      for (const groupId of groupIdsOf(team) || []) if (!this.groupIds.includes(groupId)) this.groupIds.push(groupId);
    super.aboutToShow();
  }
  getTitle() {
    return this.words.titleAllGroupLeaders || "All Group Leaders";
  }
  getTeamYTargets(teams) {
    const found = [];
    let count = 0;
    return teams.map((team) => {
      let target = 0;
      for (const groupId of groupIdsOf(team) || []) {
        if (!found.includes(groupId)) {
          found.push(groupId);
          target = count++;
          continue;
        }
        target = this.teamsPerScreen * 2;
      }
      return target;
    });
  }
}

const LEGEND_FONT = javaFont(24, true);

/** presentation.contest.internal.Legend.drawLegend (dark mode); the origin is the top-right corner. */
export function drawLegend(g, words = {}) {
  const fm = LEGEND_FONT, text = [words.firstToSolve || "First to Solve", words.solvedProblem || "Solved Problem",
    words.rejectedSubmission || "Rejected Submission", words.pendingSubmission || "Pending Submission"];
  const MARGIN = 15, H_SPACING = 10, V_SPACING = 15, fh = fm.height, fx = fh * 2,
    h = MARGIN * 2 + V_SPACING * 3 + fh * 4, w = MARGIN * 2 + fx + H_SPACING + stringWidth(g, fm, text[2]);
  g.save();
  g.translate(-w, 0);
  fillRect(g, 0, 0, w, h, new JColor(0, 0, 0, 192));
  strokePath(g, [["M", [0, 0]], ["L", [w, 0]], ["L", [w, h]], ["L", [0, h]], ["Z"]], Color.WHITE);
  g.translate(MARGIN, MARGIN);
  shadedRect(g, 0, 0, fx, fh, ICPCColors.SOLVED_COLOR, null, null, {});
  shadedRect(g, 2, 2, fx - 4, fh - 4, ICPCColors.FIRST_TO_SOLVE_COLOR, null, null, {});
  const white = Color.WHITE.css();
  drawString(g, fm, text[0], H_SPACING + fx, fm.ascent + 1, white);
  shadedRect(g, 0, V_SPACING + fh, fx, fh, ICPCColors.SOLVED_COLOR, null, null, {});
  drawString(g, fm, text[1], H_SPACING + fx, V_SPACING + fh + fm.ascent + 1, white);
  shadedRect(g, 0, V_SPACING * 2 + fh * 2, fx, fh, ICPCColors.FAILED_COLOR, null, null, {});
  drawString(g, fm, text[2], H_SPACING + fx, V_SPACING * 2 + fh * 2 + fm.ascent + 1, white);
  shadedRect(g, 0, V_SPACING * 3 + fh * 3, fx, fh, ICPCColors.PENDING_COLOR, null, null, {});
  drawString(g, fm, text[3], H_SPACING + fx, V_SPACING * 3 + fh * 3 + fm.ascent + 1, white);
  g.restore();
}

const MS_PER_PAGE = 12 * 1000, SB_FADE_IN_MS = 1000, SB_INITIAL_DELAY_MS = 3000, SB_FADE_OUT_MS = 1000;

/** AbstractScrollingScoreboardPresentation (page scrolling only; no remote scroll control). */
export class AbstractScrollingScoreboard extends AbstractScoreboard {
  constructor() {
    super();
    this.pageScroll = new PageScroll(SB_INITIAL_DELAY_MS, MS_PER_PAGE, 1500);
  }
  getNumPages() {
    return trunc((this.getContest().getOrderedTeams().length + this.teamsPerScreen) / this.teamsPerScreen);
  }
  getRepeat() {
    return MS_PER_PAGE * this.getNumPages() + SB_INITIAL_DELAY_MS + SB_FADE_OUT_MS;
  }
  getScroll() {
    return trunc(this.pageScroll.getScroll(this.getRepeatTimeMs()) * this.teamsPerScreen * this.rowHeight);
  }
  drawBackground(g, row, oddRow) {
    if (oddRow) fillRect(g, 0, 0, this.width, trunc(this.rowHeight), BG_COLOR);
  }
  paintBarsAndScroll(contest, g) {
    const toScroll = this.getScroll();
    g.translate(0, -toScroll);
    const time = this.getRepeatTimeMs();
    if (time < SB_FADE_IN_MS) g.globalAlpha = time / SB_FADE_IN_MS;
    const endTime = MS_PER_PAGE * this.getNumPages() + SB_INITIAL_DELAY_MS;
    if (time > endTime) g.globalAlpha = Math.max(0, 1.0 - (time - endTime) / SB_FADE_OUT_MS);
    const numTeams = contest.getOrderedTeams().length + 1;
    for (let i = 0; i < numTeams; i++) {
      const y = f32(i * this.rowHeight);
      if (y + this.rowHeight - toScroll > 0 && y - toScroll < this.height - this.headerHeight) {
        g.save();
        g.translate(0, trunc(y));
        this.drawBackground(g, i, i % 2 === 0);
        g.restore();
      }
    }
    return toScroll;
  }
  paintLegend() {}
  paint(g) {
    super.paint(g);
    const time = this.getRepeatTimeMs();
    if (time < 6000) {
      g.save();
      if (time < 1500) g.globalAlpha = time / 1500;
      else if (time > 4500) g.globalAlpha = (6000 - time) / 1500;
      this.paintLegend(g);
      g.restore();
    }
  }
}

/** ScrollAnimator (duplicated from the tile port to keep this module standalone). */
class PageScroll {
  constructor(initialDelay, timePerPage, scrollTime) {
    Object.assign(this, { initialDelay, timePerPage, scrollTime });
  }
  static f(x) {
    return x < 0 ? -Math.exp(1.0 / x) : x === 0 ? 0 : Math.exp(-1.0 / x);
  }
  static smooth(x) {
    return PageScroll.f(x) / (PageScroll.f(x) + PageScroll.f(1 - x));
  }
  getScroll(time) {
    const half = trunc(this.scrollTime / 2);
    if (time < this.initialDelay + half) return 0;
    let time2 = time - this.initialDelay;
    const page = trunc(time2 / this.timePerPage);
    time2 -= page * this.timePerPage;
    if (time2 < half) return page - PageScroll.smooth(0.5 - time2 / this.scrollTime);
    if (time2 > this.timePerPage - half) return page + PageScroll.smooth(0.5 - (this.timePerPage - time2) / this.scrollTime);
    return page;
  }
}

const MS_PER_HOUR = 1000 * 60 * 60;

/** scoreboard.TimelinePresentation */
export class Timeline extends AbstractScrollingScoreboard {
  getTitle() {
    return this.words.titleCurrentStandings || "Current Standings";
  }
  getX(contestTimeMs) {
    return this.start + trunc(contestTimeMs * this.scale);
  }
  drawTimeArrow(g, y) {
    const sx = this.getX(0), w = this.width, color = Color.LIGHT_GRAY, stroke = { width: 2 };
    g.save();
    g.translate(sx - 2, y - 9);
    g.beginPath();
    g.rect(0, 0, w - sx - 16, 18);
    g.clip();
    g.translate(-sx + 2, 9);
    drawLine(g, sx, 0, w - 20, 0, color, stroke);
    drawLine(g, w - 27, -7, w - 20, 0, color, stroke);
    drawLine(g, w - 27, 7, w - 20, 0, color, stroke);
    const numHours = trunc(this.getContest().getDurationMs() / MS_PER_HOUR);
    for (let hour = 0; hour < numHours; hour++) {
      const x = this.getX(hour * MS_PER_HOUR);
      drawLine(g, x, -4, x, 4, color, stroke);
    }
    g.restore();
  }
  paintLegend(g) {
    g.save();
    g.translate(this.width - 30, this.height - 230);
    drawLegend(g, this.words);
    g.restore();
  }
  paintImpl(g) {
    const contest = this.getContest(), fm = this.rowFont;
    this.start = BORDER + stringWidth(g, fm, "199 ") + trunc(this.rowHeight);
    this.scale = (this.width - this.start - 20) / contest.getDurationMs();
    g.save();
    const scroll2 = this.paintBarsAndScroll(contest, g);
    const teams = contest.getOrderedTeams(), numTeams = teams.length, bottom = trunc(numTeams * this.rowHeight);
    if (contest.getFreezeDurationMs() > 0) {
      const ct = this.getX(contest.getDurationMs() - contest.getFreezeDurationMs());
      drawLine(g, ct, 0, ct, bottom, new JColor(66, 114, 245, 64), { width: 2 });
    }
    let currentTime = 0;
    if (contest.stateEnded()) currentTime = contest.getDurationMs();
    else if (contest.stateStarted() != null) currentTime = trunc((this.getTimeMs() - contest.stateStarted()) * contest.multiplier());
    const ct = this.getX(currentTime);
    drawLine(g, ct, 0, ct, bottom, ICPCColors.BLUE, { width: 2 });
    const offset = trunc((this.cubeHeight * 3) / 16), submissions = contest.getAllSubmissions(), now = Date.now(), ch = this.cubeHeight;
    for (let i = numTeams - 1; i >= 0; i--) {
      const team = teams[i], y = this.getTeamY(team);
      if (!(y + this.rowHeight - scroll2 > 0 && y - scroll2 < this.height - this.headerHeight)) continue;
      g.save();
      g.translate(0, trunc(y));
      const arrowY = trunc(f32(f32(this.rowHeight * 3) / 4)) - 1;
      this.drawTimeArrow(g, arrowY);
      this.drawTeamGrid(g, contest, team);
      g.translate(0, arrowY);
      let up = 1;
      const own = submissions.filter((s) => s.teamId === team.id);
      for (const submission of own) {
        const closeToNeighbor = own.some((s) => s !== submission && Math.abs(submission.contestTime - s.contestTime) * this.scale < ch);
        const xx = this.getX(submission.contestTime) - ch / 2.0;
        if (closeToNeighbor) g.translate(0, -offset * up);
        const paint = shadedPaint(g, ch, submission.status, contest.isRecentSubmission(submission, now), submission.firstToSolve, this.getTimeMs());
        shadedRect(g, trunc(xx), -trunc(ch / 2), ch, ch, paint, submission.firstToSolve ? ICPCColors.SOLVED_COLOR : null,
          contest.getProblems()[submission.problemIndex]?.label ?? "", this);
        if (closeToNeighbor) {
          g.translate(0, offset * up);
          up = -up;
        } else up = 1;
      }
      g.restore();
    }
    g.restore();
  }
}

/** AbstractScoreboardPresentation.drawStatsRow (ProblemSummary pending/solved cubes). */
function drawStatsRow(sb, g) {
  const contest = sb.getContest(), fm = sb.rowFont, indent = BORDER + stringWidth(g, fm, "199 ") + trunc(sb.rowHeight),
    rowH = trunc(f32(sb.rowHeight * f32(0.6))), y = rowH + trunc(CUBE_INSET / 2) - 1, now = Date.now(), start = contest.startMs(),
    recent = (minutes) => start !== null && minutes * 60000 > (now - start) * contest.multiplier() - 5 * 60 * 1000;
  contest.getProblems().forEach((_, i) => {
    const xx = indent + i * (sb.cubeWidth + CUBE_INSET), ps = contest.getProblemSummary(i);
    let pendingTime = 0, solvedTime = 0;
    for (const cells of Object.values(contest.data.results || {})) {
      const cell = cells?.[i];
      if (cell?.status === "pending") pendingTime = Math.max(pendingTime, cell.time || 0);
      else if (cell?.status === "solved") solvedTime = Math.max(solvedTime, cell.time || 0);
    }
    const top = y - trunc((sb.cubeHeight * 5) / 4);
    if (ps.numPending > 0) shadedRect(g, xx, top, sb.cubeWidth, sb.cubeHeight, shadedPaint(g, sb.cubeHeight, "SUBMITTED", recent(pendingTime), false, sb.getTimeMs()), null, String(ps.numPending), sb);
    else shadedRect(g, xx, top, sb.cubeWidth, sb.cubeHeight, null, null, "", sb);
    if (ps.numSolved > 0) shadedRect(g, xx, y, sb.cubeWidth, sb.cubeHeight, shadedPaint(g, sb.cubeHeight, "SOLVED", recent(solvedTime), false, sb.getTimeMs()), null, String(ps.numSolved), sb);
    else shadedRect(g, xx, y, sb.cubeWidth, sb.cubeHeight, null, null, "", sb);
  });
}

/** scoreboard.ScoreboardPresentation (legend on, no resolver submission info). */
export class Scoreboard extends AbstractScrollingScoreboard {
  getTitle() {
    return this.words.titleCurrentStandings || "Current Standings";
  }
  paintImpl(g) {
    const contest = this.getContest();
    g.save();
    const scroll2 = this.paintBarsAndScroll(contest, g), teams = contest.getOrderedTeams();
    for (let i = teams.length - 1; i >= 0; i--) {
      const y = this.getTeamY(teams[i]);
      if (y + this.rowHeight - scroll2 > 0 && y - scroll2 < this.height - this.headerHeight) {
        g.save();
        g.translate(0, trunc(y));
        this.drawTeamAndProblemGrid(g, contest, teams[i]);
        g.restore();
      }
    }
    g.save();
    g.translate(0, trunc(teams.length * this.rowHeight));
    drawStatsRow(this, g);
    g.restore();
    g.restore();
  }
  paintLegend(g) {
    g.save();
    g.translate(this.width - 30, this.height - 200);
    drawLegend(g, this.words);
    g.restore();
  }
}

/** scoreboard.LeaderboardPresentation */
export class Leaderboard extends AbstractScoreboard {
  getTitle() {
    return this.words.titleLeaderboard || "Current Medal Contenders";
  }
  paint(g) {
    super.paint(g);
  }
}

/** scoreboard.FirstToSolvePresentation: first solutions slide in as their judgements arrive. */
export class FirstToSolve extends AbstractScoreboard {
  constructor() {
    super();
    this.fts = [];
    this.records = [];
    this.judged = null;
  }
  getTitle() {
    return this.words.titleFirstToSolve || "First to Solve";
  }
  aboutToShow() {
    super.aboutToShow();
    const subs = this.getContest().getAllSubmissions();
    this.judged = new Set(subs.filter((s) => s.status !== "SUBMITTED").map((s) => s.index));
    for (const s of subs) if (s.status === "SOLVED" && s.firstToSolve) this.handleSubmission(s);
    this.updateRecords(1, true);
  }
  handleFTS(sr) {
    const s = sr?.submission;
    if (!s || s.status === "SUBMITTED" || !s.firstToSolve) return;
    if (!this.fts.includes(s.problemIndex)) this.fts.push(s.problemIndex);
  }
  handleSubmission(submission) {
    for (const sr of this.records)
      if (sr.submission.index === submission.index) {
        sr.submission = submission;
        this.handleFTS(sr);
        return;
      }
    if (this.fts.includes(submission.problemIndex)) return;
    let target = 0;
    if (this.records.length) target = Math.min(this.records[this.records.length - 1].anim.getValue() + 1, this.teamsPerScreen * 2);
    const sr = { submission, age: 0, anim: new Animator(Math.max(target, this.teamsPerScreen + 2), ROW_MOVEMENT) };
    this.records.push(sr);
    this.handleFTS(sr);
  }
  incrementTimeMs(dt) {
    // Judgement listener: newly judged submissions.
    if (this.judged)
      for (const s of this.getContest().getAllSubmissions())
        if (s.status !== "SUBMITTED" && !this.judged.has(s.index)) {
          this.judged.add(s.index);
          this.handleSubmission(s);
        }
    for (const sr of this.records) {
      const latest = this.getContest().getAllSubmissions()[sr.submission.index];
      if (latest) sr.submission = latest;
    }
    this.updateRecords(dt, false);
    super.incrementTimeMs(dt);
  }
  updateRecords(dt, force) {
    let count = this.fts.length;
    const remove = [];
    for (const sr of this.records) {
      const s = sr.submission, judged = s.status !== "SUBMITTED";
      let target = count;
      if (judged && s.firstToSolve) target = this.fts.indexOf(s.problemIndex);
      else if (sr.age > 8000) target = this.teamsPerScreen * 2;
      else if (count < this.teamsPerScreen * 2) count++;
      if (force) sr.anim.reset(target);
      else {
        sr.anim.setTarget(target);
        sr.anim.incrementTimeMs(dt);
      }
      if (judged && !s.firstToSolve) {
        sr.age += dt;
        if (sr.age > 8000 && sr.anim.getValue() > this.teamsPerScreen) remove.push(sr);
      }
    }
    this.records = this.records.filter((sr) => !remove.includes(sr));
  }
  drawHeader(g) {
    const fm = this.rowFont, fm2 = this.headerFont, w = this.width, y = this.headerHeight - 3, white = Color.WHITE.css(),
      time = this.words.time || "Time", name = this.words.name || "Name", problem = this.words.problem || "Problem";
    fillRect(g, 0, 0, w, this.headerHeight + 2, Color.BLACK);
    drawLine(g, 0, this.headerHeight - 1, w, this.headerHeight - 1, Color.WHITE);
    drawString(g, fm2, time, BORDER + trunc((stringWidth(g, fm, "199") - stringWidth(g, fm2, time)) / 2), y, white);
    drawString(g, fm2, name, BORDER + stringWidth(g, fm, "199 ") + this.rowHeight, y, white);
    drawString(g, fm2, problem, w - BORDER - trunc((stringWidth(g, fm, "9999") + stringWidth(g, fm2, problem)) / 2), y, white);
  }
  paintImpl(g) {
    for (let i = 0; i < this.teamsPerScreen; i += 2) this.drawRowBackground(g, trunc(i * this.rowHeight));
    if (this.fts.length) {
      const y = trunc(this.fts.length * this.rowHeight);
      drawLine(g, 0, y, this.width, y, Color.WHITE);
    }
    for (const sr of this.records.slice()) {
      const yy = sr.anim.getValue() * this.rowHeight;
      if (yy < this.height - this.headerHeight) {
        g.save();
        g.translate(0, trunc(yy));
        this.drawSubmission(g, sr);
        g.restore();
      }
    }
  }
  drawSubmission(g, sr) {
    const contest = this.getContest(), fm = this.rowFont, s0 = String(Math.floor(sr.submission.contestTime / 60000)), team = sr.submission.team;
    textImage(g, fm, s0, BORDER + trunc((stringWidth(g, fm, "199") - stringWidth(g, fm, s0)) / 2), 5);
    if (!team) return;
    const img = logoImage(this.image(team.logo), trunc(this.rowHeight) - 10, trunc(this.rowHeight) - 10);
    if (img) g.drawImage(img, BORDER + stringWidth(g, fm, "199 ") + trunc(f32(this.rowHeight - img.width) / 2), trunc(f32(this.rowHeight - img.height) / 2));
    const x = BORDER + stringWidth(g, fm, "199 ") + trunc(this.rowHeight);
    new TextHelper(g, fm, team.displayName || team.name).drawFit(x, 5, trunc(this.width - BORDER * 2 - stringWidth(g, fm, "199 9 9999") - this.rowHeight));
    const indent = x, rowH = trunc(trunc(this.rowHeight) / 2), problems = contest.getProblems(), s = sr.submission;
    problems.forEach((p, j) => {
      const xx = indent + j * (this.cubeWidth + CUBE_INSET), y = rowH + trunc(CUBE_INSET / 2) + 3;
      if (j === s.problemIndex)
        shadedRect(g, xx, y, this.cubeWidth, this.cubeHeight, shadedPaint(g, this.cubeHeight, s.status, contest.isRecentSubmission(s, Date.now()), s.firstToSolve, 0),
          s.firstToSolve ? ICPCColors.SOLVED_COLOR : null, s0, this);
      else shadedRect(g, xx, y, this.cubeWidth, this.cubeHeight, null, null, p.label, this);
    });
    const label = problems[s.problemIndex]?.label ?? "";
    textImage(g, fm, label, this.width - BORDER - trunc((stringWidth(g, fm, "9999") + stringWidth(g, fm, label)) / 2), 5);
  }
}
