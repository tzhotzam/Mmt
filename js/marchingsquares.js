// Marching Squares ile yükseklik haritasından kapalı eş-yükselti halkaları.
//
// Izgara: { w, h, data: Float32Array }  (satır-öncelikli, data[y*w + x])
// "İçeri" = değer >= level kabul edilir.

const EDGE_T = 0, EDGE_R = 1, EDGE_B = 2, EDGE_L = 3;

// code = tl*8 | tr*4 | br*2 | bl*1
const TABLE = {
  0: [], 15: [],
  1: [[EDGE_L, EDGE_B]],
  2: [[EDGE_B, EDGE_R]],
  3: [[EDGE_L, EDGE_R]],
  4: [[EDGE_R, EDGE_T]],
  6: [[EDGE_B, EDGE_T]],
  7: [[EDGE_L, EDGE_T]],
  8: [[EDGE_T, EDGE_L]],
  9: [[EDGE_T, EDGE_B]],
  11: [[EDGE_T, EDGE_R]],
  12: [[EDGE_R, EDGE_L]],
  13: [[EDGE_R, EDGE_B]],
  14: [[EDGE_B, EDGE_L]],
};

/**
 * @param {{w:number,h:number,data:Float32Array}} grid
 * @param {number} level eşik değeri
 * @returns {Array<Array<[number,number]>>} ızgara koordinatlarında kapalı halkalar
 */
export function contourRings(grid, level) {
  const { w, h } = grid;
  if (w < 2 || h < 2) return [];

  // Kenarda açık kalan konturların kapanması için 1 hücrelik düşük değerli çerçeve.
  const PAD = 1;
  const pw = w + 2 * PAD;
  const ph = h + 2 * PAD;
  const OUTSIDE = -1;
  const g = new Float32Array(pw * ph).fill(OUTSIDE);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      g[(y + PAD) * pw + (x + PAD)] = grid.data[y * w + x];
    }
  }
  const at = (x, y) => g[y * pw + x];

  const segments = [];
  for (let y = 0; y < ph - 1; y++) {
    for (let x = 0; x < pw - 1; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      let code = 0;
      if (tl >= level) code |= 8;
      if (tr >= level) code |= 4;
      if (br >= level) code |= 2;
      if (bl >= level) code |= 1;
      if (code === 0 || code === 15) continue;

      let pairs = TABLE[code];
      if (pairs === undefined) {
        // Eyer (saddle) durumları: 5 ve 10. Merkez ortalaması ile çözülür.
        const center = (tl + tr + br + bl) / 4;
        const joined = center >= level;
        if (code === 5) {
          pairs = joined ? [[EDGE_L, EDGE_T], [EDGE_R, EDGE_B]]
                         : [[EDGE_R, EDGE_T], [EDGE_L, EDGE_B]];
        } else {
          pairs = joined ? [[EDGE_T, EDGE_R], [EDGE_B, EDGE_L]]
                         : [[EDGE_T, EDGE_L], [EDGE_B, EDGE_R]];
        }
      }

      for (const [from, to] of pairs) {
        segments.push({
          a: edgePoint(from, x, y, tl, tr, br, bl, level),
          b: edgePoint(to, x, y, tl, tr, br, bl, level),
          used: false,
        });
      }
    }
  }

  const rings = stitch(segments);
  // PAD kaymasını geri al.
  return rings.map((r) => r.map(([x, y]) => [x - PAD, y - PAD]));
}

function lerpT(v0, v1, level) {
  const d = v1 - v0;
  if (Math.abs(d) < 1e-12) return 0.5;
  return (level - v0) / d;
}

function edgePoint(edge, x, y, tl, tr, br, bl, level) {
  switch (edge) {
    case EDGE_T: return [x + lerpT(tl, tr, level), y];
    case EDGE_B: return [x + lerpT(bl, br, level), y + 1];
    case EDGE_L: return [x, y + lerpT(tl, bl, level)];
    default:     return [x + 1, y + lerpT(tr, br, level)];
  }
}

function key(p) {
  return `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
}

function stitch(segments) {
  const startMap = new Map();
  for (const s of segments) {
    const k = key(s.a);
    let list = startMap.get(k);
    if (!list) startMap.set(k, (list = []));
    list.push(s);
  }

  const rings = [];
  for (const seed of segments) {
    if (seed.used) continue;
    seed.used = true;
    const ring = [seed.a, seed.b];
    let cursor = seed.b;
    const startKey = key(seed.a);

    for (let guard = 0; guard < segments.length + 2; guard++) {
      const k = key(cursor);
      if (k === startKey) break;
      const list = startMap.get(k);
      const next = list && list.find((s) => !s.used);
      if (!next) break; // kapanmayan zincir (nadir); olduğu gibi kapatılır
      next.used = true;
      ring.push(next.b);
      cursor = next.b;
    }

    // Son nokta başlangıca eşitse tekrarı at.
    if (ring.length > 1 && key(ring[ring.length - 1]) === startKey) ring.pop();
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}
