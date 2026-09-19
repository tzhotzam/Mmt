// Kesim listesi, malzeme özeti ve montaj kılavuzu.

import { perimeter, bbox, signedArea } from './geom.js';

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
  // Doluluk yalnızca levhaya YERLEŞEN parçalardan hesaplanır. Sığmayanları
  // saymak, tek levhaya iki kızak konup 50 lamelin dışarıda kaldığı durumda
  // %357 gibi anlamsız bir doluluk üretiyordu.
  const unplaced = new Set(nestResult.oversized.map((p) => p.id));
  const partArea = parts.reduce((s, p) => {
    if (unplaced.has(p.id)) return s;
    let a = Math.abs(signedArea(p.outline));
    for (const h of p.holes) a -= Math.abs(signedArea(h));
    return s + Math.max(0, a) / 1e6;
  }, 0);

  return {
    rows,
    summary: {
      partCount: parts.length,
      placedCount: parts.length - unplaced.size,
      sheetCount,
      sheetSize: `${nestResult.opts.sheetW} × ${nestResult.opts.sheetH} mm`,
      thickness,
      totalCutLength: round(totalCut),
      estimatedMinutes: round(totalCut / feedRate, 1),
      sheetArea: round(sheetArea, 2),
      partArea: round(partArea, 2),
      utilisation: sheetArea > 0 ? round((partArea / sheetArea) * 100, 1) : 0,
      oversized: nestResult.oversized.map((p) => p.id),
      totalDepth: info.totalDepth,
      panel: `${round(info.panelW)} × ${round(info.panelH)} mm`,
    },
  };
}

export function assemblyGuide(info, seams = [], folds = []) {
  if (info.mode === 'facets') return weldGuide(info, seams, folds);
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

function weldGuide(info, seams, folds = []) {
  const p = info.params;
  const m = info.modelSize;
  const convex = seams.filter((s) => s.angle < 179).length;
  const concave = seams.filter((s) => s.angle > 181).length;
  const sharp = seams.filter((s) => s.angle < 60);

  const lines = [
    `Heykel ölçüsü: ${round(m.x)} × ${round(m.y)} × ${round(m.z)} mm`,
    info.unfold
      ? `${info.facetCount} faset → ${info.partCount} yaprak, ${info.foldCount} büküm, `
        + `${info.seamCount} kaynak dikişi, ${p.thickness} mm sac.`
      : `${info.facetCount} faset, ${info.seamCount} kaynak dikişi, ${p.thickness} mm sac.`,
    `Toplam yüzey alanı: ${round(info.totalArea / 1e6, 2)} m².`,
    '',
    'NASIL BİRLEŞİR',
    info.unfold
      ? '  Her yaprağın üstünde kendi numarası (Y01, Y02, ...) yazar.'
      : '  Her parçanın üstünde kendi numarası (P01, P02, ...) yazar.',
    '  Dış kenarlardaki küçük numaralar KAYNAK DİKİŞİ numaralarıdır.',
    '  Aynı numaralı iki kenarı karşı karşıya getirip puntalayın.',
    '  Her kenar numarası tam iki parçada geçer — eşini aşağıdaki listeden bulun.',
    ...(info.unfold ? [
      '',
      'BÜKÜM ÇİZGİLERİ',
      '  Yaprağın İÇİNDEKİ kesik çizgiler büküm hattıdır — kesim değil, KERTİKTİR.',
      '  Yanındaki derece, bükümden sonra iki yüzey arasında kalması gereken',
      '  İÇ açıdır. 180° düz demektir; sayı küçüldükçe büküm sertleşir.',
      '  Kertikli olduğu için abkant gerekmez, elle bükülür ve açı kendini tutar.',
      `  Köprü biçimi: ${p.bridgeMode === 'tek' ? 'ortada tek köprü'
        : p.bridgeMode === 'dagitik' ? 'çizgi boyunca dağıtık köprüler'
        : `otomatik — ${p.autoLimit} mm altı kenarlarda tek köprü, üstünde dağıtık`}.`,
      '  Tek köprü elle bükmeyi kolaylaştırır; uzun kenarda kanatlar burulabilir.',
      '',
      '  Kertikleri KAPATMAK ZORUNDA DEĞİLSİNİZ. İki seçenek:',
      '    a) Açık bırakın — kesik çizgi görünür kalır, yüzeyde desen olur.',
      '       Dekoratif heykellerde yaygındır ve iş yükünü çok azaltır.',
      '    b) Kaynakla doldurup taşlayın — kenar keskinleşir, yüzey kesintisiz olur.',
      '',
      '  Kabuk tek başına taşıyıcı değildir. Büyük heykellerde içeriye bir çatkı',
      '  (profil/boru iskelet) kurup kabuğu ona puntalayın.',
    ] : []),
    '',
    'MONTAJ SIRASI',
    ...(info.unfold ? [
      '  1. Yaprakları kesin; kertikli iç çizgileri KESMEYİ unutmayın (KESIM katmanı).',
      '  2. Her yaprağı kertik çizgisinin tam ortasından, yazan dereceye bükün.',
      '     Gönye veya açıölçerle kontrol edin; çelik birkaç derece geri yaylanır,',
      '     biraz fazla büküp bırakın.',
      '  3. İsterseniz kertikleri kaynakla doldurup taşlayın (bkz. yukarıdaki not).',
      '  4. Yaprakları dış kenar numaralarına göre birbirine puntalayın.',
      '  5. Tamamı puntalanıp geometri oturduktan sonra dikişleri doldurun.',
      '  6. Çarpılmayı azaltmak için karşılıklı bölgelerde sırayla kaynatın.',
      '  7. Taşlayıp yüzeyi düzleyin, ardından astar + boya.',
    ] : [
      '  1. Tüm parçaları numaralarına göre dizin, gravürlü yüz DIŞA baksın.',
      '  2. En büyük 3-4 parçadan gövdeyi kurun; önce sadece punta atın.',
      '  3. Kalan parçaları numara eşleşmesine göre ekleyin.',
      '  4. Tamamı puntalanıp geometri oturduktan sonra dikişleri doldurun.',
      '  5. Çarpılmayı azaltmak için karşılıklı bölgelerde sırayla kaynatın.',
      '  6. Taşları taşlayıp yüzeyi düzleyin, ardından astar + boya.',
    ]),
    '',
    'KAYNAK NOTLARI',
    `  Dışbükey (dıştan V açılan) dikiş: ${convex} adet — V boşluğu kaynak metalini tutar.`,
    `  İçbükey dikiş: ${concave} adet — içeriden erişim zorsa dıştan köşe kaynağı yapın.`,
    p.thicknessComp
      ? `  Kalınlık telafisi UYGULANDI: parçalar orta yüzey ölçüsünde. Model dış`
        + `
     yüzeyi temsil ediyorsa bu doğrudur.`
      : `  Kalınlık telafisi UYGULANMADI: parçalar model yüzeyi ölçüsünde.`
        + `
     Dış yüzey modellediyseniz köşelerde ${p.thickness} mm'ye varan taşma olur.`,
  ];

  if (sharp.length) {
    lines.push(
      `  DİKKAT: ${sharp.length} dikişin açısı 60°'nin altında (en dar ${round(Math.min(...sharp.map((s) => s.angle)))}°).`,
      '     Bu kadar dar köşelerde iç tarafa erişemezsiniz — dıştan doldurun.'
    );
  }

  if (info.unfold && folds.length) {
    const byPatch = new Map();
    for (const f of folds) {
      if (!byPatch.has(f.patch)) byPatch.set(f.patch, []);
      byPatch.get(f.patch).push(f);
    }
    lines.push('', 'BÜKÜM LİSTESİ', '  Yaprak  Büküm sayısı   Açılar');
    for (const [patch, list] of byPatch) {
      const angles = list.map((f) => round(f.angle) + '°').join(', ');
      lines.push(`  ${patch.padEnd(8)}${String(list.length).padEnd(15)}${angles}`);
    }
  }

  lines.push('', 'KAYNAK DİKİŞİ LİSTESİ', '  No    Parçalar      Uzunluk   Açı      Tip');
  for (const s of seams) {
    const type = s.angle < 179 ? 'dışbükey' : s.angle > 181 ? 'içbükey' : 'düz';
    lines.push(
      `  ${String(s.id).padEnd(5)} ` +
      `${s.aId || '?'}–${s.bId || '?'}`.padEnd(13) +
      ` ${(round(s.length) + ' mm').padEnd(9)} ${(round(s.angle) + '°').padEnd(8)} ${type}`
    );
  }
  return lines.join('\n');
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
