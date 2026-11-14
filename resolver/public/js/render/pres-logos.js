/*
 * Port of ICPC Tools v2.6.1331 OrgLogoWallPresentation, OrgLogoFadePresentation and
 * OrgLogoSlidePresentation.
 */
import { logoImage } from "./java-graphics.js";
import { JavaPresentation } from "./presentation-java.js";

const trunc = Math.trunc;

/** contest.getOrganizations() with their logo (an uploaded team logo overrides the feed one). */
function organizations(contest) {
  const teamLogo = new Map();
  for (const t of contest.c.teams || []) if (t.organizationId && t.logo && !teamLogo.has(t.organizationId)) teamLogo.set(t.organizationId, t.logo);
  return (contest.c.organizations || []).map((o) => ({ ...o, logo: o.logo || teamLogo.get(o.id) || null }));
}

class OrgLogoBase extends JavaPresentation {
  logo(org, size) {
    return logoImage(this.image(org.logo), size, size);
  }
}

export class OrgLogoWall extends OrgLogoBase {
  getRepeat() {
    return 11000;
  }
  aboutToShow() {
    const orgs = organizations(this.getContest()), { width, height } = this;
    if (!orgs.length) {
      this.size = 25;
      return;
    }
    let size = trunc(Math.sqrt(trunc((width * height) / orgs.length)) * 1.0);
    let num = trunc(width / size) * trunc(height / size) - trunc(trunc(height / size) / 2);
    while (num < orgs.length && size > 5) {
      size--;
      num = trunc(width / size) * trunc(height / size) - trunc(trunc(height / size) / 2);
    }
    this.size = size;
  }
  paint(g) {
    const orgs = organizations(this.getContest()), { width, height } = this, size = this.size || 25, size2 = trunc(size * 0.9);
    const dx = trunc((width - trunc(width / size) * size) / 2), dy = trunc((height - trunc(height / size) * size) / 2);
    let i = dx, j = dy, oddRow = false;
    for (const org of orgs) {
      const img = this.logo(org, size2);
      if (!img) continue;
      g.drawImage(img, i + trunc((size - img.width) / 2), j + trunc((size - img.height) / 2));
      i += size;
      if (i > width - size) {
        i = dx;
        if (!oddRow) i += trunc(size / 2);
        oddRow = !oddRow;
        j += size;
      }
    }
  }
}

const SLIDE_DT = 15000;

export class OrgLogoSlide extends OrgLogoBase {
  aboutToShow() {
    this.size = organizations(this.getContest()).length ? trunc(this.height / 4) : 25;
  }
  paint(g) {
    const orgs = organizations(this.getContest()), size = this.size || trunc(this.height / 4), size2 = trunc(size * 0.9);
    if (!orgs.length) return;
    const numInRow = [0, 0, 0, 0], rowStart = [0, 0, 0, 0], numPerRow = trunc(orgs.length / 4);
    numInRow.fill(numPerRow);
    let c = 0;
    while (numPerRow * 4 + c < orgs.length) numInRow[c++]++;
    for (let i = 1; i < 4; i++) rowStart[i] = rowStart[i - 1] + numInRow[i - 1];
    const numW = trunc(this.width / size), dy = trunc((this.height - size * 4) / 2), time = this.getTimeMs(),
      ds = (size * (time % SLIDE_DT)) / SLIDE_DT, colOffset = Math.floor(time / SLIDE_DT);
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "low";
    for (let row = 0; row < 4; row++) {
      const y = dy + row * size;
      for (let col = 0; col <= numW + 1; col++) {
        if (numInRow[row] === 0) continue;
        let x = col * size, num;
        if (row % 2 === 0) {
          x -= ds;
          num = rowStart[row] + ((col + colOffset) % numInRow[row]);
        } else {
          x += ds - size;
          num = rowStart[row] + (((col - (colOffset % orgs.length) + orgs.length) % numInRow[row]) + numInRow[row]) % numInRow[row];
        }
        const img = this.logo(orgs[num], size2);
        if (img) g.drawImage(img, x + trunc((size - img.width) / 2), y + trunc((size - img.height) / 2));
      }
    }
    g.restore();
  }
}

const ROWS = 3, MS_PER_LOGO = 30000, FADE = 750;

export class OrgLogoFade extends OrgLogoBase {
  aboutToShow() {
    this.size = organizations(this.getContest()).length ? trunc(this.height / ROWS) : 25;
  }
  paint(g) {
    const orgs = organizations(this.getContest()), { width, height } = this, size = this.size || trunc(height / ROWS), size2 = trunc(size * 0.9);
    if (!orgs.length) return;
    const evenRow = trunc(width / size), oddRow = trunc((width - trunc(size / 2)) / size),
      numPerScreen = trunc((evenRow * (ROWS + 1)) / 2) + trunc((oddRow * ROWS) / 2);
    if (!this.randomOrder || this.randomOrder.length !== numPerScreen) {
      this.randomOrder = Array.from({ length: numPerScreen }, (_, i) => i);
      for (let i = 0; i < 1000; i++) {
        const a = trunc(Math.random() * numPerScreen), b = trunc(Math.random() * numPerScreen);
        [this.randomOrder[a], this.randomOrder[b]] = [this.randomOrder[b], this.randomOrder[a]];
      }
    }
    const indx = trunc((width - trunc(width / size) * size) / 2);
    let x = indx, y = trunc((height - size * ROWS) / 2), odd = false;
    for (let i = 0; i < numPerScreen; i++) {
      const base = this.getTimeMs() + trunc(((numPerScreen + this.randomOrder[i]) * MS_PER_LOGO) / numPerScreen),
        baseTime = base % MS_PER_LOGO, org = (i + Math.floor(base / MS_PER_LOGO) * numPerScreen) % orgs.length,
        img = this.logo(orgs[org], size2);
      if (img && x > -size && x < width) {
        let tr = 1;
        if (baseTime < FADE) tr = baseTime / FADE;
        else if (baseTime > MS_PER_LOGO - FADE) tr = 1 - (baseTime - (MS_PER_LOGO - FADE)) / FADE;
        g.save();
        g.globalAlpha = tr;
        g.drawImage(img, x + trunc((size - img.width) / 2), y + trunc((size - img.height) / 2));
        g.restore();
      }
      x += size;
      if (x + size > width) {
        x = !odd ? indx + trunc(size / 2) : indx;
        odd = !odd;
        y += size;
      }
    }
  }
}
