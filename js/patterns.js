// HAZIR DESENLER
//
// İnternetten model indirmek yerine desenler kodla üretilir. Üç sebep:
// dosya boyutu yok, lisans sorunu yok (indirilebilir olmak ticari kullanım
// hakkı vermez), ve her ayar değişikliğinde yeni bir desen çıkar — aynı
// deseni iki müşteriye satmak zorunda kalmazsınız.
//
// Her desen aynı arayüzü kullanır: (grid, params) → yerinde doldurur.
// params: { scale, angle, detail, seed }  (hepsi 0..1 dışında olabilir,
// her desen kendi anlamlı aralığına çevirir)

import { makeGrid, normalize } from './heightmap.js';

/** Deterministik 32-bit karıştırıcı — aynı tohum hep aynı deseni verir. */
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Değer gürültüsü (value noise) — hücre köşelerinden yumuşak geçiş. */
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

/** Çok katmanlı gürültü — doğal görünümlü düzensizlik. */
function fbm(x, y, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(fx, fy, seed + i * 101) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
  }
  return sum / norm;
}

function rotate(u, v, angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [u * c - v * s, u * s + v * c];
}

// ----------------------------------------------------------------- DESENLER

export const PATTERNS = {
  dalga: {
    label: 'Dalga',
    hint: 'Klasik parametrik dalga paneli. Açı lamellere göre eğimi belirler.',
    fn: (u, v, p) => {
      const [x, y] = rotate(u - 0.5, v - 0.5, p.angle);
      const f = 4 + p.scale * 22;
      const bend = Math.sin(y * f * 0.45 + p.seed) * (0.3 + p.detail * 1.4);
      return 0.5 + 0.5 * Math.sin(x * f + bend);
    },
  },

  halka: {
    label: 'Su halkaları',
    hint: 'Bir noktaya taş atılmış gibi. Birden fazla merkez birbiriyle girişir.',
    fn: (u, v, p) => {
      const merkez = 1 + Math.round(p.detail * 3);
      let sum = 0;
      for (let i = 0; i < merkez; i++) {
        const cx = 0.25 + hash2(i, 7, p.seedInt) * 0.5;
        const cy = 0.25 + hash2(i, 13, p.seedInt) * 0.5;
        const d = Math.hypot(u - cx, v - cy);
        const f = 12 + p.scale * 60;
        sum += Math.sin(d * f - p.angle * 3) * Math.exp(-d * 2.2);
      }
      return 0.5 + 0.5 * (sum / merkez);
    },
  },

  topografya: {
    label: 'Topografya',
    hint: 'Arazi haritası gibi organik tepeler. Katman modunda çok iyi durur.',
    fn: (u, v, p) => {
      const s = 1.5 + p.scale * 7;
      const oct = 2 + Math.round(p.detail * 5);
      const [x, y] = rotate(u, v, p.angle);
      return fbm(x * s, y * s, p.seedInt, oct);
    },
  },

  kumul: {
    label: 'Kumul',
    hint: 'Rüzgârın taşıdığı kum tepeleri — bir yüzü dik, diğeri yatık.',
    fn: (u, v, p) => {
      const [x, y] = rotate(u - 0.5, v - 0.5, p.angle);
      const f = 3 + p.scale * 14;
      const kayma = fbm(x * 2, y * 2, p.seedInt, 3) * (0.4 + p.detail * 2);
      const t = (x * f + kayma) % 1;
      const tt = t < 0 ? t + 1 : t;
      // Asimetrik profil: yavaş yüksel, sert düş.
      return tt < 0.75 ? tt / 0.75 : 1 - (tt - 0.75) / 0.25;
    },
  },

  voronoi: {
    label: 'Voronoi',
    hint: 'Hücresel bölünme. Taş duvar veya deri dokusu etkisi verir.',
    fn: (u, v, p) => {
      const n = 3 + p.scale * 14;
      const [x, y] = rotate(u, v, p.angle);
      const gx = x * n, gy = y * n;
      const cx = Math.floor(gx), cy = Math.floor(gy);
      let d1 = 1e9, d2 = 1e9;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const px = cx + i + hash2(cx + i, cy + j, p.seedInt);
          const py = cy + j + hash2(cx + i, cy + j, p.seedInt + 999);
          const d = Math.hypot(gx - px, gy - py);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
      }
      // d2-d1 hücre sınırlarını belirginleştirir; detail ikisini karıştırır.
      return Math.min(1, (1 - p.detail) * d1 + p.detail * (d2 - d1) * 1.6);
    },
  },

  dag: {
    label: 'Dağ silüeti',
    hint: 'Üst üste binen sıradağlar. Yatay lamelle manzara paneli olur.',
    fn: (u, v, p) => {
      const siralar = 2 + Math.round(p.detail * 5);
      let h = 0;
      for (let i = 0; i < siralar; i++) {
        const taban = 0.12 + (i / siralar) * 0.55;
        const s = 2 + p.scale * 8 + i * 1.5;
        const profil = taban + fbm(u * s + i * 31, i * 7 + p.angle, p.seedInt + i * 53, 3) * 0.32;
        if (v < profil) h = Math.max(h, 0.25 + (i / siralar) * 0.75);
      }
      return h;
    },
  },

  moire: {
    label: 'Moiré',
    hint: 'İki tarağın girişimi. Bakış açısına göre değişen hipnotik desen.',
    fn: (u, v, p) => {
      const f = 10 + p.scale * 70;
      const [x1, y1] = rotate(u - 0.5, v - 0.5, p.angle);
      const [x2] = rotate(u - 0.5, v - 0.5, p.angle + 0.08 + p.detail * 0.5);
      // Tohum tarakları kaydırır; aynı açıda bile farklı girişim deseni çıkar.
      const a = Math.sin(x1 * f + p.seed);
      const b = Math.sin(x2 * f - p.seed * 0.6 + y1 * f * 0.04);
      return 0.5 + 0.25 * (a + b);
    },
  },

  difuzor: {
    label: 'Akustik difüzör',
    hint: 'Karesel kalıntı dizisi — sesi dağıtan, gerçekten işe yarayan bir desen.',
    fn: (u, v, p) => {
      // Asal sayı büyüdükçe kuyu sayısı artar.
      const asallar = [7, 11, 13, 17, 23, 29, 37, 43];
      const N = asallar[Math.min(asallar.length - 1, Math.round(p.scale * (asallar.length - 1)))];
      const [x, y] = rotate(u, v, p.angle);
      const i = Math.floor(Math.abs(x) * N) % N;
      const j = Math.floor(Math.abs(y) * N) % N;
      // 1B veya 2B difüzör
      // Diziyi tohumla kaydırmak difüzörün akustik özelliğini bozmaz,
      // ama görünüşünü değiştirir.
      const k = (p.seedInt % N + N) % N;
      const n = p.detail < 0.5
        ? ((i + k) * (i + k)) % N
        : (((i + k) * (i + k)) + (j * j)) % N;
      return n / (N - 1);
    },
  },
};

export const PATTERN_KEYS = Object.keys(PATTERNS);

/**
 * Deseni ızgaraya yazar.
 * @param {number} cols,rows ızgara boyutu
 * @param {string} key PATTERNS anahtarı
 * @param {object} opts { scale, angle, detail, seed } — hepsi 0..1
 */
export function renderPattern(cols, rows, key, opts = {}) {
  const desen = PATTERNS[key] || PATTERNS.dalga;
  const {
    scale = 0.5, angle = 0, detail = 0.5, seed = 0.5,
  } = opts;
  const p = {
    scale: Math.min(1, Math.max(0, scale)),
    angle: angle * Math.PI,
    detail: Math.min(1, Math.max(0, detail)),
    seed: seed * Math.PI * 2,
    seedInt: Math.round(seed * 100000) | 0,
  };

  const g = makeGrid(cols, rows);
  for (let y = 0; y < rows; y++) {
    const v = rows > 1 ? y / (rows - 1) : 0.5;
    for (let x = 0; x < cols; x++) {
      const u = cols > 1 ? x / (cols - 1) : 0.5;
      const h = desen.fn(u, v, p);
      g.data[y * cols + x] = Number.isFinite(h) ? Math.min(1, Math.max(0, h)) : 0;
    }
  }
  return normalize(g);
}
