/*
 * Java2D text model for the ICPC Tools font (Helvetica, v2.6.1331).
 *
 * FontMetrics: ascent = floor(0.95 + 0.75 * size), descent = floor(0.95 + 0.16992188 * size),
 * leading follows FontDesignMetrics. Without fractional metrics, plain advances are the hinted
 * integer widths for ppem = round(size) (presentation-widths.js) and Java's synthetic bold adds
 * ppem / 32 to every non-empty glyph. With fractional metrics, advances are the exact outline
 * advances. Glyph outlines come from presentation-glyphs.js; characters outside the table fall
 * back to the canvas font.
 */
import { glyphs } from "./presentation-glyphs.js";
import { hintedWidths } from "./presentation-widths.js";
import { setFont, CJK_FONT_FAMILY } from "./text.js";

const ASCENT = 750 / 1000, DESCENT = 169.92188 / 1000, LEADING = 29.785156 / 1000;
const paths = new Map();

/** Equivalent of ICPCFont.deriveFont(style, size); `fractional` mirrors KEY_FRACTIONALMETRICS. */
export function javaFont(size, bold = false, fractional = false) {
  const s = Math.fround(size), ascent = Math.floor(0.95 + ASCENT * s), descent = Math.floor(0.95 + DESCENT * s),
    leading = Math.floor(0.95 + DESCENT * s + LEADING * s) - descent;
  return { size: s, bold, fractional, ppem: Math.max(1, Math.round(s)), ascent, descent, leading, height: ascent + descent + leading };
}

export const withFractional = (font, fractional = true) => ({ ...font, fractional });

// Empty glyphs outside the exported Latin-1 table (advance in 1000-unit em).
const EXTRA = { 0x200a: { advance: 69.82421875, path: "" } };

function glyph(font, code) {
  return glyphs[font.bold ? 1 : 0][code] || EXTRA[code];
}

/** Advance of one character in device pixels, as used by drawString and FontMetrics. */
export function advance(font, code) {
  const g = glyph(font, code);
  if (!g) return null;
  if (font.fractional) return (g.advance * font.size) / 1000;
  const row = code < 256 && font.ppem <= 512 ? hintedWidths[font.ppem - 1] : null;
  const plainGlyph = glyphs[0][code] || EXTRA[code];
  let w = Math.round((plainGlyph.advance * font.ppem) / 1000) + (row ? row.charCodeAt(code - 32) - 80 : 0);
  if (font.bold && g.path) w += font.ppem / 32;
  return w;
}

function fallbackWidth(ctx, font, text) {
  setFont(ctx, font.size, { bold: font.bold, family: `${CJK_FONT_FAMILY}` });
  return ctx.measureText(text).width;
}

/** FontMetrics.charWidth. */
export function charWidth(ctx, font, ch) {
  const a = advance(font, ch.codePointAt(0));
  return a === null ? Math.round(fallbackWidth(ctx, font, ch)) : Math.floor(0.5 + a);
}

/** FontMetrics.stringWidth. */
export function stringWidth(ctx, font, text) {
  let sum = 0;
  for (const ch of String(text ?? "")) {
    const a = advance(font, ch.codePointAt(0));
    sum += a === null ? fallbackWidth(ctx, font, ch) : a;
  }
  return Math.floor(0.5 + sum);
}

/**
 * Graphics2D.drawString(text, x, y): baseline at y, glyphs laid out with Java advances.
 * `scaleX` reproduces TextHelper.drawFit / g.scale squeezing.
 */
export function drawString(ctx, font, text, x, y, color = "#fff", scaleX = 1) {
  const s = String(text ?? "");
  if (!s) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(x, y);
  if (scaleX !== 1) ctx.scale(scaleX, 1);
  let pen = 0;
  const k = font.size / 1000, face = font.bold ? "b" : "r";
  for (const ch of s) {
    const code = ch.codePointAt(0), g = glyph(font, code);
    if (!g) {
      setFont(ctx, font.size, { bold: font.bold, family: CJK_FONT_FAMILY });
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillText(ch, pen, 0);
      pen += ctx.measureText(ch).width;
      continue;
    }
    if (g.path) {
      let p = paths.get(face + code);
      if (!p) paths.set(face + code, (p = new Path2D(g.path)));
      ctx.save();
      ctx.translate(pen, 0);
      ctx.scale(k, k);
      ctx.fill(p);
      ctx.restore();
    }
    pen += advance(font, code);
  }
  ctx.restore();
}

/**
 * Port of ICPC Tools TextHelper for plain strings: draw(x, y) places the top-left corner
 * (baseline at y + ascent); drawFit squeezes horizontally to the given width.
 */
export class TextHelper {
  constructor(ctx, font, text) {
    this.ctx = ctx;
    this.font = font;
    this.text = String(text ?? "");
  }
  getWidth() {
    return stringWidth(this.ctx, this.font, this.text);
  }
  getHeight() {
    return this.font.height;
  }
  draw(x, y, color) {
    drawString(this.ctx, this.font, this.text, x, y + this.font.ascent, color);
  }
  drawFit(x, y, width, color) {
    const w = this.getWidth();
    if (w <= width) return this.draw(x, y, color);
    drawString(this.ctx, this.font, this.text, x, y + this.font.ascent, color, width / w);
  }
}
