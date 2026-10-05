// TEK ÇİZGİLİ YAZI — gravür numaralarını çizgiye çevirir.
//
// DXF'teki TEXT varlığını CAM programlarının çoğu ya hiç göstermez ya da
// takım yoluna çeviremez; parçalar tezgâhtan numarasız çıkıyordu. Burada
// her harf, frezenin ya da lazerin tek geçişte izleyebileceği açık
// çizgilerden oluşur (kontur değil: harf içi boşaltılmaz, üstünden geçilir).
//
// Harf ızgarası: genişlik 4, yükseklik 6 birim (taban çizgisi y=0).

const O = [[1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0]];
const P = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
const NOKTA = (y) => [[1.6, y], [2.4, y], [2.4, y + 0.8], [1.6, y + 0.8], [1.6, y]];

const GLYPH = {
  '0': [O, [[0.6, 1], [3.4, 5]]],
  '1': [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  '2': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  '3': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1.5, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  '4': [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  '5': [[[4, 6], [0, 6], [0, 3.5], [3, 3.5], [4, 2.5], [4, 1], [3, 0], [1, 0], [0, 1]]],
  '6': [[[3.5, 6], [2, 6], [0, 4], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2.5], [3, 3.5], [1, 3.5], [0, 2.5]]],
  '7': [[[0, 6], [4, 6], [1.5, 0]]],
  '8': [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  '9': [[[0.5, 0], [2, 0], [4, 2], [4, 5], [3, 6], [1, 6], [0, 5], [0, 3.5], [1, 2.5], [3, 2.5], [4, 3.5]]],
  A: [[[0, 0], [2, 6], [4, 0]], [[0.7, 2], [3.3, 2]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1.3, 3.3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [O],
  P: [P],
  Q: [O, [[2.5, 1.5], [4, 0]]],
  R: [P, [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 4], [3, 0], [4, 6]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  '-': [[[0.5, 3], [3.5, 3]]],
  '+': [[[2, 1], [2, 5]], [[0, 3], [4, 3]]],
  '×': [[[0.5, 1], [3.5, 4]], [[0.5, 4], [3.5, 1]]],
  '/': [[[0, 0], [4, 6]]],
  '.': [NOKTA(0)],
  ',': [[[2.4, 0.8], [2.4, 0], [1.6, -1]]],
  ':': [NOKTA(0), NOKTA(3.5)],
  '·': [NOKTA(2.6)],
  '°': [[[1, 5], [2, 6], [3, 5], [2, 4], [1, 5]]],
  '#': [[[1.3, 0], [1.7, 6]], [[2.7, 0], [3.1, 6]], [[0, 2], [4, 2]], [[0, 4], [4, 4]]],
};

// Türkçe harfler: taban harf + işaret.
const SEDIL = [[2, 0], [2, -0.8], [1.3, -1.6]];
const UST_IKI_NOKTA = [[[1, 6.8], [1, 7.6]], [[3, 6.8], [3, 7.6]]];
const TR = {
  'Ç': ['C', [SEDIL]], 'Ş': ['S', [SEDIL]], 'Ğ': ['G', [[[1, 7.6], [2, 6.9], [3, 7.6]]]],
  'İ': ['I', [[[2, 6.8], [2, 7.6]]]], 'Ö': ['O', UST_IKI_NOKTA], 'Ü': ['U', UST_IKI_NOKTA],
};

const ILERLEME = 5.5;   // harf genişliği 4 + aralık 1,5

/** Bir karakterin çizgileri ve ölçeği (küçük harf, büyüğün %70'i). */
function harf(ch) {
  if (GLYPH[ch]) return { cizgi: GLYPH[ch], k: 1 };
  if (TR[ch]) return { cizgi: [...GLYPH[TR[ch][0]], ...TR[ch][1]], k: 1 };
  const buyuk = ch === 'ı' ? 'I' : ch === 'i' ? 'İ' : ch.toLocaleUpperCase('tr');
  if (buyuk !== ch) {
    const h = harf(buyuk);
    if (h.cizgi) return { cizgi: h.cizgi, k: 0.7 };
  }
  return { cizgi: null, k: 1 };
}

/** Yazının birim cinsinden genişliği. */
function genislik(str) {
  let w = 0;
  for (const ch of str) w += ILERLEME * harf(ch).k;
  return Math.max(0, w - 1.5);
}

/**
 * Yazıyı açık çizgilere çevirir. (x, y) yazının ortası (yatay ve dikey
 * ortalı — DXF TEXT'te kullandığımız hizalamayla aynı), `size` büyük harf
 * yüksekliği (mm), `rot` derece.
 * @returns {Array<Array<[number, number]>>}
 */
export function textToStrokes(str, x, y, size, rot = 0) {
  const s = size / 6;
  const cos = Math.cos((rot * Math.PI) / 180), sin = Math.sin((rot * Math.PI) / 180);
  const out = [];
  let cx = -genislik(String(str)) / 2;
  for (const ch of String(str)) {
    const { cizgi, k } = harf(ch);
    if (cizgi) {
      for (const c of cizgi) {
        out.push(c.map(([gx, gy]) => {
          const lx = (cx + gx * k) * s, ly = (gy * k - 3) * s;
          return [x + lx * cos - ly * sin, y + lx * sin + ly * cos];
        }));
      }
    }
    cx += ILERLEME * k;
  }
  return out;
}

/** Bu yazının çizgiye çevrilemeyen karakterleri (test ve uyarı için). */
export function eksikHarfler(str) {
  return [...new Set([...String(str)].filter((ch) => ch !== ' ' && !harf(ch).cizgi))];
}
