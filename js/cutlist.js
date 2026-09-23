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
  if (info.mode === 'slices') return sliceGuide(info);
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

/**
 * Büyük heykel için iç iskelet önerisi. Kabuk 1,5 mm sacdır; kendi ağırlığını
 * taşır ama rüzgârı, çocukların tırmanmasını, taşımayı taşımaz.
 */
function iskeletNotu(m, info, percin) {
  const boy = Math.max(m.x, m.y, m.z);
  const kg = (info.totalArea / 1e6) * info.params.thickness * 7.85;
  return [
    '',
    'İÇ İSKELET',
    `  Heykel ${round(boy)} mm; kabuk yaklaşık ${round(kg)} kg (çelik). Kabuk taşıyıcı değildir.`,
    '  Öneri: zemine dübelle sabitlenen 10 mm çelik taban levhası; ayaklardan',
    '  gövdeye çıkan Ø42-48 boru ya da 40×40 kutu profil omurga, gövde içinde',
    '  birkaç yatay kuşak. Kabuk kuşaklara, içeriden kaynatılmış küçük',
    percin
      ? '  bağlantı kulaklarıyla perçinlenir ya da cıvatalanır.'
      : '  bağlantı kulaklarıyla puntalanır.',
    '  Ayak içleri dardır: boruyu kabuktan ÖNCE yerleştirin, ayak yapraklarını',
    '  borunun etrafına kapatın.',
  ];
}

function weldGuide(info, seams, folds = []) {
  const p = info.params;
  const m = info.modelSize;
  const percin = info.joinMethod === 'percin';
  // Perçinli birleşimde kaynak notları yalnızca kaynakta kalan dikişler için.
  const kaynaklar = percin ? seams.filter((s) => s.join !== 'percin') : seams;
  const convex = kaynaklar.filter((s) => s.angle < 179).length;
  const concave = kaynaklar.filter((s) => s.angle > 181).length;
  const sharp = kaynaklar.filter((s) => s.angle < 60);

  const lines = [
    `Heykel ölçüsü: ${round(m.x)} × ${round(m.y)} × ${round(m.z)} mm`,
    // Perçinde dikişlerin çoğu kaynak DEĞİL; "369 kaynak dikişi" yazmak
    // (241'i perçinliyken) yanıltıyordu.
    (info.unfold
      ? `${info.facetCount} faset → ${info.partCount} yaprak, ${info.foldCount} büküm, `
      : `${info.facetCount} faset, `)
      + (percin
        ? `${info.seamCount} dikiş (${info.tabCount} perçinli, ${info.weldSeamCount} kaynak), `
        : `${info.seamCount} kaynak dikişi, `)
      + `${p.thickness} mm sac.`,
    `Toplam yüzey alanı: ${round(info.totalArea / 1e6, 2)} m².`,
    ...(percin ? [
      `Birleşim: perçinli kulakçık — ${info.tabCount} kulakçık, ${info.rivetCount} adet ` +
        `Ø${p.rivetDiameter} kör perçin (%10 yedekle ${Math.ceil(info.rivetCount * 1.1)}), ` +
        `${info.weldSeamCount} dikiş kaynakla.`,
      '',
      'PERÇİNLİ BİRLEŞİM',
      '  Her perçinli dikişin BİR tarafında kulakçık vardır; kulakçık dikiş',
      '  kenarındaki kertikli çizgiden bükülür ve eş parçanın ALTINA girer.',
      '  Kulakçık tarafındaki etiket "12·143°" biçimindedir: 12 dikiş numarası,',
      '  143° kulakçığı büktükten sonra iki yüzey arasında kalacak iç açı.',
      '  Eş parçada yuvarlak delik, kulakçıkta oval yuva vardır; üst üste getirip',
      `  Ø${p.rivetDiameter} kör (pop) perçin atın. Oval yuva sac kalınlığından doğan`,
      '  kaymayı karşılar; perçinin pulu yuvayı içeriden örter.',
      '  Perçin başı dışta kalır ve yüzeyde düzenli bir desen olur.',
      ...(info.reliefHoleCount ? [
        `  Yaprakların içindeki ${info.reliefHoleCount} küçük delik köşe deliğidir: büküm`,
        '  hatlarının buluştuğu noktada sacın yırtılmasını önler, perçin için değildir.',
      ] : []),
    ] : []),
    '',
    'NASIL BİRLEŞİR',
    info.unfold
      ? '  Her yaprağın üstünde kendi numarası (Y01, Y02, ...) yazar.'
      : '  Her parçanın üstünde kendi numarası (P01, P02, ...) yazar.',
    percin
      ? '  Dış kenarlardaki küçük numaralar DİKİŞ numaralarıdır.'
      : '  Dış kenarlardaki küçük numaralar KAYNAK DİKİŞİ numaralarıdır.',
    percin
      ? '  Aynı numaralı iki kenarı karşı karşıya getirin: kulakçık eşin altına girer.'
      : '  Aynı numaralı iki kenarı karşı karşıya getirip puntalayın.',
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
      percin
        ? '  (profil/boru iskelet) kurup kabuğu ona perçin ya da cıvatayla bağlayın.'
        : '  (profil/boru iskelet) kurup kabuğu ona puntalayın.',
    ] : []),
    ...(Math.max(m.x, m.y, m.z) >= 1500 ? iskeletNotu(m, info, percin) : []),
    '',
    'MONTAJ SIRASI',
    ...(info.unfold && percin ? [
      '  1. Yaprakları kesin; kertikleri, delikleri ve yuvaları KESMEYİ unutmayın (KESIM katmanı).',
      '  2. Çapakları alın. İsterseniz astarı ŞİMDİ, düz hâldeyken atın — içi de korunur.',
      '  3. Her yaprağı kertik çizgisinin tam ortasından, yazan dereceye bükün.',
      '     Çelik birkaç derece geri yaylanır; biraz fazla büküp bırakın.',
      '  4. Kulakçıkları etiketteki açıya (ör. "12·143°" → 143°) bükün.',
      '  5. İç iskeleti kurun (bkz. İÇ İSKELET). Alttan yukarı çalışın: önce',
      '     ayaklar ve gövdenin alt yarısı, en son baş.',
      '  6. Eş numaralı kenarları getirin, önce her dikişe BİR perçin atın',
      '     (geçici, iskelet üstünde şekil otursun), sonra kalanları.',
      '  7. "kaynak" işaretli dikişleri (montaj listesinin sonunda) puntalayın.',
      '  8. Son kat boya: parlak tek renk faset kenarlarını ve perçin desenini öne çıkarır.',
    ] : info.unfold ? [
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
    percin ? 'KAYNAKTA KALAN DİKİŞLER İÇİN NOTLAR' : 'KAYNAK NOTLARI',
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

  lines.push('', percin ? 'DİKİŞ LİSTESİ' : 'KAYNAK DİKİŞİ LİSTESİ',
    '  No    Parçalar      Uzunluk   Açı      Tip' + (percin ? '        Birleşim' : ''));
  for (const s of seams) {
    const type = s.angle < 179 ? 'dışbükey' : s.angle > 181 ? 'içbükey' : 'düz';
    const birlesim = !percin ? ''
      : s.join === 'percin' ? `  perçin ×${s.rivets} (kulakçık ${s.tabOn})` : '  kaynak';
    lines.push(
      `  ${String(s.id).padEnd(5)} ` +
      `${s.aId || '?'}–${s.bId || '?'}`.padEnd(13) +
      ` ${(round(s.length) + ' mm').padEnd(9)} ${(round(s.angle) + '°').padEnd(8)} ${type.padEnd(10)}${birlesim}`
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

/**
 * Dilimli heykel montaj kılavuzu.
 *
 * Kritik iki bilgi: milin ne kadar uzun olması gerektiği ve hangi parçaların
 * milden geçmediği. İkincisi söylenmezse usta parçayı eline alıp nereye
 * oturacağını bulamaz.
 */
/**
 * Mil parça listesi. Mil heykelin dışına çıktığı dilimlerde görünür olurdu;
 * bu yüzden içeride kaldığı her ardışık dilim dizisi ayrı bir mil parçasıdır.
 */
function milParcalari(info, milBoyu) {
  const p = info.params;
  const segs = info.rodSegments || [];
  if (!segs.length || !segs.some((g) => g.length)) {
    return [`  En az ${milBoyu} mm boyunda olmalı (yığın + 80 mm bağlantı payı).`];
  }
  // Aralıklı dizilişte uçlara somun/rondela payı; sıkı istifte mil gömülür.
  const pay = p.gap > 0 ? 20 : 0;
  const out = [];
  let toplam = 0, adet = 0;
  segs.forEach((g, k) => {
    const parca = g.map((x) => `D${String(x.from + 1).padStart(3, '0')}–D${String(x.to + 1).padStart(3, '0')}: ` +
      `${Math.ceil((x.length + pay) / 5) * 5} mm`);
    g.forEach((x) => { toplam += x.length + pay; adet++; });
    out.push(`  Mil ${k + 1}: ${parca.join(' · ')}`);
  });
  out.push(`  Toplam ${adet} mil parçası, ${Math.ceil(toplam / 10) * 10} mm çubuk` +
    (pay ? ' (her parçaya iki uçta 10\'ar mm somun/rondela payı dahil).' : '.'));
  if (p.gap > 0) {
    out.push(`  Aralıklı dizilişte dişli çubuk (M${Math.round(p.rodDiameter)}) + her iki dilim arasına`);
    out.push(`  ${p.gap} mm boyunda ara boru önerilir; uçlarda somunla sıkıştırılır.`);
  }
  return out;
}

function sliceGuide(info) {
  const p = info.params;
  const kare = p.rodShape === 'kare';
  const yigin = info.layerCount * p.thickness + (info.layerCount - 1) * p.gap;
  // Mil, yığını geçip altta bağlantı payı bırakmalı.
  const milBoyu = Math.ceil((yigin + 80) / 10) * 10;

  const satirlar = [
    `Heykel: ${round(info.modelSize.x)} × ${round(info.modelSize.y)} × ${round(info.modelSize.z)} mm.`,
    `${info.layerCount} dilim, ${p.thickness} mm malzemeden` +
      (p.gap > 0 ? `, aralarında ${p.gap} mm boşluk.` : ', sıkı istif (boşluksuz).'),
    `Dilim ekseni: ${String(p.axis).toUpperCase()} — dilimler bu eksen boyunca dizilir.`,
    `Yığın yüksekliği ${round(yigin)} mm.`,
    '',
    kare
      ? `KAZIK: ${info.rodPoints.length} adet, ${p.rodDiameter}×${p.rodDiameter} mm kare kesit.`
      : `MİL: ${info.rodPoints.length} adet, Ø${p.rodDiameter} mm.`,
    ...milParcalari(info, milBoyu),
    kare
      ? '  Yuvanın köşelerinde kemik payı var: dönen uç keskin iç köşe kesemez,'
      : '  Delikler mil çapında açılır; sıkı geçme isteniyorsa 0,2 mm küçültün.',
    ...(kare ? [
      '  o pay olmasa kazık yuvaya birkaç mm eksik otururdu. Kazığın köşelerini',
      '  yuvarlatmayın — yuva zaten paylı.',
      '  Kare kesit dönmeyi kendi engeller; ikinci kazığa gerek yoktur.',
    ] : []),
    ...(info.maxRodSize > p.rodDiameter * 1.3 ? [
      `  Bu heykel ${Math.floor(info.maxRodSize / 5) * 5} mm'ye kadar kaldırır —` +
      ' daha kalın omurga istiyorsanız yer var.',
    ] : []),
  ];

  if (!kare && info.rodPoints.length === 1) {
    satirlar.push('  TEK MİL: parçalar mil etrafında dönebilir. Montajda her dilimi');
    satirlar.push('  gözle hizalayın ya da mil sayısını 2 yapıp yeniden üretin.');
  }
  if (p.gap > 0) {
    satirlar.push(`  Dilimler arasına ${p.gap} mm kalınlığında ara pul gerekir` +
      (kare ? ' (kare kazıkta: aynı kesitte kısa takozlar).' : ' (boru/rondela).'));
  }

  if (info.groupedParts > 0) {
    satirlar.push('');
    satirlar.push(`ALT GRUPLAR: ${info.groupedParts} parça ${info.groupCount} grupta (G1, G2 ...).`);
    satirlar.push('  Bu bölgeler gövdeden ayrı durduğu için düz mil gövdeye ulaşmaz.');
    satirlar.push('  Her grubu önce kendi mil parçasında birleştirin, sonra gövdeye');
    satirlar.push('  değdiği yerlerden yapıştırın (epoksi ya da siyanoakrilat).');
  }

  if (info.rodlessParts > 0) {
    satirlar.push('');
    satirlar.push(`DİKKAT: ${info.rodlessParts} parçadan mil geçmiyor.`);
    satirlar.push('  Bunlar kesitin ana gövdeden kopuk adalarıdır (ayrı bacak, uzanan kol).');
    satirlar.push('  Kendi başlarına durmazlar; bir alt ve bir üst komşularına tutkalla');
    satirlar.push('  yapıştırılmalıdır. Numaraları D<dilim><harf> biçimindedir: aynı');
    satirlar.push('  dilimin a, b, c parçaları yan yana gelir.');
  }

  satirlar.push(
    '',
    'Montaj sırası:',
    '  1. Omurgayı düz bir tabana dik sabitleyin (flanş ya da taban levhasına gömme).',
    '  2. D001\'den başlayarak dilimleri sırayla geçirin; gravür numarası hep aynı',
    '     yöne baksın, yoksa yığın burulur.',
    '  3. Her 8-10 dilimde bir gönye ve şakül kontrolü yapın.',
    '  4. Kopuk adaları (yukarıdaki uyarı) komşu dilimlere yapıştırın.',
    '  5. Üstte mili gizlemek için son dilimi tutkalla kapatın.',
    '  6. Zımpara: dilim kenarları istifte hafif basamak yapar; 120 kumla',
    '     kenarları yuvarlatmak bu basamağı yumuşatır.'
  );
  return satirlar.join('\n');
}
