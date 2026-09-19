// Basit raf (shelf) yerleşimi — parçaları levhalara dizer.
// Amaç optimum kesim değil, kullanılabilir ve öngörülebilir bir yerleşimdir.

import { bbox, rotateRing90, translateRing } from './geom.js';

export const NEST_DEFAULTS = {
  sheetW: 2440,
  sheetH: 1220,
  margin: 10,   // levha kenarından boşluk
  spacing: 6,   // parçalar arası boşluk
  allowRotate: true,
};

export function nest(parts, userOpts = {}) {
  const o = { ...NEST_DEFAULTS, ...userOpts };
  const usableW = o.sheetW - 2 * o.margin;
  const usableH = o.sheetH - 2 * o.margin;

  const items = parts.map((part) => {
    const b = bbox(part.outline);
    return { part, b, w: b.w, h: b.h };
  });
  items.sort((a, b) => b.h - a.h || b.w - a.w);

  const sheets = [];
  const oversized = [];
  let sheet = newSheet();

  for (const it of items) {
    if (!fitsAnywhere(it)) {
      oversized.push(it.part);
      continue;
    }
    if (place(sheet, it)) continue;
    // Bu levhada yer kalmadı: kapat, yenisini aç.
    if (sheet.placements.length) sheets.push(sheet);
    sheet = newSheet();
    if (!place(sheet, it)) oversized.push(it.part);
  }
  if (sheet.placements.length) sheets.push(sheet);

  return { sheets, oversized, opts: o };

  function newSheet() {
    return { shelves: [], placements: [], w: o.sheetW, h: o.sheetH };
  }

  function place(sh, it) {
    return tryPlace(sh, it, false) || (o.allowRotate && tryPlace(sh, it, true));
  }

  function fitsAnywhere(it) {
    if (it.w <= usableW && it.h <= usableH) return true;
    return o.allowRotate && it.h <= usableW && it.w <= usableH;
  }

  function tryPlace(sh, it, rot) {
    const w = rot ? it.h : it.w;
    const h = rot ? it.w : it.h;
    if (w > usableW || h > usableH) return false;

    for (const shelf of sh.shelves) {
      if (h <= shelf.h && shelf.cursorX + w <= o.margin + usableW) {
        commit(sh, it, shelf.cursorX, shelf.y, rot);
        shelf.cursorX += w + o.spacing;
        return true;
      }
    }
    const top = sh.shelves.length
      ? sh.shelves[sh.shelves.length - 1].y + sh.shelves[sh.shelves.length - 1].h + o.spacing
      : o.margin;
    if (top + h > o.margin + usableH) return false;
    const shelf = { y: top, h, cursorX: o.margin };
    sh.shelves.push(shelf);
    commit(sh, it, shelf.cursorX, shelf.y, rot);
    shelf.cursorX += w + o.spacing;
    return true;
  }

  function commit(sh, it, x, y, rot) {
    sh.placements.push({ part: it.part, x, y, rot, srcBBox: it.b });
  }
}

/**
 * Bir yerleşimi uygulayıp levha koordinatlarında halkalar döner.
 * @returns {{outline:Array, holes:Array, engrave:Array}}
 */
export function applyPlacement(pl) {
  const { part, x, y, rot, srcBBox } = pl;
  const map = (ring) => {
    let r = translateRing(ring, -srcBBox.minX, -srcBBox.minY);
    if (rot) {
      r = rotateRing90(r);
      r = translateRing(r, srcBBox.h, 0); // 90° dönüş sonrası negatif X'i geri al
    }
    return translateRing(r, x, y);
  };
  const mapPoint = ([px, py]) => map([[px, py]])[0];

  return {
    outline: map(part.outline),
    holes: part.holes.map(map),
    engrave: part.engrave.map((e) => {
      if (e.type === 'polyline') return { ...e, points: map(e.points) };
      const [tx, ty] = mapPoint([e.x, e.y]);
      return { ...e, x: tx, y: ty, rot: rot ? 90 : 0 };
    }),
  };
}
