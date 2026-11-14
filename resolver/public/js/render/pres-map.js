/*
 * Port of ICPC Tools v2.6.1331 map presentations: WorldMap, BubbleOut, TeamIntroPresentation
 * ("Team Intro"), WorldPresentation ("World"), GroupPresentation ("Group") and
 * BalloonMapPresentation ("Submissions").
 */
import { Animator, Movement } from "./animator.js";
import { javaFont, stringWidth, drawString } from "./java-text.js";
import { Color, JColor, contrastColor, fillRect, drawLine, logoImage, scaleImage, toCanvas } from "./java-graphics.js";
import { JavaPresentation } from "./presentation-java.js";
import { problemColor } from "./pres-charts.js";

const trunc = Math.trunc, f32 = Math.fround;
const MAP = "/hydro-resolver/assets/img/world-map.jpg";

const lat = (o) => (o?.location ? o.location.latitude : NaN);
const lon = (o) => (o?.location ? o.location.longitude : NaN);
const groupIdsOf = (t) => (Array.isArray(t.groupIds) && t.groupIds.length ? t.groupIds : null);
const belongsToGroup = (groupIds, groupId) => Boolean(groupIds && groupId != null && groupIds.includes(groupId));

/** WorldMap.drawMap(g, x, y, width, height, sc), bilinear like RENDER_QUALITY drawImage. */
function drawMap(g, map, x, y, width, height, sc) {
  if (!map) return;
  const w = trunc(width * sc), h = trunc(height * sc);
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "low";
  g.drawImage(map, x, y, w, h);
  if (x + width * sc < width) g.drawImage(map, x + w, y, w, h);
  if (x > 0) g.drawImage(map, x - w, y, w, h);
  g.restore();
}

class Animator3D {
  constructor(x, xMove, y, yMove, z, zMove) {
    this.xAnim = new Animator(x, xMove);
    this.yAnim = new Animator(y, yMove);
    this.zAnim = new Animator(z, zMove);
  }
  incrementTimeMs(dt) {
    this.xAnim.incrementTimeMs(dt);
    this.yAnim.incrementTimeMs(dt);
    this.zAnim.incrementTimeMs(dt);
  }
  getXValue() {
    return this.xAnim.getValue();
  }
  getYValue() {
    return this.yAnim.getValue();
  }
  getZValue() {
    return this.zAnim.getValue();
  }
  setTarget(x, y, z) {
    this.xAnim.setTarget(x);
    this.yAnim.setTarget(y);
    this.zAnim.setTarget(z);
    const xt = this.xAnim.getMoveTime(), yt = this.yAnim.getMoveTime(), zt = this.zAnim.getMoveTime(), max = Math.max(xt, yt, zt);
    if (xt !== 0) this.xAnim.setTimeScale(xt / max);
    if (yt !== 0) this.yAnim.setTimeScale(yt / max);
    if (zt !== 0) this.zAnim.setTimeScale(zt / max);
  }
}
const cameraAnimator = () => new Animator3D(0.0, new Movement(60, 180), 0.0, new Movement(30, 90), 1.0, new Movement(0.5, 1.5));

class Position {
  constructor(x, y, z, label = null) {
    Object.assign(this, { x, y, z, label, image: null, smImage: null, originalX: NaN, originalY: NaN, gridX: NaN, gridY: NaN });
  }
}

/** TeamIntroPresentation.setTargets */
function setTargets(contest, image, groupId, height, showOrganizations = false) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  const zoom = { startTime: 0, endTime: 0, pos: null, name: null, instPos: [], pending: false }, orgs = new Set();
  for (const t of contest.c.teams || []) {
    const org = contest.getOrganizationById(t.organizationId);
    if (!org || !(groupId == null || belongsToGroup(groupIdsOf(t), groupId))) continue;
    if (showOrganizations && orgs.has(org.id)) continue;
    orgs.add(org.id);
    const la = lat(org), lo = lon(org);
    if (!Number.isNaN(la)) {
      minLat = Math.min(minLat, la);
      maxLat = Math.max(maxLat, la);
    }
    if (!Number.isNaN(lo)) {
      minLon = Math.min(minLon, lo);
      maxLon = Math.max(maxLon, lo);
    }
    const p = new Position(lo, la, 1, showOrganizations ? org.formalName : `${t.label} - ${t.displayName || t.name}`);
    const logoSize2 = trunc(height / 4), url = t.logo || org.logo, img = image(url);
    // Java loads logos synchronously; rebuild once a pending browser image arrives.
    if (url && !img) zoom.pending = true;
    p.image = logoImage(img, logoSize2, logoSize2);
    if (p.image) p.smImage = scaleImage(p.image, trunc(height / 12), trunc(height / 12));
    zoom.instPos.push(p);
  }
  // Arrays.sort is stable; NaN comparisons follow Double.compare (NaN sorts last).
  const key = (p) => p.x - p.y;
  zoom.instPos.sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (Number.isNaN(ka) || Number.isNaN(kb)) return Number.isNaN(ka) - Number.isNaN(kb);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (minLat === 90 || minLon === 180) {
    zoom.pos = new Position(0, 0, 1);
    return zoom;
  }
  minLon -= 3;
  maxLon += 3;
  minLat -= 3;
  maxLat += 3;
  const dLon = maxLon - minLon, dLat = maxLat - minLat;
  zoom.pos = new Position(minLon + dLon / 2.0, minLat + dLat / 2.0, Math.min(5, Math.min(360.0 / (dLon + 20.0), 180.0 / (dLat + 10.0))));
  for (const p of zoom.instPos) p.z = zoom.pos.z * 1.15;
  return zoom;
}

/** BubbleOut.bubbleOut */
function bubbleOut(instPos, teamInd2, width, height, imageScaleFactor, dt) {
  const teamInd = Math.min(teamInd2, instPos.length), valid = (p) => p && !Number.isNaN(p.x) && !Number.isNaN(p.y) && p.smImage;
  let maxD = 0;
  for (let i = 0; i < teamInd; i++) {
    const p = instPos[i];
    if (!valid(p)) continue;
    if (Number.isNaN(p.originalX)) p.originalX = p.x;
    if (Number.isNaN(p.originalY)) p.originalY = p.y;
    maxD = Math.max(maxD, Math.max((p.smImage.width * 360.0) / width, (p.smImage.height * 180.0) / height));
  }
  maxD *= imageScaleFactor;
  maxD *= 1 - 0.2;
  maxD = Math.max(maxD, 0.001);
  const grid = new Map(), gridKey = (x, y) => x + 1000 * y;
  for (let i = 0; i < teamInd; i++) {
    const p = instPos[i];
    if (!valid(p)) continue;
    const gx = Math.round(p.x / maxD), gy = Math.round(p.y / maxD);
    p.gridX = gx * maxD;
    p.gridY = gy * maxD;
    if (!grid.has(gridKey(gx, gy))) grid.set(gridKey(gx, gy), []);
    grid.get(gridKey(gx, gy)).push(p);
  }
  for (let i = 0; i < teamInd; i++) {
    const p = instPos[i];
    if (!valid(p)) continue;
    const gx = Math.round(p.x / maxD), gy = Math.round(p.y / maxD), dtf = 3 * Math.min(1, dt / 1000.0);
    let totalAdjust = 0, minD = Infinity;
    for (let dgx = -1; dgx <= 1; ++dgx)
      for (let dgy = -1; dgy <= 1; ++dgy)
        for (const q of grid.get(gridKey(gx + dgx, gy + dgy)) || []) {
          if (p === q) continue;
          let dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
          minD = Math.min(minD, d);
          if (d > maxD) continue;
          if (d < 1e-6) {
            dx += 1e-6 * (1 + Math.random());
            dy += 1e-6 * (1 + Math.random());
            d = Math.sqrt(dx * dx + dy * dy);
          }
          const ff = 1.0 - d / maxD;
          p.x -= (dtf * ff * dx) / d;
          p.y -= (dtf * ff * dy) / d;
          totalAdjust += ff;
        }
    if (totalAdjust > 0.1 || minD > maxD) {
      const dx = p.originalX - p.x, dy = p.originalY - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-6) {
        p.x += (dtf * 0.02 * dx) / d;
        p.y += (dtf * 0.02 * dy) / d;
      }
    }
  }
}

function restore(instPos) {
  for (const p of instPos)
    if (p && !Number.isNaN(p.originalX) && !Number.isNaN(p.originalY)) {
      p.x = p.originalX;
      p.y = p.originalY;
    }
}

const GROUP_INTRO_TIME = 4000, GROUP_SUMMARY_TIME = 7000, TIME_PER_GROUP = GROUP_INTRO_TIME + GROUP_SUMMARY_TIME, FADE = 500,
  TIME_PER_TEAM = 1000 + 1500 + 1000;

/** TeamIntroPresentation; a program item may restrict it to one group. */
export class TeamIntro extends JavaPresentation {
  constructor() {
    super();
    this.anim = cameraAnimator();
    this.zooms = null;
  }
  setSize(w, h) {
    super.setSize(w, h);
    this.groupFont = javaFont(f32(f32(f32(h * 72) * f32(0.12)) / 96), true);
    this.font = javaFont(f32(f32(f32(h * 72) * f32(0.07)) / 96), true);
    this.zooms = null;
  }
  getRepeat() {
    this.setup();
    if (!this.zooms) return 0;
    const numTeams = this.zooms.reduce((n, gz) => n + gz.instPos.length, 0);
    return numTeams * TIME_PER_TEAM + (this.zooms.length + 1) * TIME_PER_GROUP;
  }
  aboutToShow() {
    this.setup();
  }
  setup() {
    if (this.zooms && !this.zooms.some((z) => z.pending)) return;
    const contest = this.getContest(), withTeams = new Set();
    for (const t of contest.c.teams || []) for (const id of groupIdsOf(t) || []) withTeams.add(id);
    let groups = contest.getGroups().filter((g) => withTeams.has(g.id));
    if (this.item?.groupId) groups = groups.filter((g) => g.id === this.item.groupId);
    let time = 0;
    this.zooms = groups.map((g) => {
      const z = setTargets(contest, this.image, g.id, this.height);
      z.name = g.name;
      z.startTime = time;
      time += TIME_PER_GROUP + z.instPos.length * TIME_PER_TEAM;
      z.endTime = time;
      return z;
    });
  }
  currentZoom(time) {
    let gr = 0, gz = this.zooms[gr];
    while (gz && time > gz.endTime) gz = ++gr > this.zooms.length - 1 ? null : this.zooms[gr];
    return gz;
  }
  incrementTimeMs(dt) {
    this.setup();
    if (!this.zooms?.length) return;
    const time = this.getRepeatTimeMs(), gz = this.currentZoom(time);
    if (!gz) this.anim.setTarget(0, 0, 1);
    else {
      let gzTime = time - gz.startTime;
      if (gzTime < GROUP_INTRO_TIME || gzTime > GROUP_INTRO_TIME + gz.instPos.length * TIME_PER_TEAM) {
        this.anim.setTarget(gz.pos.x, gz.pos.y, gz.pos.z);
        if (gzTime < GROUP_INTRO_TIME) restore(gz.instPos);
        else bubbleOut(gz.instPos, gz.instPos.length, this.width, this.height, 1 / this.anim.getZValue(), dt);
      } else {
        gzTime -= GROUP_INTRO_TIME;
        const teamInd = trunc(gzTime / TIME_PER_TEAM);
        if (teamInd >= 0 && teamInd < gz.instPos.length) {
          const p = gz.instPos[teamInd];
          this.anim.setTarget(p.x, p.y, p.z);
        }
        bubbleOut(gz.instPos, teamInd, this.width, this.height, 1 / this.anim.getZValue(), dt);
      }
    }
    this.anim.incrementTimeMs(dt);
  }
  paint(g) {
    const { width, height } = this, time = this.getRepeatTimeMs(), sc = this.anim.getZValue(),
      oX = width / 2.0 - (width * (this.anim.getXValue() + 180) * sc) / 360.0, oY = height / 2.0 - (height * (90 - this.anim.getYValue()) * sc) / 180.0;
    drawMap(g, this.image(MAP), trunc(oX), trunc(oY), width, height, sc);
    if (!this.zooms?.length) return;
    const gz = this.currentZoom(time);
    if (!gz) return;
    const border = trunc(height / 40);
    let gzTime = time - gz.startTime;
    g.save();
    if (gzTime < GROUP_INTRO_TIME) {
      if (gzTime < 1000) g.globalAlpha = gzTime / 1000;
      else if (gzTime > GROUP_INTRO_TIME - 1000) g.globalAlpha = (GROUP_INTRO_TIME - gzTime) / 1000;
      const s = gz.name, fm = this.groupFont, x = trunc((width - stringWidth(g, fm, s)) / 2), y = trunc((height + fm.ascent) / 2);
      drawString(g, fm, s, x, y + 2, Color.DARK_GRAY.css());
      drawString(g, fm, s, x + 2, y, Color.DARK_GRAY.css());
      drawString(g, fm, s, x, y, Color.WHITE.css());
      g.restore();
      return;
    } else if (gzTime > GROUP_INTRO_TIME + gz.instPos.length * TIME_PER_TEAM) {
      const s = gz.name, fm = this.font, x = trunc((width - stringWidth(g, fm, s)) / 2);
      drawString(g, fm, s, x + 2, height - border, Color.DARK_GRAY.css());
      drawString(g, fm, s, x, height - border + 2, Color.DARK_GRAY.css());
      drawString(g, fm, s, x, height - border, Color.WHITE.css());
    }
    gzTime -= GROUP_INTRO_TIME;
    const teamInd = Math.floor(gzTime / TIME_PER_TEAM);
    // g2: translated map layer with its own composite.
    let alpha2 = 0.75;
    if (gzTime > gz.instPos.length * TIME_PER_TEAM) {
      const ttime = gzTime - gz.instPos.length * TIME_PER_TEAM;
      if (ttime < 500) alpha2 = 0.75 + ttime / 2000;
      else if (ttime > GROUP_SUMMARY_TIME - 1000) alpha2 = (GROUP_SUMMARY_TIME - ttime) / 1000;
    }
    const mapXY = (p) => [trunc((width * (p.x + 180.0) * sc) / 360.0), trunc((height * (90 - p.y) * sc) / 180.0)];
    g.save();
    g.translate(trunc(oX), trunc(oY));
    g.globalAlpha = alpha2;
    for (let i = 0; i < teamInd; i++) {
      const p = gz.instPos[i];
      if (p?.smImage) {
        const [x, y] = mapXY(p);
        g.drawImage(p.smImage, x - trunc(p.smImage.width / 2), y - trunc(p.smImage.height / 2));
      }
    }
    g.restore();
    if (gzTime > gz.instPos.length * TIME_PER_TEAM) {
      g.restore();
      return;
    }
    const teamTime = gzTime - teamInd * TIME_PER_TEAM;
    let alphaG = g.globalAlpha, alphaG2 = 1;
    if (teamTime < FADE) alphaG = alphaG2 = teamTime / FADE;
    else if (teamTime > TIME_PER_TEAM - FADE) {
      const tt = teamTime - (TIME_PER_TEAM - FADE);
      alphaG = 0.333 + ((FADE - tt) * 2) / (FADE * 3);
      alphaG2 = 0.75 + (FADE - tt) / (FADE * 4);
    }
    const team = teamInd;
    if (team < 0 || team > gz.instPos.length - 1) {
      g.restore();
      return;
    }
    const pos = gz.instPos[team];
    if (pos.image) {
      const w = pos.image.width, h = pos.image.height, [x, y] = mapXY(pos);
      g.save();
      g.translate(trunc(oX), trunc(oY));
      g.globalAlpha = alphaG2;
      if (teamTime > TIME_PER_TEAM - FADE) {
        const tt = teamTime - (TIME_PER_TEAM - FADE), scale = 0.5 + (FADE - tt) / (FADE * 2.0), ww = trunc((w * scale) / 2.0), hh = trunc((h * scale) / 2.0);
        g.drawImage(pos.image, x - ww, y - hh, ww * 2, hh * 2);
      } else g.drawImage(pos.image, x - trunc(w / 2), y - trunc(h / 2));
      g.restore();
    }
    // Label bar: TextHelper(image + spacer + string), drawn with g's composite.
    g.globalAlpha = alphaG;
    const fm = this.font, h = Math.max(border, trunc(height / 12)) + border, y = height - border - h;
    const textWidth = (pos.smImage ? pos.smImage.width + border : 0) + stringWidth(g, fm, pos.label),
      textHeight = Math.max(pos.smImage ? pos.smImage.height : 0, fm.height);
    g.globalAlpha = 0.5;
    fillRect(g, 0, y, width, h, Color.BLACK);
    g.globalAlpha = 1;
    const drawItems = (x0, top, maxWidth) => {
      const sx = textWidth > maxWidth ? maxWidth / textWidth : 1;
      g.save();
      g.translate(x0, 0);
      g.scale(sx, 1);
      let x = 0;
      if (pos.smImage) {
        g.drawImage(pos.smImage, x + trunc(pos.smImage.width / 2) - trunc(pos.smImage.width / 2), top + trunc(textHeight / 2) - trunc(pos.smImage.height / 2));
        x += pos.smImage.width + border;
      }
      drawString(g, fm, pos.label, x, top + trunc(textHeight / 2) - trunc(fm.height / 2) + fm.ascent, Color.WHITE.css());
      g.restore();
    };
    if (textWidth + border * 2 <= width) drawItems(trunc(Math.max(border, width - textWidth) / 2), y + trunc((h - textHeight) / 2), width - border * 2);
    else {
      const labelWidth = stringWidth(g, fm, pos.label);
      if (pos.smImage) g.drawImage(pos.smImage, 0, y + trunc((h - pos.smImage.height) / 2));
      const sx = Math.min(1, (width - border * 2 - (pos.smImage?.width || 0)) / labelWidth);
      g.save();
      g.translate((pos.smImage?.width || 0) + trunc(Math.max(border, width - labelWidth) / 2), 0);
      g.scale(sx, 1);
      drawString(g, fm, pos.label, 0, y + trunc((h - fm.height) / 2) + fm.ascent, Color.WHITE.css());
      g.restore();
    }
    g.restore();
  }
}

/** Color.getHSBColor(h, s, b) */
function hsb(hue, saturation, brightness) {
  let r = 0, g = 0, b = 0;
  if (saturation === 0) r = g = b = trunc(brightness * 255.0 + 0.5);
  else {
    const h = (hue - Math.floor(hue)) * 6.0, f = h - Math.floor(h), p = brightness * (1.0 - saturation), q = brightness * (1.0 - saturation * f),
      t = brightness * (1.0 - saturation * (1.0 - f)), v = (x) => trunc(x * 255.0 + 0.5);
    switch (trunc(h)) {
      case 0: [r, g, b] = [v(brightness), v(t), v(p)]; break;
      case 1: [r, g, b] = [v(q), v(brightness), v(p)]; break;
      case 2: [r, g, b] = [v(p), v(brightness), v(t)]; break;
      case 3: [r, g, b] = [v(p), v(q), v(brightness)]; break;
      case 4: [r, g, b] = [v(t), v(p), v(brightness)]; break;
      case 5: [r, g, b] = [v(brightness), v(p), v(q)]; break;
    }
  }
  return new JColor(r, g, b);
}

/** WorldPresentation (logos on, logo size 33%, no group lines). */
export class World extends JavaPresentation {
  constructor() {
    super();
    this.worldLogos = null;
    this.organizationGroups = null;
  }
  setSize(w, h) {
    super.setSize(w, h);
    this.worldLogos = null;
  }
  groupColors() {
    const contest = this.getContest(), groups = contest.getGroups();
    this.colors = new Map();
    this.organizationGroups = new Map();
    let hue = f32(0);
    for (const group of groups) {
      this.colors.set(group.id, hsb(hue, 1, 1));
      hue = f32(hue + f32(1 / groups.length));
      for (const t of contest.c.teams || []) {
        const org = contest.getOrganizationById(t.organizationId);
        if (org && belongsToGroup(groupIdsOf(t), group.id)) this.organizationGroups.set(org.id, group.id);
      }
    }
  }
  incrementTimeMs(dt) {
    if (!this.worldLogos || this.worldLogos.pending) this.worldLogos = setTargets(this.getContest(), this.image, null, trunc((33 * this.height) / 100));
    bubbleOut(this.worldLogos.instPos, this.worldLogos.instPos.length, this.width, this.height, 1, dt);
  }
  paint(g) {
    const { width, height } = this, contest = this.getContest();
    drawMap(g, this.image(MAP), 0, 0, width, height, 1);
    if (!this.organizationGroups?.size) this.groupColors();
    for (const org of contest.c.organizations || []) {
      const la = lat(org), lo = lon(org), color = this.colors.get(this.organizationGroups.get(org.id));
      if (!Number.isNaN(la) && !Number.isNaN(lo) && !this.worldLogos && color)
        fillRect(g, trunc((width * (lo + 180.0)) / 360.0) - 3, trunc((height * (90 - la)) / 180.0) - 3, 6, 6, color);
    }
    const cl = contest.c.location;
    if (cl) fillRect(g, trunc((width * (cl.longitude + 180.0)) / 360.0) - 3, trunc((height * (90 - cl.latitude)) / 180.0) - 3, 6, 6, Color.GREEN);
    if (this.worldLogos)
      for (const p of this.worldLogos.instPos)
        if (p.smImage && !Number.isNaN(p.x) && !Number.isNaN(p.y)) g.drawImage(p.smImage, (width * (p.x + 180.0)) / 360.0, (height * (90 - p.y)) / 180.0);
  }
}

/** GroupPresentation: zooms to each group in turn (all teams first). */
export class GroupMap extends JavaPresentation {
  constructor() {
    super();
    this.anim = cameraAnimator();
    this.groupNum = -1;
  }
  setSize(w, h) {
    super.setSize(w, h);
    this.groupFont = javaFont(f32(f32(f32(h * 72) * f32(0.07)) / 96), true);
  }
  getRepeat() {
    return 12000;
  }
  aboutToShow() {
    this.groupNum++;
    if (this.groupNum >= this.getContest().getGroups().length) this.groupNum = -1;
    this.setTargets();
  }
  setTargets() {
    const contest = this.getContest(), groupId = this.groupNum >= 0 ? contest.getGroups()[this.groupNum].id : null;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const t of contest.c.teams || []) {
      const org = contest.getOrganizationById(t.organizationId);
      if (org && (groupId == null || belongsToGroup(groupIdsOf(t), groupId))) {
        minLat = Math.min(minLat, lat(org));
        maxLat = Math.max(maxLat, lat(org));
        minLon = Math.min(minLon, lon(org));
        maxLon = Math.max(maxLon, lon(org));
      }
    }
    if (minLat === 90 || minLon === 180) return this.anim.setTarget(0, 0, 1);
    const dLon = maxLon - minLon, dLat = maxLat - minLat;
    this.anim.setTarget(minLon + dLon / 2.0, minLat + dLat / 2.0, Math.min(5, Math.min(360.0 / (dLon + 20.0), 180.0 / (dLat + 10.0))));
  }
  incrementTimeMs(dt) {
    this.anim.incrementTimeMs(dt);
  }
  paint(g) {
    const { width, height } = this, contest = this.getContest(), time = this.getRepeatTimeMs(), sc = this.anim.getZValue(),
      oX = width / 2.0 - (width * (this.anim.getXValue() + 180) * sc) / 360.0, oY = height / 2.0 - (height * (90 - this.anim.getYValue()) * sc) / 180.0;
    drawMap(g, this.image(MAP), trunc(oX), trunc(oY), width, height, sc);
    const group = this.groupNum >= 0 ? contest.getGroups()[this.groupNum] : null, groupId = group?.id;
    if (time > 5000) {
      const logoSize = trunc(height / 12), teams = contest.c.teams || [];
      let count = f32(teams.filter((t) => group == null || belongsToGroup(groupIdsOf(t), groupId)).length);
      g.save();
      g.translate(oX, oY);
      if (time > 12000 - 1000 && time < 12000) g.globalAlpha = 1 - (time - (12000 - 1000)) / 1000;
      if (time < 8000) count = f32(((time - 5000) * count) / 3000);
      for (const t of teams) {
        if (!((group == null || belongsToGroup(groupIdsOf(t), groupId)) && count > 0)) continue;
        const inst = contest.getOrganizationById(t.organizationId);
        if (!inst) continue;
        const x = trunc((width * (lon(inst) + 180.0) * sc) / 360.0), y = trunc((height * (90 - lat(inst)) * sc) / 180.0);
        if (x + oX > -20 && x + oX < width + 20 && y + oY > -20 && y + oY < height + 20) {
          if (count < 1) g.globalAlpha = count;
          const img = logoImage(this.image(t.logo || inst.logo), logoSize, logoSize);
          if (img) g.drawImage(img, x - 20, y - 20);
          else fillRect(g, x - 2, y - 2, 5, 5, Color.RED);
        }
        count--;
      }
      g.restore();
    }
    if (time > 4000) {
      g.save();
      if (time < 4000 + 1250) g.globalAlpha = (time - 4000) / 1250;
      else if (time > 12000 - 1000) g.globalAlpha = Math.max(0, 1 - (time - (12000 - 1000)) / 1000);
      const s = group ? group.name : this.words.allTeams || "All teams", fm = this.groupFont, border = f32(height / f32(40));
      drawString(g, fm, s, trunc(width - border - stringWidth(g, fm, s)) + 1, trunc(height - border) + 1, Color.DARK_GRAY.css());
      drawString(g, fm, s, trunc(width - border - stringWidth(g, fm, s)), trunc(height - border), Color.WHITE.css());
      g.restore();
    }
  }
}

const DEFAULT_LONGITUDE = 90.426443, DEFAULT_LATITUDE = 23.829082, NUM_SEGMENTS = 50;
const SUBMISSION_MOVEMENT = new Movement(0.1, 0.1);

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

/**
 * BalloonMapPresentation ("Submissions"): balloons fly from each new submission's organization to
 * the contest site. Like the original, every record is added to the list twice.
 */
export class BalloonMap extends JavaPresentation {
  constructor() {
    super();
    this.records = [];
    this.seen = null;
    this.balloonImages = null;
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
    this.seen = new Set(subs.map((s) => s.index));
    if (!contest.isFrozen(this.getTimeMs())) for (const s of subs) if (s.status === "SUBMITTED") this.handleSubmission(s);
    this.findCenter();
  }
  /** Contest listener: new submissions (by feed position) start a flight. */
  watchSubmissions() {
    if (!this.seen) return;
    for (const s of this.getContest().getAllSubmissions())
      if (!this.seen.has(s.index)) {
        this.seen.add(s.index);
        this.handleSubmission(s);
      }
  }
  handleSubmission(submission) {
    for (const sr of this.records)
      if (sr.submission.index === submission.index) {
        sr.submission = submission;
        return;
      }
    const contest = this.getContest(), sr = { submission, anim: new Animator(0, SUBMISSION_MOVEMENT), fullAge: 0, actionAge: 0, action: null };
    this.records.push(sr);
    const oLon = contest.c.location ? contest.c.location.longitude : DEFAULT_LONGITUDE, oLat = contest.c.location ? contest.c.location.latitude : DEFAULT_LATITUDE;
    sr.anim.setTarget(0.95);
    sr.problem = submission.problemIndex;
    const org = contest.getOrganizationById(submission.team?.organizationId);
    if (!org) return;
    sr.org = org;
    sr.logoUrl = submission.team?.logo || org.logo;
    sr.lat = new Array(NUM_SEGMENTS);
    sr.lon = new Array(NUM_SEGMENTS);
    sr.lat[0] = lat(org);
    sr.lon[0] = lon(org);
    const h = (40.0 * (Math.abs(sr.lat[0] - oLat) + Math.abs(sr.lon[0] - oLon))) / 180.0;
    for (let i = 1; i < NUM_SEGMENTS; i++) {
      const d = 1.0 - i / (NUM_SEGMENTS - 1.0);
      sr.lon[i] = sr.lon[0] * d + oLon * (1.0 - d);
      sr.lat[i] = sr.lat[0] * d + oLat * (1.0 - d) + Math.sin((i * Math.PI) / (NUM_SEGMENTS - 1.0)) * h;
    }
    this.records.push(sr);
  }
  incrementTimeMs(dt) {
    // Submissions refresh from the latest public state on every frame.
    for (const sr of this.records) {
      const latest = this.getContest().getAllSubmissions()[sr.submission.index];
      if (latest) sr.submission = latest;
    }
    this.watchSubmissions();
    const contest = this.getContest(), frozen = contest.isFrozen(this.getTimeMs()), remove = [];
    for (const sr of this.records) {
      sr.anim.incrementTimeMs(dt);
      sr.fullAge += dt;
      if (sr.action == null) {
        if (!frozen && sr.submission.status !== "SUBMITTED") {
          sr.actionAge += dt;
          sr.anim.setTarget(0.05);
          const solved = sr.submission.status === "SOLVED";
          if (solved && sr.actionAge > 11000) sr.action = "HIGHLIGHT";
          else if (!solved && sr.actionAge > 8000) sr.action = "FADE_OUT";
          if (sr.action != null) sr.actionAge = 0;
        } else if (frozen && sr.fullAge > 14000) sr.action = "FADE_OUT";
      } else sr.actionAge += dt;
      if ((sr.action === "HIGHLIGHT" && sr.actionAge > 11000) || (sr.action === "FADE_OUT" && sr.actionAge > 2000)) remove.push(sr);
    }
    for (const sr of remove) {
      const i = this.records.indexOf(sr);
      if (i >= 0) this.records.splice(i, 1);
    }
  }
  findCenter() {
    const contest = this.getContest();
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const t of contest.c.teams || []) {
      const org = contest.getOrganizationById(t.organizationId);
      if (!org) continue;
      if (!Number.isNaN(lat(org))) {
        minLat = Math.min(minLat, lat(org));
        maxLat = Math.max(maxLat, lat(org));
      }
      if (!Number.isNaN(lon(org))) {
        minLon = Math.min(minLon, lon(org) - 3);
        maxLon = Math.max(maxLon, lon(org) + 3);
      }
    }
    this.cLat = (minLat + maxLat) / 2.0;
    this.cLon = (minLon + maxLon) / 2.0;
    this.cZoom = Math.min(360.0 / Math.abs(minLon - maxLon), 180.0 / Math.abs(minLat - maxLat)) * 0.92;
  }
  paint(g) {
    const { width, height } = this, scm = this.cZoom ?? 1, oX = width / 2.0 - (width * ((this.cLon ?? 0) + 180) * scm) / 360.0,
      oY = height / 2.0 - (height * (90 - (this.cLat ?? 0)) * scm) / 180.0;
    drawMap(g, this.image(MAP), trunc(oX), trunc(oY), width, height, scm);
    if (!this.loadBalloons()) return;
    const xy = (la, lo) => [trunc((width * (lo + 180.0) * scm) / 360.0), trunc((height * (90 - la) * scm) / 180.0)];
    g.save();
    g.translate(trunc(oX), trunc(oY));
    const srs = this.records.filter((sr) => sr.lat);
    for (const sr of srs) {
      const d = sr.anim.getValue();
      if (d <= 0.06) continue;
      g.save();
      if (d < 0.16) g.globalAlpha = (d - 0.06) * 10.0;
      for (let i = 0; i < NUM_SEGMENTS - 1; i++) {
        const [x1, y1] = xy(sr.lat[i], sr.lon[i]), [x2, y2] = xy(sr.lat[i + 1], sr.lon[i + 1]);
        drawLine(g, x1, y1, x2, y2, Color.GRAY, { width: 3 });
      }
      g.restore();
    }
    const orgIds = [];
    for (let i = srs.length - 1; i >= 0; i--) {
      const sr = srs[i];
      if (orgIds.includes(sr.org.id)) continue;
      orgIds.push(sr.org.id);
      const [x, y] = xy(sr.lat[0], sr.lon[0]), img = logoImage(this.image(sr.logoUrl), trunc(height / 6), trunc(height / 6)),
        smImg = logoImage(this.image(sr.logoUrl), trunc(trunc((height * 4) / 6) / 10), trunc(trunc((height * 4) / 6) / 10));
      let yy = 4;
      if (img && smImg) {
        if (sr.fullAge < 3000) {
          g.drawImage(img, trunc(x - img.width / 2.0), trunc(y - img.height / 2.0));
          yy = trunc(img.height / 2) + 4;
        } else if (sr.fullAge < 4000) {
          const sc = 1.0 - (0.6 * (sr.fullAge - 3000)) / 1000;
          g.drawImage(img, trunc(x - (img.width * sc) / 2.0), trunc(y - (img.height * sc) / 2.0), trunc(img.width * sc), trunc(img.height * sc));
          yy = trunc((img.height * sc) / 2) + 4;
        } else {
          g.drawImage(smImg, trunc(x - smImg.width / 2.0), trunc(y - smImg.height / 2.0));
          yy = trunc(smImg.height / 2) + 4;
        }
      }
      const s = sr.org.name, fm = this.font;
      drawString(g, fm, s, x - trunc(stringWidth(g, fm, s) / 2), y + yy + fm.ascent, Color.WHITE.css());
    }
    for (const sr of srs) {
      if (sr.problem >= this.balloonImages.length) continue;
      const d = sr.anim.getValue(), i = trunc(d * 0.999 * (NUM_SEGMENTS - 1)), dd = (d - (i * 1.0) / (NUM_SEGMENTS - 1)) * (NUM_SEGMENTS - 1);
      const [x, y] = xy(sr.lat[i] * (1.0 - dd) + sr.lat[i + 1] * dd, sr.lon[i] * (1.0 - dd) + sr.lon[i + 1] * dd), img = this.balloonImages[sr.problem];
      const bx = trunc(x - img.width / 2.0), by = trunc(y - img.height / 2.0);
      g.drawImage(img, bx, by);
      if (sr.submission.status === "SOLVED") g.drawImage(this.solvedImage, bx, by);
      else if (sr.submission.status !== "SUBMITTED") g.drawImage(this.failedImage, bx, by);
    }
    g.restore();
  }
}
