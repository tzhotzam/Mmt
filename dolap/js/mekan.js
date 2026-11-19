// Mekân: modülleri duvarlara dizer; kolon, pencere ve kapıdan kaçar, L
// mutfakta köşeyi çözer, boşlukları ve taşmaları raporlar.
//
// Her duvarın kendi ekseni (s) vardır ve KÖŞEDEN başlar:
//   A duvarı: s = dünya x'i, dolap arkası z = 0'da, önü +z.
//   B duvarı (yalnız L): s = dünya z'si, dolap arkası x = 0'da, önü +x.
//   B duvarına bakan kişi için köşe sağdadır; modüller köşeden sola dizilir.
//
// Bu dosya tarayıcıya bağlı değildir.

import { makineMi, dolguMu } from './model.js';

const TEZGAH = 40;
const KOSE_DOLGU = 50;   // kör köşede kapak ve kulpun açılması için pay

/** Modülün kullandığı sıralar: alt, üst ya da ikisi (boy). */
export function siralar(m) {
  return m.tip === 'boy' ? ['alt', 'ust'] : [m.tip === 'ust' ? 'ust' : 'alt'];
}

/** Modülün duvarı: düz mutfakta hep A. */
export function duvarOf(m, proje) {
  return proje.mekan?.tip === 'L' && m.duvar === 'B' ? 'B' : 'A';
}

/** Modülün yerden dikey kapladığı aralık. */
function dikey(m, proje) {
  const a = proje.ayakYukseklik;
  if (m.tip === 'ust') return [proje.ustAltKot, proje.ustAltKot + m.h];
  if (m.tip === 'boy') return [0, a + m.h];
  return [0, a + m.h + (proje.tezgah ? TEZGAH : 0)];
}

/** Bu modülün yolunu kesen engel (tesisat kesmez, "önüne" işaretli kolon kesmez). */
function engelBul(engeller, duvar, s, w, dy) {
  return engeller.find((e) => e.duvar === duvar && e.tip !== 'tesisat' && !(e.tip === 'kolon' && e.onune) &&
    s < e.x + e.w - 1e-6 && s + w > e.x + 1e-6 &&
    dy[0] < e.y + e.h - 1e-6 && dy[1] > e.y + 1e-6);
}

/**
 * Modüllerin konumu. Her eleman:
 *   { duvar, s, x, y, z, rotY, kor, dAzalt }
 * x, z: dünya koordinatında modül orijini (sol-arka-alt köşe, modüle bakana göre).
 */
export function yerlestir(proje) {
  const mekan = proje.mekan || { tip: 'duz', engeller: [] };
  const engeller = (mekan.engeller || []).map((e) => ({ ...e, duvar: mekan.tip === 'L' ? e.duvar : 'A' }));
  const tk = proje.malzeme?.kapak?.kalinlik ?? 18;
  const sonuc = new Array(proje.moduller.length);
  const imlec = { A: { alt: 0, ust: 0 }, B: { alt: 0, ust: 0 } };
  const yerlesen = { A: [], B: [] };

  const yerlestirBir = (m, i, duvar) => {
    const sr = siralar(m);
    const dy = dikey(m, proje);
    let s = Math.max(...sr.map((r) => imlec[duvar][r]));
    for (let k = 0; k < 50; k++) {
      const e = engelBul(engeller, duvar, s, m.w, dy);
      if (!e) break;
      s = e.x + e.w;
    }
    // Önüne dolap konan kolon: dolabın derinliği kolon kadar kısalır.
    let dAzalt = 0;
    for (const e of engeller) {
      if (e.duvar === duvar && e.tip === 'kolon' && e.onune && s < e.x + e.w && s + m.w > e.x &&
        dy[0] < e.y + e.h && dy[1] > e.y) dAzalt = Math.max(dAzalt, e.d);
    }
    for (const r of sr) imlec[duvar][r] = s + m.w;
    const y = m.tip === 'ust' ? proje.ustAltKot : proje.ayakYukseklik;
    const k = duvar === 'A'
      ? { duvar, s, x: s, y, z: 0, rotY: 0, kor: 0, dAzalt }
      : { duvar, s, x: 0, y, z: s + m.w, rotY: Math.PI / 2, kor: 0, dAzalt };
    sonuc[i] = k;
    yerlesen[duvar].push({ m, k, i });
  };

  proje.moduller.forEach((m, i) => { if (duvarOf(m, proje) === 'A') yerlestirBir(m, i, 'A'); });

  if (mekan.tip === 'L') {
    // B duvarı, A'nın köşedeki dolabının önünden başlar.
    for (const r of ['alt', 'ust']) {
      const kose = yerlesen.A.find(({ m, k }) => k.s === 0 && siralar(m).includes(r));
      imlec.B[r] = kose ? kose.m.d - kose.k.dAzalt + tk : 0;
    }
    proje.moduller.forEach((m, i) => { if (duvarOf(m, proje) === 'B') yerlestirBir(m, i, 'B'); });
    // Kör köşe: A'daki köşe dolabının B dolaplarının arkasında kalan kısmı.
    for (const { m, k } of yerlesen.A) {
      if (!m.kose || k.s !== 0 || m.tip === 'boy') continue;
      const r = siralar(m)[0];
      const ilkB = yerlesen.B.filter(({ m: b }) => siralar(b).includes(r)).sort((a, b) => a.k.s - b.k.s)[0];
      if (ilkB) k.kor = ilkB.m.d - ilkB.k.dAzalt + tk + KOSE_DOLGU;
    }
  }
  return sonuc;
}

/**
 * Duvar boyunca boşluklar, taşmalar ve köşe uyarıları.
 * @returns {{ uyarilar: string[], notlar: string[] }}
 */
export function mekanNotlari(proje, konumlar) {
  const uyarilar = [], notlar = [], bosluklar = [];
  const mekan = proje.mekan;
  if (!mekan) return { uyarilar, notlar, bosluklar };
  const duvarlar = mekan.tip === 'L' ? ['A', 'B'] : ['A'];
  const uzunluk = { A: mekan.duvarA, B: mekan.duvarB };
  const engeller = (mekan.engeller || []).map((e) => ({ ...e, duvar: mekan.tip === 'L' ? e.duvar : 'A' }));
  const SIRA_AD = { alt: 'alt sıra', ust: 'üst sıra' };

  proje.moduller.forEach((m, i) => {
    const k = konumlar[i];
    const no = `M${i + 1} ${m.ad}`;
    const L = uzunluk[k.duvar];
    if (k.s + m.w > L + 0.5) uyarilar.push(`${no}: ${k.duvar} duvarından ${Math.round(k.s + m.w - L)} mm taşıyor (duvar ${L} mm).`);
    const ust = dikey(m, proje)[1];
    if (ust > mekan.tavan + 0.5) uyarilar.push(`${no}: tavanı ${Math.round(ust - mekan.tavan)} mm aşıyor (tavan ${mekan.tavan} mm).`);
    if (k.dAzalt) notlar.push(`${no}: kolonun önünde; derinlik ${k.dAzalt} mm kısaltıldı (${m.d - k.dAzalt} mm).`);
    if (m.kose && !(mekan.tip === 'L' && k.duvar === 'A' && k.s === 0 && m.tip !== 'boy')) {
      uyarilar.push(`${no}: köşe dolabı L mutfakta A duvarının ilk (köşedeki) alt ya da üst dolabı olmalı.`);
    } else if (m.kose && !k.kor) {
      uyarilar.push(`${no}: köşe dolabı ama B duvarında aynı sırada dolap yok; kör kısım hesaplanamadı.`);
    }
  });

  if (mekan.tip === 'L') {
    for (const r of ['alt', 'ust']) {
      const a = proje.moduller.findIndex((m, i) => konumlar[i].duvar === 'A' && konumlar[i].s === 0 && siralar(m).includes(r));
      const bVar = proje.moduller.some((m, i) => konumlar[i].duvar === 'B' && siralar(m).includes(r));
      if (a >= 0 && bVar && !proje.moduller[a].kose && !makineMi(proje.moduller[a]) && !dolguMu(proje.moduller[a]) && proje.moduller[a].tip !== 'boy') {
        notlar.push(`M${a + 1} ${proje.moduller[a].ad}: köşede; önü B duvarındaki dolaplarla kapanıyor. "Köşe dolabı" işaretlerseniz kapağı açık kısma alınır.`);
      }
    }
  }

  // Boşluklar: duvar boyunca, engellerin ve dolapların dışında kalan yerler.
  for (const d of duvarlar) {
    for (const r of ['alt', 'ust']) {
      const dolu = [];
      proje.moduller.forEach((m, i) => {
        if (konumlar[i].duvar === d && siralar(m).includes(r)) dolu.push([konumlar[i].s, konumlar[i].s + m.w]);
      });
      if (!dolu.length) continue;
      const yer = r === 'ust' ? [proje.ustAltKot, proje.ustAltKot + 720] : [0, proje.ayakYukseklik + 760];
      for (const e of engeller) {
        if (e.duvar === d && e.tip !== 'tesisat' && !(e.tip === 'kolon' && e.onune) && yer[0] < e.y + e.h && yer[1] > e.y) {
          dolu.push([e.x, e.x + e.w]);
        }
      }
      dolu.sort((a, b) => a[0] - b[0]);
      // B duvarında köşedeki A dolabının önü dolu sayılır.
      let imlec = 0;
      if (d === 'B') {
        const kose = proje.moduller.findIndex((m, i) => konumlar[i].duvar === 'A' && konumlar[i].s === 0 && siralar(m).includes(r));
        if (kose >= 0) imlec = proje.moduller[kose].d + proje.malzeme.kapak.kalinlik;
      }
      const son = Math.max(...proje.moduller.map((m, i) => (konumlar[i].duvar === d && siralar(m).includes(r) ? konumlar[i].s + m.w : 0)));
      const araliklar = [];
      for (const [a, b] of dolu) {
        if (a > imlec + 1) araliklar.push([imlec, a]);
        imlec = Math.max(imlec, b);
      }
      // Sıranın sonu ile duvar sonu (yalnız A duvarının alt sırası ve B: tezgâh duvara kadar gider).
      if (uzunluk[d] > imlec + 1 && imlec >= son) araliklar.push([imlec, uzunluk[d]]);
      for (const [a, b] of araliklar) {
        const L = Math.round(b - a);
        if (L < 2) continue;
        const ne = L <= 150 ? 'dolgu (pervaz) ile kapatın' : L >= 300 ? `${L} mm'lik dolap sığar` : 'dolgu ya da açık raf';
        notlar.push(`${d} duvarı ${SIRA_AD[r]}: ${Math.round(a)}–${Math.round(b)} arası ${L} mm boş; ${ne}.`);
        // Boşluktan önce biten modül: doldurulacak modüller onun ardına eklenir.
        let onceki = -1, enSon = -Infinity;
        proje.moduller.forEach((m, i) => {
          const k = konumlar[i];
          if (k.duvar === d && siralar(m).includes(r) && k.s + m.w <= a + 1 && k.s + m.w > enSon) { enSon = k.s + m.w; onceki = i; }
        });
        bosluklar.push({ duvar: d, sira: r, a: Math.round(a), b: Math.round(b), L, onceki });
      }
    }
  }
  return { uyarilar, notlar, bosluklar };
}
