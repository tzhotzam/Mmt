// STL (3D model) girişi → yükseklik haritası.
//
// Model tepeden ortografik olarak "z-buffer" ile taranır: her ızgara
// hücresinde en yüksek Z değeri tutulur. Bu, kabartma panel için doğru
// yaklaşımdır — panel zaten tek yönden bakılan bir rölyeftir.

/**
 * ASCII veya binary STL ayrıştırır.
 * @param {ArrayBuffer} buffer
 * @returns {Array<Array<[number,number,number]>>} üçgenler
 */
export function parseStl(buffer) {
  const bytes = new Uint8Array(buffer);
  if (isBinaryStl(bytes)) return parseBinaryStl(buffer);
  return parseAsciiStl(new TextDecoder().decode(bytes));
}

function isBinaryStl(bytes) {
  if (bytes.length < 84) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(80, true);
  if (84 + count * 50 === bytes.length) return true;
  // Boyut uymuyorsa "solid" başlığına bak.
  const head = String.fromCharCode(...bytes.subarray(0, 5)).toLowerCase();
  return head !== 'solid';
}

function parseBinaryStl(buffer) {
  const dv = new DataView(buffer);
  const count = dv.getUint32(80, true);
  const tris = [];
  for (let i = 0; i < count; i++) {
    const o = 84 + i * 50 + 12; // normal atlanır
    const v = [];
    for (let k = 0; k < 3; k++) {
      v.push([
        dv.getFloat32(o + k * 12, true),
        dv.getFloat32(o + k * 12 + 4, true),
        dv.getFloat32(o + k * 12 + 8, true),
      ]);
    }
    tris.push(v);
  }
  return tris;
}

function parseAsciiStl(text) {
  const tris = [];
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let m;
  let cur = [];
  while ((m = re.exec(text)) !== null) {
    cur.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
    if (cur.length === 3) {
      tris.push(cur);
      cur = [];
    }
  }
  return tris;
}

export function stlBounds(tris) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const [x, y, z] of t) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ, w: maxX - minX, h: maxY - minY, d: maxZ - minZ };
}

/**
 * Üçgenleri tepeden tarayıp 0..1 yükseklik haritası üretir.
 * @param {Array} tris parseStl çıktısı
 * @param {number} cols
 * @param {number} rows
 * @param {{axis?:'z'|'y'|'x'}} opts bakış ekseni (varsayılan Z = tepeden)
 */
export function heightmapFromStl(tris, cols, rows, opts = {}) {
  const axis = opts.axis || 'z';
  const t3 = axis === 'z' ? tris
    : tris.map((t) => t.map(([x, y, z]) => (axis === 'y' ? [x, z, y] : [y, z, x])));

  const b = stlBounds(t3);
  const data = new Float32Array(cols * rows).fill(-Infinity);
  if (!Number.isFinite(b.w) || b.w <= 0 || b.h <= 0) {
    return { w: cols, h: rows, data: new Float32Array(cols * rows) };
  }

  const sx = (cols - 1) / b.w;
  const sy = (rows - 1) / b.h;

  for (const t of t3) {
    // Model koordinatlarını ızgara koordinatlarına taşı (gy=0 modelin üst kenarı).
    const p = t.map(([x, y, z]) => [(x - b.minX) * sx, (b.maxY - y) * sy, z]);
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const maxX = Math.min(cols - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const maxY = Math.min(rows - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));

    const d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
    if (Math.abs(d) < 1e-12) continue;

    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const l0 = ((p[1][1] - p[2][1]) * (gx - p[2][0]) + (p[2][0] - p[1][0]) * (gy - p[2][1])) / d;
        const l1 = ((p[2][1] - p[0][1]) * (gx - p[2][0]) + (p[0][0] - p[2][0]) * (gy - p[2][1])) / d;
        const l2 = 1 - l0 - l1;
        const E = -1e-6;
        if (l0 < E || l1 < E || l2 < E) continue;
        const z = l0 * p[0][2] + l1 * p[1][2] + l2 * p[2][2];
        const i = gy * cols + gx;
        if (z > data[i]) data[i] = z;
      }
    }
  }

  const zMin = b.minZ;
  const range = b.maxZ - b.minZ || 1;
  for (let i = 0; i < data.length; i++) {
    data[i] = data[i] === -Infinity ? 0 : (data[i] - zMin) / range;
  }
  return { w: cols, h: rows, data };
}
