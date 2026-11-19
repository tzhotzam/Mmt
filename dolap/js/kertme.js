// Kolon kertmesi: kolonun içine giren gövde parçalarını oyar.
//
// Kolon modül içinde bir kutu olarak gelir (mekan.js). Her parçanın 3B kutusu
// ile kesişimi parçanın ÇİZİM düzlemine (x = boy, y = en) taşınır:
//   • Kesişim parçayı bir yönde boydan boya kesiyorsa parça KISALIR (kertik
//     kenarda) ya da İKİYE BÖLÜNÜR (kertik ortada; ör. kolon arkalığı böler).
//   • Kısmi kesişim parçada bir KÖŞE/KENAR OYUĞU açar: parça dikdörtgen
//     olmaktan çıkar, kesim konturu (p.kontur) dik açılı bir çokgen olur.
// Oyuğa düşen delikler silinir; yeni kesim kenarları bantlanmaz.
// Bu dosya tarayıcıya bağlı değildir.

const EKSEN = { x: ['x', 'sx'], y: ['y', 'sy'], z: ['z', 'sz'] };

/**
 * Parçanın çizim düzlemi: çizimin x ve y'si hangi 3B eksene karşılık
 * geliyor, ters mi akıyor. Yalnız gövde içi parçalar kertilir.
 */
export function harita(p) {
  switch (p.grup) {
    case 'yan': return { x: 'y', xT: false, y: 'z', yT: !p.sol };
    case 'dikme': return { x: 'y', xT: false, y: 'z', yT: true };
    case 'tabla': case 'kusak': return { x: 'x', xT: false, y: 'z', yT: p.yuz === 'Üst yüz' };
    case 'raf': return { x: 'x', xT: false, y: 'z', yT: false };
    case 'arkalik': return { x: 'x', xT: false, y: 'y', yT: false };
    case 'cekmeceYan': return { x: 'z', xT: false, y: 'y', yT: false };
    case 'cekmeceAyna': return { x: 'x', xT: false, y: 'y', yT: false };
    case 'cekmeceTaban': return { x: 'x', xT: false, y: 'z', yT: false };
    default: return null;
  }
}

/** 3B aralığı [a, b] → çizim aralığı (ters eksende yansır). */
function cizimAraligi(p, h, eksen, a, b) {
  const [k, s] = EKSEN[h[eksen]];
  const ters = h[`${eksen}T`];
  const k0 = p.kutu[k], S = p.kutu[s];
  return ters ? [k0 + S - b, k0 + S - a] : [a - k0, b - k0];
}

/** Çizimdeki dikdörtgen → 3B kutu (parçanın kendi kutusunun bir dilimi). */
export function cizimdenKutu(p, h, r) {
  const kutu = { ...p.kutu };
  for (const [eksen, a, b] of [['x', r.x0, r.x1], ['y', r.y0, r.y1]]) {
    const [k, s] = EKSEN[h[eksen]];
    const ters = h[`${eksen}T`];
    const k0 = p.kutu[k], S = p.kutu[s];
    kutu[k] = ters ? k0 + S - b : k0 + a;
    kutu[s] = b - a;
  }
  return kutu;
}

/**
 * Modülün parçalarına kertikleri uygular.
 * @param {Array} parcalar modül parçaları (yerinde değişir)
 * @param {Array} kolonlar modül içi kolon kutuları {x0,x1,y0,y1,z0,z1}
 * @returns {Array} yeni parça listesi
 */
export function kertUygula(parcalar, kolonlar) {
  if (!kolonlar?.length) return parcalar;
  const sonuc = [];
  for (const p of parcalar) {
    const h = harita(p);
    if (!h) { sonuc.push(p); continue; }
    const kertikler = [];
    for (const c of kolonlar) {
      const k = p.kutu;
      const kes = {
        x: [Math.max(k.x, c.x0), Math.min(k.x + k.sx, c.x1)],
        y: [Math.max(k.y, c.y0), Math.min(k.y + k.sy, c.y1)],
        z: [Math.max(k.z, c.z0), Math.min(k.z + k.sz, c.z1)],
      };
      if (Object.values(kes).some(([a, b]) => b - a < 0.5)) continue;
      const [x0, x1] = cizimAraligi(p, h, 'x', ...kes[h.x]);
      const [y0, y1] = cizimAraligi(p, h, 'y', ...kes[h.y]);
      kertikler.push({ x0: kirp(x0, p.boy), x1: kirp(x1, p.boy), y0: kirp(y0, p.en), y1: kirp(y1, p.en) });
    }
    if (!kertikler.length) { sonuc.push(p); continue; }
    sonuc.push(...parcayiKert(p, h, kertikler));
  }
  return sonuc;
}

function kirp(v, ust) {
  return Math.round(Math.max(0, Math.min(ust, v)) * 10) / 10;
}

/** Bir parçayı kertiklere göre böler / kısaltır / oyar. */
function parcayiKert(p, h, kertikler) {
  const E = 0.5;
  // Boydan boya kertikler: x boyunca tam (y'de bir şerit siler) ya da y boyunca tam.
  const tamX = kertikler.filter((k) => k.x0 <= E && k.x1 >= p.boy - E);
  const tamY = kertikler.filter((k) => k.y0 <= E && k.y1 >= p.en - E);
  const kismi = kertikler.filter((k) => !tamX.includes(k) && !tamY.includes(k));
  const kalanX = aralikCikar([0, p.boy], tamY.map((k) => [k.x0, k.x1]));
  const kalanY = aralikCikar([0, p.en], tamX.map((k) => [k.y0, k.y1]));
  const parcalar = [];
  for (const [x0, x1] of kalanX) {
    for (const [y0, y1] of kalanY) {
      if (x1 - x0 < 30 || y1 - y0 < 30) continue;          // kırıntı
      parcalar.push({ x0, x1, y0, y1 });
    }
  }
  const tek = parcalar.length === 1;
  return parcalar.map((R, i) => {
    const q = altParca(p, h, R);
    if (!tek) q.ad = `${p.ad} ${i + 1}`;
    // Bu parçaya düşen kısmi kertikler, yerel koordinatta.
    q.kertikler = kismi
      .map((k) => ({ x0: Math.max(k.x0, R.x0) - R.x0, x1: Math.min(k.x1, R.x1) - R.x0, y0: Math.max(k.y0, R.y0) - R.y0, y1: Math.min(k.y1, R.y1) - R.y0 }))
      .filter((k) => k.x1 - k.x0 > E && k.y1 - k.y0 > E);
    q.kertme = true;
    // Oyuğa düşen delikleri sil.
    q.delikler = q.delikler.filter((d) => !q.kertikler.some((k) =>
      d.x > k.x0 - d.cap / 2 - 2 && d.x < k.x1 + d.cap / 2 + 2 && d.y > k.y0 - d.cap / 2 - 2 && d.y < k.y1 + d.cap / 2 + 2));
    q.kenarDelik = q.kenarDelik.filter((d) => !q.kertikler.some((k) => kenarKertikte(d, k, q)));
    if (q.kertikler.length) {
      const g = izgara(q.boy, q.en, q.kertikler);
      q.kontur = g.kontur;
      q.kutular = g.hucreler.map((r) => cizimdenKutu(q, h, r));
      // Oyuk kenarları bantlanmaz; dış kenarlardaki bant aynen kalır.
    }
    return q;
  });
}

/** Parçanın R dikdörtgenine düşen kısmı: ölçü, delik, bant, 3B kutu. */
function altParca(p, h, R) {
  const q = {
    ...p,
    boy: Math.round((R.x1 - R.x0) * 10) / 10,
    en: Math.round((R.y1 - R.y0) * 10) / 10,
    bant: {
      x0: p.bant.x0 && R.x0 <= 0.5, x1: p.bant.x1 && R.x1 >= p.boy - 0.5,
      y0: p.bant.y0 && R.y0 <= 0.5, y1: p.bant.y1 && R.y1 >= p.en - 0.5,
    },
    kutu: cizimdenKutu(p, h, R),
  };
  q.delikler = p.delikler
    .filter((d) => d.x >= R.x0 - 1e-6 && d.x <= R.x1 + 1e-6 && d.y >= R.y0 - 1e-6 && d.y <= R.y1 + 1e-6)
    .map((d) => ({ ...d, x: d.x - R.x0, y: d.y - R.y0 }));
  q.kenarDelik = p.kenarDelik.filter((d) => {
    if (d.kenar === 'x0') return R.x0 <= 0.5 && d.konum >= R.y0 && d.konum <= R.y1;
    if (d.kenar === 'x1') return R.x1 >= p.boy - 0.5 && d.konum >= R.y0 && d.konum <= R.y1;
    if (d.kenar === 'y0') return R.y0 <= 0.5 && d.konum >= R.x0 && d.konum <= R.x1;
    return R.y1 >= p.en - 0.5 && d.konum >= R.x0 && d.konum <= R.x1;
  }).map((d) => ({ ...d, konum: d.kenar[0] === 'x' ? d.konum - R.y0 : d.konum - R.x0 }));
  return q;
}

function kenarKertikte(d, k, q) {
  if (d.kenar === 'x0') return k.x0 <= 0.5 && d.konum > k.y0 && d.konum < k.y1;
  if (d.kenar === 'x1') return k.x1 >= q.boy - 0.5 && d.konum > k.y0 && d.konum < k.y1;
  if (d.kenar === 'y0') return k.y0 <= 0.5 && d.konum > k.x0 && d.konum < k.x1;
  return k.y1 >= q.en - 0.5 && d.konum > k.x0 && d.konum < k.x1;
}

/** [a, b] aralığından alt aralıkları çıkar. */
function aralikCikar([a, b], cik) {
  let kalan = [[a, b]];
  for (const [c, d] of cik) {
    const yeni = [];
    for (const [p, q] of kalan) {
      if (d <= p || c >= q) { yeni.push([p, q]); continue; }
      if (c > p) yeni.push([p, c]);
      if (d < q) yeni.push([d, q]);
    }
    kalan = yeni;
  }
  return kalan;
}

/**
 * Dikdörtgenden kertikler çıkınca kalan bölge: dolu hücreler ve dış
 * kontur (saat yönü tersine, dik açılı çokgen).
 */
export function izgara(boy, en, kertikler) {
  const xs = [...new Set([0, boy, ...kertikler.flatMap((k) => [k.x0, k.x1])])].filter((v) => v >= 0 && v <= boy).sort((a, b) => a - b);
  const ys = [...new Set([0, en, ...kertikler.flatMap((k) => [k.y0, k.y1])])].filter((v) => v >= 0 && v <= en).sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  const dolu = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return !kertikler.some((k) => cx > k.x0 && cx < k.x1 && cy > k.y0 && cy < k.y1);
  };
  const hucreler = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (dolu(i, j)) hucreler.push({ x0: xs[i], x1: xs[i + 1], y0: ys[j], y1: ys[j + 1] });
  // Sınır kenarları: dolu hücrenin dolu olmayan komşusuna bakan kenarı, dolu taraf solda.
  const kenarlar = new Map();
  const ekle = (a, b) => kenarlar.set(`${a[0]},${a[1]}`, b);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!dolu(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (!dolu(i, j - 1)) ekle([x0, y0], [x1, y0]);
      if (!dolu(i + 1, j)) ekle([x1, y0], [x1, y1]);
      if (!dolu(i, j + 1)) ekle([x1, y1], [x0, y1]);
      if (!dolu(i - 1, j)) ekle([x0, y1], [x0, y0]);
    }
  }
  // Zinciri izle (en dış halka; kertikler kenara değdiği için tek halka çıkar).
  const bas = [...kenarlar.keys()].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  const kontur = [];
  let p = bas;
  for (let n = 0; n < 4 * (nx + 1) * (ny + 1) + 4; n++) {
    kontur.push(p);
    const q = kenarlar.get(`${p[0]},${p[1]}`);
    if (!q || (q[0] === bas[0] && q[1] === bas[1])) break;
    p = q;
  }
  // Doğrusal ara noktaları at.
  const sade = kontur.filter((v, i) => {
    const a = kontur[(i - 1 + kontur.length) % kontur.length], b = kontur[(i + 1) % kontur.length];
    return !((a[0] === v[0] && v[0] === b[0]) || (a[1] === v[1] && v[1] === b[1]));
  });
  return { kontur: sade, hucreler };
}

/**
 * Dik açılı çokgeni (saat yönü tersine) dışa doğru r kadar kaydır: her kenar
 * kendi normali yönünde ötelenir, ardışık kenarların kesişimi yeni köşedir.
 * İç köşelerde freze yarıçapı kadar köşe kalır (dolap için sorun değil).
 */
export function poligonOfset(poli, r) {
  const n = poli.length;
  const kenar = [];
  for (let i = 0; i < n; i++) {
    const a = poli[i], b = poli[(i + 1) % n];
    const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
    // Saat yönü tersinde dış normal: (dy, -dx)
    kenar.push({ a: [a[0] + dy * r, a[1] - dx * r], yatay: dy === 0 });
  }
  const sonuc = [];
  for (let i = 0; i < n; i++) {
    const o = kenar[(i - 1 + n) % n], k = kenar[i];
    // Biri yatay biri dikey: köşe = (dikeyin x'i, yatayın y'si)
    const x = o.yatay ? k.a[0] : o.a[0];
    const y = o.yatay ? o.a[1] : k.a[1];
    sonuc.push([x, y]);
  }
  return sonuc;
}

/**
 * Parçanın KESİM konturu, kesim koordinatında (bant düşülmüş), saat yönü
 * tersine. Kertilmemiş parçada dikdörtgen.
 */
export function kesimKonturu(p) {
  if (!p.kontur) return [[0, 0], [p.kesimBoy, 0], [p.kesimBoy, p.kesimEn], [0, p.kesimEn]];
  const k = (v, ust) => Math.max(0, Math.min(ust, v));
  return p.kontur.map(([x, y]) => [k(x - p.dx, p.kesimBoy), k(y - p.dy, p.kesimEn)]);
}
