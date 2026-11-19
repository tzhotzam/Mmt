// Modül kütüphanesi: standart genişlikte hazır dolaplar (30'luk, 45'lik, 60'lık,
// 80'lik…) ve boşluğu standart modüllerle doldurma.
// Bu dosya tarayıcıya bağlı değildir.

import { ALT_TURLERI, UST_TURLERI, BOY_TURLERI } from './model.js';

export const KATALOG = [
  {
    grup: 'Alt', ogeler: [
      { ad: 'Kapaklı', tip: 'alt', ozel: {}, w: [300, 400, 450, 500, 600, 800, 900, 1000, 1200] },
      { ad: 'Çekmeceli', tip: 'alt', ozel: { kapak: 'cekmece', cekmeceSayisi: 3 }, w: [300, 400, 450, 500, 600, 800, 900] },
      { ad: 'Raf + çekmece', tip: 'alt', ozel: { bolme: 1, bolumler: ['raf', 'cekmece'] }, w: [800, 900, 1000, 1200] },
      { ad: 'Evye', tip: 'alt', ozel: ALT_TURLERI.evye.ozel, w: [800, 900, 1000, 1200] },
      { ad: 'Fırın + ocak', tip: 'alt', ozel: ALT_TURLERI.firin.ozel, w: [600] },
      { ad: 'Kör köşe', tip: 'alt', ozel: { kose: true }, w: [1000, 1100, 1200] },
      { ad: 'Bulaşık mak.', tip: 'alt', ozel: ALT_TURLERI.bulasik.ozel, w: [450, 600] },
      { ad: 'Çamaşır mak.', tip: 'alt', ozel: ALT_TURLERI.camasir.ozel, w: [600] },
      { ad: 'Dolgu', tip: 'alt', ozel: ALT_TURLERI.dolgu.ozel, w: [50, 100, 150] },
    ],
  },
  {
    grup: 'Üst', ogeler: [
      { ad: 'Kapaklı', tip: 'ust', ozel: {}, w: [300, 400, 450, 500, 600, 800, 900, 1000, 1200] },
      { ad: 'Camlı vitrin', tip: 'ust', ozel: { cam: 'cerceve' }, w: [400, 450, 500, 600, 800, 900] },
      { ad: 'Açık raf', tip: 'ust', ozel: { kapak: 'yok' }, w: [300, 400, 600, 800] },
      { ad: 'Davlumbaz', tip: 'ust', ozel: UST_TURLERI.davlumbaz.ozel, w: [600, 900] },
      { ad: 'Kör köşe', tip: 'ust', ozel: { kose: true }, w: [800, 900, 1000] },
      { ad: 'Kısa', tip: 'ust', ozel: { h: 360 }, w: [600, 700, 900] },
      { ad: 'Dolgu', tip: 'ust', ozel: UST_TURLERI.dolgu.ozel, w: [50, 100, 150] },
    ],
  },
  {
    grup: 'Boy', ogeler: [
      { ad: 'Kiler', tip: 'boy', ozel: {}, w: [400, 450, 500, 600] },
      { ad: 'Fırın kolonu', tip: 'boy', ozel: BOY_TURLERI.firin.ozel, w: [600] },
      { ad: 'Buzdolabı', tip: 'boy', ozel: BOY_TURLERI.buzdolabi.ozel, w: [600, 700, 900] },
    ],
  },
];

/** Kütüphane öğesinden modül özellikleri: ad "Kapaklı alt 60" gibi. */
export function katalogOzel(oge, w) {
  const tipAd = { alt: 'alt', ust: 'üst', boy: '' }[oge.tip];
  const ad = `${oge.ad}${tipAd && !['Evye', 'Fırın + ocak', 'Bulaşık mak.', 'Çamaşır mak.', 'Davlumbaz'].includes(oge.ad) ? ' ' + tipAd : ''} ${w / 10}`;
  return { ...oge.ozel, ad: ad.replace(/\s+/g, ' ').trim(), w };
}

export const STANDART = { alt: [1200, 1000, 900, 800, 600, 500, 450, 400, 300], ust: [1200, 1000, 900, 800, 600, 500, 450, 400, 300] };

// Ustaların tercih sırası: 60'lık ve 45'lik en yaygın; tuhaf ölçü puan kaybettirir.
const CEZA = { 600: 0, 450: 0.1, 800: 0.2, 900: 0.3, 400: 0.4, 500: 0.4, 300: 0.6, 1000: 0.8, 1200: 1.2 };

/**
 * Bir boşluğu standart genişliklerle doldurur. Puan: modül sayısı + tuhaf
 * ölçü cezası + dolgu payı; kalan ≤ 150 mm dolgu (pervaz) olur.
 * @returns {{ genislikler:number[], dolgu:number, kalan:number }}
 */
export function boslukDoldur(L, standart = STANDART.alt, dolguMax = 150) {
  const adim = 10;
  const n = Math.floor(L / adim);
  // en[i]: i*adim mm'yi tam dolduran en düşük puanlı dizilim
  const en = new Array(n + 1).fill(null);
  en[0] = { ws: [], puan: 0 };
  for (let i = 1; i <= n; i++) {
    for (const w of standart) {
      const j = i - w / adim;
      if (j < 0 || !Number.isInteger(j) || !en[j]) continue;
      const puan = en[j].puan + 1 + (CEZA[w] ?? 0.5);
      if (!en[i] || puan < en[i].puan) en[i] = { ws: [...en[j].ws, w], puan };
    }
  }
  let sec = null;
  for (let i = n; i >= 0; i--) {
    if (!en[i]) continue;
    const kalan = L - i * adim;
    if (kalan > dolguMax) continue;
    // Geniş dolgu çirkin durur: her 10 mm puan kaybettirir.
    const puan = en[i].puan + (kalan >= 20 ? 0.3 + kalan / 100 : 0);
    if (!sec || puan < sec.puan) sec = { ws: en[i].ws, kalan, puan };
  }
  if (!sec) {
    // Dolguyla kapanmayacak kadar tuhaf boşluk: en çok dolduranı al, kalanı söyle.
    for (let i = n; i >= 0; i--) if (en[i]) { sec = { ws: en[i].ws, kalan: L - i * adim }; break; }
    return { genislikler: [...sec.ws].sort((a, b) => b - a), dolgu: 0, kalan: Math.round(sec.kalan) };
  }
  const k = Math.round(sec.kalan);
  return { genislikler: [...sec.ws].sort((a, b) => b - a), dolgu: k >= 20 ? k : 0, kalan: k >= 20 ? 0 : k };
}
