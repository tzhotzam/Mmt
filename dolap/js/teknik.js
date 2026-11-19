// Teknik çizim: duvar duvar ölçülü önden görünüş (SVG) ve parça etiketleri.
// Çizim beyaz kâğıt üstüne siyah çizgidir: ekranda da yazıcıda da aynı görünür.
// Bu dosya tarayıcıya bağlı değildir; SVG ve HTML metin döner.

import { siralar } from './mekan.js';
import { makineMi } from './model.js';
import { renkAdi } from './renkler.js';
import { MALZEME_ADI } from './kesim.js';

const LEVHALIK = new Set(['govde', 'kapak', 'arkalik']);

/**
 * Bir duvarın önden görünüşü. B duvarı ona bakan kişinin gördüğü gibi
 * çizilir: köşe sağdadır.
 * @returns {string} SVG (birim mm)
 */
export function cepheSvg(cozum, proje, duvar = 'A') {
  const mk = proje.mekan;
  const L = duvar === 'B' ? mk.duvarB : mk.duvarA;
  const T = mk.tavan;
  const a = proje.ayakYukseklik;
  const PAD = 520;               // ölçü zincirleri için kenar boşluğu
  const W = L + 2 * PAD, Hs = T + 2 * PAD;
  const X = (x) => PAD + x;
  const Y = (y) => PAD + T - y;
  const sol = (k, m) => (duvar === 'B' ? L - k.s - m.w : k.s);
  const o = [];
  const yaz = (s) => o.push(s);

  yaz(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hs}" font-family="Helvetica, Arial, sans-serif">`);
  yaz(`<defs><pattern id="tarama" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="40" stroke="#777" stroke-width="3"/></pattern></defs>`);
  yaz(`<rect x="0" y="0" width="${W}" height="${Hs}" fill="#fff"/>`);
  // Duvar ve döşeme
  yaz(`<rect x="${X(0)}" y="${Y(T)}" width="${L}" height="${T}" fill="#f6f5f2" stroke="#999" stroke-width="3"/>`);
  yaz(`<line x1="${X(-200)}" y1="${Y(0)}" x2="${X(L + 200)}" y2="${Y(0)}" stroke="#000" stroke-width="6"/>`);

  // Engeller
  const engeller = (mk.engeller || []).filter((e) => (mk.tip === 'L' ? e.duvar : 'A') === duvar);
  for (const e of engeller) {
    const x = duvar === 'B' ? L - e.x - e.w : e.x;
    const h = Math.min(e.h, T - e.y);
    if (e.tip === 'kolon') {
      yaz(`<rect x="${X(x)}" y="${Y(e.y + h)}" width="${e.w}" height="${h}" fill="url(#tarama)" stroke="#333" stroke-width="4"/>`);
      yaz(etiket(X(x + e.w / 2), Y(e.y + h) + 70, `KOLON ${e.w}×${e.d}${e.onune ? ' (önünde dolap)' : ''}`, 46, '#333'));
    } else if (e.tip === 'pencere') {
      yaz(`<rect x="${X(x)}" y="${Y(e.y + h)}" width="${e.w}" height="${h}" fill="#eaf4f8" stroke="#333" stroke-width="4"/>`);
      yaz(`<line x1="${X(x + e.w / 2)}" y1="${Y(e.y + h)}" x2="${X(x + e.w / 2)}" y2="${Y(e.y)}" stroke="#333" stroke-width="3"/>`);
      yaz(etiket(X(x + e.w / 2), Y(e.y + h) + 60, `PENCERE ${e.w}×${h} · denizlik ${e.y}`, 43, '#333'));
    } else if (e.tip === 'kapi') {
      yaz(`<rect x="${X(x)}" y="${Y(e.y + h)}" width="${e.w}" height="${h}" fill="#f1ebe3" stroke="#333" stroke-width="4"/>`);
      yaz(etiket(X(x + e.w / 2), Y(e.y + h / 2), `KAPI ${e.w}×${h}`, 49, '#333'));
    } else {
      yaz(`<circle cx="${X(x + e.w / 2)}" cy="${Y(e.y + e.h / 2)}" r="${Math.max(25, Math.min(e.w, e.h) / 2)}" fill="none" stroke="#c0392b" stroke-width="4"/>`);
      yaz(etiket(X(x + e.w / 2), Y(e.y + e.h) - 20, `tesisat (y ${e.y})`, 38, '#c0392b'));
    }
  }

  // Modüller
  const modul = cozum.moduller.filter(({ konum }) => konum.duvar === duvar);
  for (const { m, no, konum, parcalar, cihazlar } of modul) {
    const x0 = sol(konum, m);
    const y0 = konum.y;
    if (makineMi(m) && m.altTur !== 'bulasik') {
      yaz(`<rect x="${X(x0 + 4)}" y="${Y(m.h + a - 5)}" width="${m.w - 8}" height="${m.h + a - 5}" fill="none" stroke="#555" stroke-width="3" stroke-dasharray="20 12"/>`);
      yaz(etiket(X(x0 + m.w / 2), Y((m.h + a) / 2), m.altTur === 'camasir' ? 'ÇAMAŞIR M.' : 'BULAŞIK M.', 46, '#555'));
    } else if (!(m.tip === 'ust' && m.ustTur === 'davlumbaz' && !(m.kisaH >= 150))) {
      // Gövde dış çizgisi (davlumbaz kısa dolabında yalnız dolap kısmı)
      const gy = m.tip === 'ust' && m.ustTur === 'davlumbaz' ? y0 + m.h - m.kisaH : y0;
      const gh = m.tip === 'ust' && m.ustTur === 'davlumbaz' ? m.kisaH : m.h;
      yaz(`<rect x="${X(x0)}" y="${Y(gy + gh)}" width="${m.w}" height="${gh}" fill="#fff" stroke="#000" stroke-width="4"/>`);
    }
    for (const c of cihazlar || []) {
      const cx = x0 + c.x, cy = y0 + c.y;
      if (c.tip === 'firin' || c.tip === 'mikrodalga') {
        yaz(`<rect x="${X(cx + 10)}" y="${Y(cy + c.h - 10)}" width="${c.w - 20}" height="${c.h - 20}" fill="#e9e9e9" stroke="#333" stroke-width="3"/>`);
        yaz(etiket(X(cx + c.w / 2), Y(cy + c.h / 2), c.tip === 'firin' ? 'FIRIN' : 'MİKRODALGA', 46, '#333'));
      } else if (c.tip === 'buzdolabi') {
        yaz(`<rect x="${X(cx)}" y="${Y(cy + c.h)}" width="${c.w}" height="${c.h}" fill="#eef0f2" stroke="#333" stroke-width="3" stroke-dasharray="20 12"/>`);
        yaz(etiket(X(cx + c.w / 2), Y(cy + c.h / 2), 'BUZDOLABI', 54, '#333'));
      } else if (c.tip === 'davlumbaz') {
        const gw = Math.min(c.w - 10, 600), sw = Math.min(260, c.w * 0.45);
        yaz(`<rect x="${X(x0 + (m.w - gw) / 2)}" y="${Y(y0 + 70)}" width="${gw}" height="70" fill="#e9e9e9" stroke="#333" stroke-width="3"/>`);
        yaz(`<rect x="${X(x0 + (m.w - sw) / 2)}" y="${Y(y0 + c.h)}" width="${sw}" height="${c.h - 70}" fill="#e9e9e9" stroke="#333" stroke-width="3"/>`);
        yaz(etiket(X(x0 + m.w / 2), Y(y0 + 35) + 12, 'DAVLUMBAZ', 40, '#333'));
      } else if (c.tip === 'ocak') {
        yaz(etiket(X(x0 + m.w / 2), Y(y0 + m.h + 40) - 18, 'OCAK', 38, '#333'));
      }
    }
    // Ön yüzler: kapak, çekmece önü, panel, baza
    for (const p of parcalar) {
      if (!['kapak', 'cekmeceOn', 'baza'].includes(p.grup)) continue;
      const k = p.kutu;
      const px = x0 + k.x, py = y0 + k.y;
      yaz(`<rect x="${X(px)}" y="${Y(py + k.sy)}" width="${k.sx}" height="${k.sy}" fill="none" stroke="#000" stroke-width="3"/>`);
      if (p.pencere) {
        const c = proje.cam.cerceve;
        yaz(`<rect x="${X(px + c)}" y="${Y(py + k.sy - c)}" width="${k.sx - 2 * c}" height="${k.sy - 2 * c}" fill="#eaf4f8" stroke="#000" stroke-width="2"/>`);
      }
      if (p.hareket?.tip === 'kapak') {
        // Açılış işareti: menteşe tarafının ortasına giden kesik üçgen.
        const mx = p.hareket.mentese === 'sol' ? px : px + k.sx;
        const ox = p.hareket.mentese === 'sol' ? px + k.sx : px;
        yaz(`<polyline points="${X(ox)},${Y(py + k.sy)} ${X(mx)},${Y(py + k.sy / 2)} ${X(ox)},${Y(py)}" fill="none" stroke="#888" stroke-width="2" stroke-dasharray="14 10"/>`);
      } else if (p.hareket?.tip === 'devril') {
        yaz(`<polyline points="${X(px)},${Y(py + k.sy)} ${X(px + k.sx / 2)},${Y(py)} ${X(px + k.sx)},${Y(py + k.sy)}" fill="none" stroke="#888" stroke-width="2" stroke-dasharray="14 10"/>`);
      }
      if (p.grup === 'cekmeceOn') {
        yaz(`<line x1="${X(px + k.sx / 2 - 64)}" y1="${Y(py + k.sy / 2)}" x2="${X(px + k.sx / 2 + 64)}" y2="${Y(py + k.sy / 2)}" stroke="#000" stroke-width="5"/>`);
      }
    }
    if (m.tip === 'alt' && proje.tezgah) {
      yaz(`<rect x="${X(x0)}" y="${Y(y0 + m.h + 38)}" width="${m.w}" height="38" fill="#ddd" stroke="#000" stroke-width="3"/>`);
    }
    // Modül numarası
    const ny = m.tip === 'ust' ? y0 + m.h + 70 : y0 + m.h - 70;
    yaz(`<circle cx="${X(x0 + m.w / 2)}" cy="${Y(ny)}" r="58" fill="#fff" stroke="#000" stroke-width="3"/>`);
    yaz(etiket(X(x0 + m.w / 2), Y(ny), `M${no}`, 46, '#000', true));
  }

  // Ölçü zincirleri: alt sıra altta, üst sıra üstte, toplam en altta.
  const zincir = (sira, yCizgi, yon) => {
    const parcalar = [];
    for (const { m, konum } of modul) if (siralar(m).includes(sira)) parcalar.push([sol(konum, m), sol(konum, m) + m.w]);
    for (const e of engeller) {
      if (e.tip === 'tesisat') continue;
      const x = duvar === 'B' ? L - e.x - e.w : e.x;
      parcalar.push([x, x + e.w]);
    }
    if (!parcalar.length) return;
    const noktalar = new Set([0, L]);
    for (const [p, q] of parcalar) { noktalar.add(Math.round(p)); noktalar.add(Math.round(q)); }
    const n = [...noktalar].filter((v) => v >= 0 && v <= L).sort((p, q) => p - q);
    for (let i = 0; i < n.length - 1; i++) yaz(olcu(X(n[i]), X(n[i + 1]), yCizgi, n[i + 1] - n[i], yon));
  };
  zincir('alt', Y(0) + 150, 1);
  zincir('ust', Y(T) - 150, -1);
  yaz(olcu(X(0), X(L), Y(0) + 330, L, 1));

  // Dikey kotlar (solda): ayak, gövde, tezgâh, ara, üst dolap, tavan.
  const altH = Math.max(0, ...modul.filter(({ m }) => m.tip === 'alt').map(({ m }) => m.h));
  const ustH = Math.max(0, ...modul.filter(({ m }) => m.tip === 'ust').map(({ m }) => m.h));
  const kot = [0];
  if (altH) kot.push(a, a + altH, a + altH + (proje.tezgah ? 38 : 0));
  if (ustH) kot.push(proje.ustAltKot, proje.ustAltKot + ustH);
  kot.push(T);
  const k = [...new Set(kot.map(Math.round))].sort((p, q) => p - q);
  for (let i = 0; i < k.length - 1; i++) yaz(olcuDikey(X(0) - 170, Y(k[i]), Y(k[i + 1]), k[i + 1] - k[i]));
  yaz(olcuDikey(X(0) - 360, Y(0), Y(T), T));

  // Başlık
  yaz(etiket(X(0), PAD / 2 - 40, `${esc(proje.ad || 'Mutfak')} · ${duvar} duvarı önden görünüş`, 84, '#000', true, 'start'));
  yaz(etiket(X(0), PAD / 2 + 40, `Ölçüler mm · duvar ${L} · tavan ${T}${mk.tip === 'L' ? (duvar === 'A' ? ' · köşe solda' : ' · köşe sağda') : ''}`, 46, '#555', false, 'start'));
  yaz('</svg>');
  return o.join('\n');
}

function etiket(x, y, s, boy, renk = '#000', kalin = false, hiza = 'middle') {
  return `<text x="${x}" y="${y}" font-size="${boy}" fill="${renk}" text-anchor="${hiza}" dominant-baseline="middle"${kalin ? ' font-weight="700"' : ''}>${esc(s)}</text>`;
}

/** Yatay ölçü: uzatma çizgileri, eğik işaretler, ortada değer. yon: 1 alta, -1 üste. */
function olcu(x1, x2, y, deger, yon) {
  if (x2 - x1 < 1) return '';
  const t = 16;
  const yaziY = y - 30;
  const kisa = x2 - x1 < 140;
  return `<g stroke="#000" stroke-width="2">
    <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>
    <line x1="${x1}" y1="${y - 40 * yon}" x2="${x1}" y2="${y + 20 * yon}"/>
    <line x1="${x2}" y1="${y - 40 * yon}" x2="${x2}" y2="${y + 20 * yon}"/>
    <line x1="${x1 - t}" y1="${y + t}" x2="${x1 + t}" y2="${y - t}"/>
    <line x1="${x2 - t}" y1="${y + t}" x2="${x2 + t}" y2="${y - t}"/>
  </g>${etiket((x1 + x2) / 2, kisa ? yaziY - 30 * (yon > 0 ? -1 : 1) - 30 : yaziY, sayi(deger), kisa ? 34 : 46)}`;
}

function olcuDikey(x, y1, y2, deger) {
  if (Math.abs(y2 - y1) < 1) return '';
  const t = 16;
  const ym = (y1 + y2) / 2;
  return `<g stroke="#000" stroke-width="2">
    <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>
    <line x1="${x - t}" y1="${y1 + t}" x2="${x + t}" y2="${y1 - t}"/>
    <line x1="${x - t}" y1="${y2 + t}" x2="${x + t}" y2="${y2 - t}"/>
  </g><text x="${x - 24}" y="${ym}" font-size="42" text-anchor="middle" transform="rotate(-90 ${x - 24} ${ym})">${sayi(deger)}</text>`;
}

function sayi(v) {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * Yazdırılacak parça etiketleri (A4'e 3 × 8 etiket). Her levha parçası için
 * bir etiket: numara, modül, ölçü, bant, delinen yüz, renk.
 * @returns {string} HTML
 */
export function etiketlerHtml(cozum, proje) {
  const bantYaz = (p) => {
    const b = p.bant;
    const boy = +b.y0 + +b.y1, en = +b.x0 + +b.x1;
    return boy || en ? `Bant: boy ${boy} · en ${en}` : 'Bantsız';
  };
  const kartlar = cozum.parcalar.filter((p) => LEVHALIK.has(p.malzeme)).map((p) => `
    <div class="etiket">
      <div class="et-ust"><b>${esc(p.no)}</b><span>${esc(MALZEME_ADI[p.malzeme])} ${p.kalinlik} mm</span></div>
      <div class="et-ad">${esc(p.ad)}</div>
      <div class="et-olcu">${sayi(p.kesimBoy)} × ${sayi(p.kesimEn)}</div>
      <div class="et-alt">M${p.modulNo} ${esc(p.modulAd)} · ${esc(bantYaz(p))}${p.delikler.length ? ` · delik: ${esc(p.yuz)}` : ''}${p.pencere ? ' · camlı' : ''}</div>
      ${p.renk ? `<div class="et-alt">${esc(renkAdi(p.renk))}</div>` : ''}
    </div>`).join('');
  return `<div class="etiket-sayfa">${kartlar}</div>`;
}
