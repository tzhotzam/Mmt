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
import { cornerRelief } from '../corners.js';

export const SLICE_DEFAULTS = {
  targetSize: 1200,     // heykelin en uzun kenarı (mm)
  sizeAxis: 'max',
  axis: 'z',            // dilimlerin dizildiği eksen
  thickness: 18,
  gap: 0,               // dilimler arası (mm) — 0 = sıkı istif
  minArea: 300,         // bu alanın altındaki adalar elenir (mm²)
  rodShape: 'yuvarlak', // 'yuvarlak' (mil) | 'kare' (kazık)
  rodDiameter: 10,      // yuvarlakta ÇAP, karede KENAR (mm)
  rodCount: 2,          // yuvarlak milde 2 tane dönmeyi engeller
  rodInset: 0.35,       // iki mil, parçanın ana ekseninde bu oranda ayrılır
  toolDiameter: 6,      // kare kazık yuvasının köşe payı bu uca göre açılır
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

  // ---- Mil / kazık yerini seç -------------------------------------------
  // Kare kazığın köşesi merkeze en uzak noktadır: çevrel yarıçap kenar·√2/2.
  // Yarıçap olarak bunu kullanmazsak kazık kâğıtta sığar, tezgâhta köşesi
  // parçanın dışına taşar.
  const kareMi = p.rodShape === 'kare';
  const ucYaricap = Math.max(0, (p.toolDiameter || 0) / 2);
  // Kemik payı, karenin KÖŞESİNDEN uç yarıçapı kadar daha dışarı taşar.
  // Boşluğu yalnızca çevrel yarıçapla ölçersek dar kesitlerde yuvanın köşe
  // payı parçanın kenarından dışarı çıkar — parça o köşeden kopar.
  const milYaricap = kareMi
    ? (p.rodDiameter * Math.SQRT2) / 2 + ucYaricap
    : p.rodDiameter / 2;
  const mil = chooseRods(layers, p, milYaricap);

  // ---- Parçaları kur -----------------------------------------------------
  const parts = [];
  let milsiz = 0;
  layers.forEach((l) => {
    const cokAda = l.adalar.length > 1;
    l.adalar.forEach((ada, ai) => {
      const id = `D${String(l.index + 1).padStart(3, '0')}${cokAda ? String.fromCharCode(97 + ai) : ''}`;
      const holes = ada.holes.slice();

      const tutan = mil.points.filter((m) => icerdeMi(m, ada, milYaricap));
      for (const m of tutan) {
        holes.push(kareMi
          ? squareSlot(m, p.rodDiameter, (p.toolDiameter || 0) / 2)
          : circle(m, p.rodDiameter / 2));
      }
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

  // ---- Sığabilecek en büyük mil/kazık ------------------------------------
  // Sınırı, milin geçtiği EN DAR kesit belirler. İstenen ölçü hiçbir kesite
  // sığmadıysa mil.points boş kalır; o durumda ölçüyü sıfır kabul edip
  // yeniden yer arıyoruz, yoksa kullanıcıya "en fazla kaç" diyemeyiz.
  const olcum = mil.points.length ? mil : chooseRods(layers, p, 0);
  // Yuvarlakta çap = 2r. Karede yukarıdaki bağıntının tersi:
  // r = kenar·√2/2 + ucYarıçapı  →  kenar = (r - ucYarıçapı)·2/√2.
  const enBuyuk = olcum.maxRadius > 0
    ? (kareMi
      ? Math.max(0, (olcum.maxRadius - ucYaricap) * 2 / Math.SQRT2)
      : 2 * olcum.maxRadius)
    : 0;

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
  if (kareMi && mil.points.length > 1) {
    warnings.push(
      'Kare kazık tek başına dönmeyi engeller; ikinci kazık gereksiz yere ' +
      'malzeme zayıflatır. "Mil sayısı"nı 1 yapabilirsiniz.'
    );
  }
  if (kareMi && p.rodDiameter < (p.toolDiameter || 0) * 2) {
    warnings.push(
      `Kazık kenarı (${p.rodDiameter} mm) takım çapının (${p.toolDiameter} mm) ` +
      'iki katından küçük — bu yuva o uçla açılamaz. Kazığı büyütün ya da ' +
      'daha ince uç kullanın.'
    );
  }
  // Ölçü bilgisi yalnızca İŞE YARADIĞINDA uyarı olur: sığmıyorsa. Sığıyorken
  // her seferinde yazmak gürültüdür; boşluk payı montaj kılavuzunda durur.
  if (enBuyuk > 0 && p.rodDiameter > enBuyuk + 1e-6) {
    const yuvarlanmis = Math.floor(enBuyuk / 5) * 5;
    warnings.push(
      `${kareMi ? 'Kazık kenarı' : 'Mil çapı'} ${p.rodDiameter} mm — bu heykele ` +
      `sığmıyor. En dar kesit en fazla ~${yuvarlanmis} mm taşır. ` +
      (yuvarlanmis < 5
        ? 'Kesitler mil için fazla ince; heykel boyunu büyütün.'
        : `${yuvarlanmis} mm'ye düşürün ya da heykel boyunu büyütün.`)
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
      rodShape: p.rodShape,
      rodDiameter: p.rodDiameter,
      maxRodSize: enBuyuk,
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
function chooseRods(layers, p, r) {
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

  // Bu yerleşimde mil ne kadar kalınlaşabilir?
  //
  // Sadece "en çok parçayı tutan nokta"ya bakmak yanıltıcı: eşit derecede
  // iyi tutan iki noktadan biri kesitin ortasında, diğeri kenarına yakın
  // olabilir. Bu yüzden İYİ tutan adaylar (en iyi skorun %90'ı) arasından
  // kenara uzaklığı EN BÜYÜK olan aranır. Ölçülen, milin geçtiği en dar
  // kesitte merkezden kenara kalan paydır.
  let enIyiSkorGenel = 0;
  const skorlar = ornek.map((c) => {
    const s = skor(c);
    if (s > enIyiSkorGenel) enIyiSkorGenel = s;
    return s;
  });
  let enGenisPay = 0;
  ornek.forEach((c, i) => {
    if (skorlar[i] < enIyiSkorGenel * 0.9) return;
    let dar = Infinity;
    for (const l of layers) {
      for (const ada of l.adalar) {
        if (!pointInRing(c, ada.outline)) continue;
        let d = kenaraUzaklik(c, ada.outline);
        for (const h of ada.holes) d = Math.min(d, kenaraUzaklik(c, h));
        dar = Math.min(dar, d);
      }
    }
    if (Number.isFinite(dar) && dar > enGenisPay) enGenisPay = dar;
  });

  return { points, maxRadius: enGenisPay };
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

/**
 * Kare kazık yuvası.
 *
 * Yuva bir DELİKTİR: malzeme dışarıda kalır, dolayısıyla karenin dört köşesi
 * malzeme açısından İÇ köşedir ve dönen uç oraya giremez. Köşelerde kalan et
 * yüzünden kazık yuvaya girmez — 40 mm kazık, 6 mm uçla açılmış yuvaya 3 mm
 * eksik oturur.
 *
 * Halka CW üretilir ve köşe payı bu hâliyle uygulanır: cornerRelief CCW
 * varsayar, CW bir halkada dört köşeyi de "iç köşe" sayar ve payı karenin
 * DIŞINA, yani malzemenin içine açar. Delik için istenen tam budur.
 */
function squareSlot(c, side, toolRadius) {
  const h = side / 2;
  // CW sıra (dış halka CCW olduğu için delik ters yönde olmalı).
  const kare = [
    [c[0] - h, c[1] - h],
    [c[0] - h, c[1] + h],
    [c[0] + h, c[1] + h],
    [c[0] + h, c[1] - h],
  ];
  if (!(toolRadius > 0)) return kare;

  const pay = cornerRelief(kare, toolRadius, { mode: 'kemik' });
  // Pay yuvayı BÜYÜTMELİ (|alan| artmalı). Küçüldüyse yay yanlış tarafa
  // dönmüş demektir; o zaman ham kareyle devam et.
  const eski = Math.abs(signedArea(kare));
  const yeni = Math.abs(signedArea(pay.ring));
  if (pay.applied === 4 && yeni > eski) return pay.ring;
  return kare;
}

function emptyInfo(p, scaled, pitch) {
  return {
    mode: 'slices', layerCount: 0, partCount: 0, pitch, axis: p.axis,
    rodPoints: [], rodShape: p.rodShape, rodDiameter: p.rodDiameter, maxRodSize: 0, rodlessParts: 0,
    modelSize: scaled.size, panelW: scaled.size.x, panelH: scaled.size.z || scaled.size.y,
    totalDepth: 0, totalHeight: 0, params: p,
  };
}
