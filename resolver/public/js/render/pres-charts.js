/*
 * Port of ICPC Tools v2.6.1331 PresCore AbstractChartPresentation/Series and the PresContest charts:
 * ProblemSummaryChart, LanguageSummaryChart, TotalProblemsChart, ScoreboardChart, JudgementChart,
 * JudgeQueueDepthChart, ProblemComparisonChart and ProblemDetailChart.
 */
import { Animator, Movement } from "./animator.js";
import { javaFont, stringWidth, drawString } from "./java-text.js";
import { Color, ICPCColors, JColor, alpha, alphaDarker, fillRect, drawRect, drawLine, fillOval } from "./java-graphics.js";
import { JavaPresentation } from "./presentation-java.js";

const trunc = Math.trunc, f32 = Math.fround;
const MARGIN = 10, GAP = 5, INITIAL_DELAY = 250, FADE_IN_TIME = 3000, UPDATE_TIME = 800, NO_DATA = -9999;
const SHADOW = new JColor(0, 0, 0, 192);

/** transition.SmoothUtil.smooth (1000-entry float table) */
const SMOOTH = (() => {
  const f = (x) => (x < 0 ? -Math.exp(1.0 / x) : x === 0 ? 0 : Math.exp(-1.0 / x));
  return Array.from({ length: 1000 }, (_, i) => f32(f(i / 1000) / (f(i / 1000) + f(1 - i / 1000))));
})();
export function smooth(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return SMOOTH[trunc(x * 1000.0)];
}

/** NumberFormat.getNumberInstance() with the given maximum (and minimum) fraction digits. */
function numberFormat(value, maxFraction, minFraction = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFraction, minimumFractionDigits: minFraction, roundingMode: "halfEven" }).format(value);
}

/** Problem.getColorVal() */
export function problemColor(problem) {
  let rgb = problem?.rgb;
  if (rgb == null || ![3, 4, 6, 7].includes(String(rgb).length)) return Color.BLACK;
  rgb = String(rgb);
  const hex = (s) => {
    if (!/^[0-9a-f]+$/i.test(s)) throw new Error("bad color");
    return parseInt(s, 16);
  };
  try {
    if (rgb.length === 3 || rgb.length === 4) {
      if (rgb.length === 4) rgb = rgb.substring(1);
      return new JColor(hex(rgb[0] + rgb[0]), hex(rgb[1] + rgb[1]), hex(rgb[2] + rgb[2]));
    }
    if (rgb.length === 7) rgb = rgb.substring(1);
    return new JColor(hex(rgb.substring(0, 2)), hex(rgb.substring(2, 4)), hex(rgb.substring(4, 6)));
  } catch {
    return Color.BLACK;
  }
}

export class Series {
  constructor(numOrPaints, paint) {
    if (Array.isArray(numOrPaints)) {
      this.paints = numOrPaints;
      this.values = new Array(numOrPaints.length).fill(0);
    } else {
      this.paints = [paint];
      this.values = new Array(numOrPaints).fill(0);
    }
    this.strokeWidth = 3;
    this.anim = null;
    this.title = null;
    this.linePoint = null;
  }
  setValues(values) {
    values.forEach((v, i) => (this.values[i] = v));
    if (!this.anim) this.anim = values.map((v) => new Animator(v, new Movement(5, 30)));
    else values.forEach((v, i) => this.anim[i].setTarget(v));
  }
  incrementTimeMs(dt) {
    for (const a of this.anim || []) a.incrementTimeMs(dt);
  }
  getPaint(i) {
    return this.paints.length >= i ? this.paints[i] : this.paints[0];
  }
  getOutline(i) {
    const p = this.paints.length > 1 ? this.paints[i] : this.paints[0];
    if (p.r === 0 && p.g === 0 && p.b === 0) return alpha(Color.LIGHT_GRAY, p.a);
    return p.brighter();
  }
  getValueLabel(i) {
    return this.getValue(i) === 0 ? "" : numberFormat(this.getValue(i), 0);
  }
  getLength() {
    return this.values.length;
  }
  getValue(i) {
    return this.values[i];
  }
  getAnimValue(i) {
    return this.anim ? this.anim[i].getValue() : this.values[i];
  }
  drawPoint(g, x, y, color) {
    if (this.linePoint === "RECT") fillRect(g, x - 2, y - 2, 5, 5, color);
    else if (this.linePoint === "OVAL") fillOval(g, x - 3, y - 3, 7, 7, color);
  }
}

class AbstractChart extends JavaPresentation {
  constructor(type, title, verticalAxisTitle) {
    super();
    this.type = type;
    this.title = title;
    this.verticalAxisTitle = verticalAxisTitle;
    this.horizontalAxisTitle = null;
    this.showValueLabels = true;
    this.dataSeries = null;
    this.maximum = new Animator(0, new Movement(5, 20));
    this.lines = null;
    this.xPoints = null;
    this.initialTime = 0;
    this.lastUpdateTime = 0;
  }
  setSize(w, h) {
    super.setSize(w, h);
    const labelHeight = f32(h / f32(20)), inch = f32(labelHeight / 96);
    let size = trunc(f32(f32(inch * 72) * f32(1.1)));
    this.titleFont = javaFont(size, true);
    size = trunc(f32(f32(inch * 72) * f32(0.9)));
    this.labelFont = javaFont(size, false);
    this.horizontalAxisFont = javaFont(size, false);
  }
  getRepeat() {
    return 15000;
  }
  aboutToShow() {
    this.setupChart();
    this.updateData();
    this.updateMaxTarget();
    this.maximum.resetToTarget();
    this.initialTime = this.getRepeatTimeMs();
    this.lastUpdateTime = this.getTimeMs();
    this.initLines();
  }
  incrementTimeMs(dt) {
    const time = this.getTimeMs();
    if (this.lastUpdateTime < time - UPDATE_TIME) {
      this.lastUpdateTime = time;
      this.updateData();
    }
    if (!this.dataSeries) return;
    this.updateMaxTarget();
    this.maximum.incrementTimeMs(dt);
    this.initLines();
    for (const s of this.dataSeries) s.incrementTimeMs(dt);
  }
  setSeries(...ser) {
    this.dataSeries = ser;
  }
  updateMaxTarget() {
    if (!this.dataSeries) return;
    let f = 0;
    for (const s of this.dataSeries) for (let i = 0; i < this.dataSeries[0].getLength(); i++) f = Math.max(f, s.getValue(i));
    f *= this.showValueLabels ? 1.1 : 1.01;
    this.maximum.setTarget(Math.ceil(f));
  }
  initLines() {
    const max = this.maximum.getValue();
    if (max < 1) return;
    let m = trunc(trunc(max) / 4);
    if (m % 5 !== 0) m = trunc(m / 5) * 5;
    if (m < 1) m = 1;
    const numLines = trunc(trunc(max) / m);
    this.lines = Array.from({ length: numLines }, (_, i) => m * (i + 1));
  }
  initXPoints() {
    if (!this.dataSeries?.length || !this.rect) {
      this.xPoints = null;
      return;
    }
    const size = this.dataSeries[0].getLength(), w = this.type === "LINE" ? this.rect.width / (size - 1) : this.rect.width / size;
    this.xPoints = Array.from({ length: size }, (_, i) => (this.type === "LINE" ? trunc(w * i) : trunc(w * i + f32(w / 2))));
  }
  paintBackgroundRect(g) {
    const lines = this.lines || [], numLines = lines.length, white = Color.WHITE.css();
    const r = { x: MARGIN, y: MARGIN, width: this.width - MARGIN * 2, height: this.height - MARGIN * 2 };
    if (this.title != null) {
      const fm = this.titleFont;
      drawString(g, fm, this.title, trunc(this.width / 2) - trunc(stringWidth(g, fm, this.title) / 2), fm.ascent + GAP, white);
      const ind = fm.height + GAP * 3;
      r.y += ind;
      r.height -= ind;
    }
    let ind = 0, fm = this.labelFont;
    for (let i = 0; i < numLines; i++) ind = Math.max(ind, stringWidth(g, fm, String(lines[numLines - i - 1])));
    ind += 5;
    if (this.verticalAxisTitle != null) {
      fm = this.horizontalAxisFont;
      ind += fm.height + GAP;
      g.save();
      g.translate(fm.height, trunc((this.height + stringWidth(g, fm, this.verticalAxisTitle)) / 2));
      g.rotate(-Math.PI / 2);
      drawString(g, fm, this.verticalAxisTitle, 0, 0, white);
      g.restore();
      r.width -= fm.height + GAP;
    }
    r.x += ind;
    r.width -= ind;
    if (this.horizontalAxisTitle != null) {
      r.height -= fm.height + GAP;
      drawString(g, this.horizontalAxisFont, this.horizontalAxisTitle, ind + trunc((this.width - ind - stringWidth(g, fm, this.horizontalAxisTitle)) / 2),
        r.y + r.height + fm.ascent + GAP, white);
    }
    fm = this.labelFont;
    r.height -= fm.ascent + 8;
    const max = this.maximum.getValue();
    for (let i = 0; i < numLines; i++) {
      const y = r.y + r.height - trunc((r.height * lines[numLines - i - 1]) / max);
      drawLine(g, r.x, y, r.x + r.width, y, Color.DARK_GRAY);
    }
    for (let i = 0; i < numLines + 1; i++) {
      const y = i < numLines ? r.y + r.height - trunc((r.height * lines[numLines - i - 1]) / max) : r.y + r.height;
      const s = i < numLines ? String(lines[numLines - i - 1]) : "0";
      drawString(g, fm, s, r.x - stringWidth(g, fm, s) - 7, y + trunc(fm.ascent / 2), white);
    }
    this.rect = r;
    this.initXPoints();
    const h = r.y + r.height + fm.ascent + 8;
    (this.xPoints || []).forEach((x, i) => {
      const s = this.horizontalLabels?.[i];
      if (s != null) drawString(g, fm, s, r.x + x - trunc(stringWidth(g, fm, s) / 2), h, white);
    });
    return r;
  }
  growTime() {
    let time = this.getRepeatTimeMs();
    if (time > 500000) time -= this.initialTime;
    return time;
  }
  getPoints(series, growOnStart) {
    const time = this.growTime(), max = this.maximum.getValue(), rect = this.rect;
    return series.values.map((_, i) => {
      const val = series.getAnimValue(i);
      if (val === NO_DATA) return NO_DATA;
      let h = trunc((rect.height * val) / max);
      if (growOnStart) {
        if (time < INITIAL_DELAY) h = 0;
        else if (time < INITIAL_DELAY + FADE_IN_TIME) h = trunc(h * smooth((time - INITIAL_DELAY) / FADE_IN_TIME));
      }
      return rect.height - h;
    });
  }
  paintLineSeries(g, series) {
    let size = series.getLength();
    if (!size) return;
    const color = series.getPaint(0), p = this.getPoints(series, false), growTime = this.growTime();
    if (growTime < INITIAL_DELAY) return;
    if (growTime < INITIAL_DELAY + FADE_IN_TIME) size = trunc(size * smooth((growTime - INITIAL_DELAY) / FADE_IN_TIME));
    for (let i = 1; i < size; i++)
      if (p[i - 1] !== NO_DATA && p[i] !== NO_DATA) drawLine(g, this.xPoints[i - 1], p[i - 1], this.xPoints[i], p[i], color, { width: series.strokeWidth });
    for (let i = 0; i < size; i++) series.drawPoint(g, this.xPoints[i], p[i], color);
  }
  paintBarSeries(g, series, ser, numSeries) {
    const size = series.getLength();
    if (!size) return;
    const w = trunc(this.rect.width / size), pp = this.getPoints(series, true), fm = this.labelFont;
    let ww = trunc(w * 0.8);
    const p = this.xPoints.map((x, i) => ({ x, y: pp[i] }));
    if (numSeries > 1) {
      ww = trunc(w * 0.7);
      for (const pt of p) {
        if (ser === 0) pt.x += trunc(f32(w * f32(0.1)));
        else if (ser === 1) pt.x -= trunc(f32(w * f32(0.1)));
      }
    }
    for (let i = 0; i < size; i++) {
      const hh = this.rect.height - p[i].y;
      fillRect(g, p[i].x - trunc(ww / 2) - 1, p[i].y - 1, ww + 3, hh + 2, new JColor(0, 0, 0, 64));
      fillRect(g, p[i].x - trunc(ww / 2), p[i].y, ww, hh, series.getPaint(i));
      drawRect(g, p[i].x - trunc(ww / 2), p[i].y, ww, hh, series.getOutline(i), { width: 2 });
    }
    if (this.showValueLabels && this.getTimeMs() / 1000 > 3) {
      const shadow = alpha(SHADOW, trunc(255 / 3)).css(), white = Color.WHITE.css();
      for (let i = 0; i < size; i++) {
        const s = series.getValueLabel(i), x = p[i].x - trunc(stringWidth(g, fm, s) / 2), y = p[i].y - fm.descent - 4;
        drawString(g, fm, s, x - 1, y - 1, shadow);
        drawString(g, fm, s, x + 1, y + 1, shadow);
        drawString(g, fm, s, x, y, white);
      }
    }
  }
  paint(g) {
    if (!this.dataSeries) return;
    const rect = (this.rect = this.paintBackgroundRect(g));
    drawLine(g, rect.x, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height, Color.WHITE);
    g.save();
    g.translate(rect.x, rect.y);
    const n = this.dataSeries.length;
    if (this.type === "LINE") for (const s of this.dataSeries) this.paintLineSeries(g, s);
    else {
      this.dataSeries.forEach((s, i) => this.paintBarSeries(g, s, i, n));
      drawLine(g, 0, rect.height, rect.width, rect.height, Color.WHITE);
    }
    g.restore();
    const time = this.growTime();
    if (time < 6000) {
      g.save();
      if (time > 0 && time < 1500) g.globalAlpha = time / 1500;
      else if (time > 4500) g.globalAlpha = (6000 - time) / 1500;
      const right = trunc((this.width - rect.x - rect.width) / 2);
      g.translate(this.width - right, rect.y + right);
      this.paintLegend(g);
      g.restore();
    }
  }
  paintLegend(g) {
    if (!this.dataSeries || this.dataSeries.length < 2) return;
    const fm = this.horizontalAxisFont, fh = fm.height, size = this.dataSeries.length, white = Color.WHITE.css();
    const h = MARGIN * 2 + MARGIN * (size - 1) + fh * size;
    let w = 0;
    for (const s of this.dataSeries) w = Math.max(w, MARGIN * 2 + fh + MARGIN + stringWidth(g, fm, s.title ?? "null"));
    g.translate(-w, 0);
    fillRect(g, 0, 0, w, h, new JColor(0, 0, 0, 192));
    drawRect(g, 0, 0, w, h, Color.WHITE);
    g.translate(MARGIN, MARGIN);
    let y = 0;
    for (const s of this.dataSeries) {
      fillRect(g, 0, y, fh, fh, s.getPaint(0));
      drawRect(g, 0, y, fh, fh, s.getOutline(0), { width: 2 });
      drawString(g, fm, s.title ?? "null", MARGIN + fh, y + fm.ascent + 1, white);
      y += fh + MARGIN;
    }
  }
}

const CHART_BLUE_YELLOW_RED = [ICPCColors.BLUE, ICPCColors.YELLOW, ICPCColors.RED];

/** TotalProblemsChart.getHourLabels */
export function hourLabels(numValues, min) {
  const labels = new Array(numValues).fill(null);
  if (trunc(60 / min) < labels.length) labels[trunc(60 / min)] = "1 hour";
  let count = 2;
  for (let i = trunc(120 / min); i < numValues; i += trunc(60 / min)) labels[i] = `${count++} hours`;
  return labels;
}

const bucket5 = (ms) => Math.max(0, Math.floor(ms / 1000 / 60 / 5));

export class ProblemSummaryChart extends AbstractChart {
  constructor() {
    super("BAR", "Attempts & Solutions by Problem", "# of submissions");
  }
  setupChart() {
    const problems = this.getContest().getProblems();
    if (!problems.length) return;
    this.horizontalLabels = problems.map((p) => p.label);
    const attempt = problems.map(problemColor);
    this.setSeries(new Series(attempt), new Series(attempt.map((c) => alphaDarker(c, 200, 0.8))));
  }
  updateData() {
    if (!this.dataSeries) return;
    const contest = this.getContest(), n = contest.getProblems().length, attempts = new Array(n).fill(0), solved = new Array(n).fill(0);
    for (const team of contest.c.teams || [])
      for (let j = 0; j < n; j++) {
        const r = contest.getResult(team, j);
        attempts[j] += r.numSubmissions;
        if (r.status === "SOLVED") solved[j]++;
      }
    this.dataSeries[0].setValues(attempts);
    this.dataSeries[1].setValues(solved);
    this.dataSeries[0].title = "# of submissions";
    this.dataSeries[1].title = "# of solved submissions";
  }
}

export class LanguageSummaryChart extends AbstractChart {
  constructor() {
    super("BAR", "Attempts & Solutions by Language", "# of submissions");
  }
  setupChart() {
    const langs = this.getContest().getLanguages();
    if (!langs.length) return;
    const colors = langs.map((_, i) => CHART_BLUE_YELLOW_RED[i % 3]);
    this.horizontalLabels = langs.map((l) => l.name);
    this.setSeries(new Series(colors), new Series(colors.map((c) => alphaDarker(c, 200, 0.85))));
    this.dataSeries[0].title = "# of submissions";
    this.dataSeries[1].title = "# of solutions";
  }
  updateData() {
    const langs = this.getContest().getLanguages();
    if (!langs.length || !this.dataSeries) return;
    const attempts = new Array(langs.length).fill(0), solved = new Array(langs.length).fill(0);
    for (const s of this.getContest().getAllSubmissions()) {
      if (s.languageIndex < 0 || s.languageIndex >= langs.length) continue;
      attempts[s.languageIndex]++;
      if (s.status === "SOLVED") solved[s.languageIndex]++;
    }
    this.dataSeries[0].setValues(attempts);
    this.dataSeries[1].setValues(solved);
  }
}

export class TotalProblemsChart extends AbstractChart {
  constructor() {
    super("LINE", "Total Problem Submissions", "# of submissions every 5 minutes");
    this.showValueLabels = false;
  }
  setupChart() {
    this.numValues = Math.max(1, trunc(this.getContest().getContestTimeOfLastEvent() / 60000 / 5));
    this.horizontalLabels = hourLabels(this.numValues, 5);
    this.setSeries(new Series(this.numValues, ICPCColors.FAILED_COLOR), new Series(this.numValues, ICPCColors.PENDING_COLOR), new Series(this.numValues, ICPCColors.SOLVED_COLOR));
    for (const s of this.dataSeries) s.linePoint = "OVAL";
  }
  updateData() {
    const solns = new Array(this.numValues).fill(0), fails = solns.slice(), pends = solns.slice();
    for (const s of this.getContest().getAllSubmissions()) {
      const rt = Math.min(bucket5(s.contestTime), this.numValues - 1);
      (s.status === "SOLVED" ? solns : s.status === "FAILED" ? fails : pends)[rt]++;
    }
    this.dataSeries[0].setValues(fails);
    this.dataSeries[1].setValues(pends);
    this.dataSeries[2].setValues(solns);
    this.dataSeries[0].title = "# of failed submissions";
    this.dataSeries[1].title = "# of pending submissions";
    this.dataSeries[2].title = "# of solved submissions";
  }
}

/** Contest order at TimeFilter(time): submissions at or after `time` are dropped (Ranking.rankIt). */
function orderAt(contest, time) {
  const teams = contest.c.teams || [], penaltyMs = (contest.c.penaltyMinutes ?? 20) * 60000, duration = contest.getDurationMs();
  const stats = new Map(teams.map((t) => [t.id, { team: t, solved: 0, time: 0, last: -1, cells: new Map() }]));
  const subs = contest.getAllSubmissions().filter((s) => s.contestTime < time && s.contestTime >= 0 && s.contestTime < duration)
    .sort((a, b) => a.contestTime - b.contestTime);
  for (const s of subs) {
    const st = stats.get(s.teamId);
    if (!st) continue;
    const cell = st.cells.get(s.problemIndex) || { solved: false, fails: 0 };
    st.cells.set(s.problemIndex, cell);
    if (cell.solved) continue;
    if (s.status === "SOLVED") {
      cell.solved = true;
      const min = Math.floor(s.contestTime / 60000);
      st.solved++;
      st.time += cell.fails * penaltyMs + min * 60000;
      st.last = Math.max(st.last, min);
    } else if (s.status === "FAILED" && s.penalty) cell.fails++;
  }
  return [...stats.values()].sort((a, b) => b.solved - a.solved || a.time - b.time || a.last - b.last ||
    String(a.team.name).localeCompare(String(b.team.name)));
}

/**
 * ScoreboardChart. Its TimeFilter time is the int product i * 5 * 60_000_000, which overflows; the
 * port keeps the same arithmetic, so most points show the final order and wrapped ones drop to 0.
 */
export class ScoreboardChart extends AbstractChart {
  constructor() {
    super("LINE", "Scoreboard Standing", "Rank");
    this.showValueLabels = false;
  }
  setupChart() {
    const contest = this.getContest();
    if (contest.getNumTeams() < 4) return;
    this.numValues = Math.max(1, trunc(contest.getContestTimeOfLastEvent() / 60000 / 5));
    this.horizontalLabels = hourLabels(this.numValues, 5);
    this.setSeries(...[Color.RED, Color.GREEN, Color.BLUE, Color.CYAN].map((c) => new Series(this.numValues, c)));
    const teams = contest.getOrderedTeams(), data = Array.from({ length: 4 }, () => new Array(this.numValues).fill(0)), cache = new Map();
    for (let i = 0; i < this.numValues; i++) {
      const time = Math.imul(Math.imul(i, 5), 60000000), key = Math.min(time, contest.getDurationMs());
      let order = cache.get(key);
      if (!order) cache.set(key, (order = orderAt(contest, time)));
      for (let j = 0; j < 4; j++) {
        const index = order.findIndex((st) => st.team.id === teams[j].id);
        data[j][i] = order[index].solved === 0 ? 0 : teams.length - index;
      }
    }
    for (let j = 0; j < 4; j++) {
      this.dataSeries[j].setValues(data[j]);
      this.dataSeries[j].title = teams[j].displayName || teams[j].name;
    }
  }
  updateData() {}
}

/** JudgementChart: average judgement time per problem. */
export class JudgementChart extends AbstractChart {
  constructor() {
    super("BAR", "Average Judgement Time by Problem", "Time");
  }
  setupChart() {
    this.title = this.words.judgementTimeByProblem || this.title;
    this.verticalAxisTitle = this.words.time || this.verticalAxisTitle;
    const problems = this.getContest().getProblems();
    if (!problems.length) return;
    this.horizontalLabels = problems.map((p) => p.label);
    const attempt = problems.map(problemColor), solved = attempt.map((c) => alphaDarker(c, 200, 0.8));
    const label = function (i) {
      const d = this.getValue(i);
      if (d === 0) return "";
      if (d > 950) return `${numberFormat(d / 1000.0, 1, 1)}s`;
      return `${numberFormat(d, 0)}ms`;
    };
    this.setSeries(Object.assign(new Series(attempt), { getValueLabel: label }), Object.assign(new Series(solved), { getValueLabel: label }));
  }
  updateData() {
    if (!this.dataSeries) return;
    const n = this.getContest().getProblems().length, at = new Array(n).fill(0), st = at.slice(), ac = at.slice(), sc = at.slice();
    for (const s of this.getContest().getAllSubmissions()) {
      if (s.judgeEnd < 0) continue;
      if (s.status === "SOLVED") {
        st[s.problemIndex] += s.judgeEnd - s.judgeStart;
        sc[s.problemIndex]++;
      } else {
        at[s.problemIndex] += s.judgeEnd - s.judgeStart;
        ac[s.problemIndex]++;
      }
    }
    for (let j = 0; j < n; j++) {
      if (ac[j] > 0) at[j] /= ac[j];
      if (sc[j] > 0) st[j] /= sc[j];
    }
    this.dataSeries[0].setValues(st);
    this.dataSeries[1].setValues(at);
    this.dataSeries[0].title = this.words.solutionJudgementTime || "Solution Judgement Time";
    this.dataSeries[1].title = this.words.attemptJudgementTime || "Attempt Judgement Time";
  }
}

export class JudgeQueueDepthChart extends AbstractChart {
  constructor() {
    super("LINE", "Judgement Queue Depth", "Time");
    this.showValueLabels = false;
  }
  setupChart() {
    this.title = this.words.judgeQueueDepth || this.title;
    const INTERVAL = 1000;
    this.numPoints = Math.max(1, trunc(this.getContest().getDurationMs() / INTERVAL));
    const labels = new Array(this.numPoints).fill(null);
    if (trunc(3600000 / INTERVAL) < this.numPoints) labels[trunc(3600000 / INTERVAL)] = "1 hour";
    let count = 2;
    for (let i = trunc(7200000 / INTERVAL); i < this.numPoints; i += trunc(3600000 / INTERVAL)) labels[i] = `${count++} hours`;
    this.horizontalLabels = labels;
    this.verticalAxisTitle = "Depth";
    const s = new Series(this.numPoints, ICPCColors.SOLVED_COLOR);
    s.strokeWidth = 1;
    s.getValueLabel = () => "";
    s.title = "Queued Submissions";
    this.setSeries(s);
  }
  updateData() {
    if (!this.dataSeries) return;
    const arr = new Array(this.numPoints).fill(0);
    let ms2 = Math.floor(this.getContest().getContestTimeOfLastEvent() / 1000);
    for (const s of this.getContest().getAllSubmissions()) {
      let ms1 = Math.ceil(s.contestTime / 1000);
      if (s.judgeEnd >= 0) ms2 = Math.floor(s.judgeEnd / 1000);
      if (ms1 > this.numPoints) ms1 = this.numPoints - 1;
      if (ms2 > this.numPoints) ms2 = this.numPoints - 1;
      for (let i = ms1; i < ms2; i++) arr[i]++;
    }
    this.dataSeries[0].setValues(arr);
  }
}

export class ProblemComparisonChart extends AbstractChart {
  constructor() {
    super("LINE", "Problem Submissions", "# of submissions every 5 minutes");
    this.showValueLabels = false;
  }
  setupChart() {
    this.title = "Submissions by Problem";
    this.numMin = Math.max(1, trunc(this.getContest().getContestTimeOfLastEvent() / 60000 / 5));
    this.horizontalLabels = hourLabels(this.numMin, 5);
    this.setSeries(...this.getContest().getProblems().map((p) => {
      let c = problemColor(p);
      if (c.r === 0 && c.g === 0 && c.b === 0 && c.a === 255) c = Color.DARK_GRAY;
      return Object.assign(new Series(this.numMin, c), { title: `Problem ${p.label}`, linePoint: "RECT" });
    }));
  }
  updateData() {
    const size = this.getContest().getProblems().length, data = Array.from({ length: size }, () => new Array(this.numMin).fill(0));
    for (const s of this.getContest().getAllSubmissions()) data[s.problemIndex][Math.min(bucket5(s.contestTime), this.numMin - 1)]++;
    data.forEach((d, i) => this.dataSeries[i].setValues(d));
  }
}

/** ProblemDetailChart: advances to the next problem on every repeat. */
export class ProblemDetailChart extends AbstractChart {
  constructor() {
    super("LINE", "Problem Submissions", "# of submissions every 5 minutes");
    this.showValueLabels = false;
    this.problemNum = 0;
  }
  aboutToShow() {
    super.aboutToShow();
    const n = this.getContest().getProblems().length;
    if (n) this.problemNum = (this.problemNum + 1) % n;
  }
  setupChart() {
    const problem = this.getContest().getProblems()[this.problemNum];
    if (!problem) return;
    this.title = `Problem ${problem.label} Submissions`;
    this.numMin = Math.max(1, trunc(this.getContest().getContestTimeOfLastEvent() / 60000 / 5));
    this.horizontalLabels = hourLabels(this.numMin, 5);
    this.setSeries(new Series(this.numMin, ICPCColors.FAILED_COLOR), new Series(this.numMin, ICPCColors.PENDING_COLOR), new Series(this.numMin, ICPCColors.SOLVED_COLOR));
    ["Failed submissions", "Pending submissions", "Solved submissions"].forEach((t, i) => Object.assign(this.dataSeries[i], { title: t, linePoint: "RECT" }));
  }
  updateData() {
    if (!this.dataSeries) return;
    const fails = new Array(this.numMin).fill(0), solns = fails.slice(), pends = fails.slice();
    for (const s of this.getContest().getAllSubmissions()) {
      if (s.problemIndex !== this.problemNum) continue;
      const rt = Math.min(bucket5(s.contestTime), this.numMin - 1);
      (s.status === "SOLVED" ? solns : s.status === "FAILED" ? fails : pends)[rt]++;
    }
    this.dataSeries[0].setValues(fails);
    this.dataSeries[1].setValues(pends);
    this.dataSeries[2].setValues(solns);
  }
}
