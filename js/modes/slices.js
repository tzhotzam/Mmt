// DİLİM MODU ("katmanlı heykel")
//
// Kapalı bir 3B model paralel düzlemlerle kesilir, her kesit levhadan çıkar
// ve parçalar bir MİLE dizilerek heykel kurulur. Lamel modundan farkı:
// orada kesit tek bir yükseklik eğrisiydi (2,5B kabartma), burada modelin
// gerçek kesiti alınır — oturan bir figürün iki bacağı ayrı ayrı halka
// olarak çıkar.
//
// Üç şey bu modu zorlaştırır ve üçü de burada açıkça ele alınır:
//
//  1. ADA'lar. Bir dilim birden çok kopuk parçaya ayrılabilir (iki bacak,
//     gövdeden ayrılan kol). Her ada ayrı parçadır; mil hepsinden geçmez.
//  2. MİL YERİ. Mil, olabildiğince çok parçadan geçmeli. Tek bir "merkez"
//     yoktur; aday noktalar denenip en çok parçayı yakalayan seçilir.
//  3. MİLİN TUTMADIĞI parçalar. Bunlar sessizce bırakılmaz — sayılır,
//     işaretlenir ve kullanıcıya "bunları yapıştıracaksın" denir.

import { sliceMesh } from '../slice.js';
import { classifyRings, signedArea, bbox, pointInRing, centroid } from '../geom.js';
import { scaleTriangles } from '../mesh.js';

export const SLICE_DEFAULTS = {
  targetSize: 1200,     // heykelin en uzun kenarı (mm)
  sizeAxis: 'max',
  axis: 'z',            // dilimlerin dizildiği eksen
  thickness: 18,
  gap: 0,               // dilimler arası (mm) — 0 = sıkı istif
  minArea: 300,         // bu alanın altındaki adalar elenir (mm²)
  rodDiameter: 10,      // mil çapı (mm)
  rodCount: 2,          // 2 mil dönmeyi de engeller
  rodInset: 0.35,       // iki mil, parçanın ana ekseninde bu oranda ayrılır
  labelSize: 8,
  maxLayers: 400,
};

export function generateSlices(rawTris, userParams = {}) {
  const p = { ...SLICE_DEFAULTS, ...userParams };
  const warnings = [];

  const scaled = scaleTriangles(rawTris, p.targetSize, p.sizeAxis);
  const pitch = p.thickness + p.gap;
  const sliced = sliceMesh(scaled.tris, {
    axis: p.axis, pitch, tol: Math.max(0.005, p.targetSize * 1e-5), maxLayers: p.maxLayers,
  });

  if (!sliced.count) {
    return {
      parts: [], info: emptyInfo(p, scaled, pitch),
      warnings: ['Model dilimlenemedi — geçerli üçgen ya da yükseklik yok.'],
    };
  }

  // ---- Dilimleri adalara ayır -------------------------------------------
  let acikZincir = 0;
  let elenenAda = 0;
  let elenenAlan = 0;

  const layers = sliced.layers.map((l) => {
    acikZincir += l.open;
    const sinif = classifyRings(l.rings);
    const disHalkalar = sinif.filter((s) => !s.hole);
    const delikler = sinif.filter((s) => s.hole);

    const adalar = [];
    for (const d of disHalkalar) {
      if (d.area < p.minArea) { elenenAda++; elenenAlan += d.area; continue; }
      // Delik, hangi dış halkanın içindeyse ona aittir.
      const kendiDelikleri = delikler.filter((h) => pointInRing(h.ring[0], d.ring));
      adalar.push({ outline: d.ring, holes: kendiDelikleri.map((h) => h.ring), area: d.area });
    }
    return { index: l.index, coord: l.coord, adalar };
  });

  const toplamAda = layers.reduce((s, l) => s + l.adalar.length, 0);
  if (!toplamAda) {
    return {
      parts: [], info: emptyInfo(p, scaled, pitch),
      warnings: [
        `Hiç parça üretilemedi: ${elenenAda} adanın tamamı en küçük ada ` +
        `alanının (${p.minArea} mm²) altında kaldı. Heykel boyunu büyütün ` +
        'ya da bu değeri düşürün.',
      ],
    };
  }

  // ---- Mil yerini seç ----------------------------------------------------
  const mil = chooseRods(layers, p);

  // ---- Parçaları kur -----------------------------------------------------
  const parts = [];
  let milsiz = 0;
  layers.forEach((l) => {
    const cokAda = l.adalar.length > 1;
    l.adalar.forEach((ada, ai) => {
      const id = `D${String(l.index + 1).padStart(3, '0')}${cokAda ? String.fromCharCode(97 + ai) : ''}`;
      const holes = ada.holes.slice();

      const tutan = mil.points.filter((m) => icerdeMi(m, ada, p.rodDiameter / 2));
      for (const m of tutan) holes.push(circle(m, p.rodDiameter / 2));
      if (!tutan.length) milsiz++;

      const b = bbox(ada.outline);
      const c = centroid(ada.outline);
      parts.push({
        id,
        kind: 'dilim',
        outline: ada.outline,
        holes,
        engrave: [{ type: 'text', text: id, x: c[0], y: c[1], size: p.labelSize }],
        w: b.w,
        h: b.h,
        meta: {
          layer: l.index, coord: l.coord, island: ai,
          area: ada.area, rods: tutan.length,
        },
      });
    });
  });

  // ---- Uyarılar ----------------------------------------------------------
  if (acikZincir > 0) {
    warnings.push(
      `${acikZincir} kesit halkası kapanmadı — model kapalı bir hacim değil ` +
      '(delik, ters normal ya da kopuk yüzey). Blender\'da "Merge by Distance" + ' +
      '"Recalculate Normals" uygulayıp tekrar deneyin; kapanmayan kesitler ' +
      'eksik parça olarak çıkar.'
    );
  }
  if (elenenAda > 0) {
    warnings.push(
      `${elenenAda} küçük ada elendi (toplam ${Math.round(elenenAlan)} mm²). ` +
      `Bunlar parmak ucu, saç teli gibi ince uzantılardır; ${p.minArea} mm² ` +
      'sınırının altında kaldıkları için kesilmeye değmez. Gerekiyorsa ' +
      '"En küçük ada" değerini düşürün.'
    );
  }
  if (milsiz > 0) {
    warnings.push(
      `${milsiz} parçadan mil geçmiyor — bunlar kendi başına durmaz, ` +
      'komşu dilime yapıştırılmalı. Montaj kılavuzunda işaretli. ' +
      'Mil sayısını 2 yapmak ya da mil yerini değiştirmek bu sayıyı düşürür.'
    );
  }
  if (mil.points.length < p.rodCount) {
    warnings.push(
      `${p.rodCount} mil istendi ama ${mil.points.length} tanesi yerleştirilebildi. ` +
      'Kesitler tek milden fazlasını taşıyacak kadar geniş değil; tek milde ' +
      'parçalar dönebilir, montajda hizayı gözle tutmanız gerekir.'
    );
  }
  if (parts.length > 250) {
    warnings.push(
      `${parts.length} parça çok fazla. Kalınlığı artırın (daha az dilim), ` +
      'heykeli küçültün ya da dilimler arası boşluk verin.'
    );
  }

  return {
    parts,
    info: {
      mode: 'slices',
      layerCount: sliced.count,
      partCount: parts.length,
      pitch,
      axis: p.axis,
      rodPoints: mil.points,
      rodDiameter: p.rodDiameter,
      rodlessParts: milsiz,
      modelSize: scaled.size,
      panelW: scaled.size.x,
      panelH: scaled.size.z || scaled.size.y,
      totalDepth: sliced.count * pitch,
      totalHeight: sliced.bounds.size[sliced.axisIndex],
      params: p,
    },
    warnings,
  };
}

// ------------------------------------------------------------- YARDIMCILAR

/**
 * Mil yerlerini seçer.
 *
 * "Merkez" diye tek bir doğru nokta yok: oturan bir figürde kütle merkezi
 * boşluğa düşebilir. Bu yüzden aday noktalar (her adanın ağırlık merkezi)
 * denenir ve EN ÇOK PARÇADAN geçen seçilir. İkinci mil, birincinin
 * yakınındaki adayları eleyerek aranır; iki mil birbirine çok yakın olursa
 * dönmeyi engellemez.
 */
function chooseRods(layers, p) {
  const r = p.rodDiameter / 2;
  const adaylar = [];
  for (const l of layers) {
    for (const ada of l.adalar) {
      const c = centroid(ada.outline);
      if (icerdeMi(c, ada, r)) { adaylar.push(c); continue; }
      // İçbükey adada ağırlık merkezi dışarı düşer (hilal, U biçimi).
      // O zaman adanın kutusunda küçük bir ızgara taranır.
      const b = bbox(ada.outline);
      for (let iy = 1; iy <= 3; iy++) {
        for (let ix = 1; ix <= 3; ix++) {
          const q = [b.minX + (b.w * ix) / 4, b.minY + (b.h * iy) / 4];
          if (icerdeMi(q, ada, r)) adaylar.push(q);
        }
      }
    }
  }
  if (!adaylar.length) return { points: [] };

  const skor = (nokta) => {
    let n = 0;
    for (const l of layers) for (const ada of l.adalar) if (icerdeMi(nokta, ada, r)) n++;
    return n;
  };

  const points = [];
  const kullanilmis = new Set();
  // Tüm adayları denemek büyük modellerde pahalı; eşit aralıklı bir örneklem
  // yeterli. 120 aday, 400 dilimlik bir modelde bile hızlı.
  const adim = Math.max(1, Math.floor(adaylar.length / 120));
  const ornek = adaylar.filter((_, i) => i % adim === 0);

  const tumBbox = bbox(adaylar);
  const enAzUzaklik = Math.max(p.rodDiameter * 2, Math.hypot(tumBbox.w, tumBbox.h) * p.rodInset);

  for (let k = 0; k < p.rodCount; k++) {
    let enIyi = null;
    let enIyiSkor = 0;
    for (let i = 0; i < ornek.length; i++) {
      if (kullanilmis.has(i)) continue;
      const c = ornek[i];
      if (points.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < enAzUzaklik)) continue;
      const s = skor(c);
      if (s > enIyiSkor) { enIyiSkor = s; enIyi = c; kullanilmis.add(i); }
    }
    if (!enIyi || enIyiSkor === 0) break;
    points.push(enIyi);
  }
  return { points };
}

/** Nokta, adanın içinde ve kenarlardan en az `pay` kadar uzakta mı? */
function icerdeMi(nokta, ada, pay) {
  if (!pointInRing(nokta, ada.outline)) return false;
  for (const h of ada.holes) if (pointInRing(nokta, h)) return false;
  if (pay > 0) {
    if (kenaraUzaklik(nokta, ada.outline) < pay) return false;
    for (const h of ada.holes) if (kenaraUzaklik(nokta, h) < pay) return false;
  }
  return true;
}

function kenaraUzaklik(nokta, ring) {
  let en = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    en = Math.min(en, noktaDogruParcasi(nokta, a, b));
  }
  return en;
}

function noktaDogruParcasi(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function circle(c, r, seg = 24) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (2 * Math.PI * i) / seg;
    pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  // Delik halkaları CW olmalı (dış halka CCW).
  return signedArea(pts) > 0 ? pts.reverse() : pts;
}

function emptyInfo(p, scaled, pitch) {
  return {
    mode: 'slices', layerCount: 0, partCount: 0, pitch, axis: p.axis,
    rodPoints: [], rodDiameter: p.rodDiameter, rodlessParts: 0,
    modelSize: scaled.size, panelW: scaled.size.x, panelH: scaled.size.z || scaled.size.y,
    totalDepth: 0, totalHeight: 0, params: p,
  };
}
