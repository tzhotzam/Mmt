// Modül → parça listesi. Her parça hem kesim (2B, delikli) hem 3B önizleme
// (kutu) bilgisini taşır.
//
// KOORDİNATLAR
//   Modül içi 3B: x sağa (genişlik), y yukarı (gövde altı = 0), z öne
//   (duvar = 0, gövde önü = d). Kapaklar z = d'nin önünde durur.
//
//   Parça çizimi 2B: x = "boy" (damar yönü), y = "en". Çizim, DELİNEN YÜZ
//   yukarı bakacak şekilde tezgâha konan parçanın tepeden görünüşüdür. Sol ve
//   sağ yan bu yüzden birbirinin aynası çıkar: aynı ölçü, farklı delik düzeni.
//
//   Kenar adları çizime göredir: x0 (x = 0 kenarı), x1 (x = boy), y0, y1.
//   Kenar bandı bu adlarla işaretlenir.
//
// Bu dosya tarayıcıya bağlı değildir; Node'dan doğrudan çağrılabilir.

import { HIRDAVAT, kapakTuru, dogrula } from './model.js';

const RAY_BOSLUK = 13;                       // bilyalı ray, her yanda
const RAY_BOYLARI = [600, 550, 500, 450, 400, 350, 300, 250];
const KUSAK = 100;                            // alt dolap üst kuşak eni

/**
 * Projeyi çözer: her modülün konumu ve parçaları.
 * @returns {{ moduller: Array, parcalar: Array, uyarilar: string[] }}
 */
export function projeyiCoz(proje, hir = HIRDAVAT) {
  const uyarilar = dogrula(proje);
  const konumlar = yerlestir(proje);
  const moduller = proje.moduller.map((m, i) => {
    const no = i + 1;
    const parcalar = modulParcalari(m, proje, hir);
    parcalar.forEach((p, k) => {
      p.no = `M${no}-${String(k + 1).padStart(2, '0')}`;
      p.modulNo = no;
      p.modulId = m.id;
      p.modulAd = m.ad;
    });
    return { m, no, konum: konumlar[i], parcalar };
  });
  const parcalar = moduller.flatMap((x) => x.parcalar);
  for (const p of parcalar) kesimOlcusu(p, proje.bant);
  return { moduller, parcalar, uyarilar };
}

/**
 * Modülleri duvar boyunca dizer. Alt ve boy dolaplar alt sırada, üst
 * dolaplar üst sırada ilerler; boy dolap iki sırayı birden doldurur.
 */
export function yerlestir(proje) {
  let alt = 0, ust = 0;
  return proje.moduller.map((m) => {
    if (m.tip === 'boy') {
      const x = Math.max(alt, ust);
      alt = ust = x + m.w;
      return { x, y: proje.ayakYukseklik, z: 0 };
    }
    if (m.tip === 'ust') {
      const x = ust;
      ust += m.w;
      return { x, y: proje.ustAltKot, z: 0 };
    }
    const x = alt;
    alt += m.w;
    return { x, y: proje.ayakYukseklik, z: 0 };
  });
}

/** Net ölçüden kesim ölçüsü: bantlı kenarlardan bant kalınlığı düşülür. */
export function kesimOlcusu(p, bant) {
  const bt = bant.kesimdenDus ? bant.kalinlik : 0;
  const b = p.bant;
  p.dx = b.x0 ? bt : 0;
  p.dy = b.y0 ? bt : 0;
  p.kesimBoy = yuvarla(p.boy - bt * ((b.x0 ? 1 : 0) + (b.x1 ? 1 : 0)));
  p.kesimEn = yuvarla(p.en - bt * ((b.y0 ? 1 : 0) + (b.y1 ? 1 : 0)));
  return p;
}

/** Kenar bandının uzunluğu (mm). */
export function bantUzunlugu(p) {
  const b = p.bant;
  return ((b.y0 ? 1 : 0) + (b.y1 ? 1 : 0)) * p.boy + ((b.x0 ? 1 : 0) + (b.x1 ? 1 : 0)) * p.en;
}

/** Bağlantı noktaları: kısa parçada ortada bir, normalde iki, derinde üç. */
export function baglantiNoktalari(d) {
  if (d < 200) return [yuvarla(d / 2)];
  if (d <= 600) return [50, yuvarla(d - 50)];
  return [50, yuvarla(d / 2), yuvarla(d - 50)];
}

/** Kapak yüksekliğine göre menteşe sayısı. */
export function menteseSayisi(h) {
  if (h <= 900) return 2;
  if (h <= 1600) return 3;
  if (h <= 2000) return 4;
  return 5;
}

export function rayBoyu(icDerinlik) {
  return RAY_BOYLARI.find((r) => r <= icDerinlik - 10) ?? 0;
}

// ----------------------------------------------------------------------------

function modulParcalari(m, proje, hir) {
  const t = proje.malzeme.govde.kalinlik;
  const ta = proje.malzeme.arkalik.kalinlik;
  const tk = proje.malzeme.kapak.kalinlik;
  const g = proje.kapakBosluk;
  const W = m.w, H = m.h, D = m.d;
  const Dg = D - ta;              // gövde parçalarının derinliği (arkalık çakma)
  const parcalar = [];

  const ekle = (p) => { parcalar.push(p); return p; };

  // ---- yanlar ----
  const yanBant = (sol) => {
    const b = { x0: false, x1: false, y0: false, y1: false };
    if (sol) b.y1 = true; else b.y0 = true;     // ön kenar
    if (m.tip === 'ust') { b.x0 = true; b.x1 = true; }
    if (m.tip === 'boy') b.x1 = true;
    return b;
  };
  const solYan = ekle(parca('Sol yan', 'yan', 'govde', t, H, Dg, yanBant(true), 'İç yüz',
    { x: 0, y: 0, z: ta, sx: t, sy: H, sz: Dg }));
  const sagYan = ekle(parca('Sağ yan', 'yan', 'govde', t, H, Dg, yanBant(false), 'İç yüz',
    { x: W - t, y: 0, z: ta, sx: t, sy: H, sz: Dg }));
  solYan.sol = true;

  /** Yan parçada (yükseklik, arkadan uzaklık) → çizim noktası. */
  const yanNokta = (yan, h, arkadan) => ({ x: h, y: yan.sol ? arkadan : Dg - arkadan });

  // ---- yatay parçalar (yanların arasına oturan) ----
  const yatay = (ad, grup, y, zBas, derinlik, yuz, onBant) => {
    const b = { x0: false, x1: false, y0: false, y1: false };
    if (onBant) { if (yuz === 'alt') b.y1 = true; else b.y0 = true; }
    const p = ekle(parca(ad, grup, 'govde', t, W - 2 * t, derinlik, b,
      yuz === 'alt' ? 'Alt yüz' : 'Üst yüz',
      { x: t, y, z: ta + zBas, sx: W - 2 * t, sy: t, sz: derinlik }));
    baglan(p, y + t / 2, zBas, derinlik, yuz);
    return p;
  };

  /** Yatay parçayı iki yana bağlayan delikler. */
  const baglan = (p, yc, zBas, derinlik, yuz) => {
    const L = p.boy;
    const tur = proje.baglanti;
    const mf = hir.minifix, kv = hir.kavela, vd = hir.vida;
    const pY = (arkadan) => (yuz === 'alt' ? arkadan : derinlik - arkadan);
    for (const q of baglantiNoktalari(derinlik)) {
      for (const yan of [solYan, sagYan]) {
        const kenar = yan.sol ? 'x0' : 'x1';
        const yn = yanNokta(yan, yc, zBas + q);
        if (tur === 'minifix' || tur === 'minifix+kavela') {
          yan.delikler.push(delik(yn.x, yn.y, mf.civataCap, mf.civataDerinlik, 'minifix'));
          p.delikler.push(delik(yan.sol ? mf.kamMesafe : L - mf.kamMesafe, pY(q), mf.kamCap, mf.kamDerinlik, 'minifix'));
          p.kenarDelik.push({ kenar, konum: pY(q), cap: mf.kenarCap, derinlik: mf.kenarDerinlik, tur: 'minifix' });
        }
        if (tur === 'kavela') {
          yan.delikler.push(delik(yn.x, yn.y, kv.cap, kv.yuzDerinlik, 'kavela'));
          p.kenarDelik.push({ kenar, konum: pY(q), cap: kv.cap, derinlik: kv.kenarDerinlik, tur: 'kavela' });
        }
        if (tur === 'minifix+kavela' && derinlik >= 200) {
          // Kavela minifixin 32 mm içine, parçanın ortasına doğru.
          const yon = q < derinlik / 2 ? 1 : -1;
          const qk = q + yon * kv.kaydir;
          const yk = yanNokta(yan, yc, zBas + qk);
          yan.delikler.push(delik(yk.x, yk.y, kv.cap, kv.yuzDerinlik, 'kavela'));
          p.kenarDelik.push({ kenar, konum: pY(qk), cap: kv.cap, derinlik: kv.kenarDerinlik, tur: 'kavela' });
        }
        if (tur === 'vida') {
          yan.delikler.push(delik(yn.x, yn.y, vd.cap, 'gecer', 'vida'));
          p.kenarDelik.push({ kenar, konum: pY(q), cap: vd.kenarCap, derinlik: vd.kenarDerinlik, tur: 'vida' });
        }
      }
    }
  };

  /** Ayarlı raflar: [alt, ust) aralığına eşit dağıtılır, yanlara pim deliği. */
  const raflar = (n, alt, ust, adOn = 'Raf') => {
    if (n <= 0) return;
    const rp = hir.rafPimi;
    const bos = ust - alt - n * t;
    const ara = bos / (n + 1);
    for (let i = 0; i < n; i++) {
      const yb = yuvarla(alt + ara * (i + 1) + t * i);
      ekle(parca(n > 1 ? `${adOn} ${i + 1}` : adOn, 'raf', 'govde', t, W - 2 * t - 2, Dg - 20,
        { x0: false, x1: false, y0: false, y1: true }, 'Fark etmez',
        { x: t + 1, y: yb, z: ta, sx: W - 2 * t - 2, sy: t, sz: Dg - 20 }));
      // Rafın altında pim, bir üstü ve bir altı ayar için.
      for (const k of [-1, 0, 1]) {
        const hy = yb - rp.alt + k * rp.adim;
        if (hy < alt + 25 || hy > ust - 25) continue;
        for (const yan of [solYan, sagYan]) {
          for (const arkadan of [rp.arka, Dg - rp.on]) {
            const n2 = yanNokta(yan, hy, arkadan);
            yan.delikler.push(delik(n2.x, n2.y, rp.cap, rp.derinlik, 'raf'));
          }
        }
      }
    }
  };

  /** Menteşeli kapak; menteşe tabanı deliklerini ilgili yana ekler. */
  const kapak = (ad, x0, x1, y0, y1, mentese, kulpYeri) => {
    const dw = yuvarla(x1 - x0), dh = yuvarla(y1 - y0);
    const p = ekle(parca(ad, 'kapak', 'kapak', tk, dh, dw,
      { x0: true, x1: true, y0: true, y1: true }, 'Arka yüz',
      { x: x0, y: y0, z: D, sx: dw, sy: dh, sz: tk }));
    p.hareket = { tip: 'kapak', mentese };
    const mh = hir.mentese;
    const n = menteseSayisi(dh);
    const yan = mentese === 'sol' ? solYan : sagYan;
    for (let i = 0; i < n; i++) {
      const hx = yuvarla(mh.ucBosluk + (dh - 2 * mh.ucBosluk) * (i / (n - 1)));
      p.delikler.push(delik(hx, mentese === 'sol' ? mh.kapMerkez : dw - mh.kapMerkez, mh.kapCap, mh.kapDerinlik, 'mentese'));
      for (const k of [-1, 1]) {
        const yn = yanNokta(yan, y0 + hx + (k * mh.tabanAralik) / 2, Dg - mh.tabanOn);
        yan.delikler.push(delik(yn.x, yn.y, mh.tabanCap, mh.tabanDerinlik, 'mentese'));
      }
    }
    // Kulp: menteşenin karşı kenarında, dikey.
    const K = proje.kulpAraligi;
    if (K > 0) {
      const ku = hir.kulp;
      let c = kulpYeri === 'ust' ? dh - ku.uc - K / 2 : ku.uc + K / 2;
      if (dh < K + 2 * ku.uc) c = dh / 2;
      const ky = mentese === 'sol' ? dw - ku.kenar : ku.kenar;
      for (const s of [-1, 1]) p.delikler.push(delik(yuvarla(c + (s * K) / 2), ky, ku.cap, 'gecer', 'kulp'));
    }
    return p;
  };

  /** Bir aralığa tek ya da çift kapak. */
  const kapaklar = (y0, y1, ad, kulpYeri) => {
    const tur = kapakTuru(m);
    if (tur === 'yok') return;
    if (tur === 'cift') {
      kapak(`${ad} sol`, g / 2, W / 2 - g / 2, y0, y1, 'sol', kulpYeri);
      kapak(`${ad} sağ`, W / 2 + g / 2, W - g / 2, y0, y1, 'sag', kulpYeri);
    } else {
      kapak(ad, g / 2, W - g / 2, y0, y1, m.mentese === 'sag' ? 'sag' : 'sol', kulpYeri);
    }
  };

  // ---- tipe göre gövde ----
  if (m.tip === 'alt') {
    yatay('Alt tabla', 'tabla', 0, 0, Dg, 'alt', true);
    yatay('Ön kuşak', 'kusak', H - t, Dg - KUSAK, KUSAK, 'ust', true);
    yatay('Arka kuşak', 'kusak', H - t, 0, KUSAK, 'ust', false);
    if (kapakTuru(m) === 'cekmece') cekmeceler();
    else {
      raflar(m.rafSayisi, t, H - t);
      kapaklar(0, H - g, 'Kapak', 'ust');
    }
  } else if (m.tip === 'ust') {
    yatay('Alt tabla', 'tabla', 0, 0, Dg, 'ust', true);
    yatay('Üst tabla', 'tabla', H - t, 0, Dg, 'ust', false);
    raflar(m.rafSayisi, t, H - t);
    kapaklar(g / 2, H - g / 2, 'Kapak', 'alt');
  } else {
    const sY = Math.round(m.sabitRaf);
    yatay('Alt tabla', 'tabla', 0, 0, Dg, 'alt', true);
    yatay('Üst tabla', 'tabla', H - t, 0, Dg, 'ust', false);
    yatay('Sabit raf', 'tabla', sY, 0, Dg, 'ust', true);
    raflar(m.rafSayisi, t, sY, 'Alt raf');
    raflar(m.ustRafSayisi ?? 0, sY + t, H - t, 'Üst raf');
    const bol = sY + t / 2;
    kapaklar(0, bol - g / 2, 'Alt kapak', 'ust');
    kapaklar(bol + g / 2, H - g / 2, 'Üst kapak', 'alt');
  }

  // ---- arkalık ----
  ekle(parca('Arkalık', 'arkalik', 'arkalik', ta, W, H,
    { x0: false, x1: false, y0: false, y1: false }, '—',
    { x: 0, y: 0, z: 0, sx: W, sy: H, sz: ta }));

  // ---- baza ----
  if (proje.baza && m.tip !== 'ust' && proje.ayakYukseklik > 30) {
    const bh = proje.ayakYukseklik;
    ekle(parca('Baza', 'baza', 'kapak', tk, W, bh,
      { x0: false, x1: false, y0: false, y1: false }, 'Fark etmez',
      { x: 0, y: -bh, z: D - 50 - tk, sx: W, sy: bh, sz: tk }));
  }

  return parcalar;

  // --------------------------------------------------------------------------
  function cekmeceler() {
    const n = Math.max(1, Math.min(6, Math.round(m.cekmeceSayisi || 1)));
    const fh = (H - n * g) / n;
    const L = rayBoyu(Dg);
    const Bw = W - 2 * t - 2 * RAY_BOSLUK;
    const bh = yuvarla(Math.max(60, Math.min(300, fh - 50)));
    for (let i = 0; i < n; i++) {
      const y0 = i * (fh + g);
      const fw = W - g;
      const on = ekle(parca(`Çekmece ön ${i + 1}`, 'cekmeceOn', 'kapak', tk, fw, yuvarla(fh),
        { x0: true, x1: true, y0: true, y1: true }, 'Arka yüz',
        { x: g / 2, y: y0, z: D, sx: fw, sy: yuvarla(fh), sz: tk }));
      on.hareket = { tip: 'cekmece', no: i, mesafe: L * 0.75 };
      const K = proje.kulpAraligi;
      if (K > 0) {
        for (const s of [-1, 1]) on.delikler.push(delik(yuvarla(fw / 2 + (s * K) / 2), yuvarla(fh / 2), hir.kulp.cap, 'gecer', 'kulp'));
      }
      if (!L) continue;
      const by = Math.max(t + 15, y0 + (fh - bh) / 2);
      const kx = t + RAY_BOSLUK;
      const hareket = { tip: 'cekmece', no: i, mesafe: L * 0.75 };
      const ust = { x0: false, x1: false, y0: false, y1: true };
      for (const [ad, x] of [['sol', kx], ['sağ', W - kx - t]]) {
        ekle(parca(`Çekmece ${i + 1} yan ${ad}`, 'cekmeceYan', 'govde', t, L, bh, { ...ust }, 'Fark etmez',
          { x, y: by, z: D - L, sx: t, sy: bh, sz: L })).hareket = hareket;
      }
      for (const [ad, z] of [['ön', D - t], ['arka', D - L]]) {
        ekle(parca(`Çekmece ${i + 1} ${ad} ayna`, 'cekmeceAyna', 'govde', t, Bw - 2 * t, bh, { ...ust }, 'Fark etmez',
          { x: kx + t, y: by, z, sx: Bw - 2 * t, sy: bh, sz: t })).hareket = hareket;
      }
      ekle(parca(`Çekmece ${i + 1} taban`, 'cekmeceTaban', 'arkalik', ta, Bw, L,
        { x0: false, x1: false, y0: false, y1: false }, '—',
        { x: kx, y: by - ta, z: D - L, sx: Bw, sy: ta, sz: L })).hareket = hareket;
    }
  }
}

function parca(ad, grup, malzeme, kalinlik, boy, en, bant, yuz, kutu) {
  return {
    ad, grup, malzeme, kalinlik,
    boy: yuvarla(boy), en: yuvarla(en),
    bant, yuz, kutu,
    delikler: [],
    kenarDelik: [],
  };
}

function delik(x, y, cap, derinlik, tur) {
  return { x: yuvarla(x), y: yuvarla(y), cap, derinlik, tur };
}

function yuvarla(v) {
  return Math.round(v * 10) / 10;
}
