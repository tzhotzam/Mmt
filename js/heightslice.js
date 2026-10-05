// GÖRSELDEN DİLİM — yükseklik haritasını doğrudan katmanlara böler.
//
// Fotoğraftan (yapay zekâ derinliğiyle) çıkan yüz bir duvar kabartmasıdır:
// arkası düz, önü yüz. Bunu yatay katmanlara bölüp üst üste yapıştırınca
// duvar panosuna oturan topografik bir yüz maskesi çıkar (grahamdecors /
// parametric_art_wood işleri gibi).
//
// Ağ kurup dilimlemek yerine kesit doğrudan haritadan okunur: z yüksekliğindeki
// yatay katman, haritanın o satırındaki profildir — arka kenar duvar (y=0),
// ön kenar yüz. Ağ yolunun iki derdi yoktu burada: zemin (h≈0) sıfır kalınlıkta
// dejenere şeritler bırakmaz, konunun dış hattı hücre basamağı değil eşik
// geçişinden aradeğerlenmiş düzgün bir çizgidir.
//
// Model eksenleri ağ yoluyla (relief3d) aynıdır: x = en, z = boy (yukarı),
// y = derinlik, ön -y yönündedir.

import { sampleBilinear } from './heightmap.js';
import { signedArea } from './geom.js';
import { contourRings } from './marchingsquares.js';

/**
 * @param {{w,h,data}} grid 0..1 yükseklik haritası (yakın = 1)
 * @param {object} o
 *   width, height  mm (en, boy)
 *   depth          kabartma derinliği (mm), en yakın nokta arka düzlemden bu kadar önde
 *   back           konu içinde arkada kalan en az et (mm) — kenarda kağıt incesi kalmasın
 *   esik           bu değerin altı zemin sayılır (kesilmez)
 *   axis           'z' yatay katman | 'x' dikey katman
 *   pitch          katman adımı (kalınlık + boşluk)
 *   maxLayers
 * @returns {{scaled:{size}, sliced:{layers,bounds,pitch,count,axis,axisIndex}}}
 */
export function heightmapToSlices(grid, o) {
  const { width, height, depth, back = 4, esik = 0.02, pitch, maxLayers = 400 } = o;
  const axis = o.axis === 'x' ? 'x' : 'z';
  const D = back + depth;
  const size = { x: width, y: D, z: height };
  const bounds = { lo: [0, -D, 0], hi: [width, 0, height], size: [width, D, height] };

  const ai = axis === 'x' ? 0 : 2;
  const uzunluk = axis === 'x' ? width : height;
  const n = Math.min(maxLayers, Math.max(1, Math.floor(uzunluk / pitch)));
  const bosluk = (uzunluk - (n - 1) * pitch) / 2;

  // Profil boyunca örnek sayısı: haritanın çözünürlüğünün iki katı, en çok
  // 0,75 mm'de bir. Daha sıkı örneklemek ayrıntı katmaz, kesim dosyasını şişirir.
  const boyProfil = axis === 'x' ? height : width;
  const haritaOrnek = axis === 'x' ? grid.h : grid.w;
  const N = Math.max(16, Math.min(Math.round(boyProfil / 0.75), haritaOrnek * 2));

  const layers = [];
  for (let li = 0; li < n; li++) {
    const coord = bosluk + li * pitch;
    // Katmanın haritadaki konumu: z → satır (v=0 üst satır), x → sütun.
    const sabit = axis === 'x' ? coord / width : 1 - coord / height;
    const hs = new Float64Array(N + 1);
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      hs[k] = axis === 'x' ? sampleBilinear(grid, sabit, t) : sampleBilinear(grid, t, sabit);
    }
    // Profil konumu (mm): z ekseninde x, x ekseninde z (t=0 üst satır = z en büyük).
    const konum = (t) => (axis === 'x' ? (1 - t) * height : t * width);
    const derin = (h) => back + h * depth;

    const rings = [];
    let k = 0;
    while (k <= N) {
      if (hs[k] < esik) { k++; continue; }
      // Dizinin başı: önceki örnekle arasında eşik geçişi.
      const bas = k === 0 ? 0 : (k - 1 + (esik - hs[k - 1]) / (hs[k] - hs[k - 1])) / N;
      const on = [[bas, derin(esik)]];
      while (k <= N && hs[k] >= esik) { on.push([k / N, derin(hs[k])]); k++; }
      const son = k > N ? 1 : (k - 1 + (hs[k - 1] - esik) / (hs[k - 1] - hs[k])) / N;
      on.push([son, derin(esik)]);
      if (son - bas < 1e-6) continue;
      // Düzlem koordinatları slice.js ile aynı: z'de (x, y), x'te (y, z).
      const nokta = (t, d) => (axis === 'x' ? [-d, konum(t)] : [konum(t), -d]);
      const ring = [nokta(bas, 0), nokta(son, 0)];
      for (let j = on.length - 1; j >= 0; j--) ring.push(nokta(on[j][0], on[j][1]));
      rings.push(signedArea(ring) < 0 ? ring.reverse() : ring);
    }
    layers.push({ index: li, coord, rings, open: 0 });
  }
  return {
    scaled: { size, tris: null },
    sliced: { layers, bounds, pitch, count: n, axis, axisIndex: ai },
  };
}

/**
 * ARKA PANO — maskenin yapıştırılacağı düz levha. Üstüne iki şey kazınır:
 *  - maskenin dış hattı (katmanların arka kenarları buraya oturur; yapıştırma
 *    sırasında hizayı bu çizgi verir),
 *  - dikey oluklar (ince çıtalı pano görünümü; kanallı uçla V-oluk olarak
 *    açılabilir ya da yalnız gravür bırakılır).
 * Koordinatlar model (x, z) düzlemindedir; pano y ∈ [0, kalınlık] arasında,
 * katmanların hemen arkasında durur.
 */
export function arkaPano(grid, o) {
  const { width, height, thickness, esik = 0.02, pay = 0.12 * Math.max(width, height), oluk = 10 } = o;
  const x0 = -pay, x1 = width + pay, z0 = -pay, z1 = height + pay;
  const outline = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const engrave = [];
  const kontur = contourRings(grid, esik)
    .map((r) => r.map(([gx, gy]) => [(gx / (grid.w - 1)) * width, (1 - gy / (grid.h - 1)) * height]))
    .filter((r) => Math.abs(signedArea(r)) > 0.002 * width * height);
  for (const r of kontur) engrave.push({ type: 'polyline', points: r, closed: true, layer: 'GRAVUR' });
  if (oluk > 0) {
    for (let x = x0 + oluk; x < x1 - oluk / 2; x += oluk) {
      engrave.push({ type: 'polyline', points: [[x, z0 + 5], [x, z1 - 5]], closed: false, layer: 'GRAVUR' });
    }
  }
  engrave.push({ type: 'text', text: 'PANO', x: x0 + 30, y: z0 + 12, size: 8 });
  return {
    id: 'PANO', kind: 'pano', outline, holes: [], engrave,
    w: x1 - x0, h: z1 - z0,
    meta: { pano: true, thickness, outlineCount: kontur.length },
  };
}
