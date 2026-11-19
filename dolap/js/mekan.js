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

/**
 * Kolonun önüne gelen dolaba ne olacağı:
 *   atla  — dolap kolonun yanından devam eder (varsayılan)
 *   onune — dolap kolonun önünden geçer, derinliği kolon kadar kısalır
 *   kert  — dolap yerinde kalır, parçaları kolonun etrafından oyulur (kertme)
 */
export function kolonModu(e) {
  return e.yerlesim || (e.onune ? 'onune' : 'atla');
}

/** Kertme bu dolapta yapılabilir mi? Kolon dolabın neredeyse tamamını yiyorsa hayır. */
function kertilebilir(e, m) {
  return kolonModu(e) === 'kert' && e.d < m.d - 100;
}

/** Bu modülün yolunu kesen engel (tesisat, "önüne" ve kertilecek kolon kesmez). */
function engelBul(engeller, duvar, s, m, dy) {
  return engeller.find((e) => e.duvar === duvar && e.tip !== 'tesisat' &&
    !(e.tip === 'kolon' && (kolonModu(e) === 'onune' || kertilebilir(e, m))) &&
    s < e.x + e.w - 1e-6 && s + m.w > e.x + 1e-6 &&
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
      const e = engelBul(engeller, duvar, s, m, dy);
      if (!e) break;
      s = e.x + e.w;
    }
    const y = m.tip === 'ust' ? proje.ustAltKot : proje.ayakYukseklik;
    // Önüne dolap konan kolon: derinlik kısalır. Kertilecek kolon: modül
    // içi koordinatta bir kutu olarak kaydedilir; parçalar ondan oyulur.
    let dAzalt = 0;
    const kertikler = [];
    for (const e of engeller) {
      if (e.duvar !== duvar || e.tip !== 'kolon' || !(s < e.x + e.w && s + m.w > e.x && dy[0] < e.y + e.h && dy[1] > e.y)) continue;
      if (kolonModu(e) === 'onune') dAzalt = Math.max(dAzalt, e.d);
      else if (kertilebilir(e, m)) {
        // B duvarında modülün sol ucu köşeden uzaktadır: yerel x ters akar.
        const x0 = duvar === 'A' ? e.x - s : s + m.w - (e.x + e.w);
        kertikler.push({ x0, x1: x0 + e.w, y0: e.y - y, y1: e.y + e.h - y, z0: -1, z1: e.d, id: e.id });
      }
    }
    for (const r of sr) imlec[duvar][r] = s + m.w;
    // Önüne geçen dolap kolon derinliği kadar öne kayar (arkası kolonun yüzüne
    // dayanır, önü öteki dolaplarla aynı hizada kalır).
    const k = duvar === 'A'
      ? { duvar, s, x: s, y, z: dAzalt, rotY: 0, kor: 0, dAzalt, kertikler }
      : { duvar, s, x: dAzalt, y, z: s + m.w, rotY: Math.PI / 2, kor: 0, dAzalt, kertikler };
    sonuc[i] = k;
    yerlesen[duvar].push({ m, k, i });
  };

  proje.moduller.forEach((m, i) => { if (duvarOf(m, proje) === 'A') yerlestirBir(m, i, 'A'); });

  if (mekan.tip === 'L') {
    // B duvarı, köşe bölgesine giren HER A dolabının önünden başlar (yalnız
    // s = 0'daki değil: kolon ya da kapı A'nın ilk dolabını köşeden
    // uzaklaştırmış olabilir; o dolap hâlâ B dolaplarının yolundadır).
    for (const r of ['alt', 'ust']) {
      const bDerin = Math.max(0, ...proje.moduller.filter((m) => duvarOf(m, proje) === 'B' && siralar(m).includes(r)).map((m) => m.d + tk));
      const koseler = yerlesen.A.filter(({ m, k }) => siralar(m).includes(r) && k.s < bDerin);
      imlec.B[r] = Math.max(0, ...koseler.map(({ m, k }) => m.d - k.dAzalt + tk));
    }
    proje.moduller.forEach((m, i) => { if (duvarOf(m, proje) === 'B') yerlestirBir(m, i, 'B'); });
    // Kör köşe: A'daki köşe dolabının B dolaplarının arkasında kalan kısmı.
    // Köşedeki normal dolap işaretlenmemiş olsa da kör köşe yapılır; yoksa
    // kapağı / çekmecesi B dolabının içine açılırdı.
    for (const { m, k } of yerlesen.A) {
      if (m.tip === 'boy' || makineMi(m) || dolguMu(m)) continue;
      const r = siralar(m)[0];
      const ilkB = yerlesen.B.filter(({ m: b }) => siralar(b).includes(r)).sort((a, b) => a.k.s - b.k.s)[0];
      if (!ilkB) continue;
      const kor = ilkB.m.d - ilkB.k.dAzalt + tk + KOSE_DOLGU - k.s;    // köşeden uzak dolapta kör kısım azalır
      if (kor > 0 && (m.kose || k.s < ilkB.m.d + tk)) k.kor = kor;
    }
  }
  return sonuc;
}

/**
 * Duvar boyunca boşluklar, taşmalar ve köşe uyarıları.
 * @returns {{ uyarilar: string[], notlar: string[] }}
 */
export function mekanNotlari(proje, konumlar) {
  const uyarilar = [], notlar = [], bosluklar = [], tasmalar = [];
  const mekan = proje.mekan;
  if (!mekan) return { uyarilar, notlar, bosluklar, tasmalar };
  const duvarlar = mekan.tip === 'L' ? ['A', 'B'] : ['A'];
  const uzunluk = { A: mekan.duvarA, B: mekan.duvarB };
  const engeller = (mekan.engeller || []).map((e) => ({ ...e, duvar: mekan.tip === 'L' ? e.duvar : 'A' }));
  const SIRA_AD = { alt: 'alt sıra', ust: 'üst sıra' };

  proje.moduller.forEach((m, i) => {
    const k = konumlar[i];
    const no = `M${i + 1} ${m.ad}`;
    const L = uzunluk[k.duvar];
    if (k.s + m.w > L + 0.5) {
      const metin = `${no}: ${k.duvar} duvarından ${Math.round(k.s + m.w - L)} mm taşıyor (duvar ${L} mm).`;
      uyarilar.push(metin);
      tasmalar.push({ i, id: m.id, metin, fazla: Math.round(k.s + m.w - L), yer: Math.max(0, Math.floor(L - k.s)) });
    }
    if (k.kertikler?.length) {
      notlar.push(`${no}: kolon için kertildi (${k.kertikler.map((q) => `${Math.round(q.x1 - q.x0)} × ${Math.round(q.z1)} mm`).join(', ')}); parçalar kolonun etrafından oyulur.`);
    }
    const ust = dikey(m, proje)[1];
    if (ust > mekan.tavan + 0.5) uyarilar.push(`${no}: tavanı ${Math.round(ust - mekan.tavan)} mm aşıyor (tavan ${mekan.tavan} mm).`);
    if (k.dAzalt) notlar.push(`${no}: kolonun önünde; derinlik ${k.dAzalt} mm kısaltıldı (${m.d - k.dAzalt} mm).`);
    if (m.kose && !(mekan.tip === 'L' && k.duvar === 'A' && m.tip !== 'boy')) {
      uyarilar.push(`${no}: köşe dolabı L mutfakta A duvarının köşedeki alt ya da üst dolabı olmalı.`);
    } else if (m.kose && !k.kor) {
      uyarilar.push(`${no}: köşe dolabı ama B duvarında aynı sırada dolap yok; kör kısım hesaplanamadı.`);
    }
    if (k.kor > 0) {
      const enAz = Math.ceil((k.kor + 250) / 50) * 50;
      if (m.w < k.kor + 250) {
        const metin = `${no}: köşede, ${Math.round(k.kor)} mm'si B dolaplarının arkasında kalıyor; kapağa yer kalmıyor. Dolabı en az ${enAz} mm yapın.`;
        uyarilar.push(metin);
        tasmalar.push({ i, id: m.id, metin, koseGenislik: enAz });
      } else if (!m.kose) {
        notlar.push(`${no}: köşede; B dolaplarının arkasında kalan ${Math.round(k.kor)} mm kör panel yapıldı, kapak açık kısımda.`);
      }
    }
    if (mekan.tip === 'L' && k.duvar === 'A' && makineMi(m) && k.s < 700 && proje.moduller.some((b, j) => konumlar[j].duvar === 'B' && b.tip !== 'ust')) {
      uyarilar.push(`${no}: makine köşede; kapağı B duvarındaki dolaba çarpar. Köşeden uzağa alın.`);
    }
  });

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
        if (e.duvar === d && e.tip !== 'tesisat' && !(e.tip === 'kolon' && kolonModu(e) !== 'atla') && yer[0] < e.y + e.h && yer[1] > e.y) {
          dolu.push([e.x, e.x + e.w]);
        }
      }
      dolu.sort((a, b) => a[0] - b[0]);
      // B duvarında köşedeki A dolabının önü dolu sayılır.
      let imlec = 0;
      if (d === 'B') {
        // B sırasının ilk modülü köşe bölgesinden sonra başlar (yerleşimle aynı kural).
        imlec = Math.min(...proje.moduller.map((m, i) => (konumlar[i].duvar === 'B' && siralar(m).includes(r) ? konumlar[i].s : Infinity)));
        if (!Number.isFinite(imlec)) imlec = 0;
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
  return { uyarilar, notlar, bosluklar, tasmalar };
}

/**
 * Bu modül eklenirse duvardan taşan modül sayısı artar mı? (Kütüphanede
 * sığmayan genişlikleri kapatmak için.) Yalnız yerleşim hesaplanır.
 */
export function eklenirseTasar(proje, yeni, sonraIndex) {
  const say = (p) => {
    const k = yerlestir(p);
    const L = { A: p.mekan?.duvarA ?? Infinity, B: p.mekan?.duvarB ?? Infinity };
    return p.moduller.reduce((a, m, i) => a + (k[i].s + m.w > L[k[i].duvar] + 0.5 ? 1 : 0), 0);
  };
  const once = say(proje);
  const moduller = [...proje.moduller];
  moduller.splice(sonraIndex + 1, 0, yeni);
  return say({ ...proje, moduller }) > once;
}

/** Bir duvarın bir sırasında son modülden duvar sonuna kalan yer (mm). */
export function kalanYer(proje, konumlar, duvar, sira) {
  const L = duvar === 'B' ? proje.mekan.duvarB : proje.mekan.duvarA;
  let son = 0;
  proje.moduller.forEach((m, i) => {
    if (konumlar[i].duvar === duvar && siralar(m).includes(sira)) son = Math.max(son, konumlar[i].s + m.w);
  });
  return Math.round(L - son);
}
