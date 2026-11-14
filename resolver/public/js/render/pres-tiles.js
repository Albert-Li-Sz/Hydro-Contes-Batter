/*
 * Port of ICPC Tools v2.6.1331 tile scoreboards: TeamTileHelper, AbstractTileScoreboardPresentation,
 * ScrollingTileScoreboardPresentation, TileScoreboardPresentation (Tiles), TileRankScoreboardPresentation
 * (Tile rank) and TileListScoreboardPresentation (Tile list). Image caches are drawn directly at the
 * same integer offsets.
 */
import { Animator, Movement } from "./animator.js";
import { javaFont, stringWidth, drawString, TextHelper } from "./java-text.js";
import { Color, ICPCColors, JColor, fillRect, fillRoundRect, drawRoundRect, drawLine, logoImage, statusColorByAge } from "./java-graphics.js";
import { JavaPresentation } from "./presentation-java.js";

const trunc = Math.trunc, f32 = Math.fround;
const IN_TILE_GAP = 3, TILE_H_GAP = 10, TILE_V_GAP = 3;
export const TILE_BG = new JColor(50, 50, 50);
const PROBLEM_BG = new JColor(90, 90, 90), PROBLEM_TIME_SQUEEZE = 3;

/** float size = tileDim.height * 36f * 0.95f / dpi */
const tileFontSize = (h) => f32(f32(f32(h * 36) * f32(0.95)) / 96);

export class TileAnimator {
  static ZOOM_ANIM = new Movement(1.0, 2.0);
  static TEAM_X_ANIM = new Movement(1.75, 5.0);
  static TEAM_Y_ANIM = new Movement(0.4, 1.75);
  constructor(p) {
    this.xAnim = new Animator(p.x, TileAnimator.TEAM_X_ANIM);
    this.yAnim = new Animator(p.y, TileAnimator.TEAM_Y_ANIM);
    this.zAnim = new Animator(1.0, TileAnimator.ZOOM_ANIM);
  }
  incrementTimeMs(dt) {
    this.xAnim.incrementTimeMs(dt);
    this.yAnim.incrementTimeMs(dt);
    this.zAnim.incrementTimeMs(dt);
  }
  getValue() {
    return { x: this.xAnim.getValue(), y: this.yAnim.getValue() };
  }
  /** Animator2D.setTarget: synchronize both axes to the longer move. */
  setTarget(p) {
    this.xAnim.setTarget(p.x);
    this.yAnim.setTarget(p.y);
    const xTime = this.xAnim.getMoveTime(), yTime = this.yAnim.getMoveTime();
    if (xTime !== 0 && yTime !== 0 && xTime !== yTime) {
      if (xTime > yTime) this.yAnim.setTimeScale(yTime / xTime);
      else this.xAnim.setTimeScale(xTime / yTime);
    }
  }
  setZoomTarget(z) {
    this.zAnim.setTarget(z);
  }
  getZoom() {
    return this.zAnim.getValue();
  }
}

export class TeamTileHelper {
  constructor(tileDim, contest, image) {
    this.tileDim = tileDim;
    this.contest = contest;
    this.image = image;
    // problemImages: the flashing background is cached by status, width and frame only, so a
    // first-to-solve cell reuses whatever background was rendered first for that key.
    this.flashBackgrounds = new Map();
    this.setup();
  }
  setSize(d) {
    this.tileDim = d;
  }
  getSize() {
    return { ...this.tileDim };
  }
  setup() {
    const size = tileFontSize(this.tileDim.height);
    this.teamFont = javaFont(f32(size * f32(1.4)), true);
    this.rankFont = javaFont(f32(size * f32(1.4)), true);
    this.statusFont = javaFont(f32(size * f32(0.7)), false);
    this.problemFont = javaFont(f32(size * f32(0.45)), false);
    this.penaltyFont = javaFont(f32(size * f32(0.85)), true);
  }
  paintTile(g, x, y, scale, team, timeMs, now) {
    const { width: W, height: H } = this.tileDim;
    g.save();
    if (scale !== 1.0) {
      g.translate(x + trunc(W / 2), y + trunc(H / 2));
      g.scale(scale, scale);
      g.translate(-trunc(W / 2), -trunc(H / 2));
    } else g.translate(x, y);
    const recent = this.contest.getRecent(team);
    if (recent) {
      const age = timeMs - recent.time;
      if (age > 0 && age < 30000) {
        const c = statusColorByAge(recent.status, age);
        if (c) fillRoundRect(g, 0, 0, W, H, trunc(W / 40), trunc(W / 40), c);
      }
    }
    const ww = stringWidth(g, this.rankFont, "199");
    if (this.contest.getOrganizationById(team.organizationId) || team.logo) {
      const logoImg = logoImage(this.image(team.logo), H - 10, H - 10);
      if (logoImg) g.drawImage(logoImg, ww + trunc((H - logoImg.width) / 2), trunc((H - logoImg.height) / 2));
    }
    this.paintTileForeground(g, team, timeMs, now);
    g.restore();
  }
  paintName(g, team, ww, maxwid) {
    const H = this.tileDim.height, text = new TextHelper(g, this.teamFont, team.displayName || team.name || team.id);
    // The name is cached as an image drawn at (ww + H + IN_TILE_GAP - 1, H / 10 - 1) and text at (1, 2).
    const x = ww + H + IN_TILE_GAP, y = trunc(H / 10) + 1;
    if (text.getWidth() <= maxwid) text.draw(x, y);
    else text.drawFit(x, y, maxwid);
  }
  paintTileForeground(g, team, timeMs, now) {
    const { width: W, height: H } = this.tileDim, contest = this.contest;
    const ww = stringWidth(g, this.rankFont, "199");
    const maxwid = W - H - ww - IN_TILE_GAP * 3 - 2 - stringWidth(g, this.penaltyFont, "1999");
    const standing = contest.getStanding(team);
    let s = standing.rank;
    drawString(g, this.rankFont, s, trunc((ww - stringWidth(g, this.rankFont, s)) / 2), trunc((H + this.rankFont.ascent) / 2), Color.WHITE.css());
    this.paintName(g, team, ww, maxwid - 3);
    if (standing.numSolved > 0) {
      s = String(standing.numSolved);
      drawString(g, this.teamFont, s, W - IN_TILE_GAP * 2 - stringWidth(g, this.teamFont, s),
        trunc((trunc((H * 7) / 10) + this.teamFont.ascent) / 2) - 2, Color.WHITE.css());
    }
    if (standing.time > 0) {
      s = String(standing.time);
      drawString(g, this.penaltyFont, s, W - IN_TILE_GAP * 2 - stringWidth(g, this.penaltyFont, s),
        trunc((H * 17) / 20) + trunc(this.penaltyFont.ascent / 2) - 3, Color.LIGHT_GRAY.css());
    }
    const problems = contest.getProblems(), numProblems = problems.length;
    if (!numProblems) return;
    const y = trunc((H * 7) / 10) - 3, h = trunc((H * 3) / 10), w = f32(f32(maxwid) / f32(numProblems)),
      xx = ww + H + IN_TILE_GAP, arc = trunc(W / 120), iw = trunc(w);
    const statusFm = this.statusFont, fracStatus = { ...this.statusFont, fractional: true };
    for (let i = 0; i < numProblems; i++) {
      const r = contest.getResult(team, i), cx = xx + trunc(f32(w * i));
      g.save();
      g.translate(cx, y);
      if (r.numSubmissions === 0) this.paintProblem(g, iw, h, arc, problems[i].label);
      else if (contest.isRecentResult(r, Date.now())) {
        let k = trunc(((timeMs * 45.0) / 1000.0) % (ICPCColors.COUNT2 * 2));
        if (k > ICPCColors.COUNT2 - 1) k = ICPCColors.COUNT2 * 2 - 1 - k;
        const backHash = `${r.status} ${iw} flash ${k}`;
        let c = this.flashBackgrounds.get(backHash);
        if (!c) {
          c = r.status === "SOLVED" ? (r.firstToSolve ? ICPCColors.FIRST_TO_SOLVE3[k] : ICPCColors.SOLVED3[k])
            : r.status === "FAILED" ? ICPCColors.FAILED3[k] : ICPCColors.PENDING3[k];
          this.flashBackgrounds.set(backHash, c);
        }
        fillRoundRect(g, 0, 0, iw - 3, h - 1, arc, arc, c);
        this.paintResultText(g, r, iw, h, arc, statusFm, fracStatus);
      } else {
        const c = r.status === "SOLVED" ? (r.firstToSolve ? ICPCColors.FIRST_TO_SOLVE[5] : ICPCColors.SOLVED[5])
          : r.status === "FAILED" ? ICPCColors.FAILED[5] : ICPCColors.PENDING[5];
        fillRoundRect(g, 0, 0, iw - 3, h - 1, arc, arc, c);
        this.paintResultText(g, r, iw, h, arc, statusFm, fracStatus);
      }
      g.restore();
    }
  }
  paintProblem(g, w, h, arc, label) {
    fillRoundRect(g, 0, 0, w - 3, h - 1, arc, arc, PROBLEM_BG);
    drawString(g, this.problemFont, label, trunc((w - stringWidth(g, this.problemFont, label)) / 2) - 1,
      trunc((h + this.problemFont.ascent) / 2) - 1, Color.LIGHT_GRAY.css());
  }
  /** Result text is rendered with fractional metrics; the squeeze test uses the integer metrics. */
  paintResultText(g, r, w, h, arc, fm, fracFont) {
    const s = stringWidth(g, fm, "9 - 999") > PROBLEM_TIME_SQUEEZE * w - 5
      ? String(r.numSubmissions) : `${r.numSubmissions} - ${r.contestTimeMin}`;
    const text = new TextHelper(g, fracFont, s), sw = text.getWidth();
    text.drawFit(trunc((w - Math.min(sw, w - 4)) / 2) - 2, trunc((h - fm.ascent) / 2), w - 4);
    if (r.firstToSolve) drawRoundRect(g, 0, 0, w - 3, h - 1, arc, arc, ICPCColors.SOLVED_COLOR);
  }
  paintTileStats(g) {
    const { width: W, height: H } = this.tileDim, problems = this.contest.getProblems(), numProblems = problems.length;
    // Drawn on a FRACTIONALMETRICS_ON graphics, so every measurement here is fractional.
    const ww = stringWidth(g, { ...this.rankFont, fractional: true }, "199");
    if (!numProblems) return;
    const y = trunc((H * 7) / 10), h = trunc((H * 3) / 10),
      maxwid = W - H - ww - IN_TILE_GAP * 3 - 2 - stringWidth(g, { ...this.penaltyFont, fractional: true }, "1999"),
      w = f32(f32(maxwid) / f32(numProblems)), xx = ww + H + IN_TILE_GAP, arc = trunc(W / 120),
      fm = { ...this.statusFont, fractional: true };
    for (let i = 0; i < numProblems; i++) {
      const ps = this.contest.getProblemSummary(i), x = xx + trunc(f32(w * i));
      this.draw(g, ps.numPending > 0 ? ICPCColors.PENDING[5] : PROBLEM_BG, x, y - trunc((h * 5) / 4), trunc(w), h, arc, ps.numPending > 0 ? String(ps.numPending) : "", fm);
      this.draw(g, ps.numSolved > 0 ? ICPCColors.SOLVED[5] : PROBLEM_BG, x, y, trunc(w), h, arc, ps.numSolved > 0 ? String(ps.numSolved) : "", fm);
    }
  }
  draw(g, c, x, y, w, h, arc, s, fm) {
    fillRoundRect(g, x, y, w - 3, h - 1, arc, arc, c);
    drawString(g, fm, s, x + trunc((w - stringWidth(g, fm, s)) / 2), y + trunc((h + fm.ascent) / 2) - 1, Color.WHITE.css());
  }
}

/** presentation.contest.internal.ScrollAnimator */
export class ScrollAnimator {
  constructor(initialDelay, timePerPage, scrollTime) {
    Object.assign(this, { initialDelay, timePerPage, scrollTime });
  }
  static f(x) {
    if (x < 0) return -Math.exp(1.0 / x);
    if (x === 0) return 0;
    return Math.exp(-1.0 / x);
  }
  static smooth(x) {
    return ScrollAnimator.f(x) / (ScrollAnimator.f(x) + ScrollAnimator.f(1 - x));
  }
  getScroll(time) {
    const half = trunc(this.scrollTime / 2);
    if (time < this.initialDelay + half) return 0;
    let time2 = time - this.initialDelay;
    const page = trunc(time2 / this.timePerPage);
    time2 -= page * this.timePerPage;
    if (time2 < half) return page - ScrollAnimator.smooth(0.5 - time2 / this.scrollTime);
    if (time2 > this.timePerPage - half) return page + ScrollAnimator.smooth(0.5 - (this.timePerPage - time2) / this.scrollTime);
    return page;
  }
}

class AbstractTileScoreboard extends JavaPresentation {
  constructor() {
    super();
    this.rows = 14;
    this.orphanAdjust = true;
    this.columns = 2;
    this.tileDim = null;
    this.teamTargets = [];
    this.teamZoomTargets = [];
    this.teamMap = new Map();
    this.image = () => null;
  }
  createTileHelper() {
    this.tileDim = { width: trunc((this.width - (this.columns - 1) * TILE_H_GAP) / this.columns), height: trunc((this.height - (this.rows - 1) * TILE_V_GAP) / this.rows) };
    return new TeamTileHelper(this.tileDim, this.getContest(), this.image);
  }
  setSize(w, h) {
    super.setSize(w, h);
    if (!w || !h) return;
    this.tileHelper = this.createTileHelper();
    this.initTeamPosition();
  }
  setContest(contest) {
    super.setContest(contest);
    if (this.tileHelper) this.tileHelper.contest = contest;
  }
  aboutToShow() {
    this.initTeamPosition();
  }
  incrementTimeMs(dt) {
    const teams = this.getContest().getOrderedTeams();
    if (teams.length !== this.teamTargets.length) this.initTeamPosition();
    this.updateTeamTargets(teams, this.teamTargets);
    this.updateTeamPosition(dt, teams);
    this.updateTeamZoomTargets(teams, this.teamZoomTargets);
    this.updateTeamZoomPosition(dt, teams);
  }
  initTeamPosition() {
    const teams = this.getContest().getOrderedTeams(), size = teams.length;
    if (this.teamTargets.length !== size) this.teamTargets = Array.from({ length: size }, () => ({ x: 0, y: 0 }));
    this.updateTeamTargets(teams, this.teamTargets);
    if (this.teamZoomTargets.length !== size) this.teamZoomTargets = new Array(size).fill(1);
    this.updateTeamZoomTargets(teams, this.teamZoomTargets);
    for (let i = 0; i < size; i++) this.teamMap.set(teams[i].id, new TileAnimator(this.teamTargets[i]));
  }
  updateTeamTargets(teams, targets) {
    for (let i = 0; i < teams.length; i++) Object.assign(targets[i], { x: trunc(i / this.rows), y: i % this.rows });
  }
  updateTeamZoomTargets(teams, targets) {
    // Zoom only reacts to Contest.getRecent(), which never reports activity in v2.6.1331.
    for (let i = 0; i < teams.length; i++) targets[i] = 1.0;
  }
  updateTeamPosition(dt, teams) {
    teams.forEach((team, i) => {
      const current = this.teamMap.get(team.id);
      if (!current) this.teamMap.set(team.id, new TileAnimator(this.teamTargets[i]));
      else {
        current.setTarget(this.teamTargets[i]);
        current.incrementTimeMs(dt);
      }
    });
  }
  updateTeamZoomPosition(dt, teams) {
    teams.forEach((team, i) => {
      const current = this.teamMap.get(team.id);
      if (current) {
        current.setZoomTarget(this.teamZoomTargets[i]);
        current.incrementTimeMs(dt);
      }
    });
  }
  orphanAdjustRows() {
    if (!this.orphanAdjust) return;
    const length = this.getContest().getOrderedTeams().length + 1, rows = this.rows;
    if (length % rows > 0 && length % rows <= 3 && (length % (rows + 1) === 0 || length % (rows + 1) > length % rows)) {
      this.rows++;
      this.setSize(this.width, this.height);
    }
  }
  paint(g) {
    if (!this.getContest().getNumTeams()) return;
    this.paintImpl(g);
  }
}

const MS_PER_COLUMN = 8000, FADE_IN_MS = 1000, INITIAL_DELAY_MS = 5000, MS_PER_SCREEN = 10000, FADE_OUT_MS = 1000;

class ScrollingTileScoreboard extends AbstractTileScoreboard {
  constructor(dir = "HORIZONTAL", header = "LEFT") {
    super();
    this.scroll = new ScrollAnimator(INITIAL_DELAY_MS, MS_PER_COLUMN, MS_PER_COLUMN / 5);
    this.vScroll = new Animator(0, new Movement(3, 8));
    this.dir = dir;
    this.header = header;
    this.margin = 50;
    this.showClock = true;
    this.currentColumns = 0;
  }
  setSize(w, h) {
    super.setSize(w, h);
    if (!this.tileDim) return;
    const size = tileFontSize(this.tileDim.height);
    this.titleFont = javaFont(f32(size * f32(1.9)), true);
    this.clockFont = javaFont(f32(size * f32(0.8)), true);
  }
  createTileHelper() {
    const { width, height, rows, columns } = this;
    if (this.header === "NONE") return super.createTileHelper();
    if (this.header === "TOP") {
      this.margin = trunc(((height - (rows - 1) * TILE_V_GAP) * 1.2) / rows);
      this.tileDim = { width: trunc((width - (columns - 1) * TILE_H_GAP) / columns), height: trunc((height - (rows - 1) * TILE_V_GAP - this.margin) / rows) };
    } else {
      this.margin = trunc(((height - (rows - 1) * TILE_V_GAP) * 1.3) / rows);
      this.tileDim = { width: trunc((width - (columns - 1) * TILE_H_GAP - this.margin) / columns), height: trunc((height - (rows - 1) * TILE_V_GAP) / rows) };
    }
    return new TeamTileHelper(this.tileDim, this.getContest(), this.image);
  }
  setColumns(cols) {
    this.currentColumns = cols;
    const { width, height, rows, margin } = this;
    if (this.header === "TOP") this.tileDim = { width: trunc((width - (cols - 1) * TILE_H_GAP) / cols), height: trunc((height - (rows - 1) * TILE_V_GAP - margin) / rows) };
    else if (this.header === "LEFT") this.tileDim = { width: trunc((width - (cols - 1) * TILE_H_GAP - margin) / cols), height: trunc((height - (rows - 1) * TILE_V_GAP) / rows) };
    this.tileHelper.setSize(this.tileDim);
  }
  getNumColumns() {
    if (this.dir === "VERTICAL") return 1;
    return trunc((this.getContest().getOrderedTeams().length + this.rows) / this.rows);
  }
  getNumRows() {
    if (this.dir === "HORIZONTAL") return 1;
    return trunc((this.getContest().getOrderedTeams().length + this.columns - 1) / this.columns);
  }
  getRepeat() {
    if (this.dir === "HORIZONTAL") return INITIAL_DELAY_MS + MS_PER_COLUMN * this.getNumColumns() + FADE_OUT_MS;
    return INITIAL_DELAY_MS + trunc(MS_PER_SCREEN * (this.getNumRows() / this.rows));
  }
  updateScrollTarget() {
    const time = this.getRepeatTimeMs();
    if (time <= INITIAL_DELAY_MS) this.vScroll.setTarget(0, 0);
    else this.vScroll.setTarget((time - INITIAL_DELAY_MS) / MS_PER_SCREEN, 1000.0 / MS_PER_SCREEN);
  }
  aboutToShow() {
    super.aboutToShow();
    if (this.dir === "HORIZONTAL") return;
    this.updateScrollTarget();
    this.vScroll.resetToTarget();
  }
  incrementTimeMs(dt) {
    if (this.dir === "VERTICAL") {
      this.updateScrollTarget();
      this.vScroll.incrementTimeMs(dt);
    }
    super.incrementTimeMs(dt);
  }
  paintHeader(g) {
    if (this.header !== "LEFT") return;
    const { tileDim, margin } = this, h = this.rows * (tileDim.height + TILE_V_GAP) - TILE_V_GAP;
    fillRect(g, 0, 0, margin - TILE_H_GAP, h, TILE_BG);
    drawLine(g, margin - TILE_H_GAP, 0, margin - TILE_H_GAP, h, Color.GRAY);
    const title = this.getTitle();
    if (title != null) {
      g.save();
      g.translate(trunc((margin - TILE_H_GAP + this.titleFont.ascent) / 2), trunc((h + stringWidth(g, this.titleFont, title)) / 2));
      g.rotate(-Math.PI / 2);
      drawString(g, this.titleFont, title, 0, 0, Color.WHITE.css());
      g.restore();
    }
    if (this.showClock) {
      // TextHelper always paints white, so the frozen colour never shows in v2.6.1331.
      const fm = this.clockFont;
      let s = this.getContestTime();
      if (s != null) {
        const text = new TextHelper(g, fm, s), x = Math.max(1, trunc((margin - TILE_H_GAP - text.getWidth()) / 2));
        text.drawFit(x, fm.height + TILE_V_GAP, margin - TILE_H_GAP - 3);
      }
      s = this.getRemainingTime();
      if (s != null) {
        const text = new TextHelper(g, fm, s), x = Math.max(1, trunc((margin - TILE_H_GAP - text.getWidth()) / 2));
        text.drawFit(x, h - TILE_V_GAP - fm.height, margin - TILE_H_GAP - 3);
      }
    }
  }
  paintBackground(g) {
    const { tileDim } = this, arc = trunc(tileDim.width / 80), hScroll = this.scroll.getScroll(this.getRepeatTimeMs()), n = this.getNumColumns();
    for (let i = 0; i < this.rows; i += 2)
      for (let j = 0; j < n; j++) {
        const x = trunc((tileDim.width + TILE_H_GAP) * (j - hScroll));
        if (x + tileDim.width > 0 && x < this.width) fillRoundRect(g, x, (tileDim.height + TILE_V_GAP) * i, tileDim.width, tileDim.height, arc, arc, TILE_BG);
      }
  }
  paintImpl(g) {
    this.orphanAdjustRows();
    const { tileDim } = this;
    g.save();
    if (this.header === "LEFT") g.translate(this.margin, 0);
    else if (this.header === "TOP") g.translate(0, this.margin);
    g.beginPath();
    g.rect(-TILE_H_GAP, -TILE_V_GAP, this.columns * (tileDim.width + TILE_H_GAP), this.rows * (tileDim.height + TILE_V_GAP));
    g.clip();
    const time = this.getRepeatTimeMs();
    if (this.dir === "HORIZONTAL") {
      const hScroll = trunc(this.scroll.getScroll(time) * (tileDim.width + TILE_H_GAP));
      this.paintBackground(g);
      if (time < FADE_IN_MS) g.globalAlpha = time / FADE_IN_MS;
      const endTime = INITIAL_DELAY_MS + MS_PER_COLUMN * this.getNumColumns();
      if (time < endTime + FADE_OUT_MS) {
        if (time > endTime) g.globalAlpha = 1.0 - (time - endTime) / FADE_OUT_MS;
        g.translate(-hScroll, 0);
        this.paintTiles(g, hScroll);
      }
    } else {
      g.translate(0, -trunc(this.vScroll.getValue() * this.height));
      this.paintBackground(g);
      if (time < FADE_IN_MS) g.globalAlpha = time / FADE_IN_MS;
      this.paintContent(g);
    }
    g.restore();
    if (this.header !== "NONE") this.paintHeader(g);
  }
  paintTiles(g, hScroll) {
    const teams = this.getContest().getOrderedTeams(), timeMs = this.getRepeatTimeMs(), { tileDim, rows } = this;
    for (let i = teams.length - 1; i >= 0; i--) {
      const team = teams[i], anim = this.teamMap.get(team.id);
      if (!anim) continue;
      const yy = anim.getValue().y, col = trunc(yy / rows);
      let x = col * (tileDim.width + TILE_H_GAP), y = trunc((yy - col * rows) * (tileDim.height + TILE_V_GAP));
      if (x - hScroll + tileDim.width > 0 && x - hScroll < this.width - this.margin)
        this.tileHelper.paintTile(g, x, y, anim.getZoom(), team, timeMs, this.getTimeMs());
      const colHeight = trunc((tileDim.height + TILE_V_GAP) * rows);
      if (y > colHeight - tileDim.height) {
        y -= colHeight;
        x += tileDim.width + TILE_H_GAP;
        if (x - hScroll + tileDim.width > 0 && x - hScroll < this.width - this.margin)
          this.tileHelper.paintTile(g, x, y, anim.getZoom(), team, timeMs, this.getTimeMs());
      }
    }
  }
  paintContent(g) {
    const vScrollv = trunc(this.vScroll.getValue() * this.height), timeMs = this.getRepeatTimeMs(), teams = this.getContest().getOrderedTeams(), { tileDim } = this;
    for (let i = teams.length - 1; i >= 0; i--) {
      const anim = this.teamMap.get(teams[i].id);
      if (!anim) continue;
      const p = anim.getValue(), x = trunc(p.x * (tileDim.width + TILE_H_GAP)), y = trunc(p.y * (tileDim.height + TILE_V_GAP));
      if (y - vScrollv + tileDim.height > 0 && y - vScrollv < this.height) this.tileHelper.paintTile(g, x, y, anim.getZoom(), teams[i], timeMs, this.getTimeMs());
    }
  }
}

/** TileScoreboardPresentation ("Tiles") */
export class TileScoreboard extends ScrollingTileScoreboard {
  constructor() {
    super();
    this.breaks = [];
    this.initScroll = new Animator(1, new Movement(0.4, 0.5));
  }
  getTitle() {
    return this.words.titleCurrentStandings || "Current Standings";
  }
  incrementTimeMs(dt) {
    this.initScroll.incrementTimeMs(dt);
    super.incrementTimeMs(dt);
  }
  aboutToShow() {
    super.aboutToShow();
    if (this.getRepeatTimeMs() < 5000) this.initScroll.reset(1);
    else this.initScroll.reset(this.columns);
  }
  updateTeamTargets(teams, targets) {
    const contest = this.getContest(), size = teams.length;
    this.breaks = [];
    let numSolved = size > 0 ? contest.getStanding(teams[0]).numSolved : 0;
    for (let i = 0; i < size; i++) {
      Object.assign(targets[i], { x: 0, y: i });
      const num = contest.getStanding(teams[i]).numSolved;
      if (num !== numSolved) {
        numSolved = num;
        this.breaks.push(i);
      }
    }
    if (this.getRepeatTimeMs() < 5000) this.initScroll.reset(1);
    else this.initScroll.setTarget(this.columns);
  }
  paintImpl(g) {
    this.setColumns(this.initScroll.getValue());
    super.paintImpl(g);
  }
  paintTiles(g, hScroll) {
    super.paintTiles(g, hScroll);
    const { tileDim, rows } = this, numTeams = this.getContest().getOrderedTeams().length, col = trunc(numTeams / rows);
    g.save();
    g.translate(col * (tileDim.width + TILE_H_GAP), trunc((numTeams - col * rows) * (tileDim.height + TILE_V_GAP)));
    this.tileHelper.paintTileStats(g);
    g.restore();
    const arc = trunc(tileDim.width / 90);
    for (const i of this.breaks) {
      const x = trunc(i / rows) * (tileDim.width + TILE_H_GAP), y = (i % rows) * (tileDim.height + TILE_V_GAP) - trunc((TILE_V_GAP + 1) / 2);
      drawLine(g, x + arc, y, x + tileDim.width - arc, y, Color.LIGHT_GRAY, { width: 2 });
    }
  }
}

/** TileRankScoreboardPresentation ("Tile rank") */
export class TileRankScoreboard extends ScrollingTileScoreboard {
  constructor() {
    super("VERTICAL", "LEFT");
    this.groups = [];
  }
  setSize(w, h) {
    super.setSize(w, h);
    if (!this.tileDim) return;
    const size = tileFontSize(this.tileDim.height);
    this.numFont = javaFont(f32(size * f32(1.9)), true);
    this.solvedFont = javaFont(f32(size * f32(0.85)), false);
  }
  getNumRows() {
    return super.getNumRows() + 3;
  }
  getTitle() {
    return this.words.titleTeamRank || "Team Rank";
  }
  updateTeamTargets(teams, targets) {
    if (!teams.length) return;
    const contest = this.getContest(), size = teams.length;
    let y = 0, i = 0;
    this.groups = [];
    while (i < size) {
      const gr = { y, numSolved: contest.getStanding(teams[i]).numSolved, numRows: 0 };
      let groupSize = 0, j = i;
      while (j < size && gr.numSolved === contest.getStanding(teams[j]).numSolved) {
        j++;
        groupSize++;
      }
      const numRows = trunc((groupSize + this.columns - 1) / this.columns);
      for (j = 0; j < groupSize; j++) Object.assign(targets[i + j], { x: trunc(j / numRows), y: y + (j % numRows) });
      gr.numRows = numRows;
      this.groups.push(gr);
      y += numRows + 0.25;
      i += groupSize;
    }
  }
  paintHeader(g) {
    const { tileDim, margin } = this;
    g.save();
    g.translate(0, -trunc(this.vScroll.getValue() * this.height));
    for (const gr of this.groups) {
      const arc = trunc(tileDim.width / 60), top = trunc(gr.y * (tileDim.height + TILE_V_GAP));
      fillRoundRect(g, 0, top, margin - TILE_H_GAP, gr.numRows * (tileDim.height + TILE_V_GAP) - TILE_V_GAP, arc, arc, Color.DARK_GRAY);
      let s = String(gr.numSolved);
      drawString(g, this.numFont, s, trunc((margin - TILE_H_GAP - stringWidth(g, this.numFont, s)) / 2), this.numFont.ascent + top + TILE_V_GAP * 2, Color.WHITE.css());
      if (gr.numRows > 1) {
        s = this.words.numSolved || "solved";
        drawString(g, this.solvedFont, s, trunc((margin - TILE_H_GAP - stringWidth(g, this.solvedFont, s)) / 2),
          this.numFont.ascent + this.solvedFont.ascent + top + TILE_V_GAP * 4, Color.LIGHT_GRAY.css());
      }
    }
    g.restore();
  }
  paintBackground(g) {
    const { tileDim } = this, arc = trunc(tileDim.width / 70);
    for (const gr of this.groups)
      for (let i = 0; i < gr.numRows; i += 2)
        for (let j = 0; j < this.columns; j++)
          fillRoundRect(g, (tileDim.width + TILE_H_GAP) * j, trunc((tileDim.height + TILE_V_GAP) * (i + gr.y)),
            tileDim.width + trunc(TILE_H_GAP / 2), tileDim.height + trunc(TILE_V_GAP / 2), arc, arc, TILE_BG);
  }
}

/** TileListScoreboardPresentation ("Tile list"): alphabetical, vertical scroll as a ScrollingTile default (horizontal). */
export class TileListScoreboard extends ScrollingTileScoreboard {
  getTitle() {
    return this.words.titleAlphabeticListOfTeams || "Alphabetic list of teams";
  }
  updateTeamTargets(teams, targets) {
    if (!teams.length) return;
    const names = teams.map((t) => t.displayName || t.name || t.id), sort = names.map((_, i) => i);
    // Java String.compareTo: UTF-16 code unit order, selection-style swaps as in the original.
    for (let i = 0; i < sort.length - 1; i++)
      for (let j = i + 1; j < sort.length; j++)
        if (names[sort[i]] > names[sort[j]]) [sort[i], sort[j]] = [sort[j], sort[i]];
    for (let i = 0; i < sort.length; i++) Object.assign(targets[sort[i]], { x: 0, y: i });
  }
}
