// KÖŞE İŞLEMLERİ — freze ucunun fiziksel sınırını çizime yansıtır.
//
// Dönen bir freze ucu KESKİN İÇ KÖŞE KESEMEZ; arkasında kendi yarıçapı kadar
// et bırakır. Kızak kanalının dibinde kalan bu et yüzünden geçme parça tam
// oturmaz, panel birkaç milimetre açık kalır. Çizim keskin görünür ama
// tezgâhta öyle çıkmaz.
//
// İki standart çözüm var, ikisi de burada:
//
//  KEMİK (dogbone): köşeye, merkezi tam köşede olan bir daire eklenir. Pay
//  köşegen doğrultuda, yani her iki komşu parçaya da r kadar girer. En az
//  malzeme götüren biçim budur.
//
//  T PAYI (T-bone): pay köşegen yerine kenarlardan birinin boyunca uzatılır.
//  Köşenin bir yanındaki malzeme inceyse — kızak dişleri gibi — kemik payı
//  dişi iki yandan yiyip koparır. T payı bütün eti tek yönde, kalın tarafta
//  alır; diş sağlam kalır.
//
// Hangisinin kullanılacağı 'oto' modunda köşe köşe seçilir: yakında başka bir
// iç köşe yoksa kemik, varsa T payı.

import { signedArea } from './geom.js';

const TAU = Math.PI * 2;

function unit(dx, dy) {
  const l = Math.hypot(dx, dy);
  return l < 1e-12 ? null : [dx / l, dy / l];
}

/**
 * Halkadaki köşeleri sınıflandırır.
 * CCW halkada sola dönüş dışbükey, sağa dönüş içbükeydir.
 * @returns {Array<{index, convex, turn}>} turn: dönüş açısı (radyan, işaretli)
 */
export function classifyCorners(ring) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n];
    const v = ring[i];
    const q = ring[(i + 1) % n];
    const d1 = unit(v[0] - p[0], v[1] - p[1]);
    const d2 = unit(q[0] - v[0], q[1] - v[1]);
    if (!d1 || !d2) { out.push({ index: i, convex: true, turn: 0 }); continue; }
    const capraz = d1[0] * d2[1] - d1[1] * d2[0];
    const nokta = d1[0] * d2[0] + d1[1] * d2[1];
    const turn = Math.atan2(capraz, nokta);
    out.push({ index: i, convex: turn >= 0, turn });
  }
  return out;
}

/**
 * İç köşelere pay açar.
 *
 * KEMİK geometrisi: köşe V, giriş yönü d1, çıkış yönü d2 olsun. Kenar boyunca
 * V'den r kadar geri çekilip A = V - r·d1 noktasına gelinir; oradan MERKEZİ
 * TAM V OLAN r yarıçaplı bir yay, malzemenin içinden dolaşarak B = V + r·d2
 * noktasına iner.
 *
 * Merkez neden tam köşede? Kesimde takım merkezi, çizginin malzeme dışına r
 * kadar ötelenmişini izler. Merkezi V olan r yarıçaplı bir yay r kadar
 * ötelendiğinde yarıçapı sıfıra iner: takım merkezi TAM V noktasından geçer,
 * yani köşede et kalmaz. 90°'lik köşede kenarlarda r'lik iki düzlük ve
 * aralarında 270°'lik bir yay görünür — klasik kemik biçimi.
 *
 * T PAYI geometrisi: pay köşegene değil, seçilen kenarın boyunca alınır.
 * ê kenar yönü olmak üzere merkez C = V + r·ê, yay yarıçapı r ve V'den
 * V + 2r·ê noktasına 180° dönerek malzemenin içine girer. Ötelenince yine
 * yarıçap sıfıra iner, takım merkezi C'den geçer ve köşe temizlenir — ama
 * eksilen etin tamamı tek kenarın ötesine, kalın tarafa düşer.
 *
 * Yay yönleri CCW halkaya göre sabittir: kemikte saat yönünde π + |dönüş|,
 * T payında kenar seçimine göre ±π. Tersi seçilseydi yay boşluğun içinden
 * geçer, yani malzeme eklerdi.
 *
 * @param {Array} ring CCW halka
 * @param {number} radius freze ucu YARIÇAPI (çap değil)
 * @param {object} opts { mode: 'oto' | 'kemik' | 't',
 *                        minTurn: bu açıdan keskin köşelere uygula (radyan),
 *                        segments: yay kaç parçaya bölünsün }
 * @returns {{ring, applied, skipped, dogbones, tbones}}
 */
export function cornerRelief(ring, radius, opts = {}) {
  const { mode = 'oto', minTurn = 0.35, segments = 10, only = null } = opts;
  const bos = { ring, applied: 0, skipped: 0, dogbones: 0, tbones: 0 };
  if (!(radius > 0) || ring.length < 3) return bos;

  const n = ring.length;
  const koseler = classifyCorners(ring);
  // `only` verilirse yalnızca geçme köşeleri işlenir. Lamelin ön kenarındaki
  // dalga da iç köşe içerir; oraya pay açmak görünen yüzü delik deşik eder.
  const uygun = (k) => !k.convex && Math.abs(k.turn) >= minTurn
    && (!only || only(ring[k.index], k));
  const icKose = koseler.filter(uygun);
  if (!icKose.length) return bos;

  const out = [];
  let applied = 0;
  let skipped = 0;
  let dogbones = 0;
  let tbones = 0;

  for (let i = 0; i < n; i++) {
    const k = koseler[i];
    const V = ring[i];
    if (!uygun(k)) { out.push(V); continue; }

    const P = ring[(i - 1 + n) % n];
    const Q = ring[(i + 1) % n];
    const d1 = unit(V[0] - P[0], V[1] - P[1]);
    const d2 = unit(Q[0] - V[0], Q[1] - V[1]);
    if (!d1 || !d2) { out.push(V); continue; }
    const kenar1 = Math.hypot(V[0] - P[0], V[1] - P[1]);
    const kenar2 = Math.hypot(Q[0] - V[0], Q[1] - V[1]);

    // Yakındaki başka bir iç köşe aradaki eti ince bırakabilir. Ama hangi
    // "ara"? İki köşe halkada KOMŞUYSA aralarındaki şey kanalın boşluğudur —
    // orada kesilecek malzeme yok, kemik sorun çıkarmaz. Komşu DEĞİLSE
    // aralarında bir diş var demektir; iki kemik o dişi iki yandan yiyerek
    // koparabilir.
    //
    // Eşik 3r: her kemik r kadar girdiğine göre dişin dibinde en az r kalsın.
    // Daha darına T payı açılır, pay tamamen kalın tarafa düşer.
    const esik = 3 * radius;
    let enYakin = Infinity;
    let komsu = null;
    for (const o of icKose) {
      if (o.index === i) continue;
      const bitisik = (o.index + 1) % n === i || (i + 1) % n === o.index;
      if (bitisik) continue;
      const W = ring[o.index];
      const d = Math.hypot(W[0] - V[0], W[1] - V[1]);
      if (d < enYakin) { enYakin = d; komsu = W; }
    }
    const kemikCakisiyor = enYakin < esik;

    const kemikSigar = radius <= kenar1 * 0.49 && radius <= kenar2 * 0.49;
    const kemikSec = mode === 'kemik'
      ? kemikSigar && !kemikCakisiyor
      : mode === 't' ? false : kemikSigar && !kemikCakisiyor;

    if (kemikSec) {
      out.push(...kemikYayi(V, d1, d2, radius, Math.abs(k.turn), segments));
      applied++; dogbones++;
      continue;
    }

    if (mode !== 'kemik') {
      const t = tPayi(V, d1, d2, kenar1, kenar2, radius, komsu, segments);
      if (t) {
        out.push(...t);
        applied++; tbones++;
        continue;
      }
    }

    // Hiçbiri sığmadı. Köşeyi olduğu gibi bırak ve bildir — sessizce
    // küçültmek, oturmayan bir geçme üretmekten kötüdür.
    skipped++;
    out.push(V);
  }

  return { ring: out, applied, skipped, dogbones, tbones };
}

/** Merkezi köşede olan kemik yayı; A'dan B'ye saat yönünde. */
function kemikYayi(V, d1, d2, r, donus, segments) {
  const A = [V[0] - d1[0] * r, V[1] - d1[1] * r];
  const B = [V[0] + d2[0] * r, V[1] + d2[1] * r];
  const aciA = Math.atan2(A[1] - V[1], A[0] - V[0]);
  const delta = -(Math.PI + donus);

  const pts = [A];
  for (let s = 1; s < segments; s++) {
    const a = aciA + (delta * s) / segments;
    pts.push([V[0] + Math.cos(a) * r, V[1] + Math.sin(a) * r]);
  }
  pts.push(B);
  return pts;
}

/**
 * Kenar boyunca alınan T payı. Kenar seçimi, payın ince tarafa değil kalın
 * tarafa düşmesine göre yapılır: iki adayın merkezinden hangisi dar geçidin
 * karşı köşesine daha uzaksa o seçilir.
 */
function tPayi(V, d1, d2, kenar1, kenar2, r, komsu, segments) {
  const adaylar = [];
  // Giriş kenarı: pay V'den ÖNCE alınır, yön V'den P'ye doğru (-d1).
  if (2 * r <= kenar1 * 0.49) adaylar.push({ e: [-d1[0], -d1[1]], once: true });
  // Çıkış kenarı: pay V'den SONRA alınır, yön d2.
  if (2 * r <= kenar2 * 0.49) adaylar.push({ e: d2, once: false });
  if (!adaylar.length) return null;

  let sec = adaylar[0];
  if (adaylar.length > 1 && komsu) {
    let enIyi = -Infinity;
    for (const a of adaylar) {
      const C = [V[0] + a.e[0] * r, V[1] + a.e[1] * r];
      const d = Math.hypot(C[0] - komsu[0], C[1] - komsu[1]);
      if (d > enIyi) { enIyi = d; sec = a; }
    }
  }

  const e = sec.e;
  const C = [V[0] + e[0] * r, V[1] + e[1] * r];
  const uc = [V[0] + e[0] * 2 * r, V[1] + e[1] * 2 * r];
  // Malzeme, CCW halkada yürüyüş yönünün solunda: yay o yana taşar.
  const aciV = Math.atan2(V[1] - C[1], V[0] - C[0]);
  const aciUc = Math.atan2(uc[1] - C[1], uc[0] - C[0]);

  const pts = [];
  const ciz = (a0, delta) => {
    for (let s = 1; s < segments; s++) {
      const a = a0 + (delta * s) / segments;
      pts.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]);
    }
  };

  if (sec.once) {
    // ... kenar boyunca gelinir, uçta dalınır, V'ye çıkılır, sonra devam.
    pts.push(uc);
    ciz(aciUc, -Math.PI);
    pts.push(V);
  } else {
    // V'ye gelinir, dalınır, kenar üzerinde 2r ileride çıkılır.
    pts.push(V);
    ciz(aciV, -Math.PI);
    pts.push(uc);
  }
  return pts;
}

/** Yalnızca kemik payı uygular (geriye dönük ad). */
export function dogbone(ring, radius, opts = {}) {
  const r = cornerRelief(ring, radius, { ...opts, mode: 'kemik' });
  return { ring: r.ring, applied: r.applied, skipped: r.skipped };
}

/**
 * Dış köşeleri yuvarlar — işlevsel değil, görsel ve elle tutuş içindir.
 * Keskin dış köşeler hem kıymık yapar hem taşımada zarar görür.
 */
export function filletConvex(ring, radius, opts = {}) {
  const { minTurn = 0.35, segments = 6 } = opts;
  if (!(radius > 0) || ring.length < 3) return { ring, applied: 0 };

  const n = ring.length;
  const koseler = classifyCorners(ring);
  const out = [];
  let applied = 0;

  for (let i = 0; i < n; i++) {
    const k = koseler[i];
    const V = ring[i];
    if (!k.convex || Math.abs(k.turn) < minTurn) { out.push(V); continue; }

    const P = ring[(i - 1 + n) % n];
    const Q = ring[(i + 1) % n];
    const d1 = unit(V[0] - P[0], V[1] - P[1]);
    const d2 = unit(Q[0] - V[0], Q[1] - V[1]);
    if (!d1 || !d2) { out.push(V); continue; }

    // Teğet noktası köşeden r/tan(θ/2) uzakta; θ = iç açı = π - |dönüş|.
    const yariAci = (Math.PI - Math.abs(k.turn)) / 2;
    const tanYari = Math.tan(yariAci);
    if (!(tanYari > 1e-6)) { out.push(V); continue; }
    let geri = radius / tanYari;

    const kenar1 = Math.hypot(V[0] - P[0], V[1] - P[1]);
    const kenar2 = Math.hypot(Q[0] - V[0], Q[1] - V[1]);
    const enFazla = Math.min(kenar1, kenar2) * 0.49;
    if (geri > enFazla) geri = enFazla;
    if (geri < 1e-6) { out.push(V); continue; }
    const r = geri * tanYari;

    const A = [V[0] - d1[0] * geri, V[1] - d1[1] * geri];
    const B = [V[0] + d2[0] * geri, V[1] + d2[1] * geri];
    // Merkez, köşeden içeri doğru açıortay üzerinde.
    const bx = d2[0] - d1[0];
    const by = d2[1] - d1[1];
    const bLen = Math.hypot(bx, by) || 1;
    const mesafe = Math.hypot(geri, r);
    const C = [V[0] + (bx / bLen) * mesafe, V[1] + (by / bLen) * mesafe];

    const aciA = Math.atan2(A[1] - C[1], A[0] - C[0]);
    const aciB = Math.atan2(B[1] - C[1], B[0] - C[0]);
    let delta = aciB - aciA;
    while (delta <= -Math.PI) delta += TAU;
    while (delta > Math.PI) delta -= TAU;

    out.push(A);
    for (let s = 1; s < segments; s++) {
      const a = aciA + (delta * s) / segments;
      out.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]);
    }
    out.push(B);
    applied++;
  }

  return { ring: out, applied };
}

/**
 * Freze ucunun giremeyeceği iç köşeleri sayar — uyarı üretmek için.
 * @returns {number} kemik payı olmadan oturmayacak köşe sayısı
 */
export function countTightCorners(ring, radius, opts = {}) {
  // Eski çağrı biçimi: countTightCorners(ring, radius, minTurn)
  const o = typeof opts === 'number' ? { minTurn: opts } : opts;
  const { minTurn = 0.35, only = null } = o;
  if (!(radius > 0)) return 0;
  let n = 0;
  for (const k of classifyCorners(ring)) {
    if (k.convex || Math.abs(k.turn) < minTurn) continue;
    if (only && !only(ring[k.index], k)) continue;
    n++;
  }
  return n;
}

/**
 * Halkanın yönünü koruyarak köşe payı uygular.
 *
 * Sonuç körü körüne kabul edilmez: pay yalnızca malzeme EKSİLTİR. Alan
 * büyüdüyse yaylardan biri yanlış tarafa dönmüş, işaret değiştiyse halka
 * kendini kesmiş demektir. İkisinde de ham halkayla devam edilir — bozuk bir
 * kesim yolu üretmektense payı hiç açmamak yeğdir.
 */
export function applyCornerRelief(ring, opts = {}) {
  const {
    toolRadius = 0, filletRadius = 0, dogboneOn = true,
    mode = 'oto', only = null,
  } = opts;
  const sonuc = { ring, applied: 0, skipped: 0, filleted: 0, dogbones: 0, tbones: 0 };
  let cur = ring;

  if (dogboneOn && toolRadius > 0) {
    const d = cornerRelief(cur, toolRadius, { mode, only });
    const eski = signedArea(cur);
    const yeni = signedArea(d.ring);
    if (d.applied > 0 && yeni > 0 && yeni <= eski + 1e-6) {
      cur = d.ring;
      sonuc.applied = d.applied;
      sonuc.dogbones = d.dogbones;
      sonuc.tbones = d.tbones;
      sonuc.skipped = d.skipped;
    } else if (d.applied > 0) {
      // Pay reddedildi: kullanıcı açısından bu köşeler işlenmemiş demektir.
      sonuc.skipped = d.skipped + d.applied;
    } else {
      sonuc.skipped = d.skipped;
    }
  }

  if (filletRadius > 0) {
    const f = filletConvex(cur, filletRadius, {});
    if (f.applied > 0 && signedArea(f.ring) > 0) {
      cur = f.ring;
      sonuc.filleted = f.applied;
    }
  }

  sonuc.ring = cur;
  return sonuc;
}
