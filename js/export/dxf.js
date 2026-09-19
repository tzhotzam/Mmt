// AutoCAD R12 ASCII DXF yazıcısı.
// R12 bilinçli tercih: en eski CAM/CNC yazılımları bile sorunsuz okur.
// Birimler milimetredir.

const LAYERS = [
  { name: 'KESIM', color: 1 },    // kırmızı — dış kontur ve delikler
  { name: 'GRAVUR', color: 3 },   // yeşil — kılavuz çizgi ve etiketler
  { name: 'LEVHA', color: 8 },    // gri — levha sınırı (kesilmez, referans)
];

class DxfBuilder {
  constructor() {
    this.lines = [];
  }
  pair(code, value) {
    this.lines.push(String(code), String(value));
    return this;
  }
  header() {
    this.pair(0, 'SECTION').pair(2, 'HEADER');
    this.pair(9, '$ACADVER').pair(1, 'AC1009');
    this.pair(9, '$INSUNITS').pair(70, 4); // 4 = milimetre
    this.pair(9, '$MEASUREMENT').pair(70, 1);
    this.pair(0, 'ENDSEC');
    return this;
  }
  tables() {
    this.pair(0, 'SECTION').pair(2, 'TABLES');
    this.pair(0, 'TABLE').pair(2, 'LAYER').pair(70, LAYERS.length);
    for (const l of LAYERS) {
      this.pair(0, 'LAYER').pair(2, l.name).pair(70, 0).pair(62, l.color).pair(6, 'CONTINUOUS');
    }
    this.pair(0, 'ENDTAB');
    this.pair(0, 'ENDSEC');
    return this;
  }
  beginEntities() {
    this.pair(0, 'SECTION').pair(2, 'ENTITIES');
    return this;
  }
  polyline(points, layer, closed = true) {
    if (!points || points.length < 2) return this;
    this.pair(0, 'POLYLINE').pair(8, layer).pair(66, 1).pair(70, closed ? 1 : 0);
    this.pair(10, 0).pair(20, 0).pair(30, 0);
    for (const [x, y] of points) {
      this.pair(0, 'VERTEX').pair(8, layer);
      this.pair(10, num(x)).pair(20, num(y)).pair(30, 0);
    }
    this.pair(0, 'SEQEND').pair(8, layer);
    return this;
  }
  text(str, x, y, height, layer, rotation = 0) {
    this.pair(0, 'TEXT').pair(8, layer);
    this.pair(10, num(x)).pair(20, num(y)).pair(30, 0);
    this.pair(40, num(height));
    this.pair(1, str);
    if (rotation) this.pair(50, num(rotation));
    this.pair(72, 1).pair(73, 2); // yatay ortalı, dikey ortalı
    this.pair(11, num(x)).pair(21, num(y)).pair(31, 0);
    return this;
  }
  end() {
    this.pair(0, 'ENDSEC').pair(0, 'EOF');
    return this.lines.join('\r\n') + '\r\n';
  }
}

function num(v) {
  return Number(v).toFixed(4);
}

/**
 * Tek bir levhayı DXF metnine çevirir.
 * @param {{placements:Array,w:number,h:number}} sheet
 * @param {Array} applied applyPlacement sonuçları (sheet.placements ile aynı sırada)
 * @param {object} opts { withSheetOutline, withEngrave }
 */
export function sheetToDxf(sheet, applied, opts = {}) {
  const { withSheetOutline = true, withEngrave = true } = opts;
  const b = new DxfBuilder().header().tables().beginEntities();

  if (withSheetOutline) {
    b.polyline([[0, 0], [sheet.w, 0], [sheet.w, sheet.h], [0, sheet.h]], 'LEVHA', true);
  }

  for (const a of applied) {
    b.polyline(a.outline, 'KESIM', true);
    for (const hole of a.holes) b.polyline(hole, 'KESIM', true);
    if (withEngrave) {
      for (const e of a.engrave) {
        if (e.type === 'polyline') b.polyline(e.points, 'GRAVUR', e.closed !== false);
        else b.text(e.text, e.x, e.y, e.size, 'GRAVUR', e.rot || 0);
      }
    }
  }

  return b.end();
}

/** Tüm parçaları yerleşimsiz, panel koordinatlarında tek DXF olarak verir. */
export function partsToDxf(parts, opts = {}) {
  const { withEngrave = true } = opts;
  const b = new DxfBuilder().header().tables().beginEntities();
  for (const part of parts) {
    b.polyline(part.outline, 'KESIM', true);
    for (const hole of part.holes) b.polyline(hole, 'KESIM', true);
    if (withEngrave) {
      for (const e of part.engrave) {
        if (e.type === 'polyline') b.polyline(e.points, 'GRAVUR', e.closed !== false);
        else b.text(e.text, e.x, e.y, e.size, 'GRAVUR', 0);
      }
    }
  }
  return b.end();
}
