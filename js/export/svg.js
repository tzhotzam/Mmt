// SVG dışa aktarım. Birim = milimetre (viewBox mm cinsinden, width/height "mm").
// Lazer/CNC yazılımlarının çoğu bu SVG'yi 1:1 ölçekte okur.

const CUT_STYLE = 'fill:none;stroke:#e11d48;stroke-width:0.15';
const ENGRAVE_STYLE = 'fill:none;stroke:#0ea5e9;stroke-width:0.15';
const SHEET_STYLE = 'fill:none;stroke:#9ca3af;stroke-width:0.4;stroke-dasharray:8,4';

function d(ring, closed = true) {
  if (!ring.length) return '';
  const head = `M ${f(ring[0][0])} ${f(ring[0][1])}`;
  const rest = ring.slice(1).map(([x, y]) => `L ${f(x)} ${f(y)}`).join(' ');
  return `${head} ${rest}${closed ? ' Z' : ''}`;
}

function f(v) {
  return Number(v).toFixed(3);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * SVG'de Y ekseni aşağı doğrudur; CAD'de yukarı. Y'yi çevirmek için
 * tüm içerik `translate(0,H) scale(1,-1)` grubuna alınır.
 */
export function sheetToSvg(sheet, applied, opts = {}) {
  const { withSheetOutline = true, withEngrave = true, title = 'Levha' } = opts;
  const body = [];

  if (withSheetOutline) {
    body.push(`<path d="${d([[0, 0], [sheet.w, 0], [sheet.w, sheet.h], [0, sheet.h]])}" style="${SHEET_STYLE}"/>`);
  }
  for (const a of applied) {
    body.push(`<path d="${d(a.outline)}" style="${CUT_STYLE}"/>`);
    for (const hole of a.holes) body.push(`<path d="${d(hole)}" style="${CUT_STYLE}"/>`);
    if (withEngrave) {
      for (const e of a.engrave) {
        if (e.type === 'polyline') {
          body.push(`<path d="${d(e.points, e.closed !== false)}" style="${ENGRAVE_STYLE}"/>`);
        } else {
          // Metin ters çevrilmiş grubun içinde okunur kalsın diye yeniden çevrilir.
          body.push(
            `<text x="0" y="0" transform="translate(${f(e.x)} ${f(e.y)}) scale(1,-1) rotate(${-(e.rot || 0)})" ` +
            `text-anchor="middle" dominant-baseline="middle" ` +
            `style="font-family:monospace;font-size:${f(e.size)}px;fill:#0ea5e9">${esc(e.text)}</text>`
          );
        }
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
     width="${f(sheet.w)}mm" height="${f(sheet.h)}mm"
     viewBox="0 0 ${f(sheet.w)} ${f(sheet.h)}">
  <title>${esc(title)}</title>
  <g transform="translate(0 ${f(sheet.h)}) scale(1 -1)">
${body.map((l) => '    ' + l).join('\n')}
  </g>
</svg>
`;
}

/** Önizleme amaçlı: parçaları panel koordinatlarında tek SVG'ye basar. */
export function partsToSvg(parts, width, height, opts = {}) {
  return sheetToSvg({ w: width, h: height }, parts.map((p) => ({
    outline: p.outline, holes: p.holes, engrave: p.engrave,
  })), { ...opts, withSheetOutline: false });
}
