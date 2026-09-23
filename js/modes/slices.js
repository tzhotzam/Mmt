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
import { classifyRings, signedArea, bbox, pointInRing, centroid, simplify } from '../geom.js';
import { scaleTriangles } from '../mesh.js';
import { dikCevir } from './facets.js';
import { planRails, notchBottom, railPart, railAxes, railEngage, YUVA_PAYI } from '../rails.js';
import { cornerRelief } from '../corners.js';

export const SLICE_DEFAULTS = {
  targetSize: 1200,     // heykelin en uzun kenarı (mm)
  sizeAxis: 'max',
  upAxis: 'z',          // modelin dik ekseni (Y-yukarı dosyalar için 'y')
  axis: 'z',            // dilimlerin dizildiği eksen
  thickness: 18,
  gap: 0,               // dilimler arası (mm) — 0 = sıkı istif
  minArea: 300,         // bu alanın altındaki adalar elenir (mm²)
  rodShape: 'yuvarlak', // 'yuvarlak' (mil) | 'kare' (kazık)
  rodDiameter: 10,      // yuvarlakta ÇAP, karede KENAR (mm)
  rodCount: 0,          // 0 = otomatik: her parça tutulana kadar mil eklenir (en çok 12)
  // Taşıyıcı: 'mil' | 'kizak' | 'ikisi' | 'oto' (aralıklı dikey dilimde kızak+mil)
  support: 'mil',
  railCount: 2,
  railEngage: 0,        // 0 → max(10, 5·kalınlık) mm geçme yüksekliği
  railBelow: 0,         // kızağın heykelin altından sarkması (mm)
  rodInset: 0.35,       // iki mil, parçanın ana ekseninde bu oranda ayrılır
  toolDiameter: 6,      // kare kazık yuvasının köşe payı bu uca göre açılır
  labelSize: 8,
  maxLayers: 400,
};

export function generateSlices(rawTris, userParams = {}) {
  const p = { ...SLICE_DEFAULTS, ...userParams };
  const warnings = [];

  const scaled = scaleTriangles(dikCevir(rawTris, p.upAxis), p.targetSize, p.sizeAxis);
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
    // Kesitleri sadeleştir: hacimden yeniden kurulmuş ya da taranmış
    // modellerde bir kesit binlerce köşe taşıyor; mil araması ve kesim
    // dosyası bunun altında eziliyordu (konsept arabada 12 saniye). Tolerans
    // heykel boyunun 1/5000'i — 450 mm'de 0,09 mm, lazerin ışın payından az.
    const tol = Math.max(0.02, p.targetSize * 2e-4);
    const sinif = classifyRings(l.rings
      .map((ring) => simplify(ring, tol, true))
      .filter((ring) => ring.length >= 3));
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
  // ---- Kızak ------------------------------------------------------------
  const destek = p.support === 'oto'
    ? (p.gap > 0 && railAxes(p.axis) ? 'ikisi' : 'mil')
    : p.support;
  const kizaklar = destek === 'kizak' || destek === 'ikisi' ? planRails(layers, p) : [];
  const ax = railAxes(p.axis);
  for (const k of kizaklar) {
    for (const f of k.fins) {
      const ada = layers[f.li].adalar[f.ai];
      const yeni = notchBottom(ada.outline, ax.hi, ax.vi, k.h, p.thickness + YUVA_PAYI, f.zb + railEngage(p) / 2);
      if (yeni) ada.outline = yeni;
    }
  }

  // Kızağın tuttuğu kanatlar mil planına "zaten bağlı" olarak girer; mil
  // yalnızca kızağa ulaşmayan parçalar (ayna, spoyler) için aranır.
  const mil = planRods(layers, { ...p, rodCount: destek === 'kizak' ? -1 : p.rodCount }, milYaricap,
    kizaklar.map((k) => k.fins.map((f) => [f.li, f.ai])));

  // ---- Parçaları kur -----------------------------------------------------
  const parts = [];
  let milsiz = 0;
  let tekMil = 0;
  let gruptaki = 0;
  layers.forEach((l, li) => {
    const cokAda = l.adalar.length > 1;
    l.adalar.forEach((ada, ai) => {
      const id = `D${String(l.index + 1).padStart(3, '0')}${cokAda ? String.fromCharCode(97 + ai) : ''}`;
      const holes = ada.holes.slice();

      // Yalnızca bu adayı en az iki dilim boyunca geçen mil parçaları delik
      // açar; tek dilimlik "parça" hiçbir şeyi hiçbir şeye bağlamaz.
      const tutan = mil.points.filter((m, k) => mil.tutar[k][li] === ai);
      if (tutan.length === 1 && !kareMi) tekMil++;
      const grup = tutan.length ? mil.grup(li, ai) : 0;
      if (grup) gruptaki++;
      for (const m of tutan) {
        holes.push(kareMi
          ? squareSlot(m, p.rodDiameter, (p.toolDiameter || 0) / 2)
          : circle(m, p.rodDiameter / 2));
      }
      if (!mil.tutulan(li, ai)) milsiz++;

      const b = bbox(ada.outline);
      const c = centroid(ada.outline);
      parts.push({
        id,
        kind: 'dilim',
        outline: ada.outline,
        holes,
        engrave: [{ type: 'text', text: grup ? `${id} G${grup}` : id, x: c[0], y: c[1], size: p.labelSize }],
        w: b.w,
        h: b.h,
        meta: {
          layer: l.index, coord: l.coord, island: ai,
          area: ada.area, rods: tutan.length, group: grup,
        },
      });
    });
  });

  kizaklar.forEach((k, i) => parts.push(railPart(k, layers, p, `K${i + 1}`)));
  if ((destek === 'kizak' || destek === 'ikisi') && !kizaklar.length) {
    warnings.push(railAxes(p.axis)
      ? 'Kızak yerleştirilemedi: kanatların alt kenarı kızağın geçeceği kadar düz ve dolu değil. Mil kullanılıyor.'
      : 'Kızak yalnızca dikey dilimlerde (X ya da Y ekseni) çalışır; yatay dilimde mil kullanılır.');
  }

  // ---- Sığabilecek en büyük mil/kazık ------------------------------------
  // Sınırı, milin geçtiği EN DAR kesit belirler. İstenen ölçü hiçbir kesite
  // sığmadıysa mil.points boş kalır; o durumda ölçüyü sıfır kabul edip
  // yeniden yer arıyoruz, yoksa kullanıcıya "en fazla kaç" diyemeyiz.
  // Ölçü tahmini eski tek-noktalı aramayla yapılır (mil planı yarıçap vermez).
  let olcum = chooseRods(layers, p, milYaricap);
  if (!olcum.points.length) olcum = chooseRods(layers, p, 0);
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
  // Elenen kırıntılar bir BİLGİdir, sorun değil (ayrıntı için arayüzde gri
  // "Bilgi" satırı). Tüm adalar elendiyse zaten yukarıda hata dönülüyor.
  const notes = [];
  if (elenenAda > 0) {
    notes.push(
      `${elenenAda} küçük ada elendi (toplam ${Math.round(elenenAlan)} mm²). ` +
      `Bunlar parmak ucu, saç teli gibi ince uzantılardır; ${p.minArea} mm² ` +
      'sınırının altında kaldıkları için kesilmeye değmez. Gerekiyorsa ' +
      '"En küçük ada" değerini düşürün.'
    );
  }
  if (milsiz > 0) {
    warnings.push(p.gap > 0
      ? `${milsiz} parçadan mil geçmiyor ve dilimler aralıklı olduğu için komşuya ` +
        'yapıştırılamazlar — havada kalırlar. Genelde ayna, spoyler ucu gibi küçük ' +
        'kopuk adalardır: "En küçük ada"yı büyütüp eleyin, mil çapını küçültün ya ' +
        'da mil sayısını otomatik (0) bırakın.'
      : `${milsiz} parçadan mil geçmiyor — bunlar kendi başına durmaz, ` +
        'komşu dilime yapıştırılmalı. Montaj kılavuzunda işaretli.'
    );
  }
  if (gruptaki > 0) {
    warnings.push(
      `${gruptaki} parça ana gövdeye düz mille bağlanamıyor (gövdeden ayrı duran ` +
      `bölgeler); kendi milleriyle ${mil.grupSayisi} alt grup oluşturuyorlar. Her ` +
      'grubu önce kendi milinde tarak gibi birleştirin, sonra gövdeye birkaç ' +
      'noktadan yapıştırın. Parçalarda "G1", "G2" diye işaretli.'
    );
  }
  if (p.rodCount > 0 && mil.points.length < p.rodCount) {
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
    notes,
    info: {
      mode: 'slices',
      layerCount: sliced.count,
      partCount: parts.length,
      pitch,
      axis: p.axis,
      rodPoints: mil.points,
      rodSegments: mil.segments,
      support: destek,
      rails: kizaklar.map((k, i) => ({ id: `K${i + 1}`, h: k.h, fins: k.fins.length })),
      railEngage: railEngage(p),
      singleRodParts: tekMil,
      groupedParts: gruptaki,
      groupCount: mil.grupSayisi,
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

/**
 * MİL PLANI — her parçayı tutacak kadar mil, en azından.
 *
 * Eski yöntem bütün heykel için N nokta seçiyor, her birini "en çok parçayı
 * delen" yere koyuyordu. İkinci mil de hep gövdeye düşüyordu (en kalabalık
 * bölge orası); bacak, kafa, ayna gibi ayrı adalar boşta kalıyordu. Tam
 * istifte onlar komşuya yapıştırılabiliyordu; aralıklı dizilişte (fotoğraftaki
 * araba) havada kalırlar. Ölçüldü: konsept arabada 138 parçanın 80'i milsizdi.
 *
 * Şimdi:
 *  - Mil düz bir çizgidir ama heykelin DIŞINA çıktığı dilimlerde görünür
 *    olurdu; bu yüzden milin içeride kaldığı ardışık dilim dizileri ayrı
 *    MİL PARÇALARI sayılır. En az iki dilim geçen parça işe yarar.
 *  - Açgözlü kapsama: her yeni mil, henüz tutulmayan parçaları en çok
 *    kapsayan yere konur. Yuvarlak milde tek milli parçaya ikinci mil
 *    (dönmeyi engeller) daha az puan getirir.
 *  - rodCount 0 ise yeni parça tutulamayana kadar (en çok 12) mil eklenir.
 *
 * @returns {{points, segments, tutar}} tutar[k][katman] = milin o katmanda
 *          tuttuğu ada indisi, yoksa -1
 */
function planRods(layers, p, r, onceBagli = []) {
  const kare = p.rodShape === 'kare';
  // Ada kutuları: nokta-içinde sınamasının çoğunu ucuzca eler (ilk sürüm
  // bunsuz 13 saniye sürüyordu).
  const kutular = layers.map((l) => l.adalar.map((ada) => bbox(ada.outline)));
  const icinde = (c, li, ai) => {
    const b = kutular[li][ai];
    if (c[0] < b.minX + r || c[0] > b.maxX - r || c[1] < b.minY + r || c[1] > b.maxY - r) return false;
    return icerdeMi(c, layers[li].adalar[ai], r);
  };

  const adaylar = [];
  layers.forEach((l, li) => {
    l.adalar.forEach((ada, ai) => {
      const c = centroid(ada.outline);
      if (icinde(c, li, ai)) adaylar.push(c);
      const b = kutular[li][ai];
      for (let iy = 1; iy <= 3; iy++) {
        for (let ix = 1; ix <= 3; ix++) {
          const q = [b.minX + (b.w * ix) / 4, b.minY + (b.h * iy) / 4];
          if (icinde(q, li, ai)) adaylar.push(q);
        }
      }
    });
  });
  const adim = Math.max(1, Math.floor(adaylar.length / 900));
  const ornek = adaylar.filter((_, i) => i % adim === 0);

  // Adalara sıra numarası: birleşim-bul (union-find) bunun üstünde çalışır.
  const kimlik = [];
  let toplam = 0;
  const alanlar = [];
  for (const l of layers) {
    kimlik.push(l.adalar.map((ada) => { alanlar.push(ada.area); return toplam++; }));
  }

  // Her aday için katman katman tuttuğu ada; işe yarayan mil parçaları.
  const iz = ornek.map((c) => {
    const hit = layers.map((l, li) => {
      for (let ai = 0; ai < l.adalar.length; ai++) if (icinde(c, li, ai)) return ai;
      return -1;
    });
    const tutar = hit.slice().fill(-1);
    const parcalar = [];
    for (let i = 0; i < hit.length;) {
      if (hit[i] < 0) { i++; continue; }
      let j = i;
      while (j + 1 < hit.length && hit[j + 1] >= 0) j++;
      if (j > i) {
        parcalar.push([i, j]);
        for (let k = i; k <= j; k++) tutar[k] = hit[k];
      }
      i = j + 1;
    }
    return { c, tutar, parcalar };
  });

  // BAĞLANTI: mil parçası, geçtiği ardışık adaları birbirine bağlar. Bir ada
  // ancak ANA GÖVDEYE (en büyük alanlı bağlı küme) bir zincirle bağlıysa
  // tutulmuş sayılır — havada birbirine takılı iki kırıntı işe yaramaz.
  const kok = (u, i) => { while (u[i] !== i) { u[i] = u[u[i]]; i = u[i]; } return i; };
  const bagla = (u, z) => {
    for (const [a, b2] of z.parcalar) {
      for (let k = a; k < b2; k++) {
        const x = kok(u, kimlik[k][z.tutar[k]]), y = kok(u, kimlik[k + 1][z.tutar[k + 1]]);
        if (x !== y) u[x] = y;
      }
    }
  };
  // Puan: ana gövdeye bağlı her ada 1; ana gövdeye değmeyen ama en az üç
  // adalık kendi mil grubunu (tarak) oluşturan her ada 0,5. Gövdeden ayrı
  // duran bir tampon dudağı düz mille gövdeye bağlanamaz (konsept arabada
  // 27 dilim boyunca 2 cm boşlukla ayrı); kendi miliyle tek parça tarak olur
  // ve gövdeye birkaç noktadan yapıştırılır — 27 kanadı tek tek yapıştırmaktan
  // çok daha iyi.
  const kumeler = (u, delinen) => {
    const alan = new Map(), adet = new Map();
    for (let i = 0; i < toplam; i++) {
      if (!delinen[i]) continue;
      const k = kok(u, i);
      alan.set(k, (alan.get(k) || 0) + alanlar[i]);
      adet.set(k, (adet.get(k) || 0) + 1);
    }
    let ana = -1, enBuyuk = 0;
    for (const [k, a2] of alan) if (a2 > enBuyuk) { enBuyuk = a2; ana = k; }
    return { ana, adet };
  };
  const anaKumeSayisi = (u, delinen) => {
    const { ana, adet } = kumeler(u, delinen);
    let puan = 0;
    for (const [k, n] of adet) {
      if (k === ana) puan += n;
      else if (n >= 3) puan += 0.5 * n;
    }
    return puan;
  };

  const uf = Int32Array.from({ length: toplam }, (_, i) => i);
  const delinen = new Uint8Array(toplam);
  const sayac = new Int32Array(toplam);
  // Kızağın geçtiği kanatlar birbirine bağlıdır (kızak bir "mil" gibi).
  for (const grup of onceBagli) {
    let ilk = -1;
    for (const [li, ai] of grup) {
      const id = kimlik[li][ai];
      delinen[id] = 1;
      sayac[id]++;
      if (ilk < 0) ilk = id;
      else { const x = kok(uf, id), y = kok(uf, ilk); if (x !== y) uf[x] = y; }
    }
  }
  let mevcut = onceBagli.length ? anaKumeSayisi(uf, delinen) : 0;
  const enAzAra = Math.max(p.rodDiameter * 3, r * 4);
  const hedef = p.rodCount > 0 ? p.rodCount : p.rodCount < 0 ? 0 : 12;
  const secilen = [];
  for (let k = 0; k < hedef; k++) {
    let enIyi = null, enIyiG = 0;
    for (const z of iz) {
      if (!z.parcalar.length) continue;
      if (secilen.some((q) => Math.hypot(q.c[0] - z.c[0], q.c[1] - z.c[1]) < enAzAra)) continue;
      const u = Int32Array.from(uf);
      const d = Uint8Array.from(delinen);
      let donme = 0;
      z.tutar.forEach((ai, li) => {
        if (ai < 0) return;
        const id = kimlik[li][ai];
        d[id] = 1;
        if (!kare && sayac[id] === 1) donme++;
      });
      bagla(u, z);
      const g = anaKumeSayisi(u, d) - mevcut + 0.35 * donme;
      if (g > enIyiG + 1e-9) { enIyiG = g; enIyi = z; }
    }
    // Otomatikte yeni mil en az bir parçayı ana gövdeye bağlamalı ya da üç
    // parçanın dönmesini engellemeli; yoksa gereksiz delik açar.
    if (!enIyi || (p.rodCount === 0 && enIyiG < 1)) break;
    secilen.push(enIyi);
    enIyi.tutar.forEach((ai, li) => {
      if (ai < 0) return;
      const id = kimlik[li][ai];
      delinen[id] = 1;
      sayac[id]++;
    });
    bagla(uf, enIyi);
    mevcut = anaKumeSayisi(uf, delinen);
  }

  // Ana gövdeye bağlanamayan adalardaki delikler anlamsız; o mil parçaları
  // yine de listede kalır (kullanıcı tutkalla birleştirebilir) ama ada
  // "milsiz" sayılır.
  const { ana: anaKok, adet: kumeAdet } = kumeler(uf, delinen);
  // Ada ne durumda: 'ana' (gövdeye mille bağlı), 'grup' (kendi mil grubunda,
  // gruba yapıştırılır), ya da tutulmuyor.
  const durum = (li, ai) => {
    if (ai < 0 || !delinen[kimlik[li][ai]]) return null;
    const k2 = kok(uf, kimlik[li][ai]);
    if (k2 === anaKok) return 'ana';
    return (kumeAdet.get(k2) || 0) >= 3 ? 'grup' : null;
  };
  const gruplar = new Set();
  for (let li = 0; li < layers.length; li++) {
    for (let ai = 0; ai < layers[li].adalar.length; ai++) {
      if (durum(li, ai) === 'grup') gruplar.add(kok(uf, kimlik[li][ai]));
    }
  }
  const grupNo = new Map([...gruplar].map((k2, i) => [k2, i + 1]));

  const mm = (a, b2) => (b2 - a + 1) * p.thickness + (b2 - a) * p.gap;
  return {
    points: secilen.map((z) => z.c),
    tutar: secilen.map((z) => z.tutar.map((ai, li) => (durum(li, ai) ? ai : -1))),
    segments: secilen.map((z) => z.parcalar.map(([a, b2]) => ({ from: a, to: b2, length: mm(a, b2) }))),
    // Ada → grup numarası (yalnızca ana gövdeye bağlanamayan gruplar için).
    grup: (li, ai) => (durum(li, ai) === 'grup' ? grupNo.get(kok(uf, kimlik[li][ai])) : 0),
    grupSayisi: gruplar.size,
    tutulan: (li, ai) => durum(li, ai) !== null,
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
    rodPoints: [], rodSegments: [], rails: [], singleRodParts: 0, groupedParts: 0, groupCount: 0, rodShape: p.rodShape, rodDiameter: p.rodDiameter, maxRodSize: 0, rodlessParts: 0,
    modelSize: scaled.size, panelW: scaled.size.x, panelH: scaled.size.z || scaled.size.y,
    totalDepth: 0, totalHeight: 0, params: p,
  };
}
