// POLİGONAL KABUK MODU (metal / kaynak)
//
// Kapalı bir 3B modeli düz yüzeylerine ayırır. Her yüzey sacdan ayrı bir
// parça olarak kesilir, parçalar kenarlarından kaynakla birleştirilir.
// Katlama yok — kaynak, katlama tırnaklarının yerini tutar.
//
// Her parçaya kendi numarası, her kaynak dikişine ortak bir numara gravürlenir:
// aynı numaralı iki kenarı karşı karşıya getirip puntalarsınız.

import {
  buildMesh, groupCoplanar, groupBoundary, planeBasis, projectToPlane,
  dihedralAngle, centroidOf, groupArea, scaleTriangles,
} from '../mesh.js';
import { ensureOrientation, signedArea, bbox } from '../geom.js';

export const FACET_DEFAULTS = {
  targetSize: 600,        // modelin en uzun kenarı (mm)
  sizeAxis: 'max',        // 'max' | 'x' | 'y' | 'z'
  thickness: 3,           // sac kalınlığı (mm)
  angleTol: 1,            // eş düzlem toleransı (derece) — büyütmek parça sayısını düşürür
  thicknessComp: true,    // model dış yüzeyse kalınlık telafisi uygula
  minArea: 150,           // mm² — bundan küçük fasetler elenir
  labelSize: 7,
  seamLabelSize: 4.5,
  offset: 0,
};

export function generateFacets(rawTris, userParams = {}) {
  const p = { ...FACET_DEFAULTS, ...userParams };
  const warnings = [];

  const scaled = scaleTriangles(rawTris, p.targetSize, p.sizeAxis);
  const mesh = buildMesh(scaled.tris);
  if (!mesh.faces.length) {
    return { parts: [], seams: [], info: emptyInfo(p, scaled), warnings: ['Modelde geçerli üçgen bulunamadı.'] };
  }

  const groups = groupCoplanar(mesh, p.angleTol);

  // Her grubun sınırını çıkar ve kenarları gruplara eşle.
  const edgeOwners = new Map(); // edgeKey -> [groupIndex...]
  const boundaries = groups.map((g, gi) => {
    const b = groupBoundary(mesh, g);
    for (const [a, c] of b.boundaryEdges) {
      const k = a < c ? `${a}_${c}` : `${c}_${a}`;
      let list = edgeOwners.get(k);
      if (!list) edgeOwners.set(k, (list = []));
      if (!list.includes(gi)) list.push(gi);
    }
    return b;
  });

  const centroids = groups.map((g) => centroidOf(mesh, g));
  const seams = [];
  const seamIdByKey = new Map();
  let openEdges = 0;

  const parts = [];
  groups.forEach((group, gi) => {
    const loop = boundaries[gi].loops[0];
    if (!loop || loop.length < 3) return;

    // Sınırı, karşı tarafındaki fasete göre dikişlere böl.
    const runs = splitIntoRuns(loop, gi, edgeOwners);
    const verts = runs.length >= 3 ? runs.map((r) => r.start) : loop;

    const basis = planeBasis(group.normal);
    const origin = centroids[gi];
    const pts3 = verts.map((vi) => mesh.vertices[vi]);
    const { pts, deviation } = projectToPlane(pts3, basis, origin);
    if (pts.length < 3) return;

    let ring = ensureOrientation(pts, true);
    const flipped = signedArea(pts) < 0;
    const area = Math.abs(signedArea(ring));
    if (area < p.minArea) return;

    // Dikiş bilgilerini topla (halka yönüyle aynı sırada).
    // Halka ters çevrildiyse kenar sırası da tersine döner, ama bir kayar:
    // [s0,s1,s2,s3] → [s2,s1,s0,s3]. Düz ters çevirmek dikişleri kaydırırdı.
    let orderedRuns = [];
    if (runs.length >= 3) {
      if (flipped) {
        const rev = runs.slice().reverse();
        orderedRuns = rev.slice(1).concat(rev[0]);
      } else {
        orderedRuns = runs;
      }
    }
    const seamInfo = orderedRuns.map((run) => {
      const partner = run.partner;
      if (partner === undefined || partner === null) {
        openEdges++;
        return { id: null, angle: 180, partner: null };
      }
      const k = run.key;
      let id = seamIdByKey.get(k);
      if (id === undefined) {
        const angle = dihedralAngle(
          group.normal, groups[partner].normal, centroids[gi], centroids[partner]
        );
        id = seams.length + 1;
        seamIdByKey.set(k, id);
        seams.push({
          id, a: gi, b: partner, angle,
          length: edgeLength(mesh, run),
        });
      }
      const seam = seams[id - 1];
      return { id, angle: seam.angle, partner };
    });

    // Kalınlık telafisi: her dikiş kendi açısına göre içeri çekilir.
    if (p.thicknessComp && seamInfo.length === ring.length && p.thickness > 0) {
      const dists = seamInfo.map((s) => seamInset(s.angle, p.thickness));
      const moved = offsetPerEdge(ring, dists);
      if (moved) ring = moved;
    }
    if (p.offset !== 0) {
      const moved = offsetPerEdge(ring, ring.map(() => -p.offset));
      if (moved) ring = moved;
    }

    const b = bbox(ring);
    const id = `P${String(parts.length + 1).padStart(2, '0')}`;
    const engrave = [{
      type: 'text', text: id,
      x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, size: p.labelSize,
    }];
    // Dikiş numaralarını kenar ortalarına, biraz içeri kaydırarak yaz.
    if (seamInfo.length === ring.length) {
      for (let i = 0; i < ring.length; i++) {
        const s = seamInfo[i];
        if (!s.id) continue;
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2;
        const dx = c[0] - a[0], dy = c[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        if (len < p.seamLabelSize * 2.5) continue; // sığmıyorsa yazma
        const inx = -dy / len, iny = dx / len; // CCW halkada içe bakan normal
        engrave.push({
          type: 'text', text: String(s.id),
          x: mx + inx * p.seamLabelSize * 1.4,
          y: my + iny * p.seamLabelSize * 1.4,
          size: p.seamLabelSize,
        });
      }
    }

    parts.push({
      id, kind: 'faset', outline: ring, holes: [], engrave,
      w: b.w, h: b.h,
      meta: {
        group: gi, area, deviation,
        triangles: group.faces.length,
        seams: seamInfo.map((s) => s.id).filter(Boolean),
        normal: group.normal,
      },
    });
  });

  // Dikişlerdeki grup indekslerini gerçek parça numaralarına çevir.
  const groupToId = new Map(parts.map((q) => [q.meta.group, q.id]));
  let orphanSeams = 0;
  for (const seam of seams) {
    seam.aId = groupToId.get(seam.a) || null;
    seam.bId = groupToId.get(seam.b) || null;
    if (!seam.aId || !seam.bId) orphanSeams++;
  }
  if (orphanSeams) {
    warnings.push(
      `${orphanSeams} dikişin karşı parçası elendi (en küçük faset filtresi). ` +
      'Filtreyi düşürün, yoksa o kenarlar boşta kalır.'
    );
  }

  // --- Uyarılar -----------------------------------------------------------
  const maxDev = parts.reduce((m, q) => Math.max(m, q.meta.deviation), 0);
  if (p.angleTol > 1 && maxDev > p.thickness) {
    warnings.push(
      `Eş düzlem toleransı ${p.angleTol}° yüzünden bazı fasetler tam düz değil ` +
      `(en büyük sapma ${maxDev.toFixed(1)} mm). Sac bu kadar bükülmek zorunda kalır — ` +
      'toleransı düşürün veya kalınlığı azaltın.'
    );
  }
  if (openEdges > 0) {
    warnings.push(
      `${openEdges} kenarın karşı tarafı yok — model kapalı bir hacim değil. ` +
      'Bu kenarlar serbest kalır, kaynak eşi bulunmaz.'
    );
  }
  if (parts.length > 150) {
    warnings.push(
      `${parts.length} parça çok fazla — her biri elle puntalanacak. ` +
      'Eş düzlem toleransını artırın veya modeli Blender\'da Decimate ile sadeleştirin.'
    );
  }
  if (parts.length && parts.length < 4) {
    warnings.push(
      `Yalnızca ${parts.length} faset çıktı — kapalı bir hacim için çok az. ` +
      'Yüzey birleştirme açısı fazla yüksek olabilir.'
    );
  }

  return {
    parts,
    seams,
    info: {
      mode: 'facets',
      facetCount: parts.length,
      seamCount: seams.length,
      openEdges,
      triangleCount: mesh.faces.length,
      maxDeviation: maxDev,
      modelSize: scaled.size,
      panelW: scaled.size.x,
      panelH: scaled.size.z || scaled.size.y,
      totalDepth: scaled.size.y,
      totalArea: groups.reduce((s, g) => s + groupArea(mesh, g), 0),
      triangles: scaled.tris,
      params: p,
    },
    warnings,
  };
}

function emptyInfo(p, scaled) {
  return {
    mode: 'facets', facetCount: 0, seamCount: 0, openEdges: 0, triangleCount: 0,
    maxDeviation: 0, modelSize: scaled.size, panelW: scaled.size.x || 1,
    panelH: scaled.size.z || 1, totalDepth: scaled.size.y || 0, totalArea: 0,
    triangles: scaled.tris, params: p,
  };
}

/**
 * Sınır halkasını, karşısındaki fasete göre kesintisiz parçalara böler.
 * Aynı komşuya bakan ardışık kenarlar tek dikiş sayılır; böylece üçgenlemeden
 * gelen ara köşeler temizlenir ama gerçek köşeler korunur.
 */
function splitIntoRuns(loop, gi, edgeOwners) {
  const n = loop.length;
  const partnerOf = (i) => {
    const a = loop[i], b = loop[(i + 1) % n];
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const owners = edgeOwners.get(k) || [];
    const other = owners.find((o) => o !== gi);
    return { partner: other === undefined ? null : other, key: k, a, b };
  };

  const edges = [];
  for (let i = 0; i < n; i++) edges.push(partnerOf(i));

  // Komşu değişiminin olduğu bir yerden başla ki ilk koşu ortadan bölünmesin.
  let startIdx = 0;
  for (let i = 0; i < n; i++) {
    if (edges[i].partner !== edges[(i - 1 + n) % n].partner) { startIdx = i; break; }
  }

  const runs = [];
  let cur = null;
  for (let s = 0; s < n; s++) {
    const i = (startIdx + s) % n;
    const e = edges[i];
    if (cur && cur.partner === e.partner && e.partner !== null) {
      cur.end = e.b;
      cur.edges.push(e);
    } else {
      cur = { partner: e.partner, key: e.key, start: e.a, end: e.b, edges: [e] };
      runs.push(cur);
    }
  }
  return runs;
}

function edgeLength(mesh, run) {
  let s = 0;
  for (const e of run.edges) {
    const a = mesh.vertices[e.a], b = mesh.vertices[e.b];
    s += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return s;
}

/**
 * Sac kalınlığı telafisi.
 *
 * İki plaka θ iç açısıyla birleşirken, dış yüzey ölçüsüyle kesilirse içeride
 * çakışırlar. Orta yüzeye inmek için her kenar (t/2)·cot(θ/2) kadar içeri
 * çekilir. θ=90° → t/2, θ=180° → 0, θ>180° (içbükey) → negatif, yani uzatılır.
 */
export function seamInset(angleDeg, thickness) {
  const half = (angleDeg / 2) * (Math.PI / 180);
  const t = Math.tan(half);
  if (Math.abs(t) < 1e-6) return 0;
  const d = (thickness / 2) / t;
  const limit = thickness * 3;
  return Math.max(-limit, Math.min(limit, d));
}

/**
 * Her kenarı kendi mesafesiyle içeri kaydırır (CCW halka varsayılır).
 * Yeni köşeler, komşu kaydırılmış doğruların kesişimidir.
 */
export function offsetPerEdge(ring, dists) {
  const n = ring.length;
  if (n < 3 || dists.length !== n) return null;

  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const inx = -dy / len, iny = dx / len; // CCW → içe bakan normal
    const d = dists[i];
    lines.push({
      px: a[0] + inx * d, py: a[1] + iny * d,
      dx: dx / len, dy: dy / len,
    });
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const det = l1.dx * (-l2.dy) - l1.dy * (-l2.dx);
    if (Math.abs(det) < 1e-9) {
      out.push([l2.px, l2.py]); // paralel kenarlar — kaydırılmış noktayı kullan
      continue;
    }
    const rx = l2.px - l1.px, ry = l2.py - l1.py;
    const t = (rx * (-l2.dy) - ry * (-l2.dx)) / det;
    out.push([l1.px + l1.dx * t, l1.py + l1.dy * t]);
  }

  // Telafi parçayı ters çevirdiyse (çok sivri açı) vazgeç.
  if (signedArea(out) <= 0) return null;
  return out;
}
