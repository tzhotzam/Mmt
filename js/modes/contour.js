// KATMAN MODU ("topografik kabartma")
//
// Yükseklik haritası eşit aralıklı eş-yükselti eğrilerine bölünür. Her eğri
// seviyesi, malzeme kalınlığı kadar kalın tek bir katman olarak kesilir.
// Katmanlar üst üste yapıştırılınca kademeli, asimetrik bir rölyef oluşur.
//
// Parça koordinatları panel koordinatlarındadır (sol-alt köşe 0,0; Y yukarı).

import { contourRings } from '../marchingsquares.js';
import { classifyRings, simplify, offsetRing, bbox, pointInRing, ensureOrientation } from '../geom.js';

export const CONTOUR_DEFAULTS = {
  panelW: 600,
  panelH: 600,
  thickness: 12,
  layerCount: 8,
  withBase: true,
  minArea: 400,      // mm² — bundan küçük adacıklar atılır
  simplifyTol: 0.25, // mm
  offset: 0,
  toolDiameter: 6,
  guideEngrave: true,
  labelSize: 8,
};

export function generateContours(grid, userParams = {}) {
  const p = { ...CONTOUR_DEFAULTS, ...userParams };
  const warnings = [];
  const N = Math.max(1, Math.round(p.layerCount));

  const toPanel = ([gx, gy]) => [
    clamp((gx / (grid.w - 1)) * p.panelW, 0, p.panelW),
    clamp(p.panelH - (gy / (grid.h - 1)) * p.panelH, 0, p.panelH),
  ];

  // Seviyeler (0,1) aralığında eşit dağıtılır; 1.0 kullanılmaz çünkü
  // tam tepe noktası ölçülebilir bir alan üretmez.
  const levels = [];
  for (let k = 1; k <= N; k++) levels.push(k / (N + 1));

  const layers = [];
  for (let k = 0; k < N; k++) {
    const rings = contourRings(grid, levels[k])
      .map((r) => r.map(toPanel))
      .map((r) => simplify(r, p.simplifyTol, true))
      .filter((r) => r.length >= 3);

    const classified = classifyRings(rings);
    const outers = classified.filter((c) => !c.hole && c.area >= p.minArea);
    const holes = classified.filter((c) => c.hole && c.area >= p.minArea);
    const dropped = classified.length - outers.length - holes.length;
    if (dropped > 0) {
      warnings.push(`Katman ${k + 1}: ${dropped} adet çok küçük ada elendi (min alan ${p.minArea} mm²).`);
    }
    layers.push({ level: levels[k], outers, holes });
  }

  const parts = [];

  if (p.withBase) {
    const r = [[0, 0], [p.panelW, 0], [p.panelW, p.panelH], [0, p.panelH]];
    parts.push(makePart('T0', 'taban', r, [], p, {
      layer: 0, z: 0, level: 0,
      guides: p.guideEngrave ? layers[0].outers.map((o) => o.ring) : [],
    }));
  }

  const baseOffset = p.withBase ? 1 : 0;
  layers.forEach((layer, k) => {
    layer.outers.forEach((outer, j) => {
      const myHoles = layer.holes
        .filter((hl) => hl.area < outer.area && pointInRing(hl.ring[0], outer.ring))
        .map((hl) => hl.ring);

      const next = layers[k + 1];
      const guides = p.guideEngrave && next
        ? next.outers.filter((o) => pointInRing(o.ring[0], outer.ring)).map((o) => o.ring)
        : [];

      parts.push(makePart(
        `K${k + 1}-${j + 1}`, 'katman', outer.ring, myHoles, p,
        { layer: k + 1, z: (k + baseOffset) * p.thickness, level: layer.level, guides }
      ));
    });
  });

  const totalLayers = N + (p.withBase ? 1 : 0);
  const thinCount = parts.filter((q) => Math.min(q.w, q.h) < p.toolDiameter * 1.5).length;
  if (p.toolDiameter > 0 && thinCount > 0) {
    warnings.push(
      `${thinCount} parça takım çapına (${p.toolDiameter} mm) göre çok ince. ` +
      'Katman sayısını azaltın veya görseli biraz daha yumuşatın.'
    );
  }

  return {
    parts,
    info: {
      mode: 'contour',
      layerCount: N,
      totalLayers,
      totalDepth: totalLayers * p.thickness,
      panelW: p.panelW,
      panelH: p.panelH,
      levels,
      params: p,
    },
    warnings,
  };
}

function makePart(id, kind, outerRing, holeRings, p, meta) {
  let outline = ensureOrientation(outerRing, true);
  let holes = holeRings.map((h) => ensureOrientation(h, false));
  if (p.offset !== 0) {
    outline = ensureOrientation(offsetRing(outline, p.offset), true);
    holes = holes.map((h) => ensureOrientation(offsetRing(ensureOrientation(h, true), -p.offset), false));
  }
  const b = bbox(outline);
  const engrave = [];
  for (const g of meta.guides || []) {
    engrave.push({ type: 'polyline', points: g, closed: true });
  }
  engrave.push({
    type: 'text',
    text: id,
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    size: p.labelSize,
  });
  return {
    id, kind, outline, holes, engrave,
    w: b.w, h: b.h,
    meta: { ...meta, guides: undefined, bbox: b },
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
