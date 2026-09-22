// HACİMSEL YENİDEN ÖRGÜLEME (voxel remesh).
//
// Neden gerekli: sadeleştirme (decimate.js) ağın YÜZEYİNİ inceltir; ağ
// bozuksa ya da inceltilemeyecek ayrıntı taşıyorsa hedefe ulaşamaz. Bir at
// heykeli modelinde ölçüldü (97.048 üçgen):
//   - 135 açık kenar (delik), 33 kenarı üç-dört yüzey paylaşıyor,
//     yüzey topolojisi ~77 kulplu (Euler karakteristiği -154);
//   - yele ve kuyrukta yüzlerce ince saç teli.
// Sadeleştirme saç tellerini ve delik kenarlarını çökertemiyor (her çökertme
// ağı yırtacağı için reddediliyor), hedefe ulaşmak için bütün bütçeyi
// GÖVDEDEN yiyordu: 1400 üçgende gövde ve bacaklar dev kıymık üçgenlere
// dönüştü, saçlar ise olduğu gibi duruyordu. Poligonal kabukta "patlamış"
// görünen tam olarak buydu.
//
// Çözüm modeli yüzey olarak değil HACİM olarak yeniden kurmaktır:
//   1. İçerisi/dışarısı: model bir voksel ızgarasına oturtulur. Her voksel
//      üç eksen boyunca ışın paritesiyle sınanır, en az ikisi "içeride"
//      derse içeridedir — bir delikten geçen ışın tek eksende yanılır, oy
//      çokluğu bunu düzeltir.
//   2. İç boşluklar doldurulur (dışarıdan ulaşılamayan her voksel içeridir).
//   3. Hacim yumuşatılır (Gauss). Yumuşatma yarıçapından ince her şey —
//      saç teli, kıl payı çıkıntı — eşik altında kalıp kaybolur. Poligonal
//      kabukta zaten bir yüzey birkaç yüz fasetle anlatılır; bu ölçekte saç
//      teli sac parçası olamaz.
//   4. Yalnızca en büyük parça tutulur: heykel tek parça kaynaklanır, havada
//      asılı kopuk kırıntılar kaynaklanamayan dikiş üretir.
//   5. Yüzey, marching tetrahedra ile çıkarılır. Kübü altı dörtyüzlüye bölen
//      Kuhn ayrışımı komşu küplerle uyumludur ve belirsiz durumu yoktur;
//      çıkan ağ HER ZAMAN kapalı ve manifold'dur (her kenar tam iki yüzey).
//
// Sonuç temiz, kapalı, düşük kulplu bir ağdır; sadeleştirme onu hedef yüzey
// sayısına sorunsuz indirir.

/** Kuhn ayrışımı: köşe indisi c = dx + 2·dy + 4·dz; 0'dan 7'ye her yol. */
const TETS = [
  [0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7],
  [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7],
];

/**
 * @param {Array} tris üçgenler
 * @param {object} opts
 *   resolution  uzun kenar boyunca voksel sayısı
 *   smooth      Gauss yumuşatma yarıçapı (voksel). İnce ayrıntı eşiği.
 * @returns {{tris: Array, info: object}}
 */
export function voxelRemesh(tris, opts = {}) {
  const res = Math.max(8, Math.round(opts.resolution ?? 64));
  const sigma = Math.max(0, opts.smooth ?? 1);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const p of t) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
    }
  }
  const boyut = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(boyut > 0)) return { tris: [], info: { resolution: res, kept: 0, removed: 0 } };

  const h = boyut / res;
  // Kenar payı: yumuşatma çekirdeği ızgaranın dışına taşmasın, dış yüzey
  // her yerde en az bir boş voksel katmanıyla çevrili olsun.
  const pad = 2 + Math.ceil(2 * sigma);
  const n = [
    Math.ceil((maxX - minX) / h) + 2 * pad,
    Math.ceil((maxY - minY) / h) + 2 * pad,
    Math.ceil((maxZ - minZ) / h) + 2 * pad,
  ];
  const o = [minX - pad * h, minY - pad * h, minZ - pad * h];
  const N = n[0] * n[1] * n[2];
  const idx = (i, j, k) => i + n[0] * (j + n[1] * k);

  // ---- 1. Parite ile içerisi/dışarısı, üç eksen oylaması ------------------
  const oy = new Uint8Array(N);
  for (let a = 0; a < 3; a++) parityAlong(tris, a, n, o, h, oy, idx);
  const ic = new Uint8Array(N);
  for (let i = 0; i < N; i++) ic[i] = oy[i] >= 2 ? 1 : 0;

  // ---- 2. Kapalı iç boşlukları doldur ------------------------------------
  // Dışarısı ızgaranın köşesinden taşkınla bulunur; ulaşılamayan boşluk iç
  // boşluktur. Doldurulmazsa heykelin İÇİNDE ikinci bir kabuk çıkar.
  const dis = new Uint8Array(N);
  const yigin = [0];
  dis[0] = 1;
  while (yigin.length) {
    const v = yigin.pop();
    const i = v % n[0], j = Math.floor(v / n[0]) % n[1], k = Math.floor(v / (n[0] * n[1]));
    const komsu = [
      i > 0 ? v - 1 : -1, i < n[0] - 1 ? v + 1 : -1,
      j > 0 ? v - n[0] : -1, j < n[1] - 1 ? v + n[0] : -1,
      k > 0 ? v - n[0] * n[1] : -1, k < n[2] - 1 ? v + n[0] * n[1] : -1,
    ];
    for (const w of komsu) {
      if (w >= 0 && !dis[w] && !ic[w]) { dis[w] = 1; yigin.push(w); }
    }
  }
  const alan = new Float32Array(N);
  for (let i = 0; i < N; i++) alan[i] = dis[i] ? 0 : 1;

  // ---- 3. Gauss yumuşatma (ayrılabilir) ----------------------------------
  if (sigma > 0) gaussBlur3(alan, n, sigma);

  // ---- 4. En büyük parçayı tut -------------------------------------------
  const { kept, removed } = keepLargest(alan, n, 0.5);

  // ---- 5. Marching tetrahedra --------------------------------------------
  const out = marchingTets(alan, n, o, h, 0.5);
  return {
    tris: out,
    info: { resolution: res, voxel: h, kept, removed, grid: n },
  };
}

/**
 * a ekseni boyunca ışınlar: her (b,c) sütununun merkezinden geçen ışının
 * yüzeyle kesiştiği noktalar toplanır, sıralanır, çiftler arası içeridir.
 * Sonuç `oy` dizisine eklenir (her eksen bir oy).
 */
function parityAlong(tris, a, n, o, h, oy, idx) {
  const b = (a + 1) % 3, c = (a + 2) % 3;
  const nb = n[b], nc = n[c];
  const sutun = new Array(nb * nc);
  // Işınlar voksel merkezlerinden, çok küçük ve eşit olmayan bir kaydırmayla
  // geçer; tam bir köşe ya da kenardan geçen ışın aynı kesişimi iki kez
  // sayıp pariteyi bozmasın.
  const kb = 0.5 + 1.37e-4, kc = 0.5 + 2.91e-4;
  for (const t of tris) {
    const pb0 = (t[0][b] - o[b]) / h, pc0 = (t[0][c] - o[c]) / h;
    const pb1 = (t[1][b] - o[b]) / h, pc1 = (t[1][c] - o[c]) / h;
    const pb2 = (t[2][b] - o[b]) / h, pc2 = (t[2][c] - o[c]) / h;
    const d = (pc1 - pc2) * (pb0 - pb2) + (pb2 - pb1) * (pc0 - pc2);
    if (Math.abs(d) < 1e-14) continue;       // ışına paralel üçgen
    const jb0 = Math.max(0, Math.ceil(Math.min(pb0, pb1, pb2) - kb));
    const jb1 = Math.min(nb - 1, Math.floor(Math.max(pb0, pb1, pb2) - kb));
    const jc0 = Math.max(0, Math.ceil(Math.min(pc0, pc1, pc2) - kc));
    const jc1 = Math.min(nc - 1, Math.floor(Math.max(pc0, pc1, pc2) - kc));
    for (let jc = jc0; jc <= jc1; jc++) {
      const y = jc + kc;
      for (let jb = jb0; jb <= jb1; jb++) {
        const x = jb + kb;
        const l0 = ((pc1 - pc2) * (x - pb2) + (pb2 - pb1) * (y - pc2)) / d;
        const l1 = ((pc2 - pc0) * (x - pb2) + (pb0 - pb2) * (y - pc2)) / d;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const z = l0 * t[0][a] + l1 * t[1][a] + l2 * t[2][a];
        const s = jb + nb * jc;
        (sutun[s] ||= []).push((z - o[a]) / h);
      }
    }
  }
  const ijk = [0, 0, 0];
  for (let jc = 0; jc < nc; jc++) {
    for (let jb = 0; jb < nb; jb++) {
      const liste = sutun[jb + nb * jc];
      if (!liste || liste.length < 2) continue;
      liste.sort((p, q) => p - q);
      ijk[b] = jb; ijk[c] = jc;
      for (let m = 0; m + 1 < liste.length; m += 2) {
        // Merkezi [giriş, çıkış] aralığında kalan vokseller içeridedir.
        const i0 = Math.max(0, Math.ceil(liste[m] - 0.5));
        const i1 = Math.min(n[a] - 1, Math.floor(liste[m + 1] - 0.5));
        for (let i = i0; i <= i1; i++) {
          ijk[a] = i;
          oy[idx(ijk[0], ijk[1], ijk[2])]++;
        }
      }
    }
  }
}

function gaussBlur3(f, n, sigma) {
  const r = Math.max(1, Math.ceil(2 * sigma));
  const w = [];
  let top = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); w.push(v); top += v; }
  for (let i = 0; i < w.length; i++) w[i] /= top;
  const adim = [1, n[0], n[0] * n[1]];
  const tmp = new Float32Array(Math.max(n[0], n[1], n[2]));
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const s = adim[a], len = n[a];
    for (let jc = 0; jc < n[c]; jc++) {
      for (let jb = 0; jb < n[b]; jb++) {
        const bas = jb * adim[b] + jc * adim[c];
        for (let i = 0; i < len; i++) {
          let acc = 0;
          for (let q = -r; q <= r; q++) {
            const ii = i + q;
            if (ii >= 0 && ii < len) acc += w[q + r] * f[bas + ii * s];
          }
          tmp[i] = acc;
        }
        for (let i = 0; i < len; i++) f[bas + i * s] = tmp[i];
      }
    }
  }
}

/**
 * Eşiğin üstündeki vokselleri 26-komşulukla parçalara ayırır; en büyüğü
 * dışındakileri sıfırlar. 26-komşuluk, marching tetrahedra'nın köşeden
 * değen iki bölgeyi birleştirebilmesiyle uyumlu olsun diye.
 * @returns {{kept:number, removed:number}} voksel sayıları
 */
function keepLargest(f, n, iso) {
  const N = f.length;
  const etiket = new Int32Array(N);
  const boylar = [0];
  const yigin = [];
  for (let s = 0; s < N; s++) {
    if (etiket[s] || f[s] <= iso) continue;
    const id = boylar.length;
    let say = 0;
    etiket[s] = id;
    yigin.push(s);
    while (yigin.length) {
      const v = yigin.pop();
      say++;
      const i = v % n[0], j = Math.floor(v / n[0]) % n[1], k = Math.floor(v / (n[0] * n[1]));
      for (let dk = -1; dk <= 1; dk++) {
        const kk = k + dk; if (kk < 0 || kk >= n[2]) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj; if (jj < 0 || jj >= n[1]) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di; if (ii < 0 || ii >= n[0]) continue;
            const w = ii + n[0] * (jj + n[1] * kk);
            if (!etiket[w] && f[w] > iso) { etiket[w] = id; yigin.push(w); }
          }
        }
      }
    }
    boylar.push(say);
  }
  let enIyi = 0;
  for (let id = 1; id < boylar.length; id++) if (boylar[id] > (boylar[enIyi] || 0)) enIyi = id;
  let removed = 0;
  for (let s = 0; s < N; s++) {
    if (etiket[s] && etiket[s] !== enIyi) { f[s] = Math.min(f[s], iso * 0.5); removed++; }
  }
  return { kept: boylar[enIyi] || 0, removed };
}

/**
 * Marching tetrahedra. Izgara noktası (i,j,k) voksel merkezidir. İçerisi
 * f > iso. Aynı ızgara kenarı üzerindeki kesişim noktası tek bir köşe olarak
 * paylaşılır (aynı dizi nesnesi) — sonraki kaynaklama adımları tam eşleşme
 * bulsun, ağ su geçirmez kalsın.
 */
function marchingTets(f, n, o, h, iso) {
  const nx = n[0], nxy = n[0] * n[1];
  const koseler = new Map();
  const nokta = (ga, gb) => {
    const key = ga < gb ? ga * f.length + gb : gb * f.length + ga;
    let p = koseler.get(key);
    if (p) return p;
    const fa = f[ga] - iso, fb = f[gb] - iso;
    const t = fa / (fa - fb);
    const ax = ga % nx, ay = Math.floor(ga / nx) % n[1], az = Math.floor(ga / nxy);
    const bx = gb % nx, by = Math.floor(gb / nx) % n[1], bz = Math.floor(gb / nxy);
    p = [
      o[0] + (ax + 0.5 + t * (bx - ax)) * h,
      o[1] + (ay + 0.5 + t * (by - ay)) * h,
      o[2] + (az + 0.5 + t * (bz - az)) * h,
    ];
    koseler.set(key, p);
    return p;
  };
  const merkez = (g) => [g % nx, Math.floor(g / nx) % n[1], Math.floor(g / nxy)];
  const out = [];
  // Üçgen, içeriden dışarıya bakan normalle eklenir.
  const ekle = (p, q, r, icG, disG) => {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const nxx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nzz = ux * vy - uy * vx;
    const a = merkez(icG), b = merkez(disG);
    const d = nxx * (b[0] - a[0]) + nyy * (b[1] - a[1]) + nzz * (b[2] - a[2]);
    out.push(d >= 0 ? [p, q, r] : [p, r, q]);
  };

  const kose = new Int32Array(8);
  for (let k = 0; k < n[2] - 1; k++) {
    for (let j = 0; j < n[1] - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const g0 = i + nx * j + nxy * k;
        let ici = 0;
        for (let c = 0; c < 8; c++) {
          const g = g0 + (c & 1) + ((c >> 1) & 1) * nx + ((c >> 2) & 1) * nxy;
          kose[c] = g;
          if (f[g] > iso) ici++;
        }
        if (ici === 0 || ici === 8) continue;
        for (const tet of TETS) {
          const icler = [], dislar = [];
          for (const c of tet) (f[kose[c]] > iso ? icler : dislar).push(kose[c]);
          if (icler.length === 0 || dislar.length === 0) continue;
          if (icler.length === 1 || dislar.length === 1) {
            const tek = icler.length === 1 ? icler[0] : dislar[0];
            const uc = icler.length === 1 ? dislar : icler;
            const [p, q, r] = uc.map((g) => nokta(tek, g));
            ekle(p, q, r, icler[0], dislar[0]);
          } else {
            const [i0, i1] = icler, [o0, o1] = dislar;
            const A = nokta(i0, o0), B = nokta(i0, o1), C = nokta(i1, o1), D = nokta(i1, o0);
            ekle(A, B, C, i0, o0);
            ekle(A, C, D, i0, o0);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Ağın sağlığı: kaç açık kenar (delik), kaç çakışık kenar (üç ve daha fazla
 * yüzey), Euler karakteristiği. Otomatik onarım kararı buna dayanır.
 *
 * Eşikler ölçümle seçildi:
 *   - Yapay zekâ ile üretilmiş temiz bir modelde 6 açık kenar vardı;
 *     doğrudan sadeleştirme iyi sonuç verdi, onarım ise ince bacakları
 *     yumuşatıp sildi. Birkaç açık kenar zararsızdır.
 *   - Bozuk at modelinde 135 açık + 33 çakışık kenar, Euler -154 (~77
 *     kulp) vardı; doğrudan sadeleştirme gövdeyi parçaladı.
 * @returns {{openEdges:number, nonManifold:number, euler:number, bozuk:boolean}}
 */
export function meshHealth(tris) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const p of t) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
    }
  }
  const tol = 1e-6 * (Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1);
  const kose = new Map();
  const nesne = new Map();
  const no = (p) => {
    let i = nesne.get(p);
    if (i !== undefined) return i;
    const k = `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)},${Math.round(p[2] / tol)}`;
    i = kose.get(k);
    if (i === undefined) { i = kose.size; kose.set(k, i); }
    nesne.set(p, i);
    return i;
  };
  const kenar = new Map();
  let yuz = 0;
  for (const t of tris) {
    const a = no(t[0]), b = no(t[1]), c = no(t[2]);
    if (a === b || b === c || a === c) continue;
    yuz++;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = x < y ? x * 4294967296 + y : y * 4294967296 + x;
      kenar.set(k, (kenar.get(k) || 0) + 1);
    }
  }
  let openEdges = 0, nonManifold = 0;
  for (const n of kenar.values()) {
    if (n === 1) openEdges++;
    else if (n > 2) nonManifold++;
  }
  const euler = kose.size - kenar.size + yuz;
  const bozuk = openEdges + nonManifold > Math.max(20, kenar.size * 0.0005) || euler < -20;
  return { openEdges, nonManifold, euler, bozuk };
}
