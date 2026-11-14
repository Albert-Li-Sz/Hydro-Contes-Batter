/*
 * Port of ICPC Tools v2.6.1331 ClockPresentation / CountdownPresentation / PolarCountdownPresentation.
 * The countdown target comes from the program item (CountdownPresentation's "targetTime" property).
 */
import { drawDigital, digitalWidth } from "./digital-font.js";
import { Color, ICPCColors, JColor, fillArc, fillOval, logoImage } from "./java-graphics.js";
import { formatTime } from "./java-contest.js";
import { JavaPresentation } from "./presentation-java.js";

const trunc = Math.trunc, f32 = Math.fround;
const EOC_COLOR = ICPCColors.RED.brighter().brighter().brighter();

class Countdown extends JavaPresentation {
  constructor() {
    super();
    this.verticalOffset = 0;
    this.clockColor = Color.WHITE;
  }
  setSize(w, h) {
    super.setSize(w, h);
    this.banner = null;
    this.verticalOffset = 0;
  }
  bannerImage() {
    if (!this.banner) {
      this.banner = logoImage(this.image(this.getContest().c.banner), trunc(this.width * 0.7), trunc(this.height * 0.2));
      if (this.banner) this.verticalOffset = trunc(this.banner.height / 2);
    }
    return this.banner;
  }
  getRemainingMillis() {
    const now = this.getTimeMs(), target = this.item?.targetTime;
    if (target > 0) return target - now;
    const contest = this.getContest(), start = contest.startMs();
    if (start === null) return 0;
    const mult = contest.multiplier(), duration = contest.getDurationMs(), freeze = contest.getFreezeDurationMs();
    const switchPoint = freeze > 0 ? duration - freeze : trunc((duration * 2) / 3);
    if (start - now < -(switchPoint / mult)) {
      this.clockColor = EOC_COLOR;
      return Math.round((start - now) * mult + duration);
    }
    this.clockColor = Color.WHITE;
    return Math.round((start - now) * mult);
  }
  getClock() {
    return -this.getRemainingMillis();
  }
  getTextBackgroundColor() {
    return new JColor(12, 12, 12);
  }
  paintClock(g) {
    const banner = this.bannerImage();
    if (banner) g.drawImage(banner, trunc((this.width - banner.width) / 2), this.height - banner.height - 20);
    const ms = this.getClock();
    if (ms == null) return;
    let time = formatTime(ms, true);
    if (!time.startsWith("-")) time = `+${time}`;
    let yh = trunc(Math.min(f32(0.225 * this.width), this.height * 0.55)), w = digitalWidth(time, yh);
    if (w > this.width) {
      yh = trunc((yh * this.width) / w);
      w = digitalWidth(time, yh);
    }
    const bg = this.getTextBackgroundColor();
    drawDigital(g, time, trunc((this.width - w) / 2), trunc(f32(f32(this.height + f32(this.height / f32(2.5))) / 2) - this.verticalOffset), yh,
      this.clockColor.css(), bg ? bg.css() : null);
  }
  paint(g) {
    this.paintClock(g);
  }
}

const NUM_ARCS = 3, ARC_GAP = 8;

export class PolarCountdown extends Countdown {
  setSize(w, h) {
    super.setSize(w, h);
    this.bannerImage();
    const diam = Math.min(w, h) - this.verticalOffset - 5;
    this.arcDim = Array.from({ length: NUM_ARCS }, (_, i) => {
      const r = trunc(trunc((diam * (NUM_ARCS + 1 - i)) / (NUM_ARCS + 1)) / 2);
      return { x: trunc(w / 2) - r, y: trunc(h / 2) - r - this.verticalOffset, width: r * 2, height: r * 2 };
    });
    this.arcWidth = trunc(trunc(diam / (NUM_ARCS + 1)) / 2) - ARC_GAP;
  }
  getTextBackgroundColor() {
    return null;
  }
  paint(g) {
    const l = this.getClock();
    if (l != null && this.arcDim) {
      const angle = [0, 0, 0], s = Math.floor(l / 1000.0), maxHours = trunc(this.getContest().getDurationMs() / 3600000);
      if (maxHours !== 0) {
        // Java int arithmetic: % keeps the dividend's sign, / truncates.
        if (s < 0) {
          angle[0] = -(59 + (s % 120)) * 6;
          angle[1] = -(60 + (trunc(s / 60) % 120)) * 6;
          angle[2] = trunc(-((maxHours + (trunc(s / 3600) % maxHours)) * trunc(360 / maxHours)));
        } else {
          angle[0] = -(s % 120) * 6;
          angle[1] = -(trunc(s / 60) % 120) * 6;
          angle[2] = trunc(-((trunc(s / 3600) % maxHours) * trunc(360 / maxHours)));
        }
      }
      const colors = [ICPCColors.BLUE, ICPCColors.YELLOW, ICPCColors.RED];
      for (let i = 0; i < NUM_ARCS; i++) this.drawArc(g, i, angle[NUM_ARCS - i - 1], colors[i]);
    }
    this.paintClock(g);
  }
  drawArc(g, arc, ang, c) {
    const d = this.arcDim[arc];
    if (ang >= -360) fillArc(g, d.x, d.y, d.width, d.height, 90, ang, c);
    else fillArc(g, d.x, d.y, d.width, d.height, 450 + ang, -720 - ang, c);
    fillOval(g, d.x + this.arcWidth, d.y + this.arcWidth, d.width - this.arcWidth * 2, d.height - this.arcWidth * 2, Color.BLACK);
  }
}
