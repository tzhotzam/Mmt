// LAMEL MODU ("parametrik dalga panel")
//
// Panel, dik (veya yatay) duran N adet lamelden oluşur. Her lamel malzeme
// kalınlığı kadar incedir ve ön kenarı yükseklik haritasından türeyen bir
// eğri boyunca kesilir. Lameller aralarında boşluk bırakılarak dizilince
// duvarda üç boyutlu, asimetrik bir kabartma görüntüsü oluşur.
//
// Lamel yerel koordinatları:  X = lamel boyu (0..L),  Y = derinlik (0..D)
// Y=0 arka (duvar) kenarı, Y=derinlik(x) ön kenar.

import { sampleBandColumn } from '../heightmap.js';
import { simplify, offsetRing, ensureOrientation } from '../geom.js';

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

  const parts = [];
  for (let i = 0; i < count; i++) {
    const a0 = i * pitch;
    const u0 = a0 / actualAcross;
    const u1 = (a0 + p.thickness) / actualAcross;

    const profile = [];
    for (let s = 0; s < samples; s++) {
      const t = s / (samples - 1);
      const pos = t * ribLength;
      // Görsel koordinatı: v=0 üst satır. Dikey lamelde lamel boyu panel
      // yüksekliğidir ve x=0 panelin altıdır, bu yüzden v ters çevrilir.
      const [u, v] = horizontal ? [t, 1 - u0 - (u1 - u0) / 2] : [u0 + (u1 - u0) / 2, 1 - t];
      const hVal = horizontal
        ? sampleBandColumn(grid, u, u, v, 1)
        : sampleBandColumn(grid, u0, u1, v, 3);
      profile.push([pos, p.baseDepth + hVal * p.maxDepth]);
    }

    const backEdge = buildNotchedEdge(ribLength, railPositions, p.thickness + p.fit, railSlotDepth);
    let ring = backEdge.concat(profile.slice().reverse());
    ring = simplify(ring, p.simplifyTol, true);
    if (p.offset !== 0) ring = offsetRing(ensureOrientation(ring, true), p.offset);
    ring = ensureOrientation(ring, true);

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
    const ring = ensureOrientation(topEdge.concat([[actualAcross, 0], [0, 0]]), true);
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

  return {
    parts,
    info: {
      mode: 'ribs',
      count,
      pitch,
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
 */
function buildNotchedEdge(length, centers, slotWidth, slotDepth) {
  const pts = [[0, 0]];
  if (slotDepth > 0 && slotWidth > 0) {
    const sorted = centers.slice().sort((a, b) => a - b);
    for (const c of sorted) {
      const a = Math.max(0, c - slotWidth / 2);
      const b = Math.min(length, c + slotWidth / 2);
      if (b - a < 1e-6) continue;
      pts.push([a, 0], [a, slotDepth], [b, slotDepth], [b, 0]);
    }
  }
  pts.push([length, 0]);
  return pts;
}
