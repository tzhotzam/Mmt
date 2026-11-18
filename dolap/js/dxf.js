// Levha planından R12 DXF.
//
// Katman düzeni CAM'de işlem atamayı kolaylaştırmak için:
//   KESIM                 parça dış konturu (boydan boya kesim)
//   DELIK_D35_Z13         Ø35, 13 mm derin (menteşe çanağı) — her çap/derinlik ayrı
//   DELIK_D5_GECER        boydan geçen delik (kulp, konfirmat)
//   KENAR_DELIK           kenardan delinecek yer işareti (3 eksende delinmez)
//   ETIKET                parça numarası (bilgi; kesilmez)
//   LEVHA                 levha sınırı (bilgi; kesilmez)
// Delikler CIRCLE varlığıdır; çoğu CAM programı çemberi doğrudan "delme"ye
// çevirir.

import { levhaNoktasi } from './yerlesim.js';

const RENK = { mentese: 4, minifix: 30, raf: 5, kavela: 3, kulp: 6, vida: 6 };

export function delikKatmani(d) {
  return d.derinlik === 'gecer' ? `DELIK_D${d.cap}_GECER` : `DELIK_D${d.cap}_Z${d.derinlik}`;
}

class Dxf {
  constructor() { this.k = []; this.katman = new Map(); this.varlik = []; }
  kat(ad, renk) { if (!this.katman.has(ad)) this.katman.set(ad, renk); return ad; }
  p(...a) { for (let i = 0; i < a.length; i += 2) this.varlik.push(String(a[i]), String(a[i + 1])); }
  cizgi(noktalar, kat, kapali) {
    this.p(0, 'POLYLINE', 8, kat, 66, 1, 70, kapali ? 1 : 0, 10, 0, 20, 0, 30, 0);
    for (const [x, y] of noktalar) this.p(0, 'VERTEX', 8, kat, 10, n(x), 20, n(y), 30, 0);
    this.p(0, 'SEQEND', 8, kat);
  }
  daire(x, y, r, kat) { this.p(0, 'CIRCLE', 8, kat, 10, n(x), 20, n(y), 30, 0, 40, n(r)); }
  yazi(s, x, y, h, kat, aci = 0) {
    this.p(0, 'TEXT', 8, kat, 10, n(x), 20, n(y), 30, 0, 40, n(h), 1, s);
    if (aci) this.p(50, n(aci));
    this.p(72, 1, 73, 2, 11, n(x), 21, n(y), 31, 0);
  }
  bitir() {
    const o = [];
    const q = (...a) => { for (let i = 0; i < a.length; i += 2) o.push(String(a[i]), String(a[i + 1])); };
    q(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC');
    q(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, this.katman.size);
    for (const [ad, renk] of this.katman) q(0, 'LAYER', 2, ad, 70, 0, 62, renk, 6, 'CONTINUOUS');
    q(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
    o.push(...this.varlik);
    q(0, 'ENDSEC', 0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }
}

function n(v) { return Number(v).toFixed(3); }

function levhaCiz(b, levha, ox, oy, opts) {
  if (opts.levhaSiniri !== false) {
    b.cizgi([[ox, oy], [ox + levha.w, oy], [ox + levha.w, oy + levha.h], [ox, oy + levha.h]], b.kat('LEVHA', 8), true);
  }
  for (const yer of levha.yerlesim) {
    const p = yer.parca;
    const x0 = ox + yer.x, y0 = oy + yer.y;
    b.cizgi([[x0, y0], [x0 + yer.w, y0], [x0 + yer.w, y0 + yer.h], [x0, y0 + yer.h]], b.kat('KESIM', 1), true);
    const nokta = (px, py) => {
      const [sx, sy] = levhaNoktasi(yer, p, px, py);
      return [ox + sx, oy + sy];
    };
    for (const d of p.delikler) {
      const [x, y] = nokta(d.x - p.dx, d.y - p.dy);
      b.daire(x, y, d.cap / 2, b.kat(delikKatmani(d), RENK[d.tur] || 7));
    }
    // Camlı kapak: pencere boydan kesilir (KESIM içinde iç kontur), arka
    // yüzde cam lambası cep olarak oyulur. Parça arka yüzü yukarı dizildiği
    // için ikisi de aynı kurulumda işlenir.
    const dikdortgen = (r) => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]
      .map(([px, py]) => nokta(px - p.dx, py - p.dy));
    if (p.lamba) b.cizgi(dikdortgen(p.lamba), b.kat(`CEP_Z${p.lamba.derinlik}`, 5), true);
    if (p.pencere) b.cizgi(dikdortgen(p.pencere), b.kat('KESIM', 1), true);
    for (const k of p.kenarDelik) {
      const L = 15;
      let a, c;
      if (k.kenar === 'x0') { a = [0, k.konum - p.dy]; c = [L, k.konum - p.dy]; }
      else if (k.kenar === 'x1') { a = [p.kesimBoy, k.konum - p.dy]; c = [p.kesimBoy - L, k.konum - p.dy]; }
      else if (k.kenar === 'y0') { a = [k.konum - p.dx, 0]; c = [k.konum - p.dx, L]; }
      else { a = [k.konum - p.dx, p.kesimEn]; c = [k.konum - p.dx, p.kesimEn - L]; }
      b.cizgi([nokta(...a), nokta(...c)], b.kat('KENAR_DELIK', 6), false);
    }
    if (opts.etiket !== false) {
      const h = Math.max(8, Math.min(30, Math.min(yer.w, yer.h) / 6));
      b.yazi(`${p.no} ${ascii(p.ad)}`, x0 + yer.w / 2, y0 + yer.h / 2, h, b.kat('ETIKET', 2), yer.w < yer.h ? 90 : 0);
    }
  }
}

/** Tek levha. */
export function levhaDxf(levha, opts = {}) {
  const b = new Dxf();
  b.kat('KESIM', 1);
  levhaCiz(b, levha, 0, 0, opts);
  return b.bitir();
}

/** Birden çok levha yan yana tek dosyada (aralarında 200 mm). */
export function levhalarDxf(levhalar, opts = {}) {
  const b = new Dxf();
  b.kat('KESIM', 1);
  let ox = 0;
  for (const lv of levhalar) {
    levhaCiz(b, lv, ox, 0, opts);
    ox += lv.w + 200;
  }
  return b.bitir();
}

// Eski CAM programları R12 TEXT içindeki Türkçe harfleri bozuk gösteriyor.
function ascii(s) {
  return String(s).replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => ({
    ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
  })[c]);
}
