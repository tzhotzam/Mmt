// Dikdörtgen parçaları levhalara dizer. İki yöntem:
//
//  • CNC nesting (MaxRects): parçalar her yöne serbestçe dizilir. Birkaç
//    sıralama × birkaç seçim ölçütü denenir; en az tam levha kullanan,
//    eşitlikte son levhası en boş olan (artık büyük kalsın) seçilir.
//  • Ebatlama (giyotin, 3 aşama): daire testere / ebatlama makinesi her
//    kesimi levhanın bir kenarından ötekine yapar. Önce levha boyunca
//    şeritler (1. aşama), şeritte enine kolonlar (2. aşama), kolonda parçalar
//    (3. aşama) kesilir; kesim sırası da çıkarılır.
//
// Stok artıklar (önceki işlerden kalan levha parçaları) tam levhadan önce
// kullanılır. Parça arası boşluk (freze çapı / testere kalınlığı) her
// parçayı sağdan ve üstten o kadar büyüterek verilir.

const SIRALAR = [
  (a, b) => b.w * b.h - a.w * a.h,
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  (a, b) => b.h - a.h || b.w - a.w,
  (a, b) => b.w - a.w || b.h - a.h,
];
const OLCUTLER = ['kisaKenar', 'alan', 'uzunKenar', 'solAlt'];

/**
 * @param {Array<{id:any, w:number, h:number, donebilir:boolean}>} parcalar
 * @param {{w:number, h:number, kenarPay:number, aralik:number, yontem?:string, testere?:number}} levha
 * @param {Array<{id:any, w:number, h:number}>} [artiklar] stoktaki artıklar
 * @returns {{ levhalar: Array<{w,h,artik?,yerlesim:Array<{id,x,y,w,h,dondu}>, doluluk:number, kesimler?:Array, kalan?:object}>, sigmayan: Array }}
 */
export function yerlestirLevha(parcalar, levha, artiklar = []) {
  const giyotin = levha.yontem === 'ebatlama';
  const ayar = giyotin ? { ...levha, aralik: levha.testere ?? 4.4 } : levha;
  const stok = [...artiklar].sort((a, b) => a.w * a.h - b.w * b.h);   // küçük artık önce dolsun
  let enIyi = null;
  for (const sira of SIRALAR) {
    for (const olcut of giyotin ? ['ilk'] : OLCUTLER) {
      const s = giyotin
        ? giyotinKez([...parcalar].sort(sira), ayar, stok)
        : birKez([...parcalar].sort(sira), ayar, olcut, stok);
      if (!enIyi || dahaIyi(s, enIyi)) enIyi = s;
    }
  }
  return enIyi;
}

function dahaIyi(a, b) {
  if (a.sigmayan.length !== b.sigmayan.length) return a.sigmayan.length < b.sigmayan.length;
  const tam = (r) => r.levhalar.filter((l) => !l.artik).length;
  if (tam(a) !== tam(b)) return tam(a) < tam(b);
  if (a.levhalar.length !== b.levhalar.length) return a.levhalar.length < b.levhalar.length;
  const son = (r) => (r.levhalar.length ? r.levhalar[r.levhalar.length - 1].doluluk : 0);
  return son(a) < son(b) - 1e-9;
}

/** Sığdırılacak sıradaki levha: önce stok artık (parçanın sığdığı), yoksa tam levha. */
function yeniLevhaSec(stok, kullanilan, levha, pw, ph, donebilir, m, s) {
  for (const a of stok) {
    if (kullanilan.has(a.id)) continue;
    const UW = a.w - 2 * m + s, UH = a.h - 2 * m + s;
    if ((pw <= UW && ph <= UH) || (donebilir && ph <= UW && pw <= UH)) {
      kullanilan.add(a.id);
      return { w: a.w, h: a.h, artik: a.id };
    }
  }
  return { w: levha.w, h: levha.h, artik: null };
}

function sonuclandir(levhalar, sigmayan) {
  return {
    levhalar: levhalar.map((lv) => ({
      w: lv.w, h: lv.h, artik: lv.artik || null,
      yerlesim: lv.yerlesim,
      doluluk: lv.yerlesim.reduce((a, y) => a + y.w * y.h, 0) / (lv.w * lv.h),
      kesimler: lv.kesimler,
      kalan: lv.kalan,
    })),
    sigmayan,
  };
}

// ---------------------------------------------------------------- MaxRects

function birKez(sirali, levha, olcut, stok) {
  const m = levha.kenarPay, s = levha.aralik;
  const levhalar = [];
  const sigmayan = [];
  const kullanilan = new Set();

  for (const p of sirali) {
    const pw = p.w + s, ph = p.h + s;
    const UW0 = levha.w - 2 * m + s, UH0 = levha.h - 2 * m + s;
    const tamSigar = (pw <= UW0 && ph <= UH0) || (p.donebilir && ph <= UW0 && pw <= UH0);
    const artikSigar = stok.some((a) => !kullanilan.has(a.id) &&
      ((pw <= a.w - 2 * m + s && ph <= a.h - 2 * m + s) || (p.donebilir && ph <= a.w - 2 * m + s && pw <= a.h - 2 * m + s)));

    let secim = null;
    for (const lv of levhalar) {
      const c = enIyiYer(lv.bos, pw, ph, p.donebilir, olcut);
      if (c) { secim = { lv, c }; break; }   // ilk sığan levhaya koy: önceki levhalar dolsun
    }
    if (!secim) {
      if (!tamSigar && !artikSigar) { sigmayan.push(p); continue; }
      const yeni = yeniLevhaSec(stok, kullanilan, levha, pw, ph, p.donebilir, m, s);
      const lv = { ...yeni, bos: [{ x: 0, y: 0, w: yeni.w - 2 * m + s, h: yeni.h - 2 * m + s }], yerlesim: [] };
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
  // Kalan en büyük boş dikdörtgen: artık olarak saklanabilir.
  for (const lv of levhalar) {
    const b = [...lv.bos].sort((x, y) => y.w * y.h - x.w * x.h)[0];
    lv.kalan = b ? { x: b.x + m, y: b.y + m, w: Math.max(0, b.w - s), h: Math.max(0, b.h - s) } : null;
  }
  return sonuclandir(levhalar, sigmayan);
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
  for (let i = bos.length - 1; i >= 0; i--) {
    for (let j = 0; j < bos.length; j++) {
      if (i !== j && icinde(bos[i], bos[j])) { bos.splice(i, 1); break; }
    }
  }
}

function icinde(a, b) {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

// ---------------------------------------------------------------- Giyotin

/**
 * 3 aşamalı giyotin: levha → boyuna şeritler → enine kolonlar → parçalar.
 * Şerit yüksekliği ilk parçanın enidir; kolonda parçalar üst üste dizilir.
 */
function giyotinKez(sirali, levha, stok) {
  const m = levha.kenarPay, k = levha.aralik;
  const levhalar = [];
  const sigmayan = [];
  const kullanilan = new Set();

  const yonler = (p) => (p.donebilir && p.w !== p.h ? [[p.w, p.h, false], [p.h, p.w, true]] : [[p.w, p.h, false]]);

  const dene = (lv, p) => {
    const W = lv.w - 2 * m, H = lv.h - 2 * m;
    // 1) Var olan kolona üst üste (aynı ya da dar parça).
    for (const st of lv.seritler) {
      for (const kol of st.kolonlar) {
        for (const [w, h, d] of yonler(p)) {
          if (w <= kol.w && kol.dolu + k + h <= st.h + 1e-6 && kol.parcalar.length) return { st, kol, w, h, d };
        }
      }
    }
    // 2) Var olan şeride yeni kolon.
    for (const st of lv.seritler) {
      for (const [w, h, d] of yonler(p)) {
        if (h <= st.h + 1e-6 && st.x + w <= W + 1e-6) return { st, yeniKolon: true, w, h, d };
      }
    }
    // 3) Yeni şerit.
    const ustY = lv.seritler.length ? lv.seritler[lv.seritler.length - 1].y + lv.seritler[lv.seritler.length - 1].h + k : 0;
    let en = null;
    for (const [w, h, d] of yonler(p)) {
      if (w <= W + 1e-6 && ustY + h <= H + 1e-6 && (!en || h < en.h)) en = { yeniSerit: ustY, w, h, d };
    }
    return en;
  };

  const koy = (lv, sec, p) => {
    let st = sec.st, kol = sec.kol;
    if (sec.yeniSerit !== undefined) {
      st = { y: sec.yeniSerit, h: sec.h, x: 0, kolonlar: [] };
      lv.seritler.push(st);
    }
    if (!kol) {
      kol = { x: st.x, w: sec.w, dolu: -k, parcalar: [] };
      st.kolonlar.push(kol);
      st.x += sec.w + k;
    }
    const y = st.y + kol.dolu + k;
    kol.dolu += k + sec.h;
    kol.parcalar.push({ id: p.id, y, w: sec.w, h: sec.h });
    lv.yerlesim.push({ id: p.id, x: kol.x + m, y: y + m, w: sec.w, h: sec.h, dondu: sec.d });
  };

  for (const p of sirali) {
    let yer = null;
    for (const lv of levhalar) {
      const sec = dene(lv, p);
      if (sec) { yer = { lv, sec }; break; }
    }
    if (!yer) {
      const tam = { w: levha.w, h: levha.h };
      const sigar = (L) => yonler(p).some(([w, h]) => w <= L.w - 2 * m && h <= L.h - 2 * m);
      let yeni = null;
      for (const a of stok) {
        if (!kullanilan.has(a.id) && sigar(a)) { kullanilan.add(a.id); yeni = { w: a.w, h: a.h, artik: a.id }; break; }
      }
      if (!yeni) {
        if (!sigar(tam)) { sigmayan.push(p); continue; }
        yeni = { ...tam, artik: null };
      }
      const lv = { ...yeni, seritler: [], yerlesim: [] };
      levhalar.push(lv);
      yer = { lv, sec: dene(lv, p) };
    }
    koy(yer.lv, yer.sec, p);
  }

  // Kesim sırası ve kalan şerit.
  for (const lv of levhalar) {
    const ks = [];
    if (m > 0) ks.push({ asama: 0, tip: 'kenar', metin: `Kenar düzeltme: dört kenardan ${m} mm` });
    lv.seritler.forEach((st, i) => {
      ks.push({ asama: 1, tip: 'serit', olcu: st.h, metin: `${i + 1}. Boyuna kes: ${fmt(st.h)} mm şerit` });
      st.kolonlar.forEach((kol, j) => {
        ks.push({ asama: 2, tip: 'kolon', olcu: kol.w, metin: `${i + 1}.${j + 1} Enine kes: ${fmt(kol.w)} mm` });
        for (const pr of kol.parcalar) {
          const tekBasina = kol.parcalar.length === 1 && Math.abs(pr.h - st.h) < 0.05;
          if (!tekBasina) ks.push({ asama: 3, tip: 'parca', olcu: pr.h, id: pr.id, metin: `Boyuna kes: ${fmt(pr.h)} mm → ${pr.id}` });
          else ks.push({ asama: 3, tip: 'parca', olcu: pr.h, id: pr.id, metin: `→ ${pr.id}` });
          if (pr.w < kol.w - 0.05) ks.push({ asama: 4, tip: 'duzelt', olcu: pr.w, id: pr.id, metin: `Düzelt: ${fmt(pr.w)} mm → ${pr.id}` });
        }
      });
    });
    lv.kesimler = ks;
    const son = lv.seritler[lv.seritler.length - 1];
    const ustY = son ? son.y + son.h + k : 0;
    lv.kalan = { x: m, y: ustY + m, w: lv.w - 2 * m, h: Math.max(0, lv.h - 2 * m - ustY) };
  }
  return sonuclandir(levhalar, sigmayan);
}

function fmt(v) {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

/**
 * Parça çizimindeki (kesim koordinatı) bir noktayı levhaya taşır.
 * Dönen parça 90° saat yönü tersine çevrilmiştir.
 */
export function levhaNoktasi(yer, parca, px, py) {
  if (!yer.dondu) return [yer.x + px, yer.y + py];
  return [yer.x + (parca.kesimEn - py), yer.y + px];
}
