// PERÇİNLİ BİRLEŞİM VE KÖŞE DELİKLERİ (poligonal kabuk).
//
// Kaynak yerine perçin: her dikişin BİR tarafına kulakçık (tab) eklenir.
// Kulakçık dikiş kenarından bükülüp eş parçanın ALTINA girer; eş parçada
// ve kulakçıkta karşılıklı delikler vardır, oradan kör (pop) perçin atılır.
// Kaynak, taşlama ve boya yanığı yoktur; perçin başları yüzeyde düzenli
// bir desen olarak kalır. Satın alınan kırmızı goril heykelindeki birleşim
// tam budur.
//
// Deliklerin hizası: iki parçanın dikiş kenarı, aynı 3B kenarın açınımıdır;
// TELAFİSİZ halkada ikisi de aynı uzunluktadır ve kenar ortası aynı 3B
// noktaya düşer. Perçin konumları bu yüzden telafisiz kenarın ortasından,
// SİMETRİK uzaklıklarla verilir — kenarın hangi yönde dolaşıldığı fark
// etmez. Derinlik de telafisiz (model) çizgisinden ölçülür.
//
// Sac kalınlığı kulakçığı eş parçanın bir kalınlık altına iter; bu, bükümde
// deliğin derinlik yönünde yaklaşık bir kalınlık kaymasına yol açar.
// Kulakçıktaki delik bu yüzden kenara dik yönde bir kalınlık kadar uzatılmış
// bir YUVADIR (oval). Perçin başının pulu yuvayı içeriden örter.

import { signedArea, pointInRing } from './geom.js';
import { polysOverlap, bridgeLine } from './unfold.js';

const SEG = 20;

export function circle(c, r, seg = SEG) {
  const out = [];
  // CW: delik halkaları dış halkanın tersi yönde tutulur.
  for (let i = 0; i < seg; i++) {
    const a = -(2 * Math.PI * i) / seg;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

/** d yönünde toplam `uzun` kadar uzatılmış yuva (stadyum), CW. */
export function slot(c, d, uzun, r, seg = SEG) {
  const [dx, dy] = d;
  const e = uzun / 2;
  const out = [];
  const yarim = seg / 2;
  const t0 = Math.atan2(dy, dx);
  // İki yarım daire: +d ucunda ve -d ucunda.
  for (const [s, bas] of [[1, t0 - Math.PI / 2], [-1, t0 + Math.PI / 2]]) {
    const cx = c[0] + dx * e * s, cy = c[1] + dy * e * s;
    for (let i = 0; i <= yarim; i++) {
      const a = bas + (Math.PI * i) / yarim;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  if (signedArea(out) > 0) out.reverse();
  return out;
}

function segUzaklik(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Nokta halkanın içinde ve sınırına en az `pay` uzaklıkta mı? */
export function icerdeMi(pt, ring, pay) {
  if (!pointInRing(pt, ring)) return false;
  for (let i = 0; i < ring.length; i++) {
    if (segUzaklik(pt, ring[i], ring[(i + 1) % ring.length]) < pay) return false;
  }
  return true;
}

/** Otomatik köşe deliği çapı: iki sac kalınlığı, 3-8 mm arası. */
export function reliefDiameter(p) {
  return p.reliefHoleDia > 0 ? p.reliefHoleDia : Math.max(3, Math.min(8, 2 * p.thickness));
}

/**
 * Büküm hatlarının YAPRAK İÇİNDE birleştiği köşelere delik.
 *
 * Birden çok büküm hattı bir noktada buluşunca sac o noktada her yönden
 * aynı anda bükülmeye zorlanır; köşe yırtılır ya da kabarır. Delik bu
 * gerilimi boşaltır ve bükümü kolaylaştırır — fotoğraftaki heykelde her
 * iç köşedeki siyah noktalar bunlardır. Sınırdaki uçlara delik açılmaz
 * (yarım delik, kenarda çentik olurdu).
 *
 * @returns {Array} delik halkaları
 */
export function reliefHoles(ring, folds, dia) {
  const r = dia / 2;
  const noktalar = [];
  for (const f of folds) {
    for (const pt of [f.p1, f.p2]) {
      if (noktalar.some((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 0.05)) continue;
      noktalar.push(pt);
    }
  }
  return noktalar
    .filter((pt) => icerdeMi(pt, ring, r + 0.5))
    .map((pt) => ({ c: pt, r, ring: circle(pt, r) }));
}

/**
 * Kaynak dikişlerini perçinli kulakçığa çevirir. Parçaları YERİNDE değiştirir.
 *
 * Her parça şunları taşımalıdır (üreticiler doldurur, burada silinir):
 *   _ring0      telafisiz halka (outline ile aynı köşe sırası)
 *   _seamEdges  [{ i, sid, label }] — i. kenar sid numaralı dikiş
 *   _circles    [{ c, r }] — çakışma denetimi için mevcut delikler
 *
 * @returns {{percin:number, kaynak:number, keskin:number, rivets:number, tabs:number}}
 */
export function applyRivetJoints(parts, seams, p) {
  const holeD = p.rivetDiameter + 0.1;           // 4 mm perçin → Ø4.1 matkap
  const r = holeD / 2;
  // Perçin kenardan kulakçık derinliğinin yarısı kadar içeride. Kenar
  // etiketi perçinin üstüne düşerse kenar boyunca kaydırılır (etiketYerlestir).
  const derinlik = Math.max(p.tabWidth / 2, r + 3);
  const uzama = p.thickness;                     // kulakçık yuvasının uzaması
  const h = Math.max(p.tabWidth, derinlik + uzama / 2 + r + 1.5);

  const taraflar = new Map();
  parts.forEach((part, pi) => {
    for (const se of part._seamEdges || []) {
      if (!taraflar.has(se.sid)) taraflar.set(se.sid, []);
      taraflar.get(se.sid).push({ pi, ...se });
    }
  });

  const kulak = new Map();       // pi -> [{ i, ek, poly }] — ek: halkaya eklenecek noktalar
  const stat = { percin: 0, kaynak: 0, keskin: 0, rivets: 0, tabs: 0 };

  for (const seam of seams) {
    const list = taraflar.get(seam.id);
    if (!list || list.length !== 2) continue;    // öksüz dikiş: kaynakta kalır

    // Bıçak sırtı dikiş (iç açı 30°'nin altında ya da 330°'nin üstünde):
    // kulakçık o açıya bükülemez, kalınlık telafisi de deliği kenara
    // yapıştırır. Ölçüldü — yapay zekâ modelinde delik sığmayan dikişlerin
    // çoğu 1-20° iç açılı ince kanatlardı. Kaynakta kalır.
    if (Math.abs(180 - seam.angle) > p.maxBend) {
      seam.join = 'kaynak';
      stat.keskin++;
      continue;
    }

    const sira = seam.id % 2 ? [list[0], list[1]] : [list[1], list[0]];
    let karar = null;
    for (const [tk, dk] of [[sira[0], sira[1]], [sira[1], sira[0]]]) {
      karar = dene(parts, tk, dk, kulak);
      if (karar) break;
    }
    if (!karar) {
      seam.join = 'kaynak';
      stat.kaynak++;
      continue;
    }

    const { tk, dk, ek, poly, delikler, yuvalar, A, B } = karar;
    const tp = parts[tk.pi];
    const dp = parts[dk.pi];
    if (!kulak.has(tk.pi)) kulak.set(tk.pi, []);
    kulak.get(tk.pi).push({ i: tk.i, ek, poly });
    for (const d of delikler) { dp.holes.push(d.ring); dp._circles.push(d); }
    for (const y of yuvalar) { tp.holes.push(y.ring); tp._circles.push(y); }

    // Kulakçığın büküm hattı: yapraktaki bükümlerle aynı kertik düzeni.
    tp.engrave.push({ type: 'polyline', points: [A, B], closed: false, layer: 'BUKUM' });
    for (const seg of bridgeLine(A, B, {
      mode: p.bridgeMode, cut: p.dashCut, gap: p.dashGap,
      bridge: p.bridgeWidth, autoLimit: p.autoLimit,
    })) {
      tp.engrave.push({ type: 'polyline', points: seg, closed: false, layer: 'KESIM' });
    }
    // Kulakçık tarafındaki etikete büküm açısı eklenir: kulakçık, iki yüzey
    // arasında dikişin iç açısı kalana kadar bükülür.
    if (tk.label) tk.label.text = `${seam.id}·${Math.round(seam.angle)}°`;
    etiketYerlestir(tk.label, tp.outline, tk.i, yuvalar);
    etiketYerlestir(dk.label, dp.outline, dk.i, delikler);

    seam.join = 'percin';
    seam.rivets = delikler.length;
    seam.tabOn = tp.id;
    stat.percin++;
    stat.rivets += delikler.length;
    stat.tabs++;
  }

  // Kulakçıkları halkaya işle (kenar indeksleri bozulmasın diye en sonda).
  for (const [pi, list] of kulak) {
    const part = parts[pi];
    const ek = new Map(list.map((t) => [t.i, t]));
    const yeni = [];
    part.outline.forEach((pt, i) => {
      yeni.push(pt);
      const t = ek.get(i);
      if (t) yeni.push(...t.ek);
    });
    part.outline = yeni;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of yeni) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    part.w = maxX - minX;
    part.h = maxY - minY;
  }
  return stat;

  /**
   * Kenar etiketi bir deliğin üstüne düşüyorsa kenar boyunca boş bir yere
   * kaydırır; hiç boş yer yoksa deliklerin gerisine (daha içeri) alır.
   */
  function etiketYerlestir(label, ring, i, delikler) {
    if (!label) return;
    const A = ring[i], B = ring[(i + 1) % ring.length];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    const inw = [-u[1], u[0]];
    const size = label.size;
    const yariEn = 0.32 * size * label.text.length + 0.3 * size;
    const bos = (x, y) => delikler.every((d) =>
      Math.hypot(d.c[0] - x, d.c[1] - y) >= d.r + 1 + Math.max(yariEn, size * 0.6));
    const d0 = 1.4 * size;
    for (const t of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      const x = A[0] + u[0] * L * t + inw[0] * d0, y = A[1] + u[1] * L * t + inw[1] * d0;
      if (bos(x, y)) { label.x = x; label.y = y; return; }
    }
    const derin = derinlik + r + 1 + size * 0.7;
    label.x = A[0] + u[0] * L * 0.5 + inw[0] * derin;
    label.y = A[1] + u[1] * L * 0.5 + inw[1] * derin;
  }

  /**
   * tk tarafına kulakçık, dk tarafına delik. Sığmazsa null.
   */
  function dene(parts, tk, dk, kulak) {
    const tp = parts[tk.pi], dp = parts[dk.pi];
    const ring = tp.outline;
    const n = ring.length;
    const A = ring[tk.i], B = ring[(tk.i + 1) % n];
    const A0 = tp._ring0[tk.i], B0 = tp._ring0[(tk.i + 1) % n];
    const L0 = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]);
    if (L0 < 1e-6) return null;
    const u = [(B0[0] - A0[0]) / L0, (B0[1] - A0[1]) / L0];
    const out = [u[1], -u[0]];                  // CCW halkada dışa bakan normal
    const M0 = [(A0[0] + B0[0]) / 2, (A0[1] + B0[1]) / 2];
    const boy = (P) => (P[0] - M0[0]) * u[0] + (P[1] - M0[1]) * u[1];
    const en = (P) => (P[0] - M0[0]) * out[0] + (P[1] - M0[1]) * out[1];

    // Delik tarafının telafisiz kenarı.
    const dn = dp.outline.length;
    const C0 = dp._ring0[dk.i], D0 = dp._ring0[(dk.i + 1) % dn];
    const Ld = Math.hypot(D0[0] - C0[0], D0[1] - C0[1]) || 1;
    const ud = [(D0[0] - C0[0]) / Ld, (D0[1] - C0[1]) / Ld];
    const ind = [-ud[1], ud[0]];                // içe bakan normal
    const Md = [(C0[0] + D0[0]) / 2, (C0[1] + D0[1]) / 2];
    const nokta = (s, d) => [M0[0] + u[0] * s + out[0] * d, M0[1] + u[1] * s + out[1] * d];

    // Perçin konumları: telafisiz kenar ortasından simetrik. Tek perçinlik
    // kenarda orta delik sığmazsa (dar faset) çeyreklerde iki perçin denenir.
    const adet = Math.max(1, Math.floor(L0 / p.rivetPitch));
    const aralik = L0 / adet;
    const konumSetleri = [[]];
    for (let j = 0; j < adet; j++) konumSetleri[0].push((j + 0.5) * aralik - L0 / 2);
    if (adet === 1) konumSetleri.push([-L0 / 4, L0 / 4]);

    const aA = boy(A), aB = boy(B);
    const pahTam = h - Math.min(en(A), en(B));

    // Kulakçık: tabanı telafili kenar, dış kenarı model çizgisinden h ötede,
    // uçları pahlı (komşu kulakçıklarla köşede çakışmasın). Pah 45° olur;
    // kısa kenarda dikleşir — sabit 45° ile 600 mm'lik heykelde 50 mm'den
    // kısa her kenar kulakçıksız kalıyordu (dikişlerin yarısı).
    //
    // Tam boy kulakçık aynı yaprağın komşu fasetine çarpıyorsa (yaprağın
    // içbükey girintisindeki kenar) uçlarından kısaltılmış kulakçık denenir:
    // gerçek boy at modelinde 160 mm'den uzun kaynakta kalan dikişlerin
    // yarısı buydu.
    for (const kisalt of [0, 0.2, 0.35]) {
      const ins = kisalt * (aB - aA);
      const oran = (aB - aA) > 0 ? ins / (aB - aA) : 0;
      const At = [A[0] + (B[0] - A[0]) * oran, A[1] + (B[1] - A[1]) * oran];
      const Bt = [B[0] - (B[0] - A[0]) * oran, B[1] - (B[1] - A[1]) * oran];
      const bA = aA + ins, bB = aB - ins;
      const pah = Math.min(pahTam, (bB - bA - 4) / 2);
      if (pah < pahTam * 0.25) break;          // kenar (ya da kalan kısım) kısa
      const A2 = nokta(bA + pah, h);
      const B2 = nokta(bB - pah, h);
      const poly = [At, A2, B2, Bt];

      // Kendi parçasına ve önceki kulakçıklarına çarpmamalı. Taban teması
      // çakışma sayılmasın diye sınama poligonu tabandan biraz dışarıda başlar.
      const k = 0.3;
      const sina = [nokta(bA + k, en(At) + k), A2, B2, nokta(bB - k, en(Bt) + k)];
      if (polysOverlap(sina, ring)) continue;
      if ((kulak.get(tk.pi) || []).some((t) => polysOverlap(sina, t.poly))) continue;

      for (const konumlar of konumSetleri) {
        const delikler = [], yuvalar = [];
        for (const s of konumlar) {
          const cd = [Md[0] + ud[0] * s + ind[0] * derinlik, Md[1] + ud[1] * s + ind[1] * derinlik];
          const ct = nokta(s, derinlik);
          if (!icerdeMi(cd, dp.outline, r + 1)) continue;
          if (dp._circles.some((q) => Math.hypot(q.c[0] - cd[0], q.c[1] - cd[1]) < q.r + r + 1.5)) continue;
          if (delikler.some((q) => Math.hypot(q.c[0] - cd[0], q.c[1] - cd[1]) < 2 * r + 1.5)) continue;
          // Yuvanın iki ucu da kulakçığın içinde kalmalı.
          const u1 = nokta(s, derinlik - uzama / 2), u2 = nokta(s, derinlik + uzama / 2);
          if (!icerdeMi(u1, poly, r + 0.8) || !icerdeMi(u2, poly, r + 0.8)) continue;
          delikler.push({ c: cd, r, ring: circle(cd, r) });
          yuvalar.push({ c: ct, r: r + uzama / 2, ring: slot(ct, out, uzama, r) });
        }
        if (!delikler.length) continue;
        const ek = ins > 0 ? [At, A2, B2, Bt] : [A2, B2];
        return { tk, dk, A: At, B: Bt, ek, poly, delikler, yuvalar };
      }
    }
    return null;
  }
}

/** Üreticilerin parçaya iliştirdiği geçici alanları temizler. */
export function cleanupJointFields(parts) {
  for (const part of parts) {
    delete part._ring0;
    delete part._seamEdges;
    delete part._circles;
  }
}
