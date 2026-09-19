// FOTOĞRAFTAN KABARTMA
//
// Düz bir fotoğrafta derinlik bilgisi YOKTUR — aynı görüntüyü sonsuz sayıda
// farklı 3B sahne üretebilir. Ama kullanılabilir bir kabartma çıkarmak için
// gerçek derinliğe ihtiyaç yok.
//
// Yöntem: konuyu zeminden ayır, sonra her noktanın KENARA UZAKLIĞINI yükseklik
// olarak kullan. Gövdenin ortası en öne çıkar, kenarlara doğru iner — tıpkı
// bir madalyon gibi. Silüeti belirgin konularda (logo, hayvan, figür)
// parlaklığı yükseklik saymaktan çok daha doğru sonuç verir, çünkü parlaklık
// ışığın nereye vurduğunu anlatır, neyin önde olduğunu değil.

import { makeGrid, cloneGrid } from './heightmap.js';

/**
 * Otsu yöntemiyle otomatik eşik: histogramı iki sınıfa ayırırken sınıf içi
 * varyansı en aza indiren değeri bulur.
 */
export function otsuThreshold(grid, bins = 256) {
  const hist = new Float64Array(bins);
  for (const v of grid.data) {
    const b = Math.min(bins - 1, Math.max(0, Math.round(v * (bins - 1))));
    hist[b]++;
  }
  const total = grid.data.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = i;
    }
  }
  // Eşik, iki kovanın ARASINA düşürülür. Aksi hâlde tam kovanın üstündeki
  // değerler `>=` ile konu sayılır ve bimodal bir görselde alt küme de
  // konuya katılır — maske tamamen dolar.
  return (best + 0.5) / (bins - 1);
}

/**
 * Tam Öklid uzaklık dönüşümü (Felzenszwalb & Huttenlocher, 2012).
 * mask: 1 = konu (uzaklık ölçülecek), 0 = zemin (uzaklık sıfır).
 * @returns {Float32Array} her hücrenin en yakın zemine uzaklığı (hücre cinsinden)
 */
export function distanceTransform(mask, w, h) {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(w * h);
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);

  // Sütunlar
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? INF : 0;
    dt1d(f, h, d, v, z, (y) => y * w + x);
  }
  // Satırlar
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    dt1d(f, w, d, v, z, (x) => y * w + x);
  }

  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(d[i]);
  return out;
}

/** Tek boyutlu karesel uzaklık dönüşümü — alt zarfı parabollerle tarar. */
function dt1d(f, n, dOut, v, z, indexOf) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dv = q - v[k];
    dOut[indexOf(q)] = dv * dv + f[v[k]];
  }
}

/**
 * Silüeti "şişirerek" kabartma üretir.
 *
 * @param {{w,h,data}} grid 0..1 yükseklik haritası (parlaklık)
 * @param {object} opts
 *  - threshold: 0 = Otsu ile otomatik, yoksa 0..1 arası elle eşik
 *  - roundness: 0 = koni (düz eğim), 1 = küresel kubbe. Varsayılan 0.7
 *  - detail:    0..1 — orijinal gölgelemeden ne kadar yüzey dokusu karışsın
 *  - minRegion: bundan küçük adacıklar zemin sayılır (hücre sayısı)
 * @returns {{grid, info}} info: eşik, konu oranı, en kalın nokta (hücre)
 */
export function inflateSilhouette(grid, opts = {}) {
  const { w, h } = grid;
  const {
    threshold = 0,
    roundness = 0.7,
    detail = 0.25,
    minRegion = Math.max(16, Math.round(w * h * 0.0004)),
  } = opts;

  const thr = threshold > 0 ? threshold : otsuThreshold(grid);

  // Konu maskesi: eşiğin ÜSTÜ konudur. (Kabartma yönü daha önce ayarlandığı
  // için buraya gelen haritada konu zaten parlak taraftadır.)
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = grid.data[i] >= thr ? 1 : 0;

  const kept = dropSmallRegions(mask, w, h, minRegion);
  let fg = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) fg++;

  const dist = distanceTransform(mask, w, h);
  let maxDist = 0;
  for (const d of dist) if (d > maxDist) maxDist = d;

  const out = makeGrid(w, h);
  if (maxDist < 1e-6) return { grid: cloneGrid(grid), info: { threshold: thr, coverage: 0, maxDist: 0, dropped: kept } };

  const r = Math.min(1, Math.max(0, roundness));
  for (let i = 0; i < out.data.length; i++) {
    if (!mask[i]) { out.data[i] = 0; continue; }
    const t = Math.min(1, dist[i] / maxDist);
    // Koni ile küresel kavis arasında geçiş.
    const dome = Math.sqrt(Math.max(0, 2 * t - t * t));
    let v = (1 - r) * t + r * dome;
    // Orijinal gölgeleme yüzey dokusu olarak eklenir — biçimi bozmadan.
    if (detail > 0) {
      const shade = (grid.data[i] - thr) / Math.max(1e-6, 1 - thr);
      v = v * (1 - detail) + v * detail * (0.35 + 0.65 * Math.min(1, Math.max(0, shade)));
    }
    out.data[i] = Math.min(1, Math.max(0, v));
  }

  return {
    grid: out,
    info: { threshold: thr, coverage: fg / (w * h), maxDist, dropped: kept },
  };
}

/**
 * Bağlı bileşen taraması — küçük lekeler zemine katılır.
 * @returns {number} elenen bölge sayısı
 */
function dropSmallRegions(mask, w, h, minRegion) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const region = new Int32Array(w * h);
  let dropped = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0, rp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      region[rp++] = p;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (rp < minRegion) {
      for (let i = 0; i < rp; i++) mask[region[i]] = 0;
      dropped++;
    }
  }
  return dropped;
}

/**
 * Şişirme ile parlaklığı karıştırır.
 * @param {number} mix 0 = sadece parlaklık, 1 = sadece şişirme
 */
export function blendRelief(brightnessGrid, inflatedGrid, mix) {
  const m = Math.min(1, Math.max(0, mix));
  const out = makeGrid(brightnessGrid.w, brightnessGrid.h);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = brightnessGrid.data[i] * (1 - m) + inflatedGrid.data[i] * m;
  }
  return out;
}
