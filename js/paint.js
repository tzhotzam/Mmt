// DERİNLİK BOYAMA
//
// Fotoğrafta derinlik bilgisi yoktur; ama kullanıcının kafasında vardır.
// Gövdenin ortası öne çıkar, kol geri gider — bunu bilen tek kişi işi yapan
// kişidir. Bu modül, yükseklik haritasının üstüne elle boyanan bir katman
// tutar: fırçayla yükseltir, alçaltır veya yumuşatırsınız.
//
// Boyanan katman -1..+1 aralığındadır ve tabana EKLENİR; böylece fotoğraftan
// gelen doku korunur, biçim elle düzeltilir.

import { makeGrid } from './heightmap.js';

export function createPaintLayer(w, h) {
  return { w, h, data: new Float32Array(w * h) };
}

/** Boyama katmanını tabana ekler ve 0..1 aralığına kırpar. */
export function applyPaint(base, layer, strength = 1) {
  if (!layer || layer.w !== base.w || layer.h !== base.h) return base;
  const out = makeGrid(base.w, base.h);
  for (let i = 0; i < out.data.length; i++) {
    const v = base.data[i] + layer.data[i] * strength;
    out.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

export function isEmpty(layer) {
  if (!layer) return true;
  for (let i = 0; i < layer.data.length; i++) if (layer.data[i] !== 0) return false;
  return true;
}

/**
 * Yumuşak kenarlı dairesel fırça darbesi.
 *
 * @param {object} layer boyama katmanı (yerinde değişir)
 * @param {number} cx,cy ızgara koordinatı
 * @param {number} radius hücre cinsinden yarıçap
 * @param {number} amount + yükseltir, − alçaltır
 * @param {number} hardness 0 = çok yumuşak kenar, 1 = keskin
 */
export function stamp(layer, cx, cy, radius, amount, hardness = 0.5) {
  const { w, h, data } = layer;
  const r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const soft = 1 - Math.min(0.98, Math.max(0, hardness));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      // Yumuşak düşüş: kenara doğru kosinüs eğrisiyle söner.
      const t = soft < 1e-6 ? 1 : Math.min(1, (1 - d) / soft);
      const falloff = 0.5 - 0.5 * Math.cos(Math.PI * t);
      const i = y * w + x;
      const v = data[i] + amount * falloff;
      data[i] = v < -1 ? -1 : v > 1 ? 1 : v;
    }
  }
}

/** Fırça dairesi içinde yerel yumuşatma (kutu ortalaması). */
export function smoothAt(layer, base, cx, cy, radius, amount) {
  const { w, h, data } = layer;
  const r = Math.max(1, radius);
  const x0 = Math.max(1, Math.floor(cx - r));
  const x1 = Math.min(w - 2, Math.ceil(cx + r));
  const y0 = Math.max(1, Math.floor(cy - r));
  const y1 = Math.min(h - 2, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return;

  // Toplam yüzey (taban + boya) üzerinden ortalama alınır, fark boyaya yazılır.
  const total = (i) => base.data[i] + data[i];
  const patch = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      const i = y * w + x;
      const avg = (total(i) + total(i - 1) + total(i + 1) + total(i - w) + total(i + w)) / 5;
      patch.push([i, avg, 1 - d]);
    }
  }
  for (const [i, avg, weight] of patch) {
    const cur = base.data[i] + data[i];
    const target = cur + (avg - cur) * amount * weight;
    data[i] = target - base.data[i];
  }
}

/**
 * İki nokta arasını fırça darbeleriyle doldurur — parmak hızlı kayarsa
 * darbeler arasında boşluk kalmasın diye.
 */
export function stroke(layer, base, x0, y0, x1, y1, opts) {
  const { radius, amount, hardness = 0.5, mode = 'raise' } = opts;
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(0.6, radius * 0.25);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (mode === 'smooth') smoothAt(layer, base, x, y, radius, Math.abs(amount));
    else stamp(layer, x, y, radius, mode === 'lower' ? -Math.abs(amount) : Math.abs(amount), hardness);
  }
}
