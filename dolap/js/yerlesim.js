// Dikdörtgen parçaları levhalara dizer (MaxRects).
//
// Dolap parçalarının hepsi dikdörtgen olduğu için panel programındaki raf
// yerleşiminden çok daha sıkı dizilebilir. Birkaç sıralama × birkaç seçim
// ölçütü denenir; en az levha kullanan, eşitlikte son levhası en boş olan
// (artık parça büyük kalsın) seçilir.
//
// Parça arası boşluk (freze çapı + pay) her parçayı sağdan ve üstten o kadar
// büyüterek verilir; kullanılabilir alan da aynı kadar büyütülür ki son
// parçanın dışına boşuna boşluk düşmesin.

const SIRALAR = [
  (a, b) => b.w * b.h - a.w * a.h,
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  (a, b) => b.h - a.h || b.w - a.w,
  (a, b) => b.w - a.w || b.h - a.h,
];
const OLCUTLER = ['kisaKenar', 'alan', 'uzunKenar', 'solAlt'];

/**
 * @param {Array<{id:any, w:number, h:number, donebilir:boolean}>} parcalar
 * @param {{w:number, h:number, kenarPay:number, aralik:number}} levha
 * @returns {{ levhalar: Array<{w,h,yerlesim:Array<{id,x,y,w,h,dondu}>, doluluk:number}>, sigmayan: Array }}
 */
export function yerlestirLevha(parcalar, levha) {
  let enIyi = null;
  for (const sira of SIRALAR) {
    for (const olcut of OLCUTLER) {
      const s = birKez([...parcalar].sort(sira), levha, olcut);
      if (!enIyi || dahaIyi(s, enIyi)) enIyi = s;
    }
  }
  return enIyi;
}

function dahaIyi(a, b) {
  if (a.sigmayan.length !== b.sigmayan.length) return a.sigmayan.length < b.sigmayan.length;
  if (a.levhalar.length !== b.levhalar.length) return a.levhalar.length < b.levhalar.length;
  const son = (r) => (r.levhalar.length ? r.levhalar[r.levhalar.length - 1].doluluk : 0);
  return son(a) < son(b) - 1e-9;
}

function birKez(sirali, levha, olcut) {
  const m = levha.kenarPay, s = levha.aralik;
  const UW = levha.w - 2 * m + s, UH = levha.h - 2 * m + s;
  const levhalar = [];
  const sigmayan = [];

  for (const p of sirali) {
    const pw = p.w + s, ph = p.h + s;
    const sigar = (pw <= UW && ph <= UH) || (p.donebilir && ph <= UW && pw <= UH);
    if (!sigar) { sigmayan.push(p); continue; }

    let secim = null;
    for (const lv of levhalar) {
      const c = enIyiYer(lv.bos, pw, ph, p.donebilir, olcut);
      if (c && (!secim || c.puan < secim.c.puan)) secim = { lv, c };
      if (secim) break;   // ilk sığan levhaya koy: önceki levhalar dolsun
    }
    if (!secim) {
      const lv = { bos: [{ x: 0, y: 0, w: UW, h: UH }], yerlesim: [] };
      levhalar.push(lv);
      secim = { lv, c: enIyiYer(lv.bos, pw, ph, p.donebilir, olcut) };
    }
    const { lv, c } = secim;
    const r = { x: c.x, y: c.y, w: c.dondu ? ph : pw, h: c.dondu ? pw : ph };
    bol(lv.bos, r);
    lv.yerlesim.push({
      id: p.id, x: c.x + m, y: c.y + m,
      w: c.dondu ? p.h : p.w, h: c.dondu ? p.w : p.h, dondu: c.dondu,
    });
  }

  return {
    levhalar: levhalar.map((lv) => ({
      w: levha.w, h: levha.h,
      yerlesim: lv.yerlesim,
      doluluk: lv.yerlesim.reduce((a, y) => a + y.w * y.h, 0) / (levha.w * levha.h),
    })),
    sigmayan,
  };
}

function enIyiYer(bos, w, h, donebilir, olcut) {
  let en = null;
  const dene = (fr, rw, rh, dondu) => {
    if (rw > fr.w || rh > fr.h) return;
    let puan;
    const kisa = Math.min(fr.w - rw, fr.h - rh), uzun = Math.max(fr.w - rw, fr.h - rh);
    if (olcut === 'kisaKenar') puan = kisa * 1e6 + uzun;
    else if (olcut === 'uzunKenar') puan = uzun * 1e6 + kisa;
    else if (olcut === 'alan') puan = (fr.w * fr.h - rw * rh) * 1e3 + kisa;
    else puan = (fr.y + rh) * 1e6 + fr.x;
    if (!en || puan < en.puan) en = { x: fr.x, y: fr.y, dondu, puan };
  };
  for (const fr of bos) {
    dene(fr, w, h, false);
    if (donebilir && w !== h) dene(fr, h, w, true);
  }
  return en;
}

/** Yerleşen dikdörtgeni boş alanlardan çıkarır (MaxRects bölme + budama). */
function bol(bos, r) {
  const yeni = [];
  for (let i = bos.length - 1; i >= 0; i--) {
    const f = bos[i];
    if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) continue;
    bos.splice(i, 1);
    if (r.x > f.x) yeni.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
    if (r.x + r.w < f.x + f.w) yeni.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
    if (r.y > f.y) yeni.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
    if (r.y + r.h < f.y + f.h) yeni.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
  }
  bos.push(...yeni);
  // İçerilen boş alanları at.
  for (let i = bos.length - 1; i >= 0; i--) {
    for (let j = 0; j < bos.length; j++) {
      if (i !== j && icinde(bos[i], bos[j])) { bos.splice(i, 1); break; }
    }
  }
}

function icinde(a, b) {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

/**
 * Parça çizimindeki (kesim koordinatı) bir noktayı levhaya taşır.
 * Dönen parça 90° saat yönü tersine çevrilmiştir.
 */
export function levhaNoktasi(yer, parca, px, py) {
  if (!yer.dondu) return [yer.x + px, yer.y + py];
  return [yer.x + (parca.kesimEn - py), yer.y + px];
}
