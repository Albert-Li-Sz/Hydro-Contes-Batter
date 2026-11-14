/*
 * Port of ICPC Tools v2.6.1331 ProblemSummaryPresentation (with ProblemSummary) and
 * ProblemColorsPresentation (with contest.model.util.Balloon).
 */
import { javaFont, stringWidth, drawString } from "./java-text.js";
import { Color, ICPCColors, JColor, contrastColor, fillRoundRect, drawRoundRect, scaleImage, toCanvas } from "./java-graphics.js";
import { JavaPresentation } from "./presentation-java.js";
import { problemColor } from "./pres-charts.js";

const trunc = Math.trunc, f32 = Math.fround;

class ProblemSummary {
  constructor(r, problem) {
    this.r = r;
    this.problem = problem;
    if (problem) {
      const p = problemColor(problem);
      this.color = new JColor(p.r, p.g, p.b);
      this.outlineColor = p.r === 255 && p.g === 255 && p.b === 255 && p.a === 255 ? Color.DARK_GRAY : contrastColor(p);
      this.brightColor = this.color.brighter();
      this.darkBgColor = new JColor(trunc(p.r / 3), trunc(p.g / 3), trunc(p.b / 3));
    }
    // FRACTIONALMETRICS_ON is set by the presentation before painting.
    this.bigFont = javaFont(trunc((r.height * 5) / 6), true, true);
    this.font = javaFont(trunc(r.height / 8), true, true);
    this.stats = null;
  }
  draw(g, c, x, y, w, h, arc, s) {
    fillRoundRect(g, x, y, w, h, arc, arc, c);
    drawString(g, this.font, s, x + trunc((w - stringWidth(g, this.font, s)) / 2), y + trunc((h + this.font.ascent) / 2) - 1, Color.WHITE.css());
  }
  paint(g, words) {
    const r = this.r, ARC = trunc((r.width + r.height) / 50);
    g.translate(r.x, r.y);
    fillRoundRect(g, 0, 0, r.width, r.height, ARC, ARC, this.color || Color.BLACK);
    if (this.problem) drawRoundRect(g, 0, 0, r.width, r.height, ARC, ARC, Color.LIGHT_GRAY, { width: 1.5 });
    const margin = trunc(r.height / 20);
    if (this.problem) {
      const fm = this.bigFont, s = this.problem.label;
      for (let i = -1; i < 2; i++)
        for (let j = -1; j < 2; j++) if (i !== 0 && j !== 0) drawString(g, fm, s, margin + i, margin + j + fm.ascent, this.outlineColor.css());
      drawString(g, fm, s, margin, margin + fm.ascent, this.brightColor.css());
    }
    const fm = this.font, margin2 = trunc(r.height / 15), w = trunc((r.width * 3) / 9) - margin * 2, x = r.width - margin - w - margin2,
      y = margin + margin2, h = trunc((r.height - margin * 2 - margin2 * 3 - margin2 * 2) / 4), arc2 = trunc(w / 10);
    const stats = this.stats;
    if (!stats) {
      const gray = Color.LIGHT_GRAY.css();
      [words.attempts || "Attempts", words.accepted || "Accepted", words.rejected || "Rejected", words.ftsTime || "First to Solve time"]
        .forEach((s, i) => drawString(g, fm, s, x + w - stringWidth(g, fm, s), y + (h + margin2) * i + fm.ascent, gray));
      return;
    }
    if (stats[0] > 0 || stats[1] > 0 || stats[2] > 0 || stats[3] > -1)
      fillRoundRect(g, x - margin2, y - margin2, w + margin2 * 2, h * 4 + margin2 * 3 + margin2 * 2, ARC, ARC, this.darkBgColor);
    if (stats[0] > 0) this.draw(g, ICPCColors.PENDING[5], x, y, w, h, arc2, String(stats[0]));
    if (stats[1] > 0) this.draw(g, ICPCColors.SOLVED[5], x, y + h + margin2, w, h, arc2, String(stats[1]));
    if (stats[2] > 0) this.draw(g, ICPCColors.FAILED[5], x, y + (h + margin2) * 2, w, h, arc2, String(stats[2]));
    if (stats[3] > -1) {
      this.draw(g, ICPCColors.FIRST_TO_SOLVE[5], x, y + (h + margin2) * 3, w, h, arc2, String(stats[3]));
      drawRoundRect(g, x, y + (h + margin2) * 3, w, h, arc2, arc2, ICPCColors.SOLVED_COLOR, { width: 1.5 });
    }
  }
}

const MARGIN = 5, FLY_IN = 250;

export class ProblemSummaryPresentation extends JavaPresentation {
  getRepeat() {
    return this.probs ? this.probs.length * 1000 + 5000 : 5000;
  }
  setSize(w, h) {
    super.setSize(w, h);
    const problems = this.getContest().getProblems(), GAP = trunc(h / 50), numProblems = problems.length;
    if (!numProblems) {
      this.probs = null;
      return;
    }
    const rows = numProblems >= 12 ? 4 : numProblems >= 9 ? 3 : numProblems >= 4 ? 2 : 1;
    const numPerRow = Math.ceil((numProblems + 1) / rows), wid = trunc((w - MARGIN * 2 - GAP * (numPerRow - 1)) / numPerRow),
      hei = trunc((h - MARGIN * 2 - GAP * (rows - 1)) / rows);
    this.probs = Array.from({ length: numProblems + 1 }, (_, i) => new ProblemSummary(
      { x: MARGIN + (i % numPerRow) * (wid + GAP), y: MARGIN + trunc(i / numPerRow) * (hei + GAP), width: wid, height: hei },
      i < numProblems ? problems[i] : null));
  }
  paint(g) {
    if (!this.probs) return;
    const contest = this.getContest(), timeMs = this.getRepeatTimeMs();
    for (let i = 0; i < this.probs.length; i++) {
      if (timeMs <= i * FLY_IN) break;
      if (this.probs[i].problem) {
        const stats = [0, 0, 0, -1];
        for (const team of contest.c.teams || []) {
          const r = contest.getResult(team, i);
          stats[0] += r.numSubmissions;
          if (r.firstToSolve) stats[3] = r.contestTimeMin;
          if (r.status === "SOLVED") {
            stats[1]++;
            if (r.numJudged > 1) stats[2] += r.numJudged - 1;
          } else if (r.status === "FAILED") stats[2] += r.numJudged;
        }
        this.probs[i].stats = stats;
      }
      g.save();
      if (timeMs < (i + 1) * FLY_IN) {
        const f = f32((timeMs - f32(i * FLY_IN)) / FLY_IN), dx = trunc(f32(f32(1 - f) * this.width) / 30);
        g.globalAlpha = f;
        g.translate(dx, dx);
      }
      this.probs[i].paint(g, this.words);
      g.restore();
    }
  }
}

const TIME_FADE_IN = 200, TIME_BIG = 1000, TIME_FADE_OUT = 600, TIME_PER_PROBLEM = TIME_FADE_IN + TIME_BIG + TIME_FADE_OUT, TIME_END = 6000;
const BALLOON = "/hydro-resolver/assets/img/icpc-balloon.gif";

/** Balloon.getBalloonImage(c): recolour the template's red, highlight and outline pixels. */
function balloonImage(base, c) {
  const canvas = toCanvas(base), ctx = canvas.getContext("2d"), data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const cc = c.brighter(), outline = contrastColor(c), px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
    if (a === 255 && r === 255 && g === 255 && b === 255) {
      px[i + 3] = 0;
      continue;
    }
    const set = (col) => {
      px[i] = col.r;
      px[i + 1] = col.g;
      px[i + 2] = col.b;
      px[i + 3] = 255;
    };
    if (a === 255 && r === 255 && g === 0 && b === 0) set(c);
    else if (a === 255 && r === 255 && g === 198 && b === 198) set(cc);
    else if (a === 255 && r === 0 && g === 0 && b === 0) set(outline);
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export class ProblemColorsPresentation extends JavaPresentation {
  getRepeat() {
    return TIME_PER_PROBLEM * this.getContest().getProblems().length + TIME_END;
  }
  init() {
    if (this.problemInfos) return;
    const base = this.image(BALLOON);
    if (!base) return;
    const h = trunc((this.height * 4) / 5), font = javaFont(f32(f32(h * 45) / 96), true);
    this.problemInfos = this.getContest().getProblems().map((p) => {
      const c = problemColor(p), img = balloonImage(base, c), w = trunc((h * img.width) / img.height);
      const bi = document.createElement("canvas");
      bi.width = w;
      bi.height = h;
      const g = bi.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h);
      const s = p.label;
      drawString(g, font, s, trunc((w - stringWidth(g, font, s)) / 2), trunc(h * 0.575), contrastColor(c).css());
      return { x: 0, y: 0, bigImage: bi, smallImage: null };
    });
    this.createSmallImages();
  }
  setSize(w, h) {
    const changed = w !== this.width || h !== this.height;
    super.setSize(w, h);
    if (changed) this.problemInfos = null;
    this.init();
  }
  createSmallImages() {
    const infos = this.problemInfos;
    if (!infos?.length) return;
    const n = infos.length, img = infos[0].bigImage, { width, height } = this;
    if (width > height * 2) {
      const scale = img.height / (height / 2.0), w = trunc(img.width / scale), h = trunc(img.height / scale),
        numTopRow = trunc((n + 1) / 2), topRowOffset = trunc((width - w * numTopRow) / 2), bottomRowOffset = topRowOffset + (n % 2 === 1 ? trunc(w / 2) : 0);
      infos.forEach((pi, i) => {
        pi.smallImage = scaleImage(pi.bigImage, w - 10, h - 10);
        pi.x = (i < numTopRow ? topRowOffset + w * i : bottomRowOffset + w * (i - numTopRow)) + 5;
        pi.y = (i < numTopRow ? 0 : h) + 5;
      });
      return;
    }
    const scale = img.height / (height / 3.0), w = trunc(img.width / scale), h = trunc(img.height / scale), dif = n % 3;
    let numTopBottomRow = trunc(n / 3), numMiddleRow = trunc(n / 3);
    if (dif === 0 || dif === 1) numMiddleRow++;
    else numTopBottomRow++;
    const longestRow = Math.max(numTopBottomRow, numMiddleRow);
    let topBottomRowOffset = trunc((width - w * longestRow) / 2), middleRowOffset = topBottomRowOffset;
    if (dif === 0 || dif === 1) topBottomRowOffset += trunc(w / 2);
    else middleRowOffset += trunc(w / 2);
    infos.forEach((pi, i) => {
      pi.smallImage = scaleImage(pi.bigImage, w - 10, h - 10);
      if (i < numTopBottomRow) [pi.x, pi.y] = [topBottomRowOffset + w * i, 0];
      else if (i < numTopBottomRow + numMiddleRow) [pi.x, pi.y] = [middleRowOffset + w * (i - numTopBottomRow), h];
      else [pi.x, pi.y] = [topBottomRowOffset + w * (i - numTopBottomRow - numMiddleRow), h * 2];
      pi.x += 5;
      pi.y += 5;
    });
  }
  paint(g) {
    if (!this.problemInfos) this.init();
    const infos = this.problemInfos;
    if (!infos) return;
    const time = this.getRepeatTimeMs();
    let balloonNum = trunc(time / TIME_PER_PROBLEM + 0.5);
    const balloonTime = time - TIME_PER_PROBLEM * balloonNum;
    if (balloonNum > infos.length) balloonNum = infos.length;
    for (let i = 0; i < balloonNum; i++) if (infos[i].smallImage) g.drawImage(infos[i].smallImage, infos[i].x, infos[i].y);
    if (balloonNum >= infos.length) return;
    g.save();
    if (balloonTime < TIME_FADE_IN) g.globalAlpha = Math.max(0, balloonTime / TIME_FADE_IN);
    const pi = infos[balloonNum], image = pi.bigImage;
    let x = trunc((this.width - image.width) / 2), y = trunc((this.height - image.height) / 2);
    if (balloonTime > TIME_FADE_IN + TIME_BIG) {
      const t = f32((balloonTime - TIME_FADE_IN - TIME_BIG) / TIME_FADE_OUT);
      x = trunc(x * (1 - t) + pi.x * t);
      y = trunc(y * (1 - t) + pi.y * t);
      const w = trunc(image.width * (1 - t) + pi.smallImage.width * t), h = trunc(image.height * (1 - t) + pi.smallImage.height * t);
      g.imageSmoothingEnabled = false;
      g.drawImage(image, 0, 0, image.width, image.height, x, y, w, h);
    } else g.drawImage(image, x, y);
    g.restore();
  }
}
