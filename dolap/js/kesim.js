// Kesim listesi, levha planı, hırdavat listesi ve maliyet.

import { HIRDAVAT } from './model.js';
import { bantUzunlugu, rayBoyu } from './govde.js';
import { yerlestirLevha } from './yerlesim.js';
import { renkAdi } from './renkler.js';
import { CAM_TURU, makineMi, evyeMi } from './model.js';

export const MALZEME_ADI = { govde: 'Gövde', kapak: 'Kapak', arkalik: 'Arkalık', cam: 'Cam', aluminyum: 'Alüminyum' };
const LEVHALIK = new Set(['govde', 'kapak', 'arkalik']);

/**
 * Aynı ölçü + malzeme + bant düzenindeki parçaları tek satırda toplar.
 * @param {'modul'|'toplu'} mod modül modül ya da bütün proje için tek liste
 */
export function kesimListesi(parcalar, mod = 'modul') {
  const satirlar = new Map();
  for (const p of parcalar) {
    if (!LEVHALIK.has(p.malzeme)) continue;     // cam ve alüminyum kapak ayrı listede
    const b = p.bant;
    const anahtar = [
      mod === 'modul' ? p.modulNo : '', p.malzeme, p.renk, p.kalinlik, p.kesimBoy, p.kesimEn,
      +b.y0 + +b.y1, +b.x0 + +b.x1, mod === 'modul' ? p.grup : '', p.pencere ? 'cam' : '',
    ].join('|');
    let s = satirlar.get(anahtar);
    if (!s) {
      s = {
        modulNo: mod === 'modul' ? p.modulNo : null,
        modulAd: mod === 'modul' ? p.modulAd : null,
        adlar: [], nolar: [], adet: 0,
        malzeme: p.malzeme, renk: p.renk, kalinlik: p.kalinlik,
        boy: p.kesimBoy, en: p.kesimEn, netBoy: p.boy, netEn: p.en,
        boyBant: +b.y0 + +b.y1, enBant: +b.x0 + +b.x1,
        delik: 0,
        camli: !!p.pencere,
      };
      satirlar.set(anahtar, s);
    }
    s.adet++;
    s.nolar.push(p.no);
    if (!s.adlar.includes(p.ad)) s.adlar.push(p.ad);
    s.delik += p.delikler.length;
  }
  return [...satirlar.values()].map((s) => ({ ...s, ad: kisaAd(s.adlar) }));
}

/** "Sol yan", "Sağ yan" → "Sol + sağ yan" gibi kısa bir ad. */
function kisaAd(adlar) {
  if (adlar.length === 1) return adlar[0];
  if (adlar.length === 2 && /^Sol /.test(adlar[0]) && /^Sağ /.test(adlar[1])) {
    return `Sol + sağ ${adlar[0].slice(4)}`;
  }
  // "Çekmece 1 yan sol", "Çekmece 2 yan sağ" → "Çekmece yan"
  const sade = [...new Set(adlar.map(genelAd))];
  const ilk = sade.slice(0, 3).join(', ');
  return sade.length > 3 ? `${ilk} …` : ilk;
}

function genelAd(ad) {
  const s = ad.split(/\s+/).filter((k) => !/^\d+$/.test(k) && !/^(sol|sağ)$/i.test(k)).join(' ');
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}

/** Excel'in Türkçe ayarında doğrudan açılan CSV (noktalı virgül, virgüllü sayı, BOM). */
export function kesimCsv(satirlar, proje) {
  const sayi = (v) => String(v).replace('.', ',');
  const bas = ['No', 'Modül', 'Parça', 'Adet', 'Boy', 'En', 'Kalınlık', 'Malzeme', 'Renk',
    'Boy bant', 'En bant', 'Net boy', 'Net en', 'Delikli', 'Not', 'Parça no'];
  const satir = satirlar.map((s, i) => [
    i + 1,
    s.modulNo ? `M${s.modulNo} ${s.modulAd}` : '',
    s.ad, s.adet, sayi(s.boy), sayi(s.en), sayi(s.kalinlik),
    proje.malzeme[s.malzeme].ad, s.renk ? renkAdi(s.renk) : '',
    s.boyBant, s.enBant, sayi(s.netBoy), sayi(s.netEn),
    s.delik ? 'evet' : '', s.camli ? 'camlı: pencere boydan kesilir, arkada cam lambası, iç kenar bantlı' : '',
    s.nolar.join(' '),
  ]);
  const kac = (v) => {
    const t = String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [bas, ...satir].map((r) => r.map(kac).join(';')).join('\r\n') + '\r\n';
}

/**
 * Malzemeye göre levha planı. Damar açıksa gövde ve kapak parçaları
 * dönmez (boy, levhanın uzun kenarı boyunca kalır).
 */
export function levhaPlani(parcalar, proje) {
  const sonuc = {};
  // Her malzeme ayrı levha; kapakta her renk ayrı levha.
  const gruplar = [];
  for (const malzeme of ['govde', 'kapak', 'arkalik']) {
    const liste = parcalar.filter((p) => p.malzeme === malzeme);
    if (!liste.length) continue;
    if (malzeme !== 'kapak') { gruplar.push({ anahtar: malzeme, malzeme, renk: '', liste }); continue; }
    const renkler = [...new Set(liste.map((p) => p.renk))];
    for (const renk of renkler) {
      gruplar.push({
        anahtar: renkler.length > 1 ? `kapak:${renk}` : 'kapak',
        malzeme, renk, liste: liste.filter((p) => p.renk === renk),
      });
    }
  }
  for (const { anahtar, malzeme, renk, liste } of gruplar) {
    const donebilir = !(proje.levha.damar && malzeme !== 'arkalik');
    const r = yerlestirLevha(
      liste.map((p) => ({ id: p.no, w: p.kesimBoy, h: p.kesimEn, donebilir })),
      proje.levha,
    );
    const bul = new Map(liste.map((p) => [p.no, p]));
    for (const lv of r.levhalar) for (const y of lv.yerlesim) y.parca = bul.get(y.id);
    sonuc[anahtar] = {
      anahtar,
      malzeme,
      renk,
      ad: proje.malzeme[malzeme].ad + (malzeme === 'kapak' && renk ? ` · ${renkAdi(renk)}` : ''),
      kalinlik: proje.malzeme[malzeme].kalinlik,
      levhalar: r.levhalar,
      sigmayan: r.sigmayan.map((x) => bul.get(x.id)),
    };
  }
  return sonuc;
}

/** Hırdavat listesi: deliklerden ve modüllerden sayılır. */
export function hirdavatListesi(cozum, proje, hir = HIRDAVAT) {
  const say = { minifix: 0, kavela: 0, vida: 0, mentese: 0, rafPimi: 0, kulp: 0, ayak: 0, aski: 0 };
  const raylar = new Map();
  for (const p of cozum.parcalar) {
    for (const d of p.delikler) {
      if (d.tur === 'minifix' && d.cap === hir.minifix.kamCap) say.minifix++;
      if (d.tur === 'mentese' && d.cap === hir.mentese.kapCap) say.mentese++;
      if (d.tur === 'kulp') say.kulp += 0.5;
    }
    for (const k of p.kenarDelik) {
      if (k.tur === 'kavela') say.kavela++;
      if (k.tur === 'vida') say.vida++;
    }
    if (p.grup === 'raf') say.rafPimi += 4;
  }
  for (const { m, parcalar } of cozum.moduller) {
    if (m.tip === 'ust') say.aski += 2;
    else if (!makineMi(m)) say.ayak += m.w > 600 ? 6 : 4;
    if (evyeMi(m)) say.tepsi = (say.tepsi || 0) + 1;
    const taban = parcalar.filter((p) => p.grup === 'cekmeceTaban').length;
    if (taban) {
      const L = rayBoyu(m.d - proje.malzeme.arkalik.kalinlik);
      raylar.set(L, (raylar.get(L) || 0) + taban);
    }
  }
  const liste = [
    ['Minifix (takım)', say.minifix],
    ['Kavela Ø8', say.kavela],
    ['Konfirmat vida 7×50', say.vida],
    ['Menteşe (bindirme, frenli)', say.mentese],
    ['Raf pimi', say.rafPimi],
    ['Kulp' + (proje.kulpAraligi ? ` (${proje.kulpAraligi} mm)` : ''), Math.round(say.kulp)],
    ['Dolap ayağı', say.ayak],
    ['Üst dolap askı takımı', say.aski],
    ['Evye altı alüminyum tepsi', say.tepsi || 0],
  ];
  for (const [L, n] of [...raylar].sort((a, b) => b[0] - a[0])) liste.push([`Çekmece rayı ${L} mm (çift)`, n]);
  return liste.filter(([, n]) => n > 0).map(([ad, adet]) => ({ ad, adet }));
}

/**
 * Cam ve hazır alınacak kapaklar: camcıya / profilciye gidecek liste.
 * Aynı ölçü ve türdekiler tek satırda toplanır.
 */
export function camListesi(parcalar, proje) {
  const satir = new Map();
  for (const p of parcalar) {
    let tur, boy, en;
    if (p.malzeme === 'cam') { tur = `${CAM_TURU[p.camTuru] || p.camTuru} cam ${p.kalinlik} mm`; boy = p.boy; en = p.en; }
    else if (p.malzeme === 'aluminyum') { tur = `Alüminyum çerçeveli cam kapak (${CAM_TURU[proje.cam.tur]})`; boy = p.boy; en = p.en; }
    else continue;
    const k = `${p.malzeme}|${tur}|${boy}|${en}`;
    let s = satir.get(k);
    if (!s) { s = { malzeme: p.malzeme, tur, boy, en, adet: 0, nolar: [] }; satir.set(k, s); }
    s.adet++;
    s.nolar.push(p.no);
  }
  return [...satir.values()].map((s) => ({ ...s, m2: Math.round((s.boy * s.en * s.adet) / 1e4) / 100 }));
}

/** Bant metrajı (fire payı %10) ve kaba maliyet. */
export function maliyet(cozum, plan, proje) {
  const bantMm = cozum.parcalar.reduce((a, p) => a + bantUzunlugu(p), 0);
  const bantM = Math.ceil((bantMm / 1000) * 1.1);
  const f = proje.fiyat;
  const fiyatlar = { govde: f.levha, kapak: f.kapakLevha, arkalik: f.arkalikLevha };
  const kalemler = [];
  for (const k of Object.keys(plan)) {
    const n = plan[k].levhalar.length;
    kalemler.push({ ad: `${plan[k].ad} levha`, miktar: `${n} adet`, tutar: n * (fiyatlar[plan[k].malzeme] || 0) });
  }
  kalemler.push({ ad: `PVC bant ${proje.bant.kalinlik} mm`, miktar: `${bantM} m`, tutar: bantM * f.bantMetre });
  for (const [malz, ad, fiyat] of [['cam', 'Cam', f.camM2 || 0], ['aluminyum', 'Alüminyum cam kapak', f.aluminyumM2 || 0]]) {
    const m2 = camListesi(cozum.parcalar, proje).filter((s) => s.malzeme === malz).reduce((a, s) => a + s.m2, 0);
    if (m2 > 0) kalemler.push({ ad, miktar: `${String(Math.round(m2 * 100) / 100).replace('.', ',')} m²`, tutar: Math.round(m2 * fiyat) });
  }
  return { bantM, kalemler, toplam: kalemler.reduce((a, k) => a + k.tutar, 0) };
}
