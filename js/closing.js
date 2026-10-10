// KESİT SADELEŞTİRME — dilim kesitine morfolojik kapanış uygular.
//
// Ayrıntılı modellerde (araba ızgarası, jant kolları, hava girişleri, ayna
// sapı) kesit, gövdenin yanında bir sürü dar yarık, delik ve kırıntı ada
// taşır. Aralıklı dilimde bunlar ya havada kalan küçük parça olur ya da
// dilimin kenarını tırtıklı gösterir; elle yapılan parametrik heykellerde
// bu ayrıntı zaten yoktur, silüet temizdir.
//
// Kapanış = önce r kadar şişir, sonra r kadar daralt. Genişliği 2r'den dar
// yarık ve delikler kapanır, gövdeye 2r'den yakın kırıntılar gövdeye
// kaynar, iç köşeler r yarıçapla yuvarlanır; dış hat ve büyük boşluklar
// (kabin, tekerlek davlumbazı) olduğu gibi kalır.
//
// Çokgen birleşimi yerine ızgarada yapılır: kesit tarama çizgisiyle
// doldurulur, iki geçişli tam Öklid uzaklık dönüşümüyle şişirilip
// daraltılır, sonra uzaklık alanı Marching Squares ile hücre altı
// hassasiyette yeniden halkaya çevrilir.

import { contourRings } from './marchingsquares.js';

const SONSUZ = 1e20;

/** Tek boyutlu kare uzaklık dönüşümü (Felzenszwalb–Huttenlocher). */
export function edt1(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -SONSUZ; z[1] = SONSUZ;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const r = v[k];
      s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
      if (s <= z[k]) { k--; continue; }
      break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = SONSUZ;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + f[r];
  }
}

/**
 * Hedef hücrelere (hedef[i] = 1) olan kare Öklid uzaklığı, hücre biriminde.
 * @returns {Float64Array}
 */
export function kareUzaklik(hedef, w, h) {
  const D = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) D[i] = hedef[i] ? 0 : SONSUZ;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = D[y * w + x];
    edt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) D[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = D[y * w + x];
    edt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) D[y * w + x] = d[x];
  }
  return D;
}

/** Halkaları çift-tek kuralıyla ızgaraya doldurur (delikler kendiliğinden boş kalır). */
function doldur(rings, x0, y0, c, w, h) {
  const ic = new Uint8Array(w * h);
  const kes = [];
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) * c;
    kes.length = 0;
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if ((a[1] <= y) === (b[1] <= y)) continue;
        kes.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    kes.sort((p, q) => p - q);
    for (let k = 0; k + 1 < kes.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((kes[k] - x0) / c - 0.5));
      const i1 = Math.min(w - 1, Math.floor((kes[k + 1] - x0) / c - 0.5));
      for (let i = i0; i <= i1; i++) ic[j * w + i] = 1;
    }
  }
  return ic;
}

/**
 * @param {Array<Array<[number,number]>>} rings kesitin bütün halkaları (dış + delik)
 * @param {number} r kapanış yarıçapı (mm)
 * @param {object} [o] { hucre: ızgara adımı (mm) — verilmezse kesit boyuna göre }
 * @returns {Array<Array<[number,number]>>} yeni halkalar (yönleri karışık;
 *   sınıflandırma çağıranın işi)
 */
export function kesitKapat(rings, r, o = {}) {
  if (!(r > 0) || !rings.length) return rings;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const boy = Math.max(maxX - minX, maxY - minY);
  // Hücre: yarıçapın en çok üçte biri; kesit en çok ~900 hücre olsun.
  const c = o.hucre || Math.min(r / 3, Math.max(0.4, boy / 900));
  const pay = r + 3 * c;
  const x0 = minX - pay, y0 = minY - pay;
  const w = Math.ceil((maxX - minX + 2 * pay) / c) + 1;
  const h = Math.ceil((maxY - minY + 2 * pay) / c) + 1;

  const ic = doldur(rings, x0, y0, c, w, h);
  const rc = r / c;
  // Şişir: içe r'den yakın her hücre içeri.
  const Dic = kareUzaklik(ic, w, h);
  const sisik = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) sisik[i] = Dic[i] <= rc * rc ? 1 : 0;
  // Daralt: şişik kümenin dışına uzaklık − r. Sıfır düzeyi kapanmış kesitin
  // kenarıdır; alan sürekli olduğu için kontur hücre basamağı taşımaz.
  const disari = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) disari[i] = sisik[i] ? 0 : 1;
  const Ddis = kareUzaklik(disari, w, h);
  const alan = { w, h, data: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) alan.data[i] = Math.sqrt(Ddis[i]) - rc;

  return contourRings(alan, 0)
    .map((ring) => ring.map(([gx, gy]) => [x0 + (gx + 0.5) * c, y0 + (gy + 0.5) * c]))
    .filter((ring) => ring.length >= 3);
}

/**
 * İÇ BOŞALTMA — parçanın içini, kenarlardan `et` kadar bant bırakarak
 * oyar (çerçeve dilim). Sac heykelde dolu dilim hem çok ağır hem çok sac
 * yer: 1,2 m'lik arabada 3 mm çelikle ~350 kg. Bant, dış hattan VE mevcut
 * deliklerden (mil deliği, kızak çentiği dış hattın parçası) ölçülür; bu
 * yüzden mil çevresinde ve kızak çentiğinin üstünde et kendiliğinden kalır.
 *
 * @param {Array} outline dış halka
 * @param {Array} holes mevcut delikler
 * @param {number} et bant genişliği (mm)
 * @param {object} [o] { minAlan: bundan küçük oyuk açılmaz (mm²) }
 * @returns {{oyuklar: Array, etiket: [number,number]|null}} yeni delikler ve
 *   bandın içinde, parçanın altına yakın bir yazı noktası
 */
export function icBosalt(outline, holes, et, o = {}) {
  const bos = { oyuklar: [], etiket: null };
  if (!(et > 0)) return bos;
  const rings = [outline, ...holes];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outline) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (Math.min(maxX - minX, maxY - minY) < 3 * et) return bos;   // oyacak yer yok
  const boy = Math.max(maxX - minX, maxY - minY);
  const c = Math.min(et / 4, Math.max(0.4, boy / 700));
  const pay = 3 * c;
  const x0 = minX - pay, y0 = minY - pay;
  const w = Math.ceil((maxX - minX + 2 * pay) / c) + 1;
  const h = Math.ceil((maxY - minY + 2 * pay) / c) + 1;
  const ic = doldur(rings, x0, y0, c, w, h);
  const disari = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) disari[i] = ic[i] ? 0 : 1;
  const D = kareUzaklik(disari, w, h);
  const alan = { w, h, data: new Float32Array(w * h) };
  // ½ hücre kaydırma: eşik √tamsayı'ya denk gelmesin.
  for (let i = 0; i < w * h; i++) alan.data[i] = Math.sqrt(D[i]) * c - et + 0.5 * c;

  const minAlan = o.minAlan ?? 4 * et * et;
  const alanOf = (r) => {
    let s = 0;
    for (let i = 0, n = r.length; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s / 2);
  };
  bos.oyuklar = contourRings(alan, 0)
    .map((ring) => ring.map(([gx, gy]) => [x0 + (gx + 0.5) * c, y0 + (gy + 0.5) * c]))
    .filter((ring) => ring.length >= 3 && alanOf(ring) >= minAlan);

  // Yazı yeri: bandın ortasında (kenardan ~et/2), alt kenara en yakın, yatayda
  // ortaya yakın nokta. Oyuk açılmadıysa çağıran eski yeri kullanır.
  if (bos.oyuklar.length) {
    const orta = (minX + maxX) / 2;
    let enIyi = Infinity;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const d = Math.sqrt(D[j * w + i]) * c;
        if (!ic[j * w + i] || d < et * 0.4 || d > et * 0.6) continue;
        const x = x0 + (i + 0.5) * c, y = y0 + (j + 0.5) * c;
        const puan = (y - minY) + 0.25 * Math.abs(x - orta);
        if (puan < enIyi) { enIyi = puan; bos.etiket = [x, y]; }
      }
    }
  }
  return bos;
}
