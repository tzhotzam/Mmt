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

/** Sıralı sözde-rastgele üreteç (mulberry32) — hazırlık aşamasında kullanılır. */
function rng32(seed) {
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
 * Metni sayısal tohuma çevirir (FNV-1a).
 *
 * Müşterinin adı, tarih, ne yazılırsa — aynı metin hep aynı deseni verir.
 * "Bu desen sizin isminizden üretildi" diyebilmek için gerekli; ayrıca altı
 * ay sonra aynı paneli yeniden üretmeyi garanti eder.
 */
export function textSeed(text) {
  let h = 0x811c9dc5;
  const s2 = String(text || '');
  for (let i = 0; i < s2.length; i++) {
    h ^= s2.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** Dalga biçimleri — hepsi t (radyan) alır, 0..1 döner. */
const DALGA_BICIMLERI = {
  sinus: (t) => 0.5 + 0.5 * Math.sin(t),
  ucgen: (t) => {
    const x = ((t / (Math.PI * 2)) % 1 + 1) % 1;
    return x < 0.5 ? x * 2 : 2 - x * 2;
  },
  sirt: (t) => Math.abs(Math.sin(t)),          // keskin vadiler
  testere: (t) => ((t / (Math.PI * 2)) % 1 + 1) % 1,  // keskin tepeler
};
const BICIM_ADLARI = Object.keys(DALGA_BICIMLERI);

function rotate(u, v, angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [u * c - v * s, u * s + v * c];
}

// ----------------------------------------------------------------- DESENLER

export const PATTERNS = {
  dalga: {
    label: 'Dalga',
    hint: 'Klasik parametrik dalga paneli. Rastgele düğmesi dalganın yapısını '
      + 'baştan kurar: kaç katman, hangi biçim, nasıl birleşiyor.',
    /**
     * Dalga sadece bir sinüs değil, TOHUMDAN KURULAN bir formül.
     *
     * Tohum yalnızca fazı kaydırsaydı her rastgelede aynı dalganın ötelenmiş
     * hâli çıkardı. Bunun yerine katman sayısı, her katmanın biçimi (sinüs /
     * üçgen / sırt / testere), açısı, frekansı, birleşme biçimi ve alan
     * bükülmesi tohumdan türetiliyor — aynı ayarlarla bile baştan başka bir
     * desen çıkıyor.
     */
    prepare: (p) => {
      const r = rng32(p.seedInt || 1);
      const katmanSayisi = 1 + Math.floor(r() * 3);
      const katmanlar = [];
      for (let i = 0; i < katmanSayisi; i++) {
        katmanlar.push({
          frekans: (3 + p.scale * 20) * (i === 0 ? 1 : 0.35 + r() * 1.6),
          aci: p.angle + (r() - 0.5) * (0.25 + p.detail * 2.4),
          faz: r() * Math.PI * 2,
          genlik: (i === 0 ? 1 : 0.35 + r() * 0.5),
          bicim: BICIM_ADLARI[Math.floor(r() * BICIM_ADLARI.length)],
        });
      }
      return {
        katmanlar,
        // Alan bükülmesi: koordinatlar gürültüyle kaydırılır, dalga akar.
        bukme: r() < 0.65 ? (0.15 + r() * 0.85) * p.detail : 0,
        bukmeFrekansi: 1 + r() * 3,
        birlesim: ['topla', 'carp', 'enbuyuk', 'modulasyon'][Math.floor(r() * 4)],
        zarf: ['yok', 'yok', 'merkez', 'kosegen'][Math.floor(r() * 4)],
        zarfAci: r() * Math.PI,
      };
    },
    fn: (u, v, p, st) => {
      let uu = u - 0.5;
      let vv = v - 0.5;
      if (st.bukme > 0) {
        const f = st.bukmeFrekansi;
        uu += (fbm(u * f, v * f, p.seedInt + 11, 3) - 0.5) * st.bukme;
        vv += (fbm(u * f + 5.7, v * f - 3.1, p.seedInt + 29, 3) - 0.5) * st.bukme;
      }

      let deger = st.birlesim === 'carp' ? 1 : st.birlesim === 'enbuyuk' ? 0 : 0;
      let agirlik = 0;
      let modFaz = 0;

      for (const k of st.katmanlar) {
        const [x] = rotate(uu, vv, k.aci);
        const t = x * k.frekans + k.faz + modFaz;
        const h = DALGA_BICIMLERI[k.bicim](t);
        if (st.birlesim === 'carp') deger *= 0.35 + 0.65 * h;
        else if (st.birlesim === 'enbuyuk') deger = Math.max(deger, h * k.genlik);
        else if (st.birlesim === 'modulasyon') {
          // Her katman bir sonrakinin fazını sürüyor — girift dalgalar.
          deger = h;
          modFaz += (h - 0.5) * 6 * k.genlik;
        } else {
          deger += h * k.genlik;
          agirlik += k.genlik;
        }
      }
      if (st.birlesim === 'topla') deger = agirlik > 0 ? deger / agirlik : deger;

      if (st.zarf === 'merkez') {
        deger *= 1 - Math.min(1, Math.hypot(uu, vv) * 1.6) * 0.75;
      } else if (st.zarf === 'kosegen') {
        const [e] = rotate(uu, vv, st.zarfAci);
        deger *= 0.3 + 0.7 * (e + 0.5);
      }
      return deger;
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

  // Hazırlık bir kez çalışır: desenin yapısı (katmanlar, birleşim biçimi)
  // tohumdan burada kurulur, piksel döngüsünde değil.
  const st = desen.prepare ? desen.prepare(p) : null;

  const g = makeGrid(cols, rows);
  for (let y = 0; y < rows; y++) {
    const v = rows > 1 ? y / (rows - 1) : 0.5;
    for (let x = 0; x < cols; x++) {
      const u = cols > 1 ? x / (cols - 1) : 0.5;
      const h = desen.fn(u, v, p, st);
      g.data[y * cols + x] = Number.isFinite(h) ? Math.min(1, Math.max(0, h)) : 0;
    }
  }
  return normalize(g);
}

// ------------------------------------------------------------- DESEN KODU

/**
 * Tüm desen ayarlarını kısa bir koda çevirir.
 *
 * Müşteri bir deseni onayladığında altı ay sonra aynısını yeniden üretmek
 * gerekir. JSON dosyası da bunu yapar ama telefonda kod okumak/yazmak daha
 * pratiktir: "DALGA.50.10.50.F7K2P" tek satırda paylaşılır.
 */
export function encodePatternCode(key, opts = {}) {
  const yuzde = (v) => String(Math.round(Math.min(1, Math.max(0, v ?? 0)) * 100)).padStart(2, '0');
  const tohum = Math.round(Math.min(1, Math.max(0, opts.seed ?? 0)) * 1e9)
    .toString(36).toUpperCase();
  return [
    (PATTERNS[key] ? key : PATTERN_KEYS[0]).toUpperCase(),
    yuzde(opts.scale), yuzde(opts.angle), yuzde(opts.detail), tohum,
  ].join('.');
}

/**
 * Kodu ayarlara çevirir. Bozuk kodda null döner — kullanıcı yazarken
 * her tuşta desen bozulmasın diye çağıran taraf bunu sessizce yok sayabilir.
 */
export function decodePatternCode(code) {
  const parcalar = String(code || '').trim().toUpperCase().split('.');
  if (parcalar.length !== 5) return null;
  const [ad, s, a, d, t] = parcalar;
  const key = ad.toLowerCase();
  if (!PATTERNS[key]) return null;

  const sayi = (x) => {
    if (!/^\d{1,3}$/.test(x)) return null;
    const n = Number(x);
    return n >= 0 && n <= 100 ? n / 100 : null;
  };
  const scale = sayi(s), angle = sayi(a), detail = sayi(d);
  if (scale === null || angle === null || detail === null) return null;
  if (!/^[0-9A-Z]{1,7}$/.test(t)) return null;

  const seed = parseInt(t, 36) / 1e9;
  if (!Number.isFinite(seed) || seed < 0 || seed > 1) return null;
  return { key, scale, angle, detail, seed };
}
