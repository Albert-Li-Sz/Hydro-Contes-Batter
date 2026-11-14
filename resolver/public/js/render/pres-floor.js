/*
 * Port of ICPC Tools v2.6.1331 FloorMap (drawing and aisle paths), ContestFloorPresentation
 * ("Contest Floor") and BalloonFloorPresentation ("Balloons"). Both need the CDS map-info
 * extension; without it the original draws nothing, and so does the port.
 */
import { Animator, Movement } from "./animator.js";
import { javaFont, stringWidth, drawString } from "./java-text.js";
import { Color, JColor, contrastColor, fillPath, strokePath, drawLine, logoImage, scaleImage, toCanvas } from "./java-graphics.js";
import { JavaPresentation } from "./presentation-java.js";
import { problemColor } from "./pres-charts.js";

const trunc = Math.trunc, f32 = Math.fround, rad = (d) => (d * Math.PI) / 180;
const LIGHTER_GRAY = new JColor(240, 240, 240), DARKISH_GRAY = new JColor(96, 96, 96), DARKER_GRAY = new JColor(40, 40, 40),
  DARKEST_GRAY = new JColor(25, 25, 25);
const COLORS = {
  teamAreaFill: Color.BLACK, teamAreaOutline: Color.GRAY, seatFill: DARKEST_GRAY, seatOutline: DARKISH_GRAY, text: Color.WHITE,
  deskOutline: Color.GRAY, deskFill: DARKER_GRAY,
};

const rect = (x, y, w, h) => [["M", [x, y]], ["L", [x + w, y]], ["L", [x + w, y + h]], ["L", [x, y + h]], ["Z"]];

class FloorMap {
  constructor(contest) {
    this.contest = contest;
    this.mapInfo = contest.c.mapInfo || null;
    this.teams = (contest.c.teams || []).filter((t) => t.location);
    this.bounds = this.getBounds();
    this.intersections = this.computeAisleIntersections();
  }
  getBounds() {
    const mi = this.mapInfo;
    if (!mi) return null;
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    for (const t of this.teams) {
      const { x, y, rotation } = t.location, c = Math.cos(rad(rotation)), s = Math.sin(rad(rotation));
      for (const [px, py] of [[-mi.tableDepth / 2, -mi.tableWidth / 2], [mi.tableDepth / 2, -mi.tableWidth / 2], [mi.tableDepth / 2, mi.tableWidth / 2], [-mi.tableDepth / 2, mi.tableWidth / 2]]) {
        const tx = x + px * c - py * s, ty = y + px * s + py * c;
        x1 = Math.min(x1, tx);
        y1 = Math.min(y1, ty);
        x2 = Math.max(x2, tx);
        y2 = Math.max(y2, ty);
      }
    }
    for (const p of this.contest.getProblems()) {
      if (!p.location) continue;
      x1 = Math.min(x1, p.location.x - 2);
      y1 = Math.min(y1, p.location.y - 2);
      x2 = Math.max(x2, p.location.x + 2);
      y2 = Math.max(y2, p.location.y + 2);
    }
    for (const a of mi.aisles) {
      x1 = Math.min(x1, a.x1, a.x2);
      y1 = Math.min(y1, a.y1, a.y2);
      x2 = Math.max(x2, a.x1, a.x2);
      y2 = Math.max(y2, a.y1, a.y2);
    }
    return { x: x1 - 2, y: y1 - 2, width: x2 - x1 + 4, height: y2 - y1 + 4 };
  }
  computeAisleIntersections() {
    const list = [], aisles = this.mapInfo?.aisles || [];
    for (let i = 0; i < aisles.length - 1; i++)
      for (let j = i + 1; j < aisles.length; j++) {
        const a1 = aisles[i], a2 = aisles[j], xd1 = a1.x2 - a1.x1, yd1 = a1.y2 - a1.y1, xd2 = a2.x2 - a2.x1, yd2 = a2.y2 - a2.y1,
          denom = xd2 * yd1 - yd2 * xd1;
        if (denom === 0) continue;
        const s1 = (yd2 * (a1.x1 - a2.x1) - xd2 * (a1.y1 - a2.y1)) / denom;
        if (s1 < 0 || s1 > 1) continue;
        const s2 = (yd1 * (a1.x1 - a2.x1) - xd1 * (a1.y1 - a2.y1)) / denom;
        if (s2 >= 0 && s2 <= 1) list.push({ a1, a2, x: a1.x1 + s1 * xd1, y: a1.y1 + s1 * yd1 });
      }
    return list;
  }
  origin(r) {
    const b = this.bounds, scale = Math.min(r.width / b.width, r.height / b.height), ww = trunc(b.width * scale), hh = trunc(b.height * scale);
    return { scale, x1: trunc((r.width - ww) / 2) + r.x - trunc(b.x * scale), y1: trunc((r.height - hh) / 2) + r.y - trunc(b.y * scale) };
  }
  /** FloorMap.getPosition(r, x, y) */
  getPosition(r, x, y) {
    const b = this.bounds, scale = Math.min(r.width / b.width, r.height / b.height), ww = trunc(b.width * scale), hh = trunc(b.height * scale);
    return { x: trunc((r.width - ww) / 2) + r.x - trunc((b.x - x) * scale), y: trunc((r.height - hh) / 2) + r.y - trunc((b.y - y) * scale) };
  }
  getTeamPosition(r, team) {
    const a = rad(team.location.rotation + 180), d = this.mapInfo.teamAreaDepth;
    return this.getPosition(r, team.location.x + (Math.cos(a) * d) / 3, team.location.y - (Math.sin(a) * d) / 3);
  }
  drawFloor(g, r, teamLogo) {
    const mi = this.mapInfo;
    if (!mi || !this.bounds) return;
    const { scale, x1, y1 } = this.origin(r), fontSize = f32((mi.tableWidth * scale) / f32(2.75));
    for (const t of this.teams) {
      g.save();
      g.translate(x1 + t.location.x * scale, y1 + t.location.y * scale);
      g.rotate(-rad(t.location.rotation));
      const draw = (segs, fill, outline) => {
        fillPath(g, segs, fill);
        strokePath(g, segs, outline);
      };
      draw(rect((-(mi.teamAreaDepth + 1) * scale) / 2, (-mi.teamAreaWidth * scale) / 2, mi.teamAreaDepth * scale, mi.teamAreaWidth * scale), COLORS.teamAreaFill, COLORS.teamAreaOutline);
      const c = (mi.tableWidth * scale) / 8;
      for (let i = 0; i < 3; i++)
        draw(rect(-mi.tableDepth * scale * 0.75, (-mi.tableWidth * scale) / 2 + c * i * 2.5 + c / 2, mi.tableDepth * scale * 0.25, c * 2), COLORS.seatFill, COLORS.seatOutline);
      draw(rect((-mi.tableDepth * scale) / 2, (-mi.tableWidth * scale) / 2, mi.tableDepth * scale, mi.tableWidth * scale), COLORS.deskFill, COLORS.deskOutline);
      if (t.label != null && !teamLogo(t)) {
        g.rotate(t.location.rotation === 270 ? rad(270) : rad(90));
        // drawFloor derives the Graphics default "Dialog" font (Lucida Grande on macOS, DejaVu Sans on Linux).
        g.font = `${fontSize}px "Lucida Grande", "DejaVu Sans", Arial, sans-serif`;
        g.fillStyle = COLORS.text.css();
        const ascent = Math.ceil(fontSize * 0.93);
        g.fillText(t.label, -g.measureText(t.label).width / 2, (ascent - 3.5) / 2);
      }
      g.restore();
    }
    for (const t of this.teams) {
      const img = teamLogo(t);
      if (!img) continue;
      const a = rad(t.location.rotation + 180), x = x1 + (t.location.x + (Math.cos(a) * mi.teamAreaDepth) / 3) * scale,
        y = y1 + (t.location.y - (Math.sin(a) * mi.teamAreaDepth) / 3) * scale;
      g.drawImage(img, trunc(x - trunc(img.width / 2)), trunc(y - trunc(img.height / 2)));
    }
  }
  getClosestAisle(x, y) {
    if (!this.mapInfo) return null;
    const ai = { a1: null, a2: null, x: 0, y: 0 };
    let dist = Number.MAX_VALUE;
    for (const a of this.mapInfo.aisles) {
      const xd = a.x2 - a.x1, yd = a.y2 - a.y1;
      let k = (xd * x - xd * a.x1 + yd * y - yd * a.y1) / (xd * xd + yd * yd);
      k = Math.max(0, Math.min(1, k));
      const xc = a.x1 + k * xd, yc = a.y1 + k * yd, d = Math.hypot(x - xc, y - yc);
      if (d < dist) Object.assign(ai, { a1: a, x: xc, y: yc }), (dist = d);
    }
    return ai;
  }
  intersectionsOf(a) {
    return a ? this.intersections.filter((ai) => ai.a1 === a || ai.a2 === a) : [];
  }
  /** FloorMap.getPath: recursive relaxation from the problem's balloon to the team. */
  getPath(p1, p2) {
    if (!p1 || !p2) return null;
    const start = this.getClosestAisle(p1.x, p1.y), end = this.getClosestAisle(p2.x, p2.y);
    if (!start || !end) return null;
    const paths = new Map([[start, { list: [start], dist: 0 }]]);
    const relax = (from) => {
      const path = paths.get(from);
      for (const aisle of [from.a1, from.a2]) {
        const list = this.intersectionsOf(aisle);
        if (aisle && aisle === end.a1) list.push(end);
        for (const ai of list) {
          const p = paths.get(ai), dist = path.dist + Math.hypot(from.x - ai.x, from.y - ai.y);
          if (!p || dist < p.dist) {
            paths.set(ai, { list: [...path.list, ai], dist });
            relax(ai);
          }
        }
      }
    };
    relax(start);
    const best = paths.get(end);
    if (!best) return null;
    best.dist += Math.hypot(start.x - p1.x, start.y - p1.y);
    best.list.unshift({ x: p1.x, y: p1.y });
    best.dist += Math.hypot(end.x - p2.x, end.y - p2.y);
    best.list.push({ x: p2.x, y: p2.y });
    return best;
  }
  interimPosition(path, d) {
    if (d < 0 || d > path.dist) return null;
    path.segLength ||= path.list.slice(0, -1).map((a, i) => Math.hypot(a.x - path.list[i + 1].x, a.y - path.list[i + 1].y));
    let i = 0, dd = d;
    while (dd >= 0) {
      if (i >= path.segLength.length) return { ...path.list[path.list.length - 1] };
      if (dd > path.segLength[i]) dd -= path.segLength[i];
      else {
        const a = path.list[i], b = path.list[i + 1], f = dd / path.segLength[i];
        return { x: a.x - (a.x - b.x) * f, y: a.y - (a.y - b.y) * f };
      }
      i++;
    }
    return null;
  }
  drawPath(g, r, path, color) {
    const { scale, x1, y1 } = this.origin(r);
    g.save();
    g.translate(x1, y1);
    let prev = null;
    for (const ai of path.list) {
      const nx = trunc(scale * ai.x), ny = trunc(scale * ai.y);
      if (prev) drawLine(g, prev[0], prev[1], nx, ny, color, { width: 3 });
      prev = [nx, ny];
    }
    g.restore();
  }
}

/** Numeric ids first, as ContestUtil.sort. */
function sortTeams(teams) {
  return [...teams].sort((a, b) => {
    const na = /^-?\d+$/.test(a.id) ? Number(a.id) : NaN, nb = /^-?\d+$/.test(b.id) ? Number(b.id) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const MS_PER_TEAM = 2000;

export class ContestFloor extends JavaPresentation {
  getRepeat() {
    return this.getContest().getNumTeams() * MS_PER_TEAM;
  }
  paint(g) {
    const contest = this.getContest(), floor = new FloorMap(contest), teams = sortTeams(contest.c.teams || []);
    const team = teams[trunc(this.getRepeatTimeMs() / MS_PER_TEAM)], mx = Math.min(trunc(this.width / 10), trunc(this.height / 10));
    const r = { x: 0, y: 0, width: this.width, height: this.height };
    floor.drawFloor(g, r, (t) => (team && t.id === team.id ? logoImage(this.image(t.logo), mx, mx) : null));
    if (!team) return;
    const fm = javaFont(36, false), s = team.displayName || team.name, hh = fm.height + 10, img = logoImage(this.image(team.logo), hh, hh);
    const textHeight = Math.max(img ? img.height : 0, fm.height), textWidth = (img ? img.width + 10 : 0) + stringWidth(g, fm, s);
    const sx = textWidth > this.width - 40 ? (this.width - 40) / textWidth : 1, top = 20 + trunc((hh - textHeight) / 2);
    g.save();
    g.translate(20, 0);
    g.scale(sx, 1);
    let x = 0;
    if (img) {
      g.drawImage(img, x, top + trunc(textHeight / 2) - trunc(img.height / 2));
      x += img.width + 10;
    }
    drawString(g, fm, s, x, top + trunc(textHeight / 2) - trunc(fm.height / 2) + fm.ascent, Color.WHITE.css());
    g.restore();
  }
}

/** Balloon.getBalloonImage(c) */
function balloonImage(base, c) {
  const canvas = toCanvas(base), ctx = canvas.getContext("2d"), data = ctx.getImageData(0, 0, canvas.width, canvas.height), px = data.data;
  const cc = c.brighter(), outline = contrastColor(c);
  for (let i = 0; i < px.length; i += 4) {
    const [r, gg, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]], set = (col) => ([px[i], px[i + 1], px[i + 2], px[i + 3]] = [col.r, col.g, col.b, 255]);
    if (a === 255 && r === 255 && gg === 255 && b === 255) px[i + 3] = 0;
    else if (a === 255 && r === 255 && gg === 0 && b === 0) set(c);
    else if (a === 255 && r === 255 && gg === 198 && b === 198) set(cc);
    else if (a === 255 && r === 0 && gg === 0 && b === 0) set(outline);
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export class BalloonFloor extends JavaPresentation {
  constructor() {
    super();
    this.records = [];
    this.seen = null;
  }
  setSize(w, h) {
    super.setSize(w, h);
    this.font = javaFont(f32(f32(f32(h * 72) * f32(0.04)) / 96), true);
    this.balloonImages = null;
  }
  loadBalloons() {
    if (this.balloonImages) return true;
    const base = this.image("/hydro-resolver/assets/img/icpc-balloon.gif"), solved = this.image("/hydro-resolver/assets/img/icpc-balloon-solved.gif"),
      failed = this.image("/hydro-resolver/assets/img/icpc-balloon-failed.gif");
    if (!base || !solved || !failed) return false;
    const h = trunc(this.height / 15);
    this.balloonImages = this.getContest().getProblems().map((p, i) => {
      const img = balloonImage(base, problemColor(p)), w = trunc((h * img.width) / img.height);
      if (i === 0) {
        this.solvedImage = scaleImage(solved, w, h);
        this.failedImage = scaleImage(failed, w, h);
      }
      return scaleImage(img, w, h);
    });
    return true;
  }
  aboutToShow() {
    this.records = [];
    const contest = this.getContest(), subs = contest.getAllSubmissions();
    this.floor = new FloorMap(contest);
    this.seen = new Set(subs.map((s) => s.index));
    if (!contest.isFrozen(this.getTimeMs())) for (const s of subs) if (s.status === "SUBMITTED") this.handleSubmission(s);
  }
  handleSubmission(submission) {
    for (const sr of this.records)
      if (sr.submission.index === submission.index) {
        sr.submission = submission;
        return;
      }
    const contest = this.getContest(), problem = contest.getProblems()[submission.problemIndex], team = submission.team;
    const path = this.floor.getPath(problem?.location, team?.location);
    if (!path) return;
    const anim = new Animator(0, new Movement(5.0, 8.0));
    anim.setTarget(path.dist - 2);
    const org = contest.getOrganizationById(team.organizationId);
    this.records.push({ submission, anim, fullAge: 0, actionAge: 0, path, problem: submission.problemIndex, team, org, logoUrl: team.logo || org?.logo, action: null });
  }
  incrementTimeMs(dt) {
    const contest = this.getContest(), all = contest.getAllSubmissions();
    for (const sr of this.records) if (all[sr.submission.index]) sr.submission = all[sr.submission.index];
    if (this.seen) for (const s of all) if (!this.seen.has(s.index)) this.seen.add(s.index), this.handleSubmission(s);
    const frozenRunning = contest.isFrozen(this.getTimeMs()) && !contest.isOver(), remove = [];
    for (const sr of this.records) {
      sr.anim.incrementTimeMs(dt);
      sr.fullAge += dt;
      if (sr.action == null) {
        if (frozenRunning) {
          if (sr.fullAge > 14000) sr.action = "FADE_OUT";
        } else if (sr.submission.status !== "SUBMITTED") sr.action = sr.submission.status === "SOLVED" ? "SOLVED" : "FAILED";
      } else sr.actionAge += dt;
      if (sr.action === "SOLVED" && sr.actionAge > 11000) remove.push(sr);
      if (sr.action === "FAILED" && sr.actionAge > 8000) remove.push(sr);
      else if (sr.action === "FADE_OUT" && sr.actionAge > 2000) remove.push(sr);
    }
    this.records = this.records.filter((sr) => !remove.includes(sr));
  }
  fade(g, sr) {
    if (sr.action === "SOLVED" && sr.actionAge > 10000) g.globalAlpha = (11000 - sr.actionAge) / 1000;
    else if (sr.action === "FAILED" && sr.actionAge > 7000) g.globalAlpha = (8000 - sr.actionAge) / 1000;
    else g.globalAlpha = 1;
  }
  paint(g) {
    if (!this.floor) this.floor = new FloorMap(this.getContest());
    if (!this.loadBalloons() || !this.floor.bounds) return;
    const r = { x: 0, y: 0, width: this.width, height: this.height }, srs = this.records.slice();
    this.floor.drawFloor(g, r, () => null);
    for (const sr of srs) {
      g.save();
      if (sr.fullAge < 1000) g.globalAlpha = sr.fullAge / 1000;
      else if (sr.anim.getValue() > sr.anim.getTarget() - 2) g.globalAlpha = Math.max(0, f32((sr.anim.getTarget() - sr.anim.getValue()) / 2.0));
      if (sr.anim.getValue() + 0.02 < sr.anim.getTarget()) this.floor.drawPath(g, r, sr.path, Color.DARK_GRAY);
      g.restore();
    }
    this.drawTeamLogo(g, r, srs, false);
    for (const sr of srs) {
      if (sr.problem >= this.balloonImages.length) continue;
      const p = this.floor.interimPosition(sr.path, sr.anim.getValue());
      if (!p) continue;
      const p2 = this.floor.getPosition(r, p.x, p.y), img = this.balloonImages[sr.problem], x = trunc(p2.x - img.width / 2.0), y = trunc(p2.y - img.height / 2.0);
      g.save();
      this.fade(g, sr);
      g.drawImage(img, x, y);
      if (sr.submission.status === "SOLVED") g.drawImage(this.solvedImage, x, y);
      else if (sr.submission.status !== "SUBMITTED") g.drawImage(this.failedImage, x, y);
      g.restore();
    }
    this.drawTeamLogo(g, r, srs, true);
  }
  drawTeamLogo(g, r, srs, drawLarge) {
    const teamIds = [];
    for (let i = srs.length - 1; i >= 0; i--) {
      const sr = srs[i];
      if ((sr.fullAge < 4000 && !drawLarge) || (sr.fullAge >= 4000 && drawLarge)) continue;
      const img = logoImage(this.image(sr.logoUrl), trunc(this.height / 6), trunc(this.height / 6));
      if (!img || teamIds.includes(sr.team.id)) continue;
      const smImg = logoImage(this.image(sr.logoUrl), trunc(trunc((this.height * 4) / 6) / 10), trunc(trunc((this.height * 4) / 6) / 10));
      teamIds.push(sr.team.id);
      const p2 = this.floor.getTeamPosition(r, sr.team);
      g.save();
      this.fade(g, sr);
      let yy;
      if (sr.fullAge < 3000) {
        g.drawImage(img, trunc(p2.x - img.width / 2.0), trunc(p2.y - img.height / 2.0));
        yy = trunc(img.height / 2) + 4;
      } else if (sr.fullAge < 4000) {
        const sc = 1.0 - (0.6 * (sr.fullAge - 3000)) / 1000;
        g.drawImage(img, trunc(p2.x - (img.width * sc) / 2.0), trunc(p2.y - (img.height * sc) / 2.0), trunc(img.width * sc), trunc(img.height * sc));
        yy = trunc((img.height * sc) / 2) + 4;
      } else {
        g.drawImage(smImg, trunc(p2.x - smImg.width / 2.0), trunc(p2.y - smImg.height / 2.0));
        yy = trunc(smImg.height / 2) + 4;
      }
      const s = sr.org?.name || "", fm = this.font;
      drawString(g, fm, s, trunc(p2.x) - trunc(stringWidth(g, fm, s) / 2), trunc(p2.y) + yy + fm.ascent, Color.WHITE.css());
      g.restore();
    }
  }
}
