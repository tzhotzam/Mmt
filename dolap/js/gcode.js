// Levha planından G-code (nesting CNC router).
//
// Sıfır noktası: levhanın SOL-ALT köşesi (X0 Y0), Z0 malzemenin ÜST yüzeyi
// (ayarla tabla yüzeyi de seçilebilir). Birim mm, mutlak (G21 G90).
//
// İşlem sırası (nesting'de yerleşik uygulama):
//   1. Delikler — matkap takımı varsa dik dalış; yoksa ve delik frezeden
//      büyükse freze ile helisel cep. Takım takım gruplanır.
//   2. Cepler — menteşe çanağı Ø35, minifix kamı Ø15, cam lambası.
//   3. İç konturlar — camlı kapak penceresi.
//   4. Dış konturlar — KÜÇÜK PARÇALAR ÖNCE (vakum tutarken kesilsin),
//      takım telafili, tırmanma yönünde, rampalı giriş, kademeli paso.
//      Küçük parçalara köprü (tab) bırakılır.
//
// Takım değişimi: ATC'li makinede "T2 M6"; tek iş milli makinede iş mili
// durur, program M0 ile bekler, operatör takımı değiştirip devam eder.
//
// Bu dosya tarayıcıya bağlı değildir.

import { levhaNoktasi } from './yerlesim.js';
import { kesimKonturu, poligonOfset } from './kertme.js';

export const POSTLAR = {
  ncstudio: { ad: 'NcStudio (Weihong)', yorum: 'parantez', satirNo: false, yuzde: false, program: false, uzanti: 'nc' },
  syntec: { ad: 'Syntec', yorum: 'parantez', satirNo: true, yuzde: true, program: true, uzanti: 'nc' },
  mach3: { ad: 'Mach3 / Mach4', yorum: 'parantez', satirNo: false, yuzde: false, program: false, uzanti: 'tap' },
  grbl: { ad: 'GRBL', yorum: 'parantez', satirNo: false, yuzde: false, program: false, uzanti: 'nc', atcYok: true },
  fanuc: { ad: 'Fanuc', yorum: 'parantez', satirNo: true, yuzde: true, program: true, uzanti: 'nc' },
};

export const CNC_VARSAYILAN = {
  post: 'ncstudio',
  atc: false,                // otomatik takım değiştirici
  zSifir: 'ust',             // ust: malzeme üstü | tabla: tabla (fedakâr) yüzeyi
  guvenliZ: 15,
  yaklasmaZ: 3,
  tablaPay: 0.3,             // boydan kesimde fedakâr tablaya giriş
  pasoDerinlik: 9,
  ilerleme: 6000,            // mm/dk, kesim
  dalis: 1500,               // mm/dk, Z dalış
  devir: 18000,
  takimlar: [
    { no: 1, tur: 'freze', cap: 6 },
    { no: 2, tur: 'matkap', cap: 5 },
    { no: 3, tur: 'matkap', cap: 8 },
  ],
  kopru: true,               // küçük parçalara köprü (tab)
  kopruKucuk: 250,           // kısa kenarı bundan küçük parça "küçük" sayılır (mm)
  kopruUzunluk: 10,
  kopruYukseklik: 2,
  rampa: 40,                 // rampalı giriş uzunluğu (mm)
};

/**
 * Bir levhanın G-code'u.
 * @param {object} levha levhaPlani() içindeki levha ({w,h,yerlesim})
 * @param {number} kalinlik malzeme kalınlığı (mm)
 * @param {object} cncIn CNC ayarları
 * @param {{ baslik?:string, levhaNo?:number }} bilgi
 * @returns {{ metin:string, uyarilar:string[], sure:number, takimlar:number[] }}
 */
export function levhaGcode(levha, kalinlik, cncIn = {}, bilgi = {}) {
  const c = { ...CNC_VARSAYILAN, ...cncIn };
  const post = POSTLAR[c.post] || POSTLAR.ncstudio;
  const atc = c.atc && !post.atcYok;
  const zOfs = c.zSifir === 'tabla' ? kalinlik : 0;     // Z yazılırken eklenir
  const Z = (z) => z + zOfs;                             // z: üst yüzeye göre (− içeri)
  const freze = c.takimlar.filter((t) => t.tur === 'freze').sort((a, b) => a.cap - b.cap)[0];
  const uyarilar = [];
  if (!freze) {
    return { metin: '', uyarilar: ['Takım listesinde freze yok; kesim yapılamaz.'], sure: 0, takimlar: [] };
  }
  const r = freze.cap / 2;
  const kesimDerin = kalinlik + c.tablaPay;

  // ---- işleri topla ----
  const delmeler = new Map();   // takım no → [{x,y,derinlik}]
  const cepler = [];            // {tip:'daire', x,y,R,derinlik} | {tip:'halka', dis, ic, derinlik}
  const icKontur = [];          // [rect]
  const disKontur = [];         // {rect, kucuk, no}
  const eksik = new Map();

  for (const yer of levha.yerlesim) {
    const p = yer.parca;
    const nokta = (px, py) => levhaNoktasi(yer, p, px - p.dx, py - p.dy);
    const dikd = (rr) => {
      const a = nokta(rr.x0, rr.y0), b = nokta(rr.x1, rr.y1);
      return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
    };
    for (const d of p.delikler) {
      const [x, y] = nokta(d.x, d.y);
      const derin = d.derinlik === 'gecer' ? kesimDerin : Math.min(d.derinlik, kalinlik - 1);
      const matkap = c.takimlar.find((t) => t.tur === 'matkap' && Math.abs(t.cap - d.cap) < 0.05);
      if (matkap) {
        if (!delmeler.has(matkap.no)) delmeler.set(matkap.no, []);
        delmeler.get(matkap.no).push({ x, y, derinlik: derin });
      } else if (d.cap >= freze.cap + 0.5) {
        cepler.push({ tip: 'daire', x, y, R: d.cap / 2, derinlik: derin });
      } else {
        eksik.set(d.cap, (eksik.get(d.cap) || 0) + 1);
      }
    }
    if (p.lamba) cepler.push({ tip: 'halka', dis: dikd(p.lamba), ic: dikd(p.pencere), derinlik: p.lamba.derinlik });
    if (p.pencere) icKontur.push(dikd(p.pencere));
    const rect = { x0: yer.x, y0: yer.y, x1: yer.x + yer.w, y1: yer.y + yer.h };
    const poli = kesimKonturu(p).map(([px, py]) => levhaNoktasi(yer, p, px, py));
    disKontur.push({ rect, poli, no: p.no, alan: yer.w * yer.h, kucuk: Math.min(yer.w, yer.h) < c.kopruKucuk });
  }
  for (const [cap, n] of eksik) {
    uyarilar.push(`Ø${cap} için ${n} delik atlandı: takım listesine Ø${cap} matkap ekleyin (freze Ø${freze.cap} bu deliğe girmez).`);
  }

  // ---- yazıcı ----
  const L = [];
  let satir = 10;
  const yaz = (s) => {
    if (post.satirNo && !s.startsWith('(')) { L.push(`N${satir} ${s}`); satir += 10; } else L.push(s);
  };
  const yorum = (t) => yaz(`(${ascii(t)})`);
  const f = (v) => fmt(v);
  // Başlangıç konumu bilinmiyor: ilk Z hareketi mutlaka yazılsın.
  let konum = { x: null, y: null, z: null };
  let kesimYol = 0, hizliYol = 0, dalisYol = 0;
  let aktifTakim = null;

  const g0 = (x, y, z) => {
    const s = ['G0'];
    if (x !== undefined && x !== konum.x) s.push(`X${f(x)}`);
    if (y !== undefined && y !== konum.y) s.push(`Y${f(y)}`);
    if (z !== undefined && z !== konum.z) s.push(`Z${f(Z(z))}`);
    if (s.length === 1) return;
    if (konum.x !== null && konum.z !== null) hizliYol += Math.hypot((x ?? konum.x) - konum.x, (y ?? konum.y) - konum.y) + Math.abs((z ?? konum.z) - konum.z);
    konum = { x: x ?? konum.x, y: y ?? konum.y, z: z ?? konum.z };
    yaz(s.join(' '));
  };
  const g1 = (x, y, z, F) => {
    const s = ['G1'];
    if (x !== undefined && x !== konum.x) s.push(`X${f(x)}`);
    if (y !== undefined && y !== konum.y) s.push(`Y${f(y)}`);
    if (z !== undefined && z !== konum.z) s.push(`Z${f(Z(z))}`);
    if (s.length === 1) return;
    if (F) s.push(`F${Math.round(F)}`);
    const xy = Math.hypot((x ?? konum.x) - konum.x, (y ?? konum.y) - konum.y);
    const dz = Math.abs((z ?? konum.z) - konum.z);
    if (xy > 0) kesimYol += xy; else dalisYol += dz;
    konum = { x: x ?? konum.x, y: y ?? konum.y, z: z ?? konum.z };
    yaz(s.join(' '));
  };
  const yukari = () => g0(undefined, undefined, c.guvenliZ);
  const yaklas = (x, y) => { yukari(); g0(x, y); g0(undefined, undefined, c.yaklasmaZ); };

  const takim = (t, ne) => {
    if (aktifTakim === t.no) return;
    yukari();
    if (aktifTakim !== null) yaz('M5');
    if (atc) {
      yaz(`T${t.no} M6`);
    } else if (aktifTakim !== null) {
      yorum(`TAKIM DEGISTIR: T${t.no} ${t.tur === 'freze' ? 'freze' : 'matkap'} D${t.cap} - ${ne}`);
      yaz('M0');
    } else {
      yorum(`TAKIM T${t.no} ${t.tur === 'freze' ? 'freze' : 'matkap'} D${t.cap} TAKILI OLMALI - ${ne}`);
    }
    yaz(`M3 S${c.devir}`);
    if (post.program) yaz('G4 P2');
    aktifTakim = t.no;
  };

  // ---- başlık ----
  if (post.yuzde) L.push('%');
  if (post.program) L.push(`O${1000 + (bilgi.levhaNo || 1)}`);
  yorum(`${bilgi.baslik || 'Dolap'} - levha ${bilgi.levhaNo || 1} - ${levha.w}x${levha.h}x${kalinlik}`);
  yorum(`Sifir: levha sol-alt kose, Z0 ${c.zSifir === 'tabla' ? 'tabla yuzeyi' : 'malzeme ustu'}`);
  yaz('G21 G90 G17');
  g0(undefined, undefined, c.guvenliZ);

  // ---- 1. delme (takım takım, en yakın komşu sırası) ----
  for (const [no, liste] of [...delmeler].sort((a, b) => a[0] - b[0])) {
    const t = c.takimlar.find((x) => x.no === no);
    takim(t, `${liste.length} delik`);
    for (const d of enYakinSira(liste, konum)) {
      // Yakın deliğe yaklaşma yüksekliğinde, uzağa güvenli yükseklikte geç.
      if (konum.x === null || Math.hypot(d.x - konum.x, d.y - konum.y) > 200) yukari();
      else g0(undefined, undefined, c.yaklasmaZ);
      g0(d.x, d.y);
      g0(undefined, undefined, c.yaklasmaZ);
      // Derin delikte gagalama (çap × 3'te bir yukarı çık, talaşı at).
      const adim = Math.max(t.cap * 3, 6);
      let z = 0;
      while (z < d.derinlik - 1e-6) {
        z = Math.min(d.derinlik, z + adim);
        g1(undefined, undefined, -z, c.dalis);
        if (z < d.derinlik - 1e-6) g0(undefined, undefined, 1);
      }
      g0(undefined, undefined, c.yaklasmaZ);
    }
  }

  // ---- 2-4. freze işleri ----
  const frezeIsi = cepler.length + icKontur.length + disKontur.length;
  if (frezeIsi) takim(freze, 'cep ve kesim');

  // Daire cep: merkezden dışa halkalar, kademeli derinlik.
  const adimXY = freze.cap * 0.6;
  for (const cp of enYakinSira(cepler.filter((x) => x.tip === 'daire'), konum)) {
    const Rt = cp.R - r;
    const halkalar = [];
    for (let rr = Rt; rr > 0.05; rr -= adimXY) halkalar.unshift(rr);
    yaklas(cp.x + halkalar[0], cp.y);
    for (const z of pasolar(cp.derinlik, c.pasoDerinlik)) {
      for (const rr of halkalar) {
        g1(cp.x + rr, cp.y, undefined, c.ilerleme);
        g1(undefined, undefined, -z, c.dalis);
        yaz(`G3 X${f(cp.x + rr)} Y${f(cp.y)} I${f(-rr)} J0 F${Math.round(c.ilerleme * 0.7)}`);
        kesimYol += 2 * Math.PI * rr;
        konum = { ...konum, x: cp.x + rr, y: cp.y, z: -z };
      }
      g1(cp.x + halkalar[0], cp.y, undefined, c.ilerleme);
    }
    yukari();
  }
  // Cam lambası: dıştan içe dikdörtgen halkalar (pencere zaten boydan kesilecek).
  for (const cp of cepler.filter((x) => x.tip === 'halka')) {
    const genislik = cp.ic.x0 - cp.dis.x0;
    const insetler = [];
    for (let k = r; k <= Math.max(r, genislik - r) + 1e-6; k += adimXY) insetler.push(k);
    if (insetler[insetler.length - 1] < genislik - r - 1e-6) insetler.push(genislik - r);
    for (const z of pasolar(cp.derinlik, c.pasoDerinlik)) {
      for (const k of insetler) {
        const rr = { x0: cp.dis.x0 + k, y0: cp.dis.y0 + k, x1: cp.dis.x1 - k, y1: cp.dis.y1 - k };
        if (rr.x1 <= rr.x0 || rr.y1 <= rr.y0) continue;
        yaklas(rr.x0, rr.y0);
        g1(undefined, undefined, -z, c.dalis);
        dikdortgenGez(rr, -z, true);
      }
    }
    yukari();
  }

  // İç kontur (pencere): içeri telafi, saat yönünde (tırmanma).
  for (const w of icKontur) {
    const rr = { x0: w.x0 + r, y0: w.y0 + r, x1: w.x1 - r, y1: w.y1 - r };
    profil(rr, false, false);
  }

  // Dış kontur: küçükler önce, dışa telafi, saat yönü tersine (tırmanma).
  const siraliDis = [...disKontur].sort((a, b) => (a.kucuk === b.kucuk ? a.alan - b.alan : a.kucuk ? -1 : 1));
  for (const d of siraliDis) {
    yorum(`Parca ${d.no}`);
    profilPoli(poligonOfset(d.poli, r), c.kopru && d.kucuk);
  }

  // ---- bitiş ----
  yukari();
  yaz('M5');
  g0(0, levha.h);       // portal öne gelsin, levha alınsın
  yaz('M30');
  if (post.yuzde) L.push('%');

  const sure = (kesimYol / c.ilerleme + dalisYol / c.dalis + hizliYol / 12000) * 60 * 1.15;   // sn, hızlanma payı
  const kullanilan = [...new Set([...delmeler.keys(), ...(frezeIsi ? [freze.no] : [])])].sort((a, b) => a - b);
  return { metin: L.join('\r\n') + '\r\n', uyarilar, sure, takimlar: kullanilan };

  // --------------------------------------------------------------------
  /** Dikdörtgeni o derinlikte dolaş. ccw: saat yönü tersi. */
  function dikdortgenGez(rr, z, ccw, kopruler = null) {
    const k = ccw
      ? [[rr.x1, rr.y0], [rr.x1, rr.y1], [rr.x0, rr.y1], [rr.x0, rr.y0]]
      : [[rr.x0, rr.y1], [rr.x1, rr.y1], [rr.x1, rr.y0], [rr.x0, rr.y0]];
    for (const [x, y] of k) {
      if (kopruler) kenarKopru(konum.x, konum.y, x, y, z);
      else g1(x, y, z, c.ilerleme);
    }
  }

  /** Bir kenarı köprülerde yükselerek kes (yalnız son pasoda). */
  function kenarKopru(x0, y0, x1, y1, z) {
    const uzun = Math.hypot(x1 - x0, y1 - y0);
    const tUz = c.kopruUzunluk + freze.cap;
    if (uzun < tUz * 3) { g1(x1, y1, z, c.ilerleme); return; }
    const zK = -(kalinlik - c.kopruYukseklik);
    const orta = 0.5;
    const a = orta - tUz / 2 / uzun, b = orta + tUz / 2 / uzun;
    const ara = (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    g1(...ara(a), z, c.ilerleme);
    g1(undefined, undefined, Math.max(z, zK), c.dalis);
    g1(...ara(b), Math.max(z, zK), c.ilerleme);
    g1(undefined, undefined, z, c.dalis);
    g1(x1, y1, z, c.ilerleme);
  }

  /** Dış kontur (saat yönü tersi çokgen): rampalı giriş, kademeli paso, son pasoda köprü. */
  function profilPoli(poli, kopruVar) {
    const bas = poli[0];
    yaklas(bas[0], bas[1]);
    g1(undefined, undefined, 0, c.dalis);
    const p = pasolar(kesimDerin, c.pasoDerinlik);
    p.forEach((z, i) => {
      const ilk = poli[1];
      const kenar = Math.hypot(ilk[0] - konum.x, ilk[1] - konum.y);
      const t = Math.min(c.rampa, kenar) / Math.max(kenar, 1e-6);
      g1(konum.x + (ilk[0] - konum.x) * t, konum.y + (ilk[1] - konum.y) * t, -z, c.dalis * 2);
      g1(bas[0], bas[1], -z, c.ilerleme);
      for (let j = 1; j <= poli.length; j++) {
        const [x, y] = poli[j % poli.length];
        if (kopruVar && i === p.length - 1) kenarKopru(konum.x, konum.y, x, y, -z);
        else g1(x, y, -z, c.ilerleme);
      }
    });
    yukari();
  }

  /** Kademeli profil: her pasoda rampalı giriş, son pasoda köprü. */
  function profil(rr, dis, kopruVar) {
    const ccw = dis;
    const bas = [rr.x0, rr.y0];
    yaklas(bas[0], bas[1]);
    g1(undefined, undefined, 0, c.dalis);
    const p = pasolar(kesimDerin, c.pasoDerinlik);
    p.forEach((z, i) => {
      // Rampa: ilk kenar boyunca eğimli inerek (dik dalış yakmasın).
      const ilk = ccw ? [rr.x1, rr.y0] : [rr.x0, rr.y1];
      const kenar = Math.hypot(ilk[0] - konum.x, ilk[1] - konum.y);
      const rmp = Math.min(c.rampa, kenar);
      const t = rmp / Math.max(kenar, 1e-6);
      g1(konum.x + (ilk[0] - konum.x) * t, konum.y + (ilk[1] - konum.y) * t, -z, c.dalis * 2);
      g1(bas[0], bas[1], -z, c.ilerleme);
      dikdortgenGez(rr, -z, ccw, kopruVar && i === p.length - 1);
    });
    yukari();
  }
}

/** Derinliği eşit pasolara böl (son paso tam derinlik). */
export function pasolar(derinlik, paso) {
  const n = Math.max(1, Math.ceil(derinlik / Math.max(0.5, paso) - 1e-9));
  return Array.from({ length: n }, (_, i) => (derinlik * (i + 1)) / n);
}

/** Basit en yakın komşu sıralaması (boşta gezinmeyi kısaltır). */
export function enYakinSira(noktalar, bas) {
  const kalan = [...noktalar];
  const sira = [];
  let p = { x: bas.x, y: bas.y };
  while (kalan.length) {
    let ei = 0, ed = Infinity;
    for (let i = 0; i < kalan.length; i++) {
      const d = (kalan[i].x - p.x) ** 2 + (kalan[i].y - p.y) ** 2;
      if (d < ed) { ed = d; ei = i; }
    }
    p = kalan.splice(ei, 1)[0];
    sira.push(p);
  }
  return sira;
}

function fmt(v) {
  let s = (Math.round(v * 1000) / 1000).toFixed(3);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

// Eski kontrolcüler (NcStudio, bazı Fanuc türevleri) ASCII dışı karakterde takılır.
function ascii(t) {
  return String(t)
    .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
    .replace(/[^\x20-\x7E]/g, '').replace(/[()]/g, '');
}

/** Süreyi "1 sa 12 dk" biçiminde yaz. */
export function sureYaz(sn) {
  const dk = Math.round(sn / 60);
  return dk >= 60 ? `${Math.floor(dk / 60)} sa ${dk % 60} dk` : `${Math.max(1, dk)} dk`;
}
