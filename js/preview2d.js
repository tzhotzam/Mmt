// 2B önizlemeler: panelin önden görünümü, levha yerleşimi ve kaynak yükseklik haritası.

import { applyPlacement } from './nest.js';

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b0e12';
  ctx.fillRect(0, 0, w, h);
  return { ctx, w, h, dpr };
}

/** Panel koordinatlarını (Y yukarı) tuvale oturtan dönüşüm. */
function fitTransform(ctx, w, h, panelW, panelH, pad = 24) {
  const s = Math.min((w - pad * 2) / panelW, (h - pad * 2) / panelH);
  const ox = (w - panelW * s) / 2;
  const oy = (h - panelH * s) / 2;
  ctx.setTransform(s, 0, 0, -s, ox, h - oy);
  return s;
}

function tracePath(ctx, ring, closed = true) {
  if (!ring.length) return;
  ctx.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
  if (closed) ctx.closePath();
}

// ---------------------------------------------------------------- PLAN

export function drawPlan(canvas, state) {
  const { ctx, w, h } = setup(canvas);
  if (!state || !state.parts?.length) return;
  const { info } = state;
  const s = fitTransform(ctx, w, h, info.panelW, info.panelH);
  ctx.lineWidth = 1 / s;

  if (info.mode === 'ribs') drawRibsFront(ctx, state, s);
  else drawContourMap(ctx, state, s);

  // Panel çerçevesi
  ctx.strokeStyle = 'rgba(245,158,11,0.55)';
  ctx.lineWidth = 1.5 / s;
  ctx.beginPath();
  ctx.rect(0, 0, info.panelW, info.panelH);
  ctx.stroke();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawRibsFront(ctx, state, s) {
  const { parts, info } = state;
  const horizontal = info.params.orientation === 'horizontal';
  const minD = info.params.baseDepth;
  const maxD = info.params.baseDepth + info.params.maxDepth;

  for (const part of parts) {
    if (part.kind !== 'lamel') continue;
    const prof = part.meta.profile;
    if (!prof) continue;
    const a0 = part.meta.across;
    const t = part.meta.thickness;

    for (let i = 0; i < prof.length - 1; i++) {
      const [pos, d] = prof[i];
      const next = prof[i + 1][0];
      const k = maxD > minD ? (d - minD) / (maxD - minD) : 0;
      // Derinlik arttıkça öne çıkar → daha aydınlık.
      const lum = 26 + k * 210;
      const tint = 0.55 + k * 0.45;
      ctx.fillStyle = `rgb(${Math.round(lum * tint + 28)},${Math.round(lum * 0.92)},${Math.round(lum * 0.72)})`;
      if (horizontal) ctx.fillRect(pos, a0, next - pos + 0.6, t);
      else ctx.fillRect(a0, pos, t, next - pos + 0.6);
    }
  }

  // Lamel aralıklarındaki gölge çizgileri
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = Math.max(0.6, info.params.gap * 0.6);
  ctx.beginPath();
  for (const part of parts) {
    if (part.kind !== 'lamel') continue;
    const e = part.meta.across + part.meta.thickness + info.params.gap / 2;
    if (horizontal) { ctx.moveTo(0, e); ctx.lineTo(info.panelW, e); }
    else { ctx.moveTo(e, 0); ctx.lineTo(e, info.panelH); }
  }
  ctx.stroke();
}

function drawContourMap(ctx, state, s) {
  const { parts, info } = state;
  const total = info.totalLayers || 1;
  const sorted = parts.slice().sort((a, b) => (a.meta.layer || 0) - (b.meta.layer || 0));

  for (const part of sorted) {
    const k = (part.meta.layer || 0) / total;
    const lum = Math.round(34 + k * 200);
    ctx.fillStyle = `rgb(${Math.round(lum * 1.0)},${Math.round(lum * 0.9)},${Math.round(lum * 0.7)})`;
    ctx.beginPath();
    tracePath(ctx, part.outline);
    for (const hole of part.holes) tracePath(ctx, hole);
    ctx.fill('evenodd');

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1 / s;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- LEVHA

export function drawNest(canvas, nestResult, sheetIndex = 0) {
  const { ctx, w, h } = setup(canvas);
  if (!nestResult || !nestResult.sheets.length) return;
  const idx = Math.min(sheetIndex, nestResult.sheets.length - 1);
  const sheet = nestResult.sheets[idx];
  const s = fitTransform(ctx, w, h, sheet.w, sheet.h, 18);

  ctx.fillStyle = '#15191f';
  ctx.fillRect(0, 0, sheet.w, sheet.h);
  ctx.strokeStyle = '#4b5563';
  ctx.setLineDash([12, 6]);
  ctx.lineWidth = 1.5 / s;
  ctx.strokeRect(0, 0, sheet.w, sheet.h);
  ctx.setLineDash([]);

  for (const pl of sheet.placements) {
    const a = applyPlacement(pl);
    ctx.beginPath();
    tracePath(ctx, a.outline);
    for (const hole of a.holes) tracePath(ctx, hole);
    ctx.fillStyle = 'rgba(245,158,11,0.16)';
    ctx.fill('evenodd');
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.2 / s;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(56,189,248,0.75)';
    ctx.lineWidth = 1 / s;
    for (const e of a.engrave) {
      if (e.type !== 'polyline') continue;
      ctx.beginPath();
      tracePath(ctx, e.points, e.closed !== false);
      ctx.stroke();
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#9aa5b1';
  ctx.font = `${12 * (canvas.width / canvas.getBoundingClientRect().width)}px -apple-system, sans-serif`;
  ctx.fillText(
    `Levha ${idx + 1} / ${nestResult.sheets.length} · ${sheet.w}×${sheet.h} mm · ${sheet.placements.length} parça`,
    12, 20
  );
}

// ---------------------------------------------------------------- KAYNAK

export function drawSource(canvas, grid) {
  const { ctx, w, h } = setup(canvas);
  if (!grid) return;
  const img = ctx.createImageData(grid.w, grid.h);
  for (let i = 0; i < grid.data.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, grid.data[i])) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  // ImageData doğrudan ölçeklenemez; ara tuval üzerinden çizilir.
  const tmp = document.createElement('canvas');
  tmp.width = grid.w;
  tmp.height = grid.h;
  tmp.getContext('2d').putImageData(img, 0, 0);

  const s = Math.min((w - 24) / grid.w, (h - 24) / grid.h);
  const dw = grid.w * s;
  const dh = grid.h * s;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// ---------------------------------------------------------- PARÇA KATALOĞU

/**
 * Poligonal kabuk / dilim modunda parçaları gösterir.
 *
 *  - Izgara: bütün parçalar, numaralarıyla. Bir parçaya dokununca o parça
 *    tam ekran açılır (focus).
 *  - Tek parça: kesim çizgileri, kertikler, büküm izleri, delikler ve
 *    etiketler okunacak büyüklükte. Sol kenara dokun: önceki, sağ kenar:
 *    sonraki, orta: ızgaraya dön.
 *
 * Eskiden yalnızca dış hat ve delikler çiziliyordu; kertikler, büküm
 * çizgileri ve numaralar hiç görünmüyordu, parçalar da küçücük kalıyordu.
 * Kullanıcı perçin kulakçıklarını ve köşe deliklerini programda göremedi.
 *
 * @returns {Array} hücreler [{x,y,w,h}] — dokunma eşlemesi için (ızgarada)
 */
export function drawParts(canvas, parts, focus = -1, view = null) {
  const { ctx, w, h, dpr } = setup(canvas);
  if (!parts?.length) return [];

  if (focus >= 0 && focus < parts.length) {
    const part = parts[focus];
    const top = 34 * dpr, alt = 26 * dpr;
    // view: { k, px, py } — yakınlaştırma ve kaydırma (tuval pikseli).
    const k = view?.k || 1, px = view?.px || 0, py = view?.py || 0;
    drawPartDetail(ctx, part, w / 2 + px, top + (h - top - alt) / 2 + py,
      (w - 24 * dpr) * k, (h - top - alt - 12 * dpr) * k, true);
    // Başlık ve ipucu, yakınlaştırılan parçanın üstünde okunur kalsın.
    ctx.fillStyle = 'rgba(11,14,18,0.85)';
    ctx.fillRect(0, 0, w, top);
    ctx.fillRect(0, h - alt, w, alt);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = `600 ${14 * dpr}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    const bb = bboxOf(part.outline);
    ctx.fillText(`${part.id}  ·  ${Math.round(bb.w)} × ${Math.round(bb.h)} mm  ·  ${focus + 1}/${parts.length}`, w / 2, 22 * dpr);
    ctx.fillStyle = '#9aa5b1';
    ctx.font = `${11 * dpr}px -apple-system, sans-serif`;
    ctx.fillText(k > 1.01
      ? `×${k.toFixed(1)} · sürükle: kaydır · ortaya dokun: sığdır`
      : '◀ önceki · iki parmak/tekerlek: yakınlaştır · orta: tümü · sonraki ▶', w / 2, h - 9 * dpr);
    ctx.textAlign = 'start';
    return [];
  }

  const cols = Math.ceil(Math.sqrt(parts.length * (w / h)));
  const rows = Math.ceil(parts.length / cols);
  const cellW = w / cols;
  const cellH = h / rows;
  const pad = Math.min(cellW, cellH) * 0.12;
  const cells = [];

  parts.forEach((part, i) => {
    const cx = (i % cols) * cellW + cellW / 2;
    const cy = Math.floor(i / cols) * cellH + cellH / 2;
    drawPartDetail(ctx, part, cx, cy - cellH * 0.04, cellW - pad * 2, cellH - pad * 2.2, false);
    ctx.fillStyle = '#9aa5b1';
    ctx.font = `${Math.max(9, cellH * 0.11)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(part.id, cx, cy + cellH / 2 - 3);
    cells.push({ x: (i % cols) * cellW / dpr, y: Math.floor(i / cols) * cellH / dpr, w: cellW / dpr, h: cellH / dpr });
  });
  ctx.textAlign = 'start';
  return cells;
}

/** Bir parçayı (cx,cy) merkezli, bw×bh kutuya sığdırıp çizer. */
function drawPartDetail(ctx, part, cx, cy, bw, bh, detayli) {
  const b = bboxOf(part.outline);
  const s = Math.min(bw / (b.w || 1), bh / (b.h || 1));
  const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
  const X = (x) => cx + (x - mx) * s;
  const Y = (y) => cy - (y - my) * s;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, -s);
  ctx.translate(-mx, -my);

  // Dış halka ve delikler TEK yolda, çift-tek kuralıyla: delikler gerçekten
  // boşluk olarak görünür.
  ctx.beginPath();
  tracePath(ctx, part.outline);
  for (const hole of part.holes || []) tracePath(ctx, hole);
  ctx.fillStyle = '#e8583a';
  ctx.fill('evenodd');
  ctx.strokeStyle = '#ffd2c4';
  ctx.lineWidth = 1 / s;
  ctx.stroke();

  for (const e of part.engrave || []) {
    if (e.type !== 'polyline') continue;
    ctx.beginPath();
    tracePath(ctx, e.points, e.closed !== false);
    if (e.layer === 'KESIM') {
      // Kertik: tam kesim — koyu ve kalın.
      ctx.strokeStyle = '#111';
      ctx.lineWidth = (detayli ? 2.2 : 1.4) / s;
    } else {
      // Büküm izi / hizalama: yüzeysel gravür — ince ve açık.
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 0.8 / s;
    }
    ctx.stroke();
  }
  ctx.restore();

  // Yazılar ekran koordinatında çizilir (Y ekseni ters, metin ters dönmesin).
  // Okunamayacak kadar küçükse hiç çizilmez; ızgarada kalabalık yapar.
  ctx.fillStyle = '#1b1b1b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const e of part.engrave || []) {
    if (e.type !== 'text') continue;
    const px = e.size * s;
    if (px < 7) continue;
    ctx.font = `${px}px -apple-system, sans-serif`;
    ctx.fillText(e.text, X(e.x), Y(e.y));
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'start';
}

function bboxOf(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// ------------------------------------------------------------- ÇİZİM GÖRÜNÜMÜ

/** Izgarayı tuvale oturtan dönüşüm — çizim ve tıklama eşlemesi aynı olsun diye. */
export function gridTransform(canvas, grid, pad = 12) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width * dpr);
  const h = Math.max(1, rect.height * dpr);
  const s = Math.min((w - pad * 2) / grid.w, (h - pad * 2) / grid.h);
  return { s, ox: (w - grid.w * s) / 2, oy: (h - grid.h * s) / 2, dpr, rect };
}

/** Ekran koordinatını ızgara koordinatına çevirir. */
export function screenToGrid(canvas, grid, clientX, clientY) {
  const t = gridTransform(canvas, grid);
  const x = ((clientX - t.rect.left) * t.dpr - t.ox) / t.s;
  const y = ((clientY - t.rect.top) * t.dpr - t.oy) / t.s;
  return [x, y];
}

/**
 * Taban + boyama katmanını gri tonlamalı gösterir; boyanan yerler renklenir
 * (mavi = yükseltilmiş, kırmızı = alçaltılmış).
 */
export function drawPaintView(canvas, grid, layer) {
  const { ctx, w, h } = setup(canvas);
  if (!grid) return;

  const img = ctx.createImageData(grid.w, grid.h);
  for (let i = 0; i < grid.data.length; i++) {
    const paint = layer ? layer.data[i] : 0;
    const v = Math.max(0, Math.min(1, grid.data[i]));
    const g = Math.round(v * 255);
    let r = g, gg = g, b = g;
    if (paint > 0.004) {
      const k = Math.min(1, paint * 2);
      r = Math.round(g * (1 - k * 0.55));
      gg = Math.round(g * (1 - k * 0.2));
      b = Math.min(255, Math.round(g + k * 90));
    } else if (paint < -0.004) {
      const k = Math.min(1, -paint * 2);
      r = Math.min(255, Math.round(g + k * 90));
      gg = Math.round(g * (1 - k * 0.45));
      b = Math.round(g * (1 - k * 0.45));
    }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }

  const tmp = document.createElement('canvas');
  tmp.width = grid.w;
  tmp.height = grid.h;
  tmp.getContext('2d').putImageData(img, 0, 0);

  const t = gridTransform(canvas, grid);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, t.ox, t.oy, grid.w * t.s, grid.h * t.s);

  ctx.strokeStyle = 'rgba(245,158,11,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(t.ox, t.oy, grid.w * t.s, grid.h * t.s);
}
