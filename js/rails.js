// KIZAK — aralıklı dilim heykelde kanatları alttan tutan geçmeli çubuklar.
//
// Kanatlar (dikey dilimler) altlarından, dilim yönüne DİK uzanan kızaklara
// oturur. Klasik yarım geçme: kızakta her kanat için üstten açılmış bir yuva,
// kanatta kızak için alttan açılmış bir çentik. İkisi birbirine geçince:
//   - kanat kızak boyunca kayamaz (kızak yuvasının duvarları tutar),
//   - kızak kanat düzleminde kayamaz (kanat çentiği tutar),
//   - kanatlar arası boşluğu yuvalar belirler — ara boru, pul gerekmez.
// Kızak kanatlarla aynı sacdan kesilir.
//
// Koordinatlar: dilim düzlemi (u, v). X boyunca dilimde u = model y
// (yatay), v = model z (dikey). Y boyunca dilimde u = model z (dikey),
// v = model x (yatay). Z boyunca (yatay dilim) kızak anlamsızdır.

const YUVA_PAYI = 0.2;   // geçme boşluğu (mm): lazer kesimde sıkı ama takılır

/** Dikey ve yatay düzlem koordinatının indisleri; Z ekseninde null. */
export function railAxes(axis) {
  if (axis === 'x') return { vi: 1, hi: 0 };
  if (axis === 'y') return { vi: 0, hi: 1 };
  return null;
}

/** Halkanın `h` yatay konumundaki dikey doğruyla kesişimleri (sıralı). */
function kesisimler(ring, hi, vi, h) {
  const out = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    if ((a[hi] <= h) === (b[hi] <= h)) continue;
    const t = (h - a[hi]) / (b[hi] - a[hi]);
    out.push({ v: a[vi] + t * (b[vi] - a[vi]), k, t });
  }
  return out.sort((x, y) => x.v - y.v);
}

/**
 * Bir katmanda `h` konumunda kanadın ALT kenarı: en alttaki kesişim ve ilk
 * dolu aralığın boyu. Yoksa null.
 */
function altKenar(ada, hi, vi, h) {
  const c = kesisimler(ada.outline, hi, vi, h);
  if (c.length < 2) return null;
  let dolu = c[1].v - c[0].v;
  // Delik ilk aralığı kesiyorsa aralık orada biter.
  for (const hole of ada.holes || []) {
    const hc = kesisimler(hole, hi, vi, h);
    if (hc.length && hc[0].v > c[0].v && hc[0].v < c[1].v) dolu = Math.min(dolu, hc[0].v - c[0].v);
  }
  return { zb: c[0].v, dolu };
}

/**
 * Kanadın alt kenarına kızak çentiği açar: [h - w/2, h + w/2] genişliğinde,
 * alt kenardan `ust` yüksekliğine kadar. Halkayı yerinde değiştirmez, yenisini
 * döndürür; alt kenar bu genişlikte tek ve düzgün bir zincir değilse null.
 */
export function notchBottom(ring, hi, vi, h, w, ust) {
  const h1 = h - w / 2, h2 = h + w / 2;
  const alt = (hh) => kesisimler(ring, hi, vi, hh)[0];
  const k1 = alt(h1), k2 = alt(h2);
  if (!k1 || !k2) return null;
  if (ust <= Math.max(k1.v, k2.v) + 0.3) return null;
  const nokta = (hh, vv) => { const p = [0, 0]; p[hi] = hh; p[vi] = vv; return p; };
  const P1 = nokta(h1, k1.v), P2 = nokta(h2, k2.v);
  const n = ring.length;

  // İleri yönde a'dan b'ye giden alt zincir çentik bölgesinde mi kalıyor?
  const dene = (ka, kb, Pa, Pb, ha, hb) => {
    const zincir = [];
    if (ka.k === kb.k) {
      if (ka.t >= kb.t) return null;
    } else {
      for (let k = (ka.k + 1) % n, g = 0; g < n; k = (k + 1) % n, g++) {
        zincir.push(ring[k]);
        if (k === kb.k) break;
      }
      if (!zincir.length || zincir.length >= n - 1) return null;
    }
    const lo = Math.min(h1, h2) - 1e-6, hiH = Math.max(h1, h2) + 1e-6;
    if (zincir.some((q) => q[hi] < lo || q[hi] > hiH || q[vi] >= ust)) return null;
    const kalan = [];
    for (let k = (kb.k + 1) % n, g = 0; g < n; k = (k + 1) % n, g++) {
      kalan.push(ring[k]);
      if (k === ka.k) break;
    }
    return [...kalan, Pa, nokta(ha, ust), nokta(hb, ust), Pb];
  };
  return dene(k1, k2, P1, P2, h1, h2) || dene(k2, k1, P2, P1, h2, h1);
}

/**
 * Kızak yerlerini seçer ve her kızağın geçtiği kanatları bulur.
 *
 * @param layers  [{ coord, adalar: [{ outline, holes, area }] }]
 * @returns {Array<{h, fins: [{li, ai, zb}]}>}
 */
export function planRails(layers, p) {
  const ax = railAxes(p.axis);
  if (!ax) return [];
  const { vi, hi } = ax;
  const e = railEngage(p);
  const w = p.thickness + YUVA_PAYI;

  let lo = Infinity, hiMax = -Infinity, zmin = Infinity;
  for (const l of layers) {
    for (const ada of l.adalar) {
      for (const q of ada.outline) {
        if (q[hi] < lo) lo = q[hi];
        if (q[hi] > hiMax) hiMax = q[hi];
        if (q[vi] < zmin) zmin = q[vi];
      }
    }
  }
  if (!(hiMax > lo)) return [];
  const aralik = hiMax - lo;

  // Aday konum: her katmanda en alttaki kanat, çentik için yeterli dolu
  // aralık ve temiz bir alt kenar taşıyorsa geçerli. Kızak ARDIŞIK
  // kanatlardan geçer ve komşu iki kanadın dibi arasında en çok `sicrama`
  // fark olabilir. Kızağın alt kenarı kanat diplerini izlediği için gövdenin
  // yavaşça kavislenen altını sorunsuz takip eder; tekerlek kemeri ise
  // ani bir sıçramadır, kızak oraya tırmanmaz (konsept arabada ikinci kızak
  // arka tekerleğin içine düşüyordu).
  const sicrama = 2 * e;
  const degerlendir = (h) => {
    const girdi = layers.map((l) => {
      let enIyi = null;
      l.adalar.forEach((ada, ai) => {
        const a = altKenar(ada, hi, vi, h);
        if (a && (!enIyi || a.zb < enIyi.zb)) enIyi = { ai, ...a };
      });
      if (!enIyi) return null;
      const tamam = enIyi.dolu >= e + 3 &&
        notchBottom(l.adalar[enIyi.ai].outline, hi, vi, h, w, enIyi.zb + e / 2) !== null;
      return tamam ? enIyi : null;
    });
    let enUzun = [], dizi = [];
    girdi.forEach((f, li) => {
      if (!f) { dizi = []; return; }
      const onceki = dizi[dizi.length - 1];
      if (onceki && Math.abs(f.zb - onceki.zb) > sicrama) dizi = [];
      dizi.push({ li, ai: f.ai, zb: f.zb });
      if (dizi.length > enUzun.length) enUzun = dizi;
    });
    if (enUzun.length < 2) return null;
    const zs = enUzun.map((f) => f.zb);
    const oynama = Math.max(...zs) - Math.min(...zs);
    const yukseklik = zs.reduce((s, z) => s + z - zmin, 0) / zs.length;
    return { h, fins: enUzun, oynama, puan: enUzun.length - 0.02 * yukseklik / e };
  };

  const adaylar = [];
  // Uçlara yakın adaylar da denenir: tampon köşeleri gibi kısa parçalar
  // yalnızca oradan geçen bir kızağa oturur.
  for (let i = 0; i <= 80; i++) {
    const d = degerlendir(lo + aralik * (0.03 + 0.94 * (i / 80)));
    if (d) adaylar.push(d);
  }
  adaylar.sort((a, b) => b.puan - a.puan);
  const secilen = [];
  const sabit = p.railCount > 0;
  const adet = sabit ? Math.round(p.railCount) : 2;
  for (const a of adaylar) {
    if (secilen.length >= adet) break;
    if (secilen.some((s) => Math.abs(s.h - a.h) < aralik * (adet > 2 ? 0.2 : 0.35))) continue;
    secilen.push(a);
  }

  // Otomatikte kızak, kızağa ulaşmayan parça kalmayana dek eklenir. Dış
  // kanatları tekerlek kemeri böler: ön ve arka parçalar aks arasındaki iki
  // kızağa değmez, mile muhtaç kalıyordu. Ön ve arka çıkıntıya birer kızak
  // daha girince onları da tutar. Yeni kızak en az bir TUTULAN parçadan
  // geçmeli, yoksa kendi başına havada kalan bir öbek tutar.
  if (!sabit && secilen.length) {
    const anahtar = (f) => f.li * 4096 + f.ai;
    const tutulan = new Set(secilen.flatMap((s) => s.fins.map(anahtar)));
    const enAzAra = Math.max(2.5 * e, 20);
    while (secilen.length < KIZAK_EN_COK) {
      let enIyi = null, enIyiKazanc = 0;
      for (const a of adaylar) {
        if (secilen.some((s) => Math.abs(s.h - a.h) < enAzAra)) continue;
        let kazanc = 0, bagli = false;
        for (const f of a.fins) {
          if (tutulan.has(anahtar(f))) bagli = true; else kazanc++;
        }
        if (bagli && kazanc > enIyiKazanc) { enIyi = a; enIyiKazanc = kazanc; }
      }
      if (!enIyi) break;
      secilen.push(enIyi);
      for (const f of enIyi.fins) tutulan.add(anahtar(f));
    }
  }
  return secilen.sort((a, b) => a.h - b.h);
}

const KIZAK_EN_COK = 6;

export function railEngage(p) {
  return p.railEngage > 0 ? p.railEngage : Math.max(10, 5 * p.thickness);
}

/**
 * Kızak parçası: (s = dilim ekseni koordinatı, z = dikey) düzleminde.
 * Üst kenar basamaklı: her kanadın altında kanat kalınlığında yuva.
 */
export function railPart(rail, layers, p, id) {
  const e = railEngage(p);
  const t = p.thickness;
  const ys = t + YUVA_PAYI;
  const alt = p.railBelow || 0;
  const fins = rail.fins.map((f) => ({ s: layers[f.li].coord, zb: f.zb, li: f.li }))
    .sort((a, b) => a.s - b.s);
  const ust = fins.map((f) => f.zb + e);
  const xs = fins[0].s - ys / 2 - 3, xe = fins[fins.length - 1].s + ys / 2 + 3;

  // Üst kenar basamaklı: her kanadın altında kanat kalınlığında yuva.
  const tepe = [[xs, ust[0]]];
  fins.forEach((f, i) => {
    const sol = i === 0 ? ust[0] : Math.max(ust[i - 1], ust[i]);
    const sag = i === fins.length - 1 ? ust[i] : Math.max(ust[i], ust[i + 1]);
    const xl = f.s - ys / 2, xr = f.s + ys / 2, m = f.zb + e / 2;
    tepe.push([xl, sol], [xl, m], [xr, m], [xr, sag]);
  });
  tepe.push([xe, ust[ust.length - 1]]);
  // Alt kenar kanat diplerini izler: kızak, gövdenin altına yapışık sabit
  // yükseklikte bir şerit olur. Düz alt kenarla gövde yana doğru
  // yükseldiğinde dış kanatların altında yandan görünen bir plaka kalıyordu.
  const dip = [[xs, fins[0].zb - alt], ...fins.map((f) => [f.s, f.zb - alt]),
    [xe, fins[fins.length - 1].zb - alt]];
  const outline = [...dip, ...tepe.reverse()];

  // Ad, ortadaki iki kanadın arasına; her beşinci kanadın numarası yuvanın
  // altına: montajda yer bulmak kolay.
  const k = Math.max(0, Math.floor(fins.length / 2) - 1);
  const k2 = Math.min(fins.length - 1, k + 1);
  const engrave = [{
    type: 'text', text: id,
    x: (fins[k].s + fins[k2].s) / 2,
    y: Math.max(fins[k].zb, fins[k2].zb) - alt + 1.5,
    size: Math.min(5, e / 3),
  }];
  fins.forEach((f) => {
    const no = f.li + 1;
    if (no % 5 === 0) engrave.push({ type: 'text', text: String(no), x: f.s, y: f.zb - alt + 1.8, size: 2.5 });
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of outline) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return {
    id, kind: 'kizak', outline, holes: [], engrave,
    w: maxX - minX, h: maxY - minY,
    meta: { rail: true, h: rail.h, fins: fins.length },
  };
}

export { YUVA_PAYI };
