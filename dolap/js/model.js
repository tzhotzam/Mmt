// Proje modeli: malzeme, levha, hırdavat ölçüleri ve modül şablonları.
// Bütün ölçüler milimetredir. Bu dosya tarayıcıya bağlı değildir.

/** Hırdavat delme ölçüleri. Üretici kataloğuna göre değiştirilebilir. */
export const HIRDAVAT = {
  minifix: {
    kamCap: 15, kamDerinlik: 13,   // yatay parçanın yüzünde eksantrik yuvası
    kamMesafe: 24,                 // kam merkezinin parça ucuna uzaklığı
    civataCap: 5, civataDerinlik: 11, // yan parçanın iç yüzünde cıvata deliği
    kenarCap: 8, kenarDerinlik: 34,   // yatay parçanın ucunda (kenar) cıvata geçişi
  },
  kavela: { cap: 8, yuzDerinlik: 12, kenarDerinlik: 28, kaydir: 32 },
  vida: { cap: 7, kenarCap: 5, kenarDerinlik: 45 },        // 7×50 konfirmat
  mentese: {
    kapCap: 35, kapDerinlik: 13,
    kapMerkez: 22,                 // çanak merkezinin kapak kenarına uzaklığı
    tabanCap: 5, tabanDerinlik: 10, tabanOn: 37, tabanAralik: 32,
    ucBosluk: 100,                 // ilk/son menteşenin kapak ucuna uzaklığı
  },
  rafPimi: { cap: 5, derinlik: 10, on: 37, arka: 37, alt: 6, adim: 32 },
  kulp: { cap: 5, kenar: 40, uc: 80 },
};

export const LEVHA_HAZIR = [
  { ad: '2800 × 2070 (sunta / MDF-lam)', w: 2800, h: 2070 },
  { ad: '3660 × 1830', w: 3660, h: 1830 },
  { ad: '2440 × 1220', w: 2440, h: 1220 },
  { ad: '2100 × 2800 (dik)', w: 2100, h: 2800 },
];

/** Örnek projede kullanılan renkler (kimlikler renkler.js'ten). */
export const RENK_VARSAYILAN = {
  govde: 'Kastamonu Entegre|D152|mat',          // D152 Opak Beyaz
  kapak: 'Kastamonu Entegre|Antrasit|parlak',   // Evogloss Antrasit
  ustKapak: 'Kastamonu Entegre|Beyaz|parlak',   // Evogloss Beyaz
};

export function varsayilanProje() {
  return {
    ad: 'Mutfak',
    malzeme: {
      govde: { ad: '18 mm beyaz sunta', kalinlik: 18, renk: RENK_VARSAYILAN.govde },
      kapak: { ad: '18 mm MDF-lam', kalinlik: 18, renk: RENK_VARSAYILAN.kapak },
      arkalik: { ad: '8 mm sunta', kalinlik: 8 },
    },
    levha: { w: 2800, h: 2070, kenarPay: 10, aralik: 10, damar: false },
    bant: { kalinlik: 0.8, kesimdenDus: true },
    baglanti: 'minifix',           // minifix | kavela | minifix+kavela | vida
    kapakBosluk: 3,
    kulpAraligi: 128,               // 0 = kulpsuz (gola / bas-aç)
    ayakYukseklik: 100,
    baza: true,
    ustAltKot: 1450,                // üst dolapların yerden alt kotu
    tezgah: true,
    fiyat: { levha: 1650, kapakLevha: 2400, arkalikLevha: 650, bantMetre: 9 },
    moduller: [
      modul('alt', { ad: 'Çekmeceli', w: 450, kapak: 'cekmece', cekmeceSayisi: 3 }),
      modul('alt', { ad: 'Evye altı', w: 800, rafSayisi: 0 }),
      modul('alt', { ad: 'Alt dolap', w: 600 }),
      modul('ust', { ad: 'Üst dolap', w: 450, kapakRenk: RENK_VARSAYILAN.ustKapak }),
      modul('ust', { ad: 'Üst dolap', w: 800, kapakRenk: RENK_VARSAYILAN.ustKapak }),
      modul('ust', { ad: 'Üst dolap', w: 600, kapakRenk: RENK_VARSAYILAN.ustKapak }),
      modul('boy', { ad: 'Kiler', w: 600 }),
    ],
  };
}

let sayac = 0;

/** Tipine göre makul ölçülerle yeni modül. */
export function modul(tip, ozel = {}) {
  const ortak = {
    id: `m${Date.now().toString(36)}${(sayac++).toString(36)}`,
    tip,
    ad: { alt: 'Alt dolap', ust: 'Üst dolap', boy: 'Boy dolap' }[tip],
    kapak: 'otomatik',             // otomatik | tek | cift | cekmece | yok
    mentese: 'sol',                // tek kapakta menteşe tarafı
    kapakRenk: '',                 // boş = projenin kapak rengi
    cekmeceSayisi: 3,
  };
  const tipler = {
    alt: { w: 600, h: 720, d: 560, rafSayisi: 1 },
    ust: { w: 600, h: 720, d: 320, rafSayisi: 1 },
    boy: { w: 600, h: 2000, d: 560, rafSayisi: 2, ustRafSayisi: 1, sabitRaf: 1100 },
  };
  return { ...ortak, ...tipler[tip], ...ozel };
}

/** Kapağı çözülmüş hâli: 'otomatik' → genişliğe göre tek/çift. */
export function kapakTuru(m) {
  if (m.kapak === 'otomatik') return m.w > 600 ? 'cift' : 'tek';
  if (m.kapak === 'cekmece' && m.tip !== 'alt') return 'tek';
  return m.kapak;
}

/** Modül ölçülerini mantıklı aralıkta tutar, uyarıları döner. */
export function dogrula(proje) {
  const uyarilar = [];
  const t = proje.malzeme.govde.kalinlik;
  for (const m of proje.moduller) {
    const ad = `${m.ad} (${m.w})`;
    if (m.w < 4 * t + 100) uyarilar.push(`${ad}: genişlik çok dar.`);
    if (m.d < 150) uyarilar.push(`${ad}: derinlik çok az.`);
    const ic = m.w - 2 * t;
    if (m.rafSayisi > 0 && ic > 900 && kapakTuru(m) !== 'cekmece') {
      uyarilar.push(`${ad}: ${ic} mm açıklıkta raf sehim yapar; ara dikme ya da 25 mm raf düşünün.`);
    }
    if (kapakTuru(m) === 'tek' && m.w > 600) {
      uyarilar.push(`${ad}: ${m.w} mm tek kapak ağır olur; çift kapak önerilir.`);
    }
    if (m.tip === 'boy' && (m.sabitRaf < 300 || m.sabitRaf > m.h - 300)) {
      uyarilar.push(`${ad}: sabit raf yüksekliği gövdenin içinde kalmalı (300…${m.h - 300}).`);
    }
    if (kapakTuru(m) === 'cekmece' && m.d - proje.malzeme.arkalik.kalinlik < 290) {
      uyarilar.push(`${ad}: çekmece rayı için derinlik yetmiyor (en az 300 mm).`);
    }
  }
  return uyarilar;
}
