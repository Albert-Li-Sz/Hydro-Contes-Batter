/*
 * Java2D primitives for ICPC Tools presentation ports.
 *
 * Calibrated against OpenJDK 21 offscreen rendering with KEY_ANTIALIASING on: filled shapes are
 * rasterized unchanged, while strokes are normalized to pixel centres (Marlin
 * NearestPixelCenter: floor(c) + 0.5) before stroking. Round rectangles and ellipses use the
 * exact java.awt.geom path iterators.
 */
const trunc = Math.trunc;

export class JColor {
  constructor(r, g, b, a = 255) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }
  /** new Color(float r, float g, float b, float a) */
  static floats(r, g, b, a = 1) {
    const v = (f) => trunc(f * 255 + 0.5);
    return new JColor(v(r), v(g), v(b), v(a));
  }
  components() {
    return [this.r / 255, this.g / 255, this.b / 255, this.a / 255];
  }
  css() {
    return this.a === 255 ? `rgb(${this.r},${this.g},${this.b})` : `rgba(${this.r},${this.g},${this.b},${this.a / 255})`;
  }
  /** Color.darker() */
  darker() {
    return new JColor(Math.max(trunc(this.r * 0.7), 0), Math.max(trunc(this.g * 0.7), 0), Math.max(trunc(this.b * 0.7), 0), this.a);
  }
  /** Color.brighter() */
  brighter() {
    let { r, g, b } = this;
    const i = trunc(1 / (1 - 0.7));
    if (r === 0 && g === 0 && b === 0) return new JColor(i, i, i, this.a);
    if (r > 0 && r < i) r = i;
    if (g > 0 && g < i) g = i;
    if (b > 0 && b < i) b = i;
    return new JColor(Math.min(trunc(r / 0.7), 255), Math.min(trunc(g / 0.7), 255), Math.min(trunc(b / 0.7), 255), this.a);
  }
}

export const Color = Object.freeze({
  WHITE: new JColor(255, 255, 255),
  BLACK: new JColor(0, 0, 0),
  GRAY: new JColor(128, 128, 128),
  LIGHT_GRAY: new JColor(192, 192, 192),
  DARK_GRAY: new JColor(64, 64, 64),
  YELLOW: new JColor(255, 255, 0),
  ORANGE: new JColor(255, 200, 0),
  RED: new JColor(255, 0, 0),
  GREEN: new JColor(0, 255, 0),
  BLUE: new JColor(0, 0, 255),
  CYAN: new JColor(0, 255, 255),
  MAGENTA: new JColor(255, 0, 255),
  PINK: new JColor(255, 175, 175),
});

// presentation.contest.internal.Utility
export function getColorBetween(c1, c2, percent) {
  const a = c1.components(), b = c2.components(), p = Math.fround(percent);
  const f = a.map((v, j) => Math.fround(Math.fround(v * Math.fround(1 - p)) + Math.fround(b[j] * p)));
  return JColor.floats(...f);
}
export function getColorBetween3(c1, c2, c3, percent) {
  const a = c1.components(), b = c2.components(), c = c3.components(), p = Math.fround(percent);
  const f = a.map((v, j) => (p <= 0.5 ? v * (1 - p * 2) + b[j] * p * 2 : b[j] * (1 - (p - 0.5) * 2) + c[j] * (p - 0.5) * 2));
  return JColor.floats(...f);
}
export function getColorsBetween(c1, c2, steps) {
  const a = c1.components(), b = c2.components();
  return Array.from({ length: steps }, (_, i) => {
    const x = Math.fround(i / Math.fround(steps - 1));
    return JColor.floats(...a.map((v, j) => Math.fround(Math.fround(v * Math.fround(1 - x)) + Math.fround(b[j] * x))));
  });
}
export const alpha = (c, a) => new JColor(c.r, c.g, c.b, a);
export const darker = (c, f) => new JColor(Math.max(trunc(c.r * f), 0), Math.max(trunc(c.g * f), 0), Math.max(trunc(c.b * f), 0));
export const alphaDarker = (c, a, f) => new JColor(Math.max(trunc(c.r * f), 0), Math.max(trunc(c.g * f), 0), Math.max(trunc(c.b * f), 0), a);

// presentation.contest.internal.ICPCColors (v2.6.1331)
const PENDING_COLOR = new JColor(66, 114, 245), SOLVED_COLOR = new JColor(0, 230, 0),
  FIRST_TO_SOLVE_COLOR = new JColor(0, 100, 0), FAILED_COLOR = new JColor(240, 0, 0);
const CCOUNT = 15, COUNT2 = 30;
export const ICPCColors = Object.freeze({
  BLUE: new JColor(92, 138, 221),
  YELLOW: new JColor(255, 223, 54),
  RED: new JColor(196, 58, 36),
  SCORING_MID_COLOR: new JColor(230, 230, 0).darker(),
  PENDING_COLOR,
  SOLVED_COLOR,
  FIRST_TO_SOLVE_COLOR,
  FAILED_COLOR,
  GOLD: new JColor(205, 127, 50),
  SILVER: new JColor(230, 232, 250),
  BRONZE: new JColor(166, 125, 61),
  CCOUNT,
  COUNT2,
  PENDING: getColorsBetween(PENDING_COLOR, alphaDarker(PENDING_COLOR, 128, 0.5), CCOUNT),
  SOLVED: getColorsBetween(SOLVED_COLOR, alphaDarker(SOLVED_COLOR, 128, 0.5), CCOUNT),
  FIRST_TO_SOLVE: getColorsBetween(FIRST_TO_SOLVE_COLOR, alphaDarker(FIRST_TO_SOLVE_COLOR, 128, 0.5), CCOUNT),
  FAILED: getColorsBetween(FAILED_COLOR, alphaDarker(FAILED_COLOR, 128, 0.5), CCOUNT),
  PENDING2: getColorsBetween(PENDING_COLOR, alphaDarker(PENDING_COLOR, 32, 0.5), COUNT2),
  SOLVED2: getColorsBetween(SOLVED_COLOR, alphaDarker(SOLVED_COLOR, 32, 0.5), COUNT2),
  FAILED2: getColorsBetween(FAILED_COLOR, alphaDarker(FAILED_COLOR, 32, 0.5), COUNT2),
  PENDING3: getColorsBetween(PENDING_COLOR, darker(PENDING_COLOR, 0.5), COUNT2),
  SOLVED3: getColorsBetween(SOLVED_COLOR, darker(SOLVED_COLOR, 0.5), COUNT2),
  FIRST_TO_SOLVE3: getColorsBetween(FIRST_TO_SOLVE_COLOR, darker(FIRST_TO_SOLVE_COLOR, 0.5), COUNT2),
  FAILED3: getColorsBetween(FAILED_COLOR, darker(FAILED_COLOR, 0.5), COUNT2),
});

/** ICPCColors.getStatusColor(Status, age) */
export function statusColorByAge(status, age) {
  if (age < 0 || age > 30000) return null;
  const k = Math.min(COUNT2 - 1, trunc(((COUNT2 - 1) * age) / 30000));
  if (status === "solved") return ICPCColors.SOLVED2[k];
  if (status === "failed") return ICPCColors.FAILED2[k];
  return ICPCColors.PENDING2[k];
}

// ---------------------------------------------------------------------------
// Paths (java.awt.geom iterators)
// ---------------------------------------------------------------------------

const ACV = (() => {
  const angle = Math.PI / 4, a = 1 - Math.cos(angle), b = Math.tan(angle), c = Math.sqrt(1 + b * b) - 1 + a;
  return (1 - (((4 / 3) * a * b) / c)) / 2;
})();
const ELLIPSE_CV = 0.5522847498307933;

function roundRectSegments(x, y, w, h, aw, ah) {
  aw = Math.min(w, Math.abs(aw));
  ah = Math.min(h, Math.abs(ah));
  const P = (v0, v1, v2, v3) => [x + v0 * w + v1 * aw, y + v2 * h + v3 * ah];
  return [["M", P(0, 0, 0, 0.5)], ["L", P(0, 0, 1, -0.5)], ["C", P(0, 0, 1, -ACV), P(0, ACV, 1, 0), P(0, 0.5, 1, 0)],
    ["L", P(1, -0.5, 1, 0)], ["C", P(1, -ACV, 1, 0), P(1, 0, 1, -ACV), P(1, 0, 1, -0.5)], ["L", P(1, 0, 0, 0.5)],
    ["C", P(1, 0, 0, ACV), P(1, -ACV, 0, 0), P(1, -0.5, 0, 0)], ["L", P(0, 0.5, 0, 0)],
    ["C", P(0, ACV, 0, 0), P(0, 0, 0, ACV), P(0, 0, 0, 0.5)], ["Z"]];
}

function ellipseSegments(x, y, w, h) {
  const pcv = 0.5 + ELLIPSE_CV * 0.5, ncv = 0.5 - ELLIPSE_CV * 0.5, T = ([u, v]) => [x + u * w, y + v * h];
  return [["M", T([1, 0.5])], ["C", T([1, pcv]), T([pcv, 1]), T([0.5, 1])], ["C", T([ncv, 1]), T([0, pcv]), T([0, 0.5])],
    ["C", T([0, ncv]), T([ncv, 0]), T([0.5, 0])], ["C", T([pcv, 0]), T([1, ncv]), T([1, 0.5])], ["Z"]];
}

/** java.awt.geom.ArcIterator; type: "open" | "chord" | "pie". Angles in degrees, Java orientation. */
export function arcSegments(x, y, w, h, start, extent, type = "open") {
  const ext = Math.abs(extent);
  let arcSegs = ext >= 360 ? 4 : Math.ceil(ext / 90);
  const angStRad = -(start * Math.PI) / 180;
  let increment = -(extent * Math.PI) / 180;
  if (arcSegs > 0) increment /= arcSegs;
  let cv = ((4 / 3) * Math.sin(increment / 2)) / (1 + Math.cos(increment / 2));
  const xc = x + w / 2, yc = y + h / 2, rx = w / 2, ry = h / 2;
  const pt = (a) => [xc + Math.cos(a) * rx, yc + Math.sin(a) * ry];
  const segs = [["M", pt(angStRad)]];
  let angle = angStRad;
  for (let i = 0; i < arcSegs; i++) {
    const a1 = angle + increment, c0 = Math.cos(angle), s0 = Math.sin(angle), c1 = Math.cos(a1), s1 = Math.sin(a1);
    segs.push(["C", [xc + (c0 - cv * s0) * rx, yc + (s0 + cv * c0) * ry], [xc + (c1 + cv * s1) * rx, yc + (s1 - cv * c1) * ry], pt(a1)]);
    angle = a1;
  }
  if (type === "pie") segs.push(["L", [xc, yc]]);
  if (type !== "open") segs.push(["Z"]);
  return segs;
}

function rectSegments(x, y, w, h) {
  return [["M", [x, y]], ["L", [x + w, y]], ["L", [x + w, y + h]], ["L", [x, y + h]], ["Z"]];
}

/** Marlin NearestPixelCenter normalization in device space. */
function normalized(segs, m) {
  const dev = ([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f];
  const n = (c) => Math.floor(c) + 0.5;
  let cx = 0, cy = 0, mx = 0, my = 0;
  return segs.map((s) => {
    if (s[0] === "Z") {
      cx = mx;
      cy = my;
      return s;
    }
    const pts = s.slice(1).map(dev), last = pts[pts.length - 1], ox = last[0], oy = last[1];
    last[0] = n(ox);
    last[1] = n(oy);
    const ax = last[0] - ox, ay = last[1] - oy;
    if (s[0] === "M") {
      mx = ax;
      my = ay;
    } else if (s[0] === "Q") {
      pts[0][0] += (cx + ax) / 2;
      pts[0][1] += (cy + ay) / 2;
    } else if (s[0] === "C") {
      pts[0][0] += cx;
      pts[0][1] += cy;
      pts[1][0] += ax;
      pts[1][1] += ay;
    }
    cx = ax;
    cy = ay;
    return [s[0], ...pts];
  });
}

function trace(ctx, segs) {
  ctx.beginPath();
  for (const s of segs) {
    if (s[0] === "M") ctx.moveTo(...s[1]);
    else if (s[0] === "L") ctx.lineTo(...s[1]);
    else if (s[0] === "Q") ctx.quadraticCurveTo(...s[1], ...s[2]);
    else if (s[0] === "C") ctx.bezierCurveTo(...s[1], ...s[2], ...s[3]);
    else ctx.closePath();
  }
}

/** A JColor, CSS colour string or CanvasGradient (GradientPaint). */
function css(color) {
  return typeof color?.css === "function" ? color.css() : color;
}

export function fillPath(ctx, segs, color) {
  trace(ctx, segs);
  ctx.fillStyle = css(color);
  ctx.fill();
}

/** Graphics2D.draw(shape) with a BasicStroke (default: width 1, CAP_SQUARE, JOIN_MITER). */
export function strokePath(ctx, segs, color, { width = 1, cap = "square", join = "miter" } = {}) {
  // Normalization happens in device space; it applies to translations and rotations (unit scale).
  const m = ctx.getTransform(), rigid = Math.abs(m.a * m.a + m.b * m.b - 1) < 1e-9 && Math.abs(m.a * m.c + m.b * m.d) < 1e-9 &&
    Math.abs(m.c * m.c + m.d * m.d - 1) < 1e-9;
  ctx.save();
  if (rigid) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    trace(ctx, normalized(segs, m));
  } else trace(ctx, segs);
  ctx.strokeStyle = css(color);
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.lineJoin = join;
  ctx.miterLimit = 10;
  ctx.stroke();
  ctx.restore();
}

export const fillRect = (ctx, x, y, w, h, color) => fillPath(ctx, rectSegments(x, y, w, h), color);
export const drawRect = (ctx, x, y, w, h, color, stroke) => strokePath(ctx, rectSegments(x, y, w, h), color, stroke);
export const fillRoundRect = (ctx, x, y, w, h, aw, ah, color) => fillPath(ctx, roundRectSegments(x, y, w, h, aw, ah), color);
export const drawRoundRect = (ctx, x, y, w, h, aw, ah, color, stroke) =>
  strokePath(ctx, roundRectSegments(x, y, w, h, aw, ah), color, stroke);
export const fillOval = (ctx, x, y, w, h, color) => fillPath(ctx, ellipseSegments(x, y, w, h), color);
export const drawOval = (ctx, x, y, w, h, color, stroke) => strokePath(ctx, ellipseSegments(x, y, w, h), color, stroke);
export const drawLine = (ctx, x1, y1, x2, y2, color, stroke) => strokePath(ctx, [["M", [x1, y1]], ["L", [x2, y2]]], color, stroke);
export function drawPolyline(ctx, xs, ys, color, stroke) {
  strokePath(ctx, xs.map((x, i) => [i ? "L" : "M", [x, ys[i]]]), color, stroke);
}
export function fillPolygon(ctx, xs, ys, color) {
  fillPath(ctx, [...xs.map((x, i) => [i ? "L" : "M", [x, ys[i]]]), ["Z"]], color);
}
export const fillArc = (ctx, x, y, w, h, start, extent, color) => fillPath(ctx, arcSegments(x, y, w, h, start, extent, "pie"), color);
export const drawArc = (ctx, x, y, w, h, start, extent, color, stroke) =>
  strokePath(ctx, arcSegments(x, y, w, h, start, extent, "open"), color, stroke);

/** Java fit-to-box scaling used by getLogoImage(w, h, ..., resizeToFit). */
export function fitImage(image, w, h) {
  if (!image?.naturalWidth) return null;
  const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
  return { width: Math.max(1, Math.round(image.naturalWidth * scale)), height: Math.max(1, Math.round(image.naturalHeight * scale)) };
}

export function drawImage(ctx, image, x, y, w, h) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// presentation.contest.internal.ImageScaler
// ---------------------------------------------------------------------------

function canvasOf(w, h) {
  const c = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  return c;
}

/** Pixel copy of an image (or canvas) as a canvas, without resampling. */
export function toCanvas(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, c = canvasOf(w, h);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

/** ImageScaler.scaleImage(img, targetWidth, targetHeight): fit, then box-filter or halving. */
export function scaleImage(img, targetWidth, targetHeight) {
  if (!img) return null;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const scale = Math.min(Math.fround(targetWidth / w), Math.fround(targetHeight / h));
  if (scale === 1) return toCanvas(img);
  return scaledImage(img, Math.round(Math.fround(w * scale)), Math.round(Math.fround(h * scale)));
}

function scaledImage(img, tw, th) {
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  if (!tw || !th) return canvasOf(Math.max(1, tw), Math.max(1, th));
  if (tw * 1.5 < sw && th * 1.5 < sh) {
    const src = toCanvas(img).getContext("2d").getImageData(0, 0, sw, sh).data, out = canvasOf(tw, th), octx = out.getContext("2d");
    const dest = octx.createImageData(tw, th), scale = (tw * th) / (sw * sh), sum = [0, 0, 0, 0];
    for (let dy = 0; dy < th; dy++) {
      let y = (dy * sh) / th;
      const lowY = trunc(y), firstYWeight = 1.0 - (y - lowY);
      y = ((dy + 1) * sh) / th;
      let highY = trunc(y), lastYWeight = y - highY;
      if (highY >= sh) {
        highY = sh - 1;
        lastYWeight = 1.0;
      }
      for (let dx = 0; dx < tw; dx++) {
        sum.fill(0);
        let x = (dx * sw) / tw;
        const lowX = trunc(x), firstXWeight = 1.0 - (x - lowX);
        x = ((dx + 1) * sw) / tw;
        let highX = trunc(x), lastXWeight = x - highX;
        if (highX >= sw) {
          highX = sw - 1;
          lastXWeight = 1.0;
        }
        for (let sy = lowY; sy <= highY; sy++) {
          const yw = sy === highY ? lastYWeight : sy === lowY ? firstYWeight : 1.0;
          for (let sx = lowX; sx <= highX; sx++) {
            const xw = sx === highX ? lastXWeight : sx === lowX ? firstXWeight : 1.0, i = (sy * sw + sx) * 4;
            for (let c = 0; c < 4; c++) sum[c] += xw * yw * src[i + c];
          }
        }
        const o = (dy * tw + dx) * 4;
        for (let c = 0; c < 4; c++) dest.data[o + c] = Math.min(255, Math.round(sum[c] * scale));
      }
    }
    octx.putImageData(dest, 0, 0);
    return out;
  }
  // Repeated halving with bicubic interpolation.
  let cur = img, w = sw, h = sh;
  while (w !== tw || h !== th) {
    w = w > tw ? Math.max(tw, trunc(w / 2)) : tw;
    h = h > th ? Math.max(th, trunc(h / 2)) : th;
    const tmp = canvasOf(w, h), t = tmp.getContext("2d");
    t.imageSmoothingEnabled = true;
    t.imageSmoothingQuality = "high";
    t.drawImage(cur, 0, 0, w, h);
    cur = tmp;
  }
  return cur;
}

/** getLogoImage(w, h, ..., resizeToFit): cached ImageScaler result per size. */
const logoCache = new WeakMap();
export function logoImage(img, w, h) {
  if (!img?.naturalWidth || w <= 0 || h <= 0) return null;
  let sizes = logoCache.get(img);
  if (!sizes) logoCache.set(img, (sizes = new Map()));
  const key = `${w}x${h}`;
  if (!sizes.has(key)) sizes.set(key, scaleImage(img, w, h));
  return sizes.get(key);
}

/** ICPCColors.getContrastColor (contest model) */
export function contrastColor(c) {
  if (!c) return Color.WHITE;
  return trunc((299 * c.r + 587 * c.g + 114 * c.b) / 1000) >= 128 ? Color.BLACK : Color.WHITE;
}
