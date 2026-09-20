// LAMEL MODU ("parametrik dalga panel")
//
// Panel, dik (veya yatay) duran N adet lamelden oluşur. Her lamel malzeme
// kalınlığı kadar incedir ve ön kenarı yükseklik haritasından türeyen bir
// eğri boyunca kesilir. Lameller aralarında boşluk bırakılarak dizilince
// duvarda üç boyutlu, asimetrik bir kabartma görüntüsü oluşur.
//
// Lamel yerel koordinatları:  X = lamel boyu (0..L),  Y = derinlik (0..D)
// Y=0 arka (duvar) kenarı, Y=derinlik(x) ön kenar.

import { sampleBandColumn, sampleBandRow, bandSamples } from '../heightmap.js';
import { simplify, offsetRing, ensureOrientation } from '../geom.js';
import { applyCornerRelief, countTightCorners } from '../corners.js';

export const RIB_DEFAULTS = {
  panelW: 900,
  panelH: 600,
  thickness: 18,
  gap: 6,
  maxDepth: 60,
  baseDepth: 40,
  orientation: 'vertical', // 'vertical' | 'horizontal'
  profileSamples: 0,      // 0 = otomatik (profileStep'ten hesaplanır)
  profileStep: 1.5,       // mm — profil üzerinde iki örnek arası mesafe
  simplifyTol: 0.12,
  offset: 0,               // + parçayı büyütür (kerf telafisi elle yapılacaksa)
  railCount: 2,
  railHeight: 60,
  railInset: 0.18,         // lamel boyunun yüzdesi olarak uç kızaklarının konumu
  fit: 0.2,                // geçme boşluğu (mm) — kontrplakta 0.1–0.3 arası iyi sonuç verir
  toolDiameter: 6,         // freze ucu çapı — kemik payının ölçüsü buradan gelir
  dogbone: true,           // kanal diplerine kemik payı aç
  filletRadius: 0,         // dış köşe yuvarlatma (0 = keskin bırak)
  labelSize: 6,
};

/**
 * @param {{w:number,h:number,data:Float32Array}} grid 0..1 yükseklik haritası
 * @param {object} userParams
 * @returns {{parts:Array, info:object, warnings:string[]}}
 */
export function generateRibs(grid, userParams = {}) {
  const p = { ...RIB_DEFAULTS, ...userParams };
  const warnings = [];
  const horizontal = p.orientation === 'horizontal';

  // Lameller hangi eksen boyunca diziliyor?
  const spanAcross = horizontal ? p.panelH : p.panelW; // dizilme yönü
  const ribLength = horizontal ? p.panelW : p.panelH;  // her lamelin boyu

  const pitch = p.thickness + p.gap;
  let count = Math.floor((spanAcross + p.gap) / pitch);
  if (count < 2) {
    count = 2;
    warnings.push('Panel ölçüsü verilen kalınlık ve boşluk için çok küçük; en az 2 lamel kullanıldı.');
  }
  const actualAcross = count * p.thickness + (count - 1) * p.gap;

  const railSlotDepth = p.railCount > 0 ? p.railHeight / 2 : 0;
  if (p.railCount > 0 && p.baseDepth < railSlotDepth + 8) {
    warnings.push(
      `Taban derinliği (${p.baseDepth} mm) kızak kanalı için yetersiz. ` +
      `En az ${Math.ceil(railSlotDepth + 8)} mm önerilir.`
    );
  }

  // Profil örnek sayısı lamel boyuna göre belirlenir. Sabit 220 örnek,
  // 2,6 m'lik bir lamelde 12 mm'lik adım demekti — eğri köşeli çıkıyordu.
  const samples = p.profileSamples > 0
    ? Math.round(p.profileSamples)
    : Math.max(150, Math.min(2000, Math.round(ribLength / Math.max(0.3, p.profileStep))));

  const railPositions = computeRailPositions(p.railCount, p.railInset, ribLength);

  // Kemik payı: freze ucu kanal dibinde kendi yarıçapı kadar et bırakır,
  // geçme oturmaz. Köşelere ucun yarıçapı kadar boşluk açılır.
  const toolRadius = Math.max(0, (p.toolDiameter || 0) / 2);
  const filletRadius = Math.max(0, p.filletRadius || 0);
  // Pay YALNIZCA geçme köşelerine açılır. Lamelin ön kenarındaki dalga da
  // iç köşe içerir; oraya pay açmak görünen yüzü delik deşik ederdi. Kanal
  // dipleri bilinen bir y değerinde durduğu için bant testi yeterli; ofset
  // uygulanmışsa bant o kadar genişletilir.
  const bant = 0.3 + Math.abs(p.offset || 0);
  const kanalDibi = (y) => (V) => Math.abs(V[1] - y) <= bant;

  let reliefApplied = 0;
  let reliefSkipped = 0;
  let reliefT = 0;
  let tightUntreated = 0;

  function finishRing(ring, only) {
    if (!p.dogbone && !filletRadius) {
      tightUntreated += countTightCorners(ring, toolRadius, { only });
      return ring;
    }
    const r = applyCornerRelief(ring, {
      toolRadius, filletRadius, dogboneOn: !!p.dogbone, only,
    });
    reliefApplied += r.applied;
    reliefSkipped += r.skipped;
    reliefT += r.tbones;
    return r.ring;
  }

  const parts = [];
  for (let i = 0; i < count; i++) {
    const a0 = i * pitch;
    const u0 = a0 / actualAcross;
    const u1 = (a0 + p.thickness) / actualAcross;

    // Lamel, kendi şeridinin ORTALAMASINI okur. Örnek sayısı şeridin
    // ızgarada kaç hücre tuttuğuna göre belirlenir; sabit bırakılsaydı
    // çözünürlük yükseldiğinde şerit temsil edilmez, komşu lameller
    // gürültüden bağımsız zıplardı.
    const bandN = bandSamples(grid, u0, u1, horizontal);
    const profile = [];
    for (let s = 0; s < samples; s++) {
      const t = s / (samples - 1);
      const pos = t * ribLength;
      // Görsel koordinatı: v=0 üst satır. Dikey lamelde lamel boyu panel
      // yüksekliğidir ve x=0 panelin altıdır, bu yüzden v ters çevrilir.
      const hVal = horizontal
        // Yatay lamelde şerit v ekseninde uzanır (v ters çevrilir).
        ? sampleBandRow(grid, t, 1 - u0, 1 - u1, bandN)
        : sampleBandColumn(grid, u0, u1, 1 - t, bandN);
      profile.push([pos, p.baseDepth + hVal * p.maxDepth]);
    }

    const backEdge = buildNotchedEdge(ribLength, railPositions, p.thickness + p.fit, railSlotDepth);
    let ring = backEdge.concat(profile.slice().reverse());
    ring = simplify(ring, p.simplifyTol, true);
    if (p.offset !== 0) ring = offsetRing(ensureOrientation(ring, true), p.offset);
    ring = ensureOrientation(ring, true);
    // Kemik payı en sonda: ofset (köşe birleştirmeli) bir yayın üzerinden
    // geçerse yayı bozar.
    ring = finishRing(ring, kanalDibi(railSlotDepth));

    const maxD = profile.reduce((m, q) => Math.max(m, q[1]), 0);
    parts.push({
      id: `L${String(i + 1).padStart(2, '0')}`,
      kind: 'lamel',
      outline: ring,
      holes: [],
      engrave: [{ type: 'text', text: `L${i + 1}`, x: ribLength / 2, y: railSlotDepth + 6, size: p.labelSize }],
      w: ribLength,
      h: maxD,
      meta: { index: i, across: a0, thickness: p.thickness, maxDepth: maxD, profile },
    });
  }

  // Kızaklar (arka taşıyıcı çıtalar) — lamellerle yarım geçme yapar.
  for (let r = 0; r < p.railCount; r++) {
    const slotCenters = [];
    for (let i = 0; i < count; i++) slotCenters.push(i * pitch + p.thickness / 2);
    const edge = buildNotchedEdge(actualAcross, slotCenters, p.thickness + p.fit, railSlotDepth);
    // Kızak profili: alt kenar düz, üst kenarda lamel kanalları.
    // Üst kenar soldan sağa yürür, sonra sağ ve alt kenarlarla halka kapanır.
    const topEdge = edge.map(([x, y]) => [x, p.railHeight - y]);
    const ring = finishRing(
      ensureOrientation(topEdge.concat([[actualAcross, 0], [0, 0]]), true),
      kanalDibi(p.railHeight - railSlotDepth)
    );
    parts.push({
      id: `K${r + 1}`,
      kind: 'kizak',
      outline: ring,
      holes: [],
      engrave: [{ type: 'text', text: `KIZAK ${r + 1}`, x: actualAcross / 2, y: p.railHeight / 4, size: p.labelSize }],
      w: actualAcross,
      h: p.railHeight,
      meta: { index: r, position: railPositions[r] },
    });
  }

  if (reliefSkipped > 0) {
    warnings.push(
      `${reliefSkipped} kanal köşesine kemik payı sığmadı: kanal, ${p.toolDiameter} mm'lik ` +
      'uca göre dar. Daha ince uç seçin veya kızak yüksekliğini artırın — bu köşelerde ' +
      'geçme tam oturmayabilir.'
    );
  }
  if (tightUntreated > 0) {
    warnings.push(
      `Kemik payı kapalı: ${tightUntreated} iç köşe var ve ${p.toolDiameter} mm'lik uç ` +
      `bunların dibine ${(toolRadius).toFixed(1)} mm et bırakır. Parçalar tam oturmaz; ` +
      'kemik payını açın ya da köşeleri tezgâhta elle temizleyin.'
    );
  }

  return {
    parts,
    info: {
      mode: 'ribs',
      count,
      pitch,
      dogboneApplied: reliefApplied,
      tboneApplied: reliefT,
      dogboneSkipped: reliefSkipped,
      tightCorners: tightUntreated,
      actualAcross,
      ribLength,
      panelW: horizontal ? p.panelW : actualAcross,
      panelH: horizontal ? actualAcross : p.panelH,
      totalDepth: p.baseDepth + p.maxDepth,
      profileSamples: samples,
      railPositions,
      params: p,
    },
    warnings,
  };
}

function computeRailPositions(n, inset, length) {
  if (n <= 0) return [];
  if (n === 1) return [length / 2];
  const a = inset * length;
  const b = length - a;
  const out = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

/**
 * y=0 düz kenarı üzerinde, verilen merkezlerde dikdörtgen kanallar açar.
 * Soldan sağa yürüyen bir nokta listesi döner.
 *
 * Kenara dayanan kanallar özel durum: kızağın ilk ve son kanalı her zaman
 * uca taşar (merkez kalınlık/2'de, genişlik kalınlık+pay). Kanalı olduğu gibi
 * çizersek halka uç çizgisini bir yukarı bir aşağı iki kez geçer; arada
 * sıfır genişlikte bir çıkıntı kalır. Tezgâh oraya boşuna dalar, kemik payı
 * da o köşeyi yanlış yorumlar. Böyle kanallarda kenar doğrudan kanal
 * dibinden başlatılır (ya da orada bitirilir).
 */
function buildNotchedEdge(length, centers, slotWidth, slotDepth) {
  const araliklar = [];
  if (slotDepth > 0 && slotWidth > 0) {
    for (const c of centers.slice().sort((a, b) => a - b)) {
      const a = Math.max(0, c - slotWidth / 2);
      const b = Math.min(length, c + slotWidth / 2);
      if (b - a < 1e-6) continue;
      const son = araliklar[araliklar.length - 1];
      // Kanallar çakışıyorsa (pay büyük, boşluk küçük) tek kanal say.
      if (son && a <= son[1] + 1e-6) son[1] = Math.max(son[1], b);
      else araliklar.push([a, b]);
    }
  }

  const pts = [];
  const ekle = (x, y) => {
    const son = pts[pts.length - 1];
    if (son && Math.abs(son[0] - x) < 1e-9 && Math.abs(son[1] - y) < 1e-9) return;
    pts.push([x, y]);
  };

  const soldaAcik = araliklar.length > 0 && araliklar[0][0] <= 1e-6;
  ekle(0, soldaAcik ? slotDepth : 0);

  for (const [a, b] of araliklar) {
    if (a > 1e-6) { ekle(a, 0); ekle(a, slotDepth); }
    ekle(b, slotDepth);
    if (b < length - 1e-6) ekle(b, 0);
  }

  const sagdaAcik = araliklar.length > 0 && araliklar[araliklar.length - 1][1] >= length - 1e-6;
  ekle(length, sagdaAcik ? slotDepth : 0);
  return pts;
}
