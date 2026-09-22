// DİLİMLEME — kapalı bir 3B modeli paralel düzlemlerle keser.
//
// Her düzlemin kesiti bir veya birden çok kapalı halkadır; bunlar levhadan
// kesilip mile dizilince heykel ortaya çıkar. Lamel modundan farkı: orada
// kesit tek bir yükseklik EĞRİSİYDİ (2,5B), burada modelin gerçek kesiti
// alınır, yani oturan bir figürün bacakları ayrı ayrı halka olarak çıkar.
//
// Yöntem: her üçgenin düzlemle ARA KESİTİ bir doğru parçasıdır. Parçalar
// toplanır, uç noktaları eşleştirilerek kapalı halkalara dikilir.
//
// Köşe tam düzleme denk gelirse ara kesit dejenere olur (nokta ya da tüm
// kenar). Standart çözüm: düzlemi çok küçük bir miktar kaydırmak. Ölçüye
// etkisi mikron mertebesindedir, ama dikişi tahmin edilebilir kılar.

const AXES = { x: 0, y: 1, z: 2 };

/** Eksene dik düzlemde hangi iki eksen "u" ve "v" olur? */
function planeAxes(ai) {
  if (ai === 0) return [1, 2];   // x boyunca dilim → düzlem (y, z)
  if (ai === 1) return [0, 2];   // y boyunca dilim → düzlem (x, z)
  return [0, 1];                 // z boyunca dilim → düzlem (x, y)
}

export function meshBounds(tris) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const p of t) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < lo[k]) lo[k] = p[k];
        if (p[k] > hi[k]) hi[k] = p[k];
      }
    }
  }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

/**
 * Tek bir düzlemin kesitini doğru parçaları olarak döner.
 * @returns {Array<[[number,number],[number,number]]>}
 */
export function crossSectionSegments(tris, ai, c) {
  const [au, av] = planeAxes(ai);
  const segs = [];
  for (const t of tris) {
    const d = [t[0][ai] - c, t[1][ai] - c, t[2][ai] - c];
    // Tamamı bir tarafta ise kesişme yok.
    if ((d[0] > 0 && d[1] > 0 && d[2] > 0) || (d[0] < 0 && d[1] < 0 && d[2] < 0)) continue;

    const hits = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const di = d[i], dj = d[j];
      if ((di > 0 && dj > 0) || (di < 0 && dj < 0)) continue;
      if (di === dj) continue;                 // kenar düzleme paralel
      const s = di / (di - dj);
      if (s < 0 || s > 1) continue;
      const a = t[i], b = t[j];
      hits.push([a[au] + (b[au] - a[au]) * s, a[av] + (b[av] - a[av]) * s]);
    }
    if (hits.length < 2) continue;
    const [p, q] = hits;
    if (Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12) continue;

    // Halkanın yönü modelin dışını göstersin diye üçgenin normaline bakılır:
    // parçayı, normalin düzlemdeki izdüşümü SOLDA kalacak şekilde yönlendir.
    const n = faceNormal(t);
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const cross = dx * n[av] - dy * n[au];
    segs.push(cross > 0 ? [q, p] : [p, q]);
  }
  return segs;
}

function faceNormal(t) {
  const ux = t[1][0] - t[0][0], uy = t[1][1] - t[0][1], uz = t[1][2] - t[0][2];
  const vx = t[2][0] - t[0][0], vy = t[2][1] - t[0][1], vz = t[2][2] - t[0][2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * Doğru parçalarını kapalı halkalara diker.
 *
 * Uç noktalar nicemlenmiş anahtarla eşleştirilir; kayan nokta hatası yüzünden
 * birebir eşitlik aranamaz. Kapanmayan zincirler AÇIK kabul edilir ve ayrıca
 * döner — model kapalı bir hacim değilse kullanıcıya söylemek gerekir.
 *
 * @returns {{rings: Array, open: number}}
 */
export function stitchSegments(segs, tol = 0.01) {
  const key = (p) => `${Math.round(p[0] / tol)}_${Math.round(p[1] / tol)}`;
  const baslar = new Map();            // anahtar → parça indisleri (başlangıç ucu)
  segs.forEach((s, i) => {
    const k = key(s[0]);
    let l = baslar.get(k);
    if (!l) baslar.set(k, (l = []));
    l.push(i);
  });

  const used = new Array(segs.length).fill(false);
  const rings = [];
  let open = 0;

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const ring = [segs[i][0]];
    let cur = segs[i][1];
    const bas = key(segs[i][0]);

    for (let adim = 0; adim < segs.length + 1; adim++) {
      if (key(cur) === bas) break;                 // halka kapandı
      const aday = (baslar.get(key(cur)) || []).find((j) => !used[j]);
      if (aday === undefined) { open++; break; }   // zincir açık kaldı
      used[aday] = true;
      ring.push(cur);
      cur = segs[aday][1];
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return { rings, open };
}

/**
 * Modeli baştan sona dilimler.
 *
 * @param {Array} tris üçgenler
 * @param {object} opts
 *   axis     'x' | 'y' | 'z'  — dilimlerin DİZİLDİĞİ eksen
 *   pitch    iki dilim ortası arası (mm) = kalınlık + boşluk
 *   tol      dikiş toleransı (mm)
 * @returns {{layers: Array<{index, coord, rings, open}>, bounds, pitch, count}}
 */
export function sliceMesh(tris, opts = {}) {
  const { axis = 'z', pitch = 24, tol = 0.01, maxLayers = 400 } = opts;
  const ai = AXES[axis] ?? 2;
  const bounds = meshBounds(tris);
  const lo = bounds.lo[ai];
  const hi = bounds.hi[ai];
  const uzunluk = hi - lo;
  if (!(uzunluk > 0) || !(pitch > 0)) return { layers: [], bounds, pitch, count: 0 };

  const n = Math.min(maxLayers, Math.max(1, Math.floor(uzunluk / pitch)));
  // Dilimler modele ortalanır; iki uçta eşit pay kalır.
  const bosluk = (uzunluk - (n - 1) * pitch) / 2;

  // Düzlemi tepe noktalarından kaçır: tam köşeye denk gelen düzlem dejenere
  // ara kesit üretir ve dikiş kopar.
  const kacis = Math.max(1e-6, uzunluk * 1e-7);

  const layers = [];
  for (let i = 0; i < n; i++) {
    const coord = lo + bosluk + i * pitch + kacis;
    const segs = crossSectionSegments(tris, ai, coord);
    const { rings, open } = stitchSegments(segs, tol);
    layers.push({ index: i, coord, rings, open });
  }
  return { layers, bounds, pitch, count: n, axis, axisIndex: ai };
}
