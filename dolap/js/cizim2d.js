// Canvas çizimleri: tek parçanın delik planı ve levha yerleşimi.

import { levhaNoktasi } from './yerlesim.js';
import { kesimKonturu } from './kertme.js';

export const DELIK_RENK = {
  mentese: '#38bdf8', minifix: '#f59e0b', raf: '#a78bfa', kavela: '#34d399', kulp: '#f472b6', vida: '#f472b6',
};
export const DELIK_AD = {
  mentese: 'Menteşe', minifix: 'Minifix', raf: 'Raf pimi', kavela: 'Kavela', kulp: 'Kulp', vida: 'Konfirmat',
};
const BANT_RENK = '#f43f5e';

function hazirla(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 360;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#0b0e12';
  c.fillRect(0, 0, w, h);
  return { c, w, h };
}

/** Tek parça: kesim konturu, bantlar, delikler, ölçüler. */
export function parcaCiz(canvas, p) {
  const { c, w, h } = hazirla(canvas);
  if (!p) { bosYazi(c, w, h, 'Listeden bir parça seçin.'); return; }
  const pad = 46;
  const s = Math.min((w - 2 * pad) / p.kesimBoy, (h - 2 * pad - 20) / p.kesimEn);
  const ox = (w - p.kesimBoy * s) / 2, oy = (h + p.kesimEn * s) / 2 + 6;
  const X = (x) => ox + x * s, Y = (y) => oy - y * s;     // çizimde y yukarı

  c.fillStyle = '#1e242c';
  c.strokeStyle = '#e6eaef';
  c.lineWidth = 1.2;
  c.beginPath();
  kesimKonturu(p).forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
  c.closePath();
  c.fill();
  c.stroke();

  // Bantlı kenarlar
  c.strokeStyle = BANT_RENK;
  c.lineWidth = 4;
  const b = p.bant;
  const kenar = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(X(x1), Y(y1)); c.lineTo(X(x2), Y(y2)); c.stroke(); };
  if (b.y0) kenar(0, 0, p.kesimBoy, 0);
  if (b.y1) kenar(0, p.kesimEn, p.kesimBoy, p.kesimEn);
  if (b.x0) kenar(0, 0, 0, p.kesimEn);
  if (b.x1) kenar(p.kesimBoy, 0, p.kesimBoy, p.kesimEn);

  if (p.lamba) {
    const r = p.lamba;
    c.setLineDash([5, 4]);
    c.strokeStyle = '#38bdf8';
    c.lineWidth = 1.2;
    c.strokeRect(X(r.x0 - p.dx), Y(r.y1 - p.dy), (r.x1 - r.x0) * s, (r.y1 - r.y0) * s);
    c.setLineDash([]);
  }
  if (p.pencere) {
    const r = p.pencere;
    c.fillStyle = '#0b0e12';
    c.strokeStyle = '#e6eaef';
    c.lineWidth = 1.2;
    c.fillRect(X(r.x0 - p.dx), Y(r.y1 - p.dy), (r.x1 - r.x0) * s, (r.y1 - r.y0) * s);
    c.strokeRect(X(r.x0 - p.dx), Y(r.y1 - p.dy), (r.x1 - r.x0) * s, (r.y1 - r.y0) * s);
    c.fillStyle = '#9aa5b1';
    c.font = '11px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(`pencere ${fmt(r.x1 - r.x0)} × ${fmt(r.y1 - r.y0)} · cam lambası ${p.lamba.derinlik} mm`, X((r.x0 + r.x1) / 2 - p.dx), Y((r.y0 + r.y1) / 2 - p.dy));
  }
  for (const d of p.delikler) {
    const x = X(d.x - p.dx), y = Y(d.y - p.dy);
    c.beginPath();
    c.arc(x, y, Math.max(2.2, (d.cap / 2) * s), 0, Math.PI * 2);
    c.fillStyle = DELIK_RENK[d.tur] || '#fff';
    c.globalAlpha = d.derinlik === 'gecer' ? 1 : 0.85;
    c.fill();
    c.globalAlpha = 1;
  }
  c.strokeStyle = '#34d399';
  c.lineWidth = 2;
  for (const k of p.kenarDelik) {
    const L = 14 / s;
    if (k.kenar === 'x0') kenar(0, k.konum - p.dy, L, k.konum - p.dy);
    else if (k.kenar === 'x1') kenar(p.kesimBoy, k.konum - p.dy, p.kesimBoy - L, k.konum - p.dy);
    else if (k.kenar === 'y0') kenar(k.konum - p.dx, 0, k.konum - p.dx, L);
    else kenar(k.konum - p.dx, p.kesimEn, k.konum - p.dx, p.kesimEn - L);
  }

  // Ölçüler
  c.fillStyle = '#9aa5b1';
  c.font = '12px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText(`${fmt(p.kesimBoy)} mm`, X(p.kesimBoy / 2), Y(0) + 18);
  c.save();
  c.translate(X(0) - 16, Y(p.kesimEn / 2));
  c.rotate(-Math.PI / 2);
  c.fillText(`${fmt(p.kesimEn)} mm`, 0, 0);
  c.restore();
  c.textAlign = 'left';
  c.fillStyle = '#e6eaef';
  c.font = '600 13px system-ui, sans-serif';
  c.fillText(`${p.no} · ${p.ad}`, 12, 20);
  c.fillStyle = '#9aa5b1';
  c.font = '12px system-ui, sans-serif';
  c.fillText(`Delinen yüz yukarı: ${p.yuz} · damar → yatay${p.kontur ? ' · kolon kertmeli' : ''}`, 12, 37);
}

/** Levha: parçalar, etiketler, delikler (nokta). */
export function levhaCiz(canvas, levha, { seciliNo, baslik } = {}) {
  const { c, w, h } = hazirla(canvas);
  if (!levha) { bosYazi(c, w, h, 'Levha yok.'); return []; }
  const pad = 14, ust = 26;
  const s = Math.min((w - 2 * pad) / levha.w, (h - 2 * pad - ust) / levha.h);
  const ox = (w - levha.w * s) / 2, oy = ust + pad + levha.h * s;
  const X = (x) => ox + x * s, Y = (y) => oy - y * s;

  c.fillStyle = '#151a20';
  c.fillRect(X(0), Y(levha.h), levha.w * s, levha.h * s);
  c.strokeStyle = '#3b4552';
  c.lineWidth = 1;
  c.strokeRect(X(0), Y(levha.h), levha.w * s, levha.h * s);

  const kutular = [];
  for (const yer of levha.yerlesim) {
    const p = yer.parca;
    const sec = p.no === seciliNo;
    c.fillStyle = sec ? 'rgba(245,158,11,0.35)' : RENK_MALZEME[p.malzeme];
    c.strokeStyle = sec ? '#f59e0b' : '#5a6573';
    c.lineWidth = sec ? 2 : 1;
    const rx = X(yer.x), ry = Y(yer.y + yer.h), rw = yer.w * s, rh = yer.h * s;
    if (p.kontur) {
      c.beginPath();
      kesimKonturu(p).forEach(([px, py], i) => {
        const [sx, sy] = levhaNoktasi(yer, p, px, py);
        if (i) c.lineTo(X(sx), Y(sy)); else c.moveTo(X(sx), Y(sy));
      });
      c.closePath();
      c.fill();
      c.stroke();
    } else {
      c.fillRect(rx, ry, rw, rh);
      c.strokeRect(rx, ry, rw, rh);
    }
    kutular.push({ no: p.no, x: rx, y: ry, w: rw, h: rh });
    if (p.pencere) {
      const r = p.pencere;
      const a = levhaNoktasi(yer, p, r.x0 - p.dx, r.y0 - p.dy), z = levhaNoktasi(yer, p, r.x1 - p.dx, r.y1 - p.dy);
      const px = Math.min(a[0], z[0]), py = Math.max(a[1], z[1]);
      c.fillStyle = '#0b0e12';
      c.fillRect(X(px), Y(py), Math.abs(z[0] - a[0]) * s, Math.abs(z[1] - a[1]) * s);
      c.strokeRect(X(px), Y(py), Math.abs(z[0] - a[0]) * s, Math.abs(z[1] - a[1]) * s);
    }
    for (const d of p.delikler) {
      const [sx, sy] = levhaNoktasi(yer, p, d.x - p.dx, d.y - p.dy);
      c.beginPath();
      c.arc(X(sx), Y(sy), Math.max(1, (d.cap / 2) * s), 0, Math.PI * 2);
      c.fillStyle = DELIK_RENK[d.tur] || '#fff';
      c.fill();
    }
    if (rw > 34 && rh > 14) {
      c.save();
      c.beginPath();
      c.rect(rx, ry, rw, rh);
      c.clip();
      c.fillStyle = '#e6eaef';
      c.font = `${Math.max(9, Math.min(13, rh / 3))}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(p.no, rx + rw / 2, ry + rh / 2 - (rh > 34 ? 7 : 0));
      if (rh > 34) {
        c.fillStyle = '#9aa5b1';
        c.font = '10px system-ui, sans-serif';
        c.fillText(`${fmt(p.kesimBoy)}×${fmt(p.kesimEn)}${yer.dondu ? ' ↻' : ''}`, rx + rw / 2, ry + rh / 2 + 8);
      }
      c.restore();
    }
  }
  c.fillStyle = '#e6eaef';
  c.font = '600 12px system-ui, sans-serif';
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillText(baslik || '', pad, 18);
  return kutular;
}

const RENK_MALZEME = { govde: 'rgba(230,234,239,0.10)', kapak: 'rgba(56,189,248,0.14)', arkalik: 'rgba(167,139,250,0.12)' };

function bosYazi(c, w, h, s) {
  c.fillStyle = '#9aa5b1';
  c.font = '13px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText(s, w / 2, h / 2);
}

function fmt(v) {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}
