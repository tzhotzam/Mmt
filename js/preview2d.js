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
