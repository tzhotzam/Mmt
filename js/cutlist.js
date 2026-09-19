// Kesim listesi, malzeme özeti ve montaj kılavuzu.

import { perimeter, bbox } from './geom.js';

/**
 * @param {Array} parts üretilen parçalar
 * @param {object} nestResult nest() çıktısı
 * @param {object} info üretici modülün info nesnesi
 * @param {object} opts { feedRate: mm/dk, thickness }
 */
export function buildCutList(parts, nestResult, info, opts = {}) {
  const feedRate = opts.feedRate || 3000;
  const thickness = opts.thickness ?? info.params?.thickness ?? 0;

  const rows = parts.map((p) => {
    const b = bbox(p.outline);
    let cut = perimeter(p.outline);
    for (const h of p.holes) cut += perimeter(h);
    return {
      id: p.id,
      kind: p.kind,
      w: round(b.w),
      h: round(b.h),
      thickness,
      holes: p.holes.length,
      cutLength: round(cut),
    };
  });

  const totalCut = rows.reduce((s, r) => s + r.cutLength, 0);
  const sheetCount = nestResult.sheets.length;
  const sheetArea = sheetCount * (nestResult.opts.sheetW * nestResult.opts.sheetH) / 1e6; // m²
  const partArea = parts.reduce((s, p) => {
    const b = bbox(p.outline);
    return s + (b.w * b.h) / 1e6;
  }, 0);

  return {
    rows,
    summary: {
      partCount: parts.length,
      sheetCount,
      sheetSize: `${nestResult.opts.sheetW} × ${nestResult.opts.sheetH} mm`,
      thickness,
      totalCutLength: round(totalCut),
      estimatedMinutes: round(totalCut / feedRate, 1),
      sheetArea: round(sheetArea, 2),
      partBBoxArea: round(partArea, 2),
      utilisation: sheetArea > 0 ? round((partArea / sheetArea) * 100, 1) : 0,
      oversized: nestResult.oversized.map((p) => p.id),
      totalDepth: info.totalDepth,
      panel: `${round(info.panelW)} × ${round(info.panelH)} mm`,
    },
  };
}

export function assemblyGuide(info) {
  if (info.mode === 'ribs') {
    const p = info.params;
    return [
      `Panel ölçüsü: ${round(info.panelW)} × ${round(info.panelH)} mm, toplam derinlik ${round(info.totalDepth)} mm.`,
      `${info.count} adet lamel, ${p.thickness} mm malzemeden, aralarında ${p.gap} mm boşluk.`,
      info.railPositions.length
        ? `${info.railPositions.length} adet kızak, lamel boyunca ${info.railPositions.map((v) => round(v)).join(' / ')} mm konumlarında.`
        : 'Kızak kullanılmıyor — lamelleri arka panele doğrudan sabitleyin.',
      'Montaj sırası:',
      '  1. Kızakları düz bir zemine, kanalları yukarı bakacak şekilde paralel yerleştirin.',
      '  2. Lamelleri L1\'den başlayarak sırayla kanallara oturtun (gravür numaraları öne bakmalı).',
      '  3. Geçmeler sıkıysa kanalları zımparayla açın; gevşekse ahşap tutkalı boşluğu doldurur.',
      '  4. Kare/gönye kontrolü yapıp tutkalı kuruyana kadar işkence ile sıkın.',
      '  5. Kızakların arkasına duvar askı profili (fransız askısı) vidalayın.',
    ].join('\n');
  }
  return [
    `Panel ölçüsü: ${round(info.panelW)} × ${round(info.panelH)} mm, toplam derinlik ${round(info.totalDepth)} mm.`,
    `${info.totalLayers} katman, her biri ${info.params.thickness} mm malzemeden.`,
    'Montaj sırası:',
    '  1. T0 taban levhasını düz bir zemine koyun.',
    '  2. Her katmanı numara sırasıyla (K1, K2, ...) üstteki gravür kılavuz çizgilerine hizalayarak yapıştırın.',
    '  3. Gravür çizgisi, bir üst katmanın oturacağı sınırı gösterir.',
    '  4. Her katmandan sonra 10–15 dakika baskı uygulayın.',
    '  5. Kenarları zımparalayıp istenirse boya/vernik uygulayın.',
  ].join('\n');
}

export function cutListToCsv(cutList) {
  const head = 'Parca;Tur;En(mm);Boy(mm);Kalinlik(mm);Delik;KesimUzunlugu(mm)';
  const body = cutList.rows
    .map((r) => [r.id, r.kind, r.w, r.h, r.thickness, r.holes, r.cutLength].join(';'))
    .join('\n');
  return `${head}\n${body}\n`;
}

function round(v, digits = 0) {
  const m = Math.pow(10, digits);
  return Math.round(v * m) / m;
}
