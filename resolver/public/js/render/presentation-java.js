/*
 * Base for line-by-line ports of ICPC Tools v2.6.1331 presentations (PresCore Presentation +
 * AbstractICPCPresentation), including PresentationWindowImpl's repeat timing.
 */
import { ContestView } from "./java-contest.js";

export class JavaPresentation {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.timeMs = 0;
    this.repeatTimeMs = 0;
    this.started = false;
    this.contest = new ContestView(null);
    this.lightMode = false;
    this.words = {};
  }
  setContest(contest) {
    this.contest = contest;
  }
  getContest() {
    return this.contest;
  }
  isLightMode() {
    return this.lightMode;
  }
  setSize(w, h) {
    this.width = w;
    this.height = h;
  }
  getSize() {
    return { width: this.width, height: this.height };
  }
  init() {}
  aboutToShow() {}
  getRepeat() {
    return 0;
  }
  getTimeMs() {
    return this.timeMs;
  }
  getRepeatTimeMs() {
    return this.repeatTimeMs;
  }
  setRepeatTimeMs(t) {
    this.repeatTimeMs = t;
  }
  incrementTimeMs() {}
  setTimeMs(time) {
    const dt = time - this.timeMs;
    if (dt > 0 && dt < 2000) this.incrementTimeMs(dt);
    this.timeMs = time;
  }
  setProperty() {}
  paint() {}
  getContestTime() {
    return this.contest.getContestTime(this.timeMs);
  }
  getRemainingTime() {
    return this.contest.getRemainingTime(this.timeMs);
  }

  /**
   * One PresentationWindowImpl frame: wall-clock time first, then the repeat time (wrapping at
   * getRepeat()), aboutToShow() on the first frame and on every wrap, then paint.
   */
  frame(ctx, now, elapsed) {
    this.setTimeMs(now);
    const repeat = this.getRepeat(), rt = repeat > 0 ? elapsed % repeat : elapsed, last = this.repeatTimeMs;
    this.setRepeatTimeMs(Math.max(0, Math.floor(rt)));
    if (!this.started || last > this.repeatTimeMs) {
      this.started = true;
      this.aboutToShow();
    }
    this.paint(ctx);
  }
}
