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

import { HIRDAVAT, kapakTuru, dogrula, makineMi, evyeMi, bolumler } from './model.js';
import { yerlestir, mekanNotlari } from './mekan.js';

const RAY_BOSLUK = 13;                       // bilyalı ray, her yanda
const RAY_BOYLARI = [600, 550, 500, 450, 400, 350, 300, 250];
const KUSAK = 100;                            // alt dolap üst kuşak eni

/**
 * Projeyi çözer: her modülün konumu, parçaları ve içindeki cihazlar.
 * @returns {{ moduller: Array, parcalar: Array, uyarilar: string[], notlar: string[] }}
 */
export function projeyiCoz(proje, hir = HIRDAVAT) {
  const konumlar = yerlestir(proje);
  const mn = mekanNotlari(proje, konumlar);
  const uyarilar = [...dogrula(proje), ...mn.uyarilar];
  const moduller = proje.moduller.map((m, i) => {
    const no = i + 1;
    const { parcalar, cihazlar } = modulParcalari(m, proje, hir, konumlar[i]);
    parcalar.forEach((p, k) => {
      p.no = `M${no}-${String(k + 1).padStart(2, '0')}`;
      p.modulNo = no;
      p.modulId = m.id;
      p.modulAd = m.ad;
      // Kapak rengi modülden gelebilir; renk değişince levha da değişir.
      if (p.malzeme === 'kapak') p.renk = m.kapakRenk || proje.malzeme.kapak.renk;
      else if (p.malzeme === 'govde') p.renk = proje.malzeme.govde.renk;
      else p.renk = '';
    });
    return { m, no, konum: konumlar[i], parcalar, cihazlar };
  });
  const parcalar = moduller.flatMap((x) => x.parcalar);
  for (const p of parcalar) kesimOlcusu(p, proje.bant);
  return { moduller, parcalar, uyarilar, notlar: mn.notlar };
}

export { yerlestir };

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

/** Kenar bandının uzunluğu (mm). Camlı kapakta pencerenin iç kenarı da bantlanır. */
export function bantUzunlugu(p) {
  const b = p.bant;
  let L = ((b.y0 ? 1 : 0) + (b.y1 ? 1 : 0)) * p.boy + ((b.x0 ? 1 : 0) + (b.x1 ? 1 : 0)) * p.en;
  if (p.pencere) L += 2 * (p.pencere.x1 - p.pencere.x0 + p.pencere.y1 - p.pencere.y0);
  return L;
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

/**
 * Bir modülün parçaları ve içindeki cihazlar (fırın, buzdolabı… yalnız 3B).
 * konum: yerlestir() çıktısı (kör köşe payı, kolon önü derinlik kısalması).
 */
function modulParcalari(m0, proje, hir, konum = {}) {
  let m = m0;
  if (konum.dAzalt) m = { ...m, d: m.d - konum.dAzalt };
  // Kör köşe dolabı tek bölümlü ve kapaklıdır.
  if (m.kose && konum.kor > 0) m = { ...m, bolme: 0, kapak: m.kapak === 'cekmece' ? 'otomatik' : m.kapak };
  const cihazlar = [];
  const parcalar = [];
  const ekle = (p) => { parcalar.push(p); return p; };
  const sonuc = () => ({ parcalar, cihazlar });

  const t = proje.malzeme.govde.kalinlik;
  const ta = proje.malzeme.arkalik.kalinlik;
  const tk = proje.malzeme.kapak.kalinlik;
  const g = proje.kapakBosluk;

  // Davlumbaz yeri: boşluk + üstte kısa dolap (üst sıranın üst kotuna hizalı).
  let yKaydir = 0;
  if (m.tip === 'ust' && m.ustTur === 'davlumbaz') {
    const kh = Math.max(0, Math.min(m.h, m.kisaH || 0));
    cihazlar.push({ tip: 'davlumbaz', x: 0, y: 0, w: m.w, h: m.h - kh, d: m.d });
    if (kh < 150) return sonuc();
    yKaydir = m.h - kh;
    m = { ...m, h: kh, rafSayisi: 0, bolme: 0, cam: 'yok' };
  }

  const W = m.w, H = m.h, D = m.d;
  const Dg = D - ta;              // gövde parçalarının derinliği (arkalık çakma)

  // ---- makine yerleri: gövde yok ----
  if (makineMi(m)) {
    if (m.altTur === 'bulasik') {
      // Ankastre: makinenin kapağına vidalanan panel; menteşe yok, kulp üstte yatay.
      const dw = yuvarla(W - g), dh = yuvarla(H - g);
      const p = ekle(parca('Bulaşık makinesi paneli', 'kapak', 'kapak', tk, dh, dw,
        { x0: true, x1: true, y0: true, y1: true }, 'Arka yüz',
        { x: g / 2, y: 0, z: D, sx: dw, sy: dh, sz: tk }));
      p.hareket = { tip: 'devril' };
      const K = proje.kulpAraligi;
      if (K > 0) for (const s of [-1, 1]) p.delikler.push(delik(dh - 60, yuvarla(dw / 2 + (s * K) / 2), hir.kulp.cap, 'gecer', 'kulp'));
      baza();
    }
    return sonuc();
  }

  const boyTur = m.tip === 'boy' ? m.boyTur || 'normal' : null;
  const altFirin = m.tip === 'alt' && m.altTur === 'firin';

  // ---- yanlar ----
  const yanBant = (sol) => {
    const b = { x0: false, x1: false, y0: false, y1: false };
    if (sol) b.y1 = true; else b.y0 = true;     // ön kenar
    if (m.tip === 'ust') { b.x0 = true; b.x1 = true; }
    if (m.tip === 'boy') b.x1 = true;
    if (boyTur === 'buzdolabi') b.x0 = true;    // altı açık
    return b;
  };
  const solYan = ekle(parca('Sol yan', 'yan', 'govde', t, H, Dg, yanBant(true), 'İç yüz',
    { x: 0, y: 0, z: ta, sx: t, sy: H, sz: Dg }));
  const sagYan = ekle(parca('Sağ yan', 'yan', 'govde', t, H, Dg, yanBant(false), 'İç yüz',
    { x: W - t, y: 0, z: ta, sx: t, sy: H, sz: Dg }));
  solYan.sol = true;
  solYan.y0 = 0;
  sagYan.y0 = 0;

  /**
   * Dikey parçada (gövde yüksekliği h, arkadan uzaklık) → çizim noktası.
   * Sol yan iç yüzü +x'e, sağ yan ve ara dikmenin çizim yüzü −x'e bakar.
   */
  const dikNokta = (dk, h, arkadan) => ({ x: h - dk.y0, y: dk.sol ? arkadan : Dg - arkadan });

  // ---- yatay parçalar (yanların arasına oturan) ----
  const yataylar = [];
  const yatay = (ad, grup, y, zBas, derinlik, yuz, onBant) => {
    const b = { x0: false, x1: false, y0: false, y1: false };
    if (onBant) { if (yuz === 'alt') b.y1 = true; else b.y0 = true; }
    const p = ekle(parca(ad, grup, 'govde', t, W - 2 * t, derinlik, b,
      yuz === 'alt' ? 'Alt yüz' : 'Üst yüz',
      { x: t, y, z: ta + zBas, sx: W - 2 * t, sy: t, sz: derinlik }));
    baglan(p, y + t / 2, zBas, derinlik, yuz);
    yataylar.push({ p, y, zBas, derinlik, yuz });
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
        const yn = dikNokta(yan, yc, zBas + q);
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
          const yk = dikNokta(yan, yc, zBas + qk);
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

  /** Ayarlı raflar: [alt, ust) aralığına, bir bölümün iki duvarı arasına. */
  const raflar = (n, alt, ust, bol, adOn = 'Raf') => {
    if (n <= 0) return;
    const rp = hir.rafPimi;
    const bos = ust - alt - n * t;
    const ara = bos / (n + 1);
    const rw = bol.xb - bol.xa - 2;
    for (let i = 0; i < n; i++) {
      const yb = yuvarla(alt + ara * (i + 1) + t * i);
      ekle(parca(n > 1 ? `${adOn} ${i + 1}` : adOn, 'raf', 'govde', t, rw, Dg - 20,
        { x0: false, x1: false, y0: false, y1: true }, 'Fark etmez',
        { x: bol.xa + 1, y: yb, z: ta, sx: rw, sy: t, sz: Dg - 20 }));
      // Rafın altında pim, bir üstü ve bir altı ayar için. Ara dikmede boydan geçer
      // (iki yandaki bölüme de hizmet eder).
      for (const k of [-1, 0, 1]) {
        const hy = yb - rp.alt + k * rp.adim;
        if (hy < alt + 25 || hy > ust - 25) continue;
        for (const dk of [bol.sol, bol.sag]) {
          for (const arkadan of [rp.arka, Dg - rp.on]) {
            const n2 = dikNokta(dk, hy, arkadan);
            const d = delik(n2.x, n2.y, rp.cap, dk.dikme ? 'gecer' : rp.derinlik, 'raf');
            if (!dk.delikler.some((x) => x.x === d.x && x.y === d.y && x.cap === d.cap)) dk.delikler.push(d);
          }
        }
      }
    }
  };

  /** Menteşeli kapak; menteşe tabanı deliklerini ilgili dikey parçaya ekler. */
  const kapak = (ad, x0, x1, y0, y1, mentese, kulpYeri, cam, tasiyici) => {
    const dw = yuvarla(x1 - x0), dh = yuvarla(y1 - y0);
    const p = ekle(parca(ad, 'kapak', 'kapak', tk, dh, dw,
      { x0: true, x1: true, y0: true, y1: true }, 'Arka yüz',
      { x: x0, y: y0, z: D, sx: dw, sy: dh, sz: tk }));
    p.hareket = { tip: 'kapak', mentese };
    if (cam === 'aluminyum') {
      // Hazır alınır: levhaya girmez, bantlanmaz.
      p.malzeme = 'aluminyum';
      p.ad = `${ad} (alüminyum cam)`;
      p.bant = { x0: false, x1: false, y0: false, y1: false };
      p.cam = { tur: 'aluminyum' };
    } else if (cam === 'cerceve') {
      const c = proje.cam.cerceve, L = proje.cam.lamba, b = proje.cam.bosluk;
      if (dh - 2 * c >= 60 && dw - 2 * c >= 60) {
        // Çizimde x = kapak yüksekliği, y = genişlik (arka yüzden).
        p.pencere = { x0: c, y0: c, x1: yuvarla(dh - c), y1: yuvarla(dw - c) };
        p.lamba = { x0: c - L, y0: c - L, x1: yuvarla(dh - c + L), y1: yuvarla(dw - c + L), derinlik: proje.cam.lambaDerinlik };
        p.cam = { tur: 'cerceve' };
        const cb = yuvarla(dh - 2 * c + 2 * L - 2 * b), ce = yuvarla(dw - 2 * c + 2 * L - 2 * b);
        const camP = ekle(parca(`Cam · ${ad}`, 'cam', 'cam', proje.cam.kalinlik, cb, ce,
          { x0: false, x1: false, y0: false, y1: false }, '—',
          { x: x0 + c - L + b, y: y0 + c - L + b, z: D, sx: ce, sy: cb, sz: proje.cam.kalinlik }));
        camP.camTuru = proje.cam.tur;
      }
    }
    const mh = hir.mentese;
    const n = menteseSayisi(dh);
    const dk = tasiyici || (mentese === 'sol' ? solYan : sagYan);
    for (let i = 0; i < n; i++) {
      const hx = yuvarla(mh.ucBosluk + (dh - 2 * mh.ucBosluk) * (i / (n - 1)));
      p.delikler.push(delik(hx, mentese === 'sol' ? mh.kapMerkez : dw - mh.kapMerkez, mh.kapCap, mh.kapDerinlik, 'mentese'));
      for (const k of [-1, 1]) {
        const yn = dikNokta(dk, y0 + hx + (k * mh.tabanAralik) / 2, Dg - mh.tabanOn);
        dk.delikler.push(delik(yn.x, yn.y, mh.tabanCap, mh.tabanDerinlik, 'mentese'));
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

  /** Sabit (menteşesiz) ön panel: kör köşe, fırın altı. */
  const sabitPanel = (ad, x0, x1, y0, y1) => ekle(parca(ad, 'kapak', 'kapak', tk, yuvarla(y1 - y0), yuvarla(x1 - x0),
    { x0: true, x1: true, y0: true, y1: true }, 'Fark etmez',
    { x: x0, y: y0, z: D, sx: yuvarla(x1 - x0), sy: yuvarla(y1 - y0), sz: tk }));

  // ---- bölümler (ara dikmeler) ----
  const icerik = bolumler(m);
  const nb = icerik.length;
  const bolum = (() => {
    const cw = (W - 2 * t - (nb - 1) * t) / nb;
    const dikmeler = [];
    return { cw, dikmeler };
  })();

  /** Bölümlere kapak: tek bölümde tek/çift, bölmelide her bölüme bir kapak. */
  const kapaklar = (y0, y1, ad, kulpYeri, camli = true, bolList = null) => {
    const tur = kapakTuru(m);
    if (tur === 'yok') return;
    const cam = camli && m.cam && m.cam !== 'yok' ? m.cam : null;
    if (m.kose && konum.kor > 0) {
      // Kör köşe: köşe tarafı sabit panel, kapak açık kısımda, menteşe dış yanda.
      const kor = Math.min(konum.kor, W - 150);
      sabitPanel('Kör panel', 0, kor - g / 2, y0, y1);
      kapak(ad, kor + g / 2, W - g / 2, y0, y1, 'sag', kulpYeri, cam);
      return;
    }
    const bl = bolList || tumBolumler;
    if (bl.length === 1 && bl[0].tek) {
      if (tur === 'cift') {
        kapak(`${ad} sol`, g / 2, W / 2 - g / 2, y0, y1, 'sol', kulpYeri, cam);
        kapak(`${ad} sağ`, W / 2 + g / 2, W - g / 2, y0, y1, 'sag', kulpYeri, cam);
      } else {
        kapak(ad, g / 2, W - g / 2, y0, y1, m.mentese === 'sag' ? 'sag' : 'sol', kulpYeri, cam);
      }
      return;
    }
    bl.forEach((b) => {
      const ms = b.i === 0 ? 'sol' : 'sag';
      kapak(`${ad} ${b.i + 1}`, b.onX0, b.onX1, y0, y1, ms, kulpYeri, cam, ms === 'sol' ? b.sol : b.sag);
    });
  };

  // Bölümlerin x aralıkları ve duvarları (dikmeler aşağıda oluşturulur).
  const tumBolumler = [];
  const dikmeOlustur = (yAlt, yUst) => {
    let x = t;
    let sol = solYan;
    for (let i = 0; i < nb; i++) {
      const xa = x, xb = x + bolum.cw;
      let sag = sagYan;
      if (i < nb - 1) {
        const dh = yUst - yAlt;
        sag = ekle(parca(`Ara dikme ${i + 1}`, 'dikme', 'govde', t, yuvarla(dh), Dg,
          { x0: false, x1: false, y0: true, y1: false }, 'Sol yüz',
          { x: xb, y: yAlt, z: ta, sx: t, sy: dh, sz: Dg }));
        sag.dikme = true;
        sag.sol = false;
        sag.y0 = yAlt;
        sag.xOrta = xb + t / 2;
        bolum.dikmeler.push(sag);
      }
      const onX0 = i === 0 ? g / 2 : xa - t / 2 + g / 2;
      const onX1 = i === nb - 1 ? W - g / 2 : xb + t / 2 - g / 2;
      tumBolumler.push({ i, xa, xb, sol, sag, onX0, onX1, icerik: icerik[i], tek: nb === 1 });
      sol = sag;
      x = xb + t;
    }
    // Dikmeyi alt ve üst yatay parçaya konfirmatla bağla: yatayda boydan Ø7,
    // dikmenin ucunda Ø5 kenar deliği. (Minifix kamı iki yüzden de gerekirdi.)
    const vd = hir.vida;
    for (const dk of bolum.dikmeler) {
      for (const yt of yataylar) {
        const altta = Math.abs(yt.y + t - yAlt) < 0.5;
        const ustte = Math.abs(yt.y - yUst) < 0.5;
        if (!altta && !ustte) continue;
        for (const q of baglantiNoktalari(yt.derinlik)) {
          const px = dk.xOrta - t;
          const py = yt.yuz === 'alt' ? q : yt.derinlik - q;
          yt.p.delikler.push(delik(px, py, vd.cap, 'gecer', 'vida'));
          dk.kenarDelik.push({ kenar: altta ? 'x0' : 'x1', konum: yuvarla(Dg - (yt.zBas + q)), cap: vd.kenarCap, derinlik: vd.kenarDerinlik, tur: 'vida' });
        }
      }
    }
  };

  // ---- tipe göre gövde ----
  let arkaliklar = [[0, H]];
  if (m.tip === 'alt') {
    yatay('Alt tabla', 'tabla', 0, 0, Dg, 'alt', true);
    yatay('Ön kuşak', 'kusak', H - t, Dg - KUSAK, KUSAK, 'ust', true);
    yatay('Arka kuşak', 'kusak', H - t, 0, KUSAK, 'ust', false);
    if (altFirin) {
      // Ankastre fırın: tezgâh altında 600 mm niş, altında sabit panel.
      const rafY = H - t - 600 - t;
      yatay('Fırın rafı', 'tabla', rafY, 0, Dg, 'ust', true);
      sabitPanel('Fırın altı panel', g / 2, W - g / 2, 0, rafY + t - g / 2);
      cihazlar.push({ tip: 'firin', x: t, y: rafY + t, w: W - 2 * t, h: 595, d: Dg });
      cihazlar.push({ tip: 'ocak', x: 0, y: H, w: W, h: 0, d: D });
      arkaliklar = [];      // fırın havalandırması
    } else {
      dikmeOlustur(t, H - t);
      const kapakli = tumBolumler.filter((b) => b.icerik === 'raf');
      for (const b of tumBolumler) {
        if (b.icerik === 'cekmece') cekmeceler(b);
        else if (!evyeMi(m)) raflar(m.rafSayisi, t, H - t, b);
      }
      if (m.kose && konum.kor > 0) kapaklar(0, H - g, 'Kapak', 'ust');
      else if (kapakli.length) kapaklar(0, H - g, 'Kapak', 'ust', true, kapakli);
      if (evyeMi(m)) arkaliklar = [];
    }
  } else if (m.tip === 'ust') {
    yatay('Alt tabla', 'tabla', 0, 0, Dg, 'ust', true);
    yatay('Üst tabla', 'tabla', H - t, 0, Dg, 'ust', false);
    dikmeOlustur(t, H - t);
    for (const b of tumBolumler) raflar(m.rafSayisi, t, H - t, b);
    kapaklar(g / 2, H - g / 2, 'Kapak', 'alt');
  } else if (boyTur === 'firin') {
    // Fırın kolonu: alt dolap | fırın nişi | mikrodalga nişi | üst dolap.
    const fA = Math.round(m.firinAlt);
    const y1 = fA - t;                       // fırın rafı
    const y2 = fA + 590;                     // fırın üstü
    const y3 = m.mikrodalga ? y2 + t + 380 : null;
    const yTop = y3 ?? y2;
    yatay('Alt tabla', 'tabla', 0, 0, Dg, 'alt', true);
    yatay('Üst tabla', 'tabla', H - t, 0, Dg, 'ust', false);
    yatay('Fırın rafı', 'tabla', y1, 0, Dg, 'ust', true);
    yatay('Fırın üstü raf', 'tabla', y2, 0, Dg, 'ust', true);
    if (y3) yatay('Mikrodalga üstü raf', 'tabla', y3, 0, Dg, 'ust', true);
    const tek = { i: 0, xa: t, xb: W - t, sol: solYan, sag: sagYan, tek: true };
    raflar(m.rafSayisi, t, y1, tek, 'Alt raf');
    raflar(m.ustRafSayisi ?? 0, yTop + t, H - t, tek, 'Üst raf');
    kapaklar(0, y1 + t / 2 - g / 2, 'Alt kapak', 'ust', false, [tek]);
    kapaklar(yTop + t / 2 + g / 2, H - g / 2, 'Üst kapak', 'alt', true, [tek]);
    cihazlar.push({ tip: 'firin', x: t, y: fA, w: W - 2 * t, h: 590, d: Dg });
    if (y3) cihazlar.push({ tip: 'mikrodalga', x: t, y: y2 + t, w: W - 2 * t, h: 380, d: Dg });
    arkaliklar = [[0, fA], [yTop, H]];
  } else if (boyTur === 'buzdolabi') {
    // Buzdolabı yeri: iki boy yan, altta arka kuşak, üstte köprü dolap.
    const kh = Math.round(m.kopruH);
    yatay('Alt arka kuşak', 'kusak', 0, 0, KUSAK, 'ust', false);
    yatay('Köprü alt tabla', 'tabla', H - kh, 0, Dg, 'ust', true);
    yatay('Üst tabla', 'tabla', H - t, 0, Dg, 'ust', false);
    kapaklar(H - kh, H - g / 2, 'Köprü kapak', 'alt', true,
      [{ i: 0, xa: t, xb: W - t, sol: solYan, sag: sagYan, tek: true }]);
    cihazlar.push({ tip: 'buzdolabi', x: t + 10, y: -proje.ayakYukseklik, w: W - 2 * t - 20, h: H - kh + proje.ayakYukseklik - 10, d: Math.min(D, 650) });
    arkaliklar = [[H - kh, H]];
  } else {
    const sY = Math.round(m.sabitRaf);
    yatay('Alt tabla', 'tabla', 0, 0, Dg, 'alt', true);
    yatay('Üst tabla', 'tabla', H - t, 0, Dg, 'ust', false);
    yatay('Sabit raf', 'tabla', sY, 0, Dg, 'ust', true);
    const tek = { i: 0, xa: t, xb: W - t, sol: solYan, sag: sagYan, tek: true };
    raflar(m.rafSayisi, t, sY, tek, 'Alt raf');
    raflar(m.ustRafSayisi ?? 0, sY + t, H - t, tek, 'Üst raf');
    const bol = sY + t / 2;
    kapaklar(0, bol - g / 2, 'Alt kapak', 'ust', false, [tek]);
    kapaklar(bol + g / 2, H - g / 2, 'Üst kapak', 'alt', true, [tek]);
  }

  // ---- arkalık (evye ve fırın altında yok; fırın kolonunda niş açık) ----
  arkaliklar.forEach(([a, b], i) => {
    ekle(parca(arkaliklar.length > 1 ? `Arkalık ${i + 1}` : 'Arkalık', 'arkalik', 'arkalik', ta, W, yuvarla(b - a),
      { x0: false, x1: false, y0: false, y1: false }, '—',
      { x: 0, y: a, z: 0, sx: W, sy: yuvarla(b - a), sz: ta }));
  });

  if (m.tip !== 'ust' && boyTur !== 'buzdolabi') baza();

  if (yKaydir) for (const p of parcalar) p.kutu.y += yKaydir;
  return sonuc();

  // --------------------------------------------------------------------------
  function baza() {
    if (!proje.baza || proje.ayakYukseklik <= 30) return;
    const bh = proje.ayakYukseklik;
    ekle(parca('Baza', 'baza', 'kapak', tk, W, bh,
      { x0: false, x1: false, y0: false, y1: false }, 'Fark etmez',
      { x: 0, y: -bh, z: D - 50 - tk, sx: W, sy: bh, sz: tk }));
  }

  function cekmeceler(b) {
    const n = Math.max(1, Math.min(6, Math.round(m.cekmeceSayisi || 1)));
    const fh = (H - n * g) / n;
    const L = rayBoyu(Dg);
    const Bw = b.xb - b.xa - 2 * RAY_BOSLUK;
    const bh = yuvarla(Math.max(60, Math.min(300, fh - 50)));
    const ek = nb > 1 ? ` (${b.i + 1}. bölüm)` : '';
    for (let i = 0; i < n; i++) {
      const y0 = i * (fh + g);
      const fw = yuvarla(b.onX1 - b.onX0);
      const on = ekle(parca(`Çekmece ön ${i + 1}${ek}`, 'cekmeceOn', 'kapak', tk, fw, yuvarla(fh),
        { x0: true, x1: true, y0: true, y1: true }, 'Arka yüz',
        { x: b.onX0, y: y0, z: D, sx: fw, sy: yuvarla(fh), sz: tk }));
      const hareket = { tip: 'cekmece', no: `${b.i}-${i}`, mesafe: L * 0.75 };
      on.hareket = hareket;
      const K = proje.kulpAraligi;
      if (K > 0 && fw > K + 40) {
        for (const s of [-1, 1]) on.delikler.push(delik(yuvarla(fw / 2 + (s * K) / 2), yuvarla(fh / 2), hir.kulp.cap, 'gecer', 'kulp'));
      }
      if (!L || Bw < 2 * t + 60) continue;
      const by = Math.max(t + 15, y0 + (fh - bh) / 2);
      const kx = b.xa + RAY_BOSLUK;
      const ust = { x0: false, x1: false, y0: false, y1: true };
      for (const [ad, x] of [['sol', kx], ['sağ', b.xb - RAY_BOSLUK - t]]) {
        ekle(parca(`Çekmece ${i + 1}${ek} yan ${ad}`, 'cekmeceYan', 'govde', t, L, bh, { ...ust }, 'Fark etmez',
          { x, y: by, z: D - L, sx: t, sy: bh, sz: L })).hareket = hareket;
      }
      for (const [ad, z] of [['ön', D - t], ['arka', D - L]]) {
        ekle(parca(`Çekmece ${i + 1}${ek} ${ad} ayna`, 'cekmeceAyna', 'govde', t, Bw - 2 * t, bh, { ...ust }, 'Fark etmez',
          { x: kx + t, y: by, z, sx: Bw - 2 * t, sy: bh, sz: t })).hareket = hareket;
      }
      ekle(parca(`Çekmece ${i + 1}${ek} taban`, 'cekmeceTaban', 'arkalik', ta, Bw, L,
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
