// POLİGONAL (low-poly) yüzey.
//
// Yükseklik haritasını düzgün eğriler yerine düz üçgen yüzeylerden oluşan
// kırıklı bir yüzeye çevirir. Sonuç, lamel modunda keskin açılı profiller,
// katman modunda köşeli konturlar verir — low-poly heykellerin görünümü.
//
// Yöntem: köşeleri rastgele kaydırılmış bir dörtgen ağ kurulur, her dörtgen
// iki üçgene bölünür ve her üçgenin içi köşe yüksekliklerinden doğrusal
// olarak doldurulur. Köşeler komşu hücrelerle paylaşıldığı için ağda boşluk
// veya bindirme oluşmaz.

import { sampleBilinear } from './heightmap.js';

/** Deterministik PRNG — aynı ayar hep aynı deseni üretsin diye. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{w:number,h:number,data:Float32Array}} grid
 * @param {object} opts
 *  - cells:  uzun kenar boyunca poligon sayısı (6'dan küçükse işlem yapılmaz)
 *  - jitter: köşe kaydırma oranı 0..0.4 (0 = düzenli ızgara)
 *  - flat:   true ise her üçgen tek yükseklikte olur (papercraft görünümü)
 *  - seed:   desen tohumu
 */
export function facetize(grid, opts = {}) {
  const { cells = 26, jitter = 0.34, flat = false, seed = 7 } = opts;
  const { w, h } = grid;
  if (cells < 6 || w < 4 || h < 4) return grid;

  // Hücreleri olabildiğince kare tut.
  const cx = Math.max(2, Math.round(w >= h ? cells : cells * (w / h)));
  const cy = Math.max(2, Math.round(w >= h ? cells * (h / w) : cells));

  const stepX = (w - 1) / cx;
  const stepY = (h - 1) / cy;
  const rand = mulberry32(seed);

  // Köşe ağı: konum + yükseklik. Kenardaki köşeler panel sınırını bozmamak
  // için yalnızca kenar boyunca kaydırılır.
  const nx = cx + 1;
  const vX = new Float32Array(nx * (cy + 1));
  const vY = new Float32Array(nx * (cy + 1));
  const vZ = new Float32Array(nx * (cy + 1));

  for (let j = 0; j <= cy; j++) {
    for (let i = 0; i <= cx; i++) {
      const k = j * nx + i;
      const onLeftRight = i === 0 || i === cx;
      const onTopBottom = j === 0 || j === cy;
      const jx = onLeftRight ? 0 : (rand() - 0.5) * 2 * jitter * stepX;
      const jy = onTopBottom ? 0 : (rand() - 0.5) * 2 * jitter * stepY;
      const x = Math.min(w - 1, Math.max(0, i * stepX + jx));
      const y = Math.min(h - 1, Math.max(0, j * stepY + jy));
      vX[k] = x;
      vY[k] = y;
      vZ[k] = sampleBilinear(grid, x / (w - 1), y / (h - 1));
    }
  }

  // Kapsanmayan piksel kalırsa özgün değeri korunur.
  const out = { w, h, data: Float32Array.from(grid.data) };

  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const a = j * nx + i;
      const b = j * nx + i + 1;
      const c = (j + 1) * nx + i + 1;
      const d = (j + 1) * nx + i;
      // Köşegeni dönüşümlü seç — düzenli şerit görüntüsünü kırar.
      if ((i + j) % 2 === 0) {
        fillTriangle(out, vX, vY, vZ, a, b, c, flat);
        fillTriangle(out, vX, vY, vZ, a, c, d, flat);
      } else {
        fillTriangle(out, vX, vY, vZ, a, b, d, flat);
        fillTriangle(out, vX, vY, vZ, b, c, d, flat);
      }
    }
  }

  return out;
}

function fillTriangle(out, vX, vY, vZ, i0, i1, i2, flat) {
  const x0 = vX[i0], y0 = vY[i0], z0 = vZ[i0];
  const x1 = vX[i1], y1 = vY[i1], z1 = vZ[i1];
  const x2 = vX[i2], y2 = vY[i2], z2 = vZ[i2];

  const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(det) < 1e-12) return;

  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(out.w - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(out.h - 1, Math.ceil(Math.max(y0, y1, y2)));

  const flatZ = (z0 + z1 + z2) / 3;
  // Komşu üçgenlerin ortak kenarında boşluk kalmasın diye küçük tolerans.
  const E = -1e-6;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det;
      const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det;
      const l2 = 1 - l0 - l1;
      if (l0 < E || l1 < E || l2 < E) continue;
      out.data[y * out.w + x] = flat ? flatZ : l0 * z0 + l1 * z1 + l2 * z2;
    }
  }
}
