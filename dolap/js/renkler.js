// Kapak ve gövde renk kataloğu.
//
// Kastamonu Entegre dekor adları ve kodları bayi sayfalarından ve firmanın
// duyurularından derlendi; resmî kartela değildir. Ekrandaki ton YAKLAŞIKTIR:
// müşteriye göstermeden önce gerçek numuneyle karşılaştırın, bayiden güncel
// listeyi teyit edin. Yeni dekor eklemek için listeye bir satır yazmak yeter.
//
// yuzey: 'parlak' | 'mat'      → 3B'de yansıma
// doku:  'ahsap' | 'mermer'    → 3B'de ve renk kartında desen

const G = (marka, grup) => (kod, ad, hex, yuzey = 'mat', doku = null) =>
  ({ id: `${marka}|${kod || ad}|${yuzey}`, marka, grup, kod, ad, hex, yuzey, doku });

const egParlak = G('Kastamonu Entegre', 'Evogloss · parlak');
const egMat = G('Kastamonu Entegre', 'Evogloss · soft mat');
const kDuz = G('Kastamonu Entegre', 'MDFLam / Suntalam · düz renk');
const kAhsap = G('Kastamonu Entegre', 'MDFLam / Suntalam · ahşap');
const kFantazi = G('Kastamonu Entegre', 'MDFLam / Suntalam · fantazi');
const genel = (ad, hex, yuzey = 'mat', doku = null) =>
  ({ id: ad, marka: 'Genel', grup: 'Genel', kod: '', ad, hex, yuzey, doku });

export const KATALOG = [
  egParlak('', 'Beyaz', '#f4f4f1', 'parlak'),
  egParlak('', 'Bianco', '#f7f5ee', 'parlak'),
  egParlak('', 'Galaksi Beyaz', '#eeedea', 'parlak'),
  egParlak('', 'Beyaz İnci', '#f1eee6', 'parlak'),
  egParlak('', 'Krem', '#ece2cc', 'parlak'),
  egParlak('', 'Vizon', '#b5a594', 'parlak'),
  egParlak('', 'Açık Oksit Gri', '#a7a5a0', 'parlak'),
  egParlak('', 'Koyu Oksit Gri', '#5c5b59', 'parlak'),
  egParlak('', 'Antrasit', '#3a3d42', 'parlak'),
  egParlak('', 'Siyah İnci', '#1e1e22', 'parlak'),
  egParlak('', 'Siyah', '#141416', 'parlak'),

  egMat('', 'Lake Beyaz', '#f1f0eb'),
  egMat('', 'Krem', '#e8dfcb'),
  egMat('', 'Fırtına Gri', '#7c8186'),
  egMat('', 'Koyu Gri', '#4a4d52'),
  egMat('', 'Siyah', '#1b1b1d'),

  kDuz('D152', 'Opak Beyaz', '#f2f1ec'),
  kDuz('D104', 'Fildişi', '#ece4d0'),
  kDuz('D162', 'Sedef', '#e4ddd0'),
  kDuz('D216', 'Latte', '#c9b49a'),
  kDuz('D143', 'Antrasit', '#45484d'),
  kDuz('D107', 'Siyah', '#1c1c1e'),

  kAhsap('A351', 'Huş', '#d9c3a0', 'mat', 'ahsap'),
  kAhsap('A393', 'Doğal Huş', '#d4b98f', 'mat', 'ahsap'),
  kAhsap('A303', 'N. Kayın', '#d2a77a', 'mat', 'ahsap'),
  kAhsap('A339', 'Yenice Meşe', '#b88f5f', 'mat', 'ahsap'),
  kAhsap('A353', 'Teak', '#9a6a3f', 'mat', 'ahsap'),
  kAhsap('A364', 'Marbella Kiraz', '#9c5a3c', 'mat', 'ahsap'),
  kAhsap('A354', 'Bosfor', '#8a6a4f', 'mat', 'ahsap'),
  kAhsap('A316', 'Wenge', '#3e2e24', 'mat', 'ahsap'),

  kFantazi('F255', 'Carrara', '#ecebe8', 'mat', 'mermer'),
  kFantazi('F239', 'Trend Bej', '#cbbfa9'),
  kFantazi('F251', 'Vegas Bej', '#c4b39b'),
  kFantazi('F238', 'Trend Gri', '#8f8d88'),

  // Eski projelerle uyum için genel renkler (ilk sürümde bunlar vardı).
  genel('Beyaz', '#eeeeea'),
  genel('Krem', '#e9dfc8'),
  genel('Açık meşe', '#c9a46c', 'mat', 'ahsap'),
  genel('Ceviz', '#7a5234', 'mat', 'ahsap'),
  genel('Antrasit', '#3c4046'),
  genel('Adaçayı', '#8da38a'),
  genel('Lacivert', '#24324d'),
];

const SOZLUK = new Map(KATALOG.map((r) => [r.id, r]));

/** Kimliğe göre renk; bilinmeyen kimlik için yedek. */
export function renkBul(id, yedek = 'Beyaz') {
  return SOZLUK.get(id) || SOZLUK.get(yedek) || KATALOG[0];
}

/** Kısa, insanın okuyacağı ad: "Evogloss Antrasit (parlak)", "A339 Yenice Meşe". */
export function renkAdi(id) {
  const r = renkBul(id);
  if (r.marka === 'Genel') return r.ad;
  if (r.grup.startsWith('Evogloss')) return `Evogloss ${r.ad} (${r.yuzey === 'parlak' ? 'parlak' : 'mat'})`;
  return `${r.kod} ${r.ad}`.trim();
}

/** Gruplara ayrılmış katalog (arayüzdeki kartela için). */
export function gruplar() {
  const m = new Map();
  for (const r of KATALOG) {
    if (!m.has(r.grup)) m.set(r.grup, []);
    m.get(r.grup).push(r);
  }
  return [...m].map(([grup, renkler]) => ({ grup, renkler }));
}

/** Renk kartı için CSS arka planı: düz, parlak (ışık yansıması), ahşap, mermer. */
export function renkCss(id) {
  const r = renkBul(id);
  const katman = [];
  if (r.yuzey === 'parlak') {
    katman.push('linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 38%, rgba(255,255,255,0) 55%, rgba(0,0,0,0.12) 100%)');
  }
  if (r.doku === 'ahsap') {
    katman.push('repeating-linear-gradient(92deg, rgba(0,0,0,0.10) 0 2px, rgba(0,0,0,0) 2px 7px, rgba(255,255,255,0.06) 7px 9px, rgba(0,0,0,0) 9px 15px)');
  }
  if (r.doku === 'mermer') {
    katman.push('linear-gradient(120deg, rgba(0,0,0,0) 30%, rgba(120,120,125,0.35) 32%, rgba(0,0,0,0) 34%, rgba(0,0,0,0) 62%, rgba(140,140,145,0.25) 63.5%, rgba(0,0,0,0) 65%)');
  }
  katman.push(`linear-gradient(${r.hex}, ${r.hex})`);
  return katman.join(', ');
}
