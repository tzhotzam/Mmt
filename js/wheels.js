// TEKERLEK ÇIKARMA — araba modelinden tekerlekleri ayırır.
//
// Dilimli araba heykellerinde tekerlek çoğu zaman gövdeden ayrı yapılır
// (krom boru halkası, torna parça, üst üste diskler); gövde dilimlerinde
// yalnız çamurluk boşluğu kalır. Tekerlek gövdeyle birlikte dilimlenirse
// zarf onarımı onu gövdeye kaynatır ve araba yere oturmuş bir blok gibi
// görünür.
//
// İnternetten inen araba modellerinde her lastik ayrı bir bağlı parçadır;
// jant, fren diski, kaliper, bijon da ayrı parçalardır ve lastiğin silindiri
// içinde dururlar. Yöntem:
//   1. Ağ, ortak köşelerden bağlı parçalara ayrılır.
//   2. Lastik adayı: kutusunun iki kenarı neredeyse eşit (çap), üçüncüsü
//      çapın %20–75'i (genişlik), tekerlek ekseni yataydır ve model
//      tabanına değer.
//   3. Kutusu bir lastik silindirinin içinde kalan her parça (jant, disk,
//      kaliper) tekerlekle birlikte çıkarılır.
//
// Model eksenleri: `up` dik eksen ('x' | 'y' | 'z'); dikCevir'den ÖNCEKİ ham
// koordinatlarda çalışır.

const EKSEN = { x: 0, y: 1, z: 2 };

/** Köşeleri ortak olan üçgenleri bağlı parçalara ayırır. @returns {Int32Array} üçgen → parça no */
export function bagliParcalar(tris) {
  const n = tris.length;
  // Köşe kimliği: koordinatlar ızgaraya yuvarlanır, açık adresli karma tablo.
  let minK = Infinity, maxK = -Infinity;
  for (const t of tris) for (const p of t) for (let a = 0; a < 3; a++) {
    if (p[a] < minK) minK = p[a]; if (p[a] > maxK) maxK = p[a];
  }
  const olcek = 1e6 / Math.max(1e-9, maxK - minK);
  const kap = 1 << Math.ceil(Math.log2(n * 3 * 2 + 16));
  const tx = new Int32Array(kap), ty = new Int32Array(kap), tz = new Int32Array(kap);
  const tid = new Int32Array(kap).fill(-1);
  let say = 0;
  const kimlik = (p) => {
    const x = Math.round((p[0] - minK) * olcek), y = Math.round((p[1] - minK) * olcek), z = Math.round((p[2] - minK) * olcek);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (kap - 1);
    for (;;) {
      if (tid[h] < 0) { tx[h] = x; ty[h] = y; tz[h] = z; tid[h] = say++; return tid[h]; }
      if (tx[h] === x && ty[h] === y && tz[h] === z) return tid[h];
      h = (h + 1) & (kap - 1);
    }
  };
  const kose = new Int32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) kose[i * 3 + k] = kimlik(tris[i][k]);

  const ata = new Int32Array(say);
  for (let i = 0; i < say; i++) ata[i] = i;
  const bul = (x) => {
    let r = x;
    while (ata[r] !== r) r = ata[r];
    while (ata[x] !== r) { const s = ata[x]; ata[x] = r; x = s; }
    return r;
  };
  for (let i = 0; i < n; i++) {
    const a = bul(kose[i * 3]);
    for (let k = 1; k < 3; k++) { const b = bul(kose[i * 3 + k]); if (a !== b) ata[b] = a; }
  }
  const no = new Map();
  const parca = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = bul(kose[i * 3]);
    let id = no.get(r);
    if (id === undefined) { id = no.size; no.set(r, id); }
    parca[i] = id;
  }
  return parca;
}

/**
 * @param {Array} tris ham üçgenler
 * @param {'x'|'y'|'z'} up dik eksen
 * @returns {{tekerlekler: Array<{merkez:number[], cap:number, genislik:number, eksen:number}>,
 *            sil: Uint8Array}} sil[i] = 1 → i. üçgen tekerleğe ait
 */
export function tekerlekBul(tris, up = 'z') {
  const u = EKSEN[up] ?? 2;
  const parca = bagliParcalar(tris);
  let m = 0;
  for (let i = 0; i < parca.length; i++) if (parca[i] >= m) m = parca[i] + 1;
  const lo = new Float64Array(m * 3).fill(Infinity), hi = new Float64Array(m * 3).fill(-Infinity);
  const genel = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < tris.length; i++) {
    const c = parca[i];
    for (const p of tris[i]) for (let a = 0; a < 3; a++) {
      if (p[a] < lo[c * 3 + a]) lo[c * 3 + a] = p[a];
      if (p[a] > hi[c * 3 + a]) hi[c * 3 + a] = p[a];
      if (p[a] < genel.lo[a]) genel.lo[a] = p[a];
      if (p[a] > genel.hi[a]) genel.hi[a] = p[a];
    }
  }
  const boy = [0, 1, 2].map((a) => genel.hi[a] - genel.lo[a]);
  const yatay = [0, 1, 2].filter((a) => a !== u);

  // 2. Lastik adayları.
  const adaylar = [];
  for (let c = 0; c < m; c++) {
    const d = [0, 1, 2].map((a) => hi[c * 3 + a] - lo[c * 3 + a]);
    for (const e of yatay) {                         // tekerlek ekseni yatay
      const diger = yatay.find((a) => a !== e);
      const cap = (d[u] + d[diger]) / 2;
      if (!(cap > 0.06 * Math.max(...boy))) continue;           // kırıntı değil
      if (Math.abs(d[u] - d[diger]) > 0.06 * cap) continue;     // daire değil
      if (d[e] < 0.2 * cap || d[e] > 0.75 * cap) continue;      // disk ya da silindir
      if (lo[c * 3 + u] - genel.lo[u] > 0.08 * boy[u]) continue; // yere değmiyor
      adaylar.push({
        c, eksen: e, cap, genislik: d[e],
        merkez: [0, 1, 2].map((a) => (lo[c * 3 + a] + hi[c * 3 + a]) / 2),
      });
      break;
    }
  }
  // Araba dört (ya da daha çok) tekerlekle durur; ikiden azı tekerlek değildir.
  if (adaylar.length < 2) return { tekerlekler: [], sil: new Uint8Array(tris.length) };
  const eksen = adaylar[0].eksen;
  // Lastik ile jant ayrı parçaysa ikisi de aday olur: aynı merkezdekilerden
  // büyüğü tekerlektir.
  const tekerlekler = [];
  for (const t of adaylar.filter((a) => a.eksen === eksen).sort((a, b) => b.cap - a.cap)) {
    if (tekerlekler.some((k) => Math.hypot(...k.merkez.map((v, a) => v - t.merkez[a])) < k.cap / 4)) continue;
    tekerlekler.push(t);
  }

  // 3. Silindirin içindeki her parça tekerleğe aittir (jant, disk, kaliper).
  // Kutu köşesi değil köşe noktaları sınanır: yuvarlak jantın kutusunun
  // köşesi lastiğin dışına taşar ama kendisi içindedir.
  const W = tekerlekler.length;
  const [p, q] = [0, 1, 2].filter((a) => a !== eksen);
  const icinde = new Uint8Array(m * W).fill(1);
  for (let i = 0; i < tris.length; i++) {
    const c = parca[i];
    for (let w = 0; w < W; w++) {
      if (!icinde[c * W + w]) continue;
      const t = tekerlekler[w];
      const r = (t.cap / 2) * 1.04, yari = (t.genislik / 2) * 1.6;
      for (const v of tris[i]) {
        if (Math.abs(v[eksen] - t.merkez[eksen]) > yari
          || Math.hypot(v[p] - t.merkez[p], v[q] - t.merkez[q]) > r) { icinde[c * W + w] = 0; break; }
      }
    }
  }
  const parcaSil = new Uint8Array(m);
  for (let c = 0; c < m; c++) for (let w = 0; w < W; w++) if (icinde[c * W + w]) parcaSil[c] = 1;
  const sil = new Uint8Array(tris.length);
  for (let i = 0; i < tris.length; i++) sil[i] = parcaSil[parca[i]];
  return {
    tekerlekler: tekerlekler.map(({ merkez, cap, genislik, eksen: e }) => ({ merkez, cap, genislik, eksen: e })),
    sil,
  };
}

/** Tekerleksiz üçgen listesi ve bulunan tekerlekler. */
export function tekerlekCikar(tris, up = 'z') {
  const { tekerlekler, sil } = tekerlekBul(tris, up);
  if (!tekerlekler.length) return { tris, tekerlekler };
  return { tris: tris.filter((_, i) => !sil[i]), tekerlekler };
}
