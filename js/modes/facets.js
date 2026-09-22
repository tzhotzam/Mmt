// POLİGONAL KABUK MODU (metal / kaynak)
//
// Kapalı bir 3B modeli düz yüzeylerine ayırır. İki çıktı biçimi var:
//
//   GEVŞEK FASET  — her yüzey ayrı parça, tamamı kaynakla birleşir.
//                   Basit; ama montajda açıyı tutmak kaynakçıya kalır.
//
//   AÇINIM        — komşu yüzeyler, düzleme serildiğinde üst üste BİNMEYEN
//   ("yaprak")      öbekler hâlinde tek parça kesilir. İç kenarlar kertikli
//                   (kesik çizgili) kesilir, elle bükülür, sonra kertikler
//                   kaynakla doldurulur. Açıyı büküm çizgisi tutar, göz değil.
//                   Yaprakların birbirine bakan kenarları kaynak dikişidir.

import {
  buildMesh, groupCoplanar, groupBoundary, planeBasis, projectToPlane,
  dihedralAngle, centroidOf, groupArea, scaleTriangles,
} from '../mesh.js';
import { signedArea, bbox } from '../geom.js';
import { unfoldPatches, patchOutline, bridgeLine, bendDeduction } from '../unfold.js';
import { applyRivetJoints, reliefHoles, reliefDiameter, cleanupJointFields } from '../joints.js';

export const FACET_DEFAULTS = {
  targetSize: 600,
  sizeAxis: 'max',
  thickness: 3,
  angleTol: 1,
  thicknessComp: true,
  minArea: 40,          // ölçüldü: sadeleştirilmiş modelde 150 → 59 öksüz dikiş, 40 → 15
  labelSize: 7,
  seamLabelSize: 4.5,
  offset: 0,
  // Açınım
  unfold: false,
  maxFacetsPerPatch: 24,
  bridgeMode: 'oto',  // 'dagitik' | 'tek' | 'oto'
  dashCut: 30,
  dashGap: 8,
  bridgeWidth: 25,    // tek köprü modunda ortada kalan dolu pay (mm)
  autoLimit: 250,     // 'oto' modda bu uzunluğun altı tek köprü
  bendRadius: 0,   // 0 → sac kalınlığı kadar varsayılır
  // Bundan keskin kenar bükülmez, kaynak dikişi kalır (derece, düzden
  // sapma). 150° → iç açı 30°: abkant presin sivri takımla inebildiği sınır.
  maxBend: 150,
  // Birleşim: 'kaynak' | 'percin' (her dikişe perçinli kulakçık)
  joinMethod: 'kaynak',
  tabWidth: 20,       // kulakçık derinliği (mm)
  rivetDiameter: 4,   // kör perçin çapı; delik +0.1 mm
  rivetPitch: 80,     // perçinler arası en çok (mm)
  reliefHoles: true,  // büküm hatlarının birleştiği iç köşelere delik
  reliefHoleDia: 0,   // 0 → iki sac kalınlığı (3-8 mm)
  kFactor: 0.4,
  maxPatchW: Infinity,
  maxPatchH: Infinity,
};

export function generateFacets(rawTris, userParams = {}) {
  const p = { ...FACET_DEFAULTS, ...userParams };
  const warnings = [];

  const scaled = scaleTriangles(rawTris, p.targetSize, p.sizeAxis);
  const mesh = buildMesh(scaled.tris);
  if (!mesh.faces.length) {
    return { parts: [], seams: [], folds: [], info: emptyInfo(p, scaled), warnings: ['Modelde geçerli üçgen bulunamadı.'] };
  }

  const a = analyze(mesh, p);

  // Her şey elendiyse uygulama sessizce boş çıktı veriyordu: ne parça ne
  // uyarı. Kullanıcı bomboş bir ekrana bakıp yazılımın bozuk olduğunu
  // düşünür. Sebebini say ve söyle.
  if (!a.facets.some(Boolean)) {
    const toplam = a.elenen.halka + a.elenen.kenar + a.elenen.duzlem + a.elenen.alan;
    const neden = a.elenen.alan === toplam && toplam > 0
      ? `Fasetlerin tamamı (${toplam} adet) "En küçük faset" değerinin ` +
        `(${p.minArea} mm²) altında kaldı. Heykel boyunu büyütün ya da bu değeri düşürün.`
      : `${toplam} fasetin tamamı elendi (alan ${a.elenen.alan}, az komşu ${a.elenen.kenar}, ` +
        `sınır çıkmadı ${a.elenen.halka}, bozuk üçgen ${a.elenen.duzlem}). ` +
        'Model kapalı ve temiz bir hacim olmayabilir.';
    return {
      parts: [], seams: [], folds: [], info: emptyInfo(p, scaled),
      warnings: [`Hiç parça üretilemedi. ${neden}`],
    };
  }

  if (a.openEdges > 0) {
    warnings.push(
      `${a.openEdges} kenarın karşı tarafı yok — model kapalı bir hacim değil. ` +
      'Bu kenarlar serbest kalır, kaynak eşi bulunmaz.'
    );
  }

  const built = p.unfold
    ? buildPatchParts(a, p, warnings)
    : buildLooseParts(a, p, warnings);

  const birlesim = { percin: 0, kaynak: a.seams.length, keskin: 0, rivets: 0, tabs: 0 };
  if (p.joinMethod === 'percin') {
    Object.assign(birlesim, applyRivetJoints(built.parts, a.seams, p));
    const parcalar = [];
    if (birlesim.kaynak) {
      parcalar.push(`${birlesim.kaynak} dikişe kulakçık ya da perçin deliği sığmadı ` +
        '(kenar kısa, faset dar ya da kulakçık parçanın kendisine çarpıyor — ' +
        'heykeli büyütmek bu sayıyı düşürür)');
    }
    if (birlesim.keskin) {
      parcalar.push(`${birlesim.keskin} dikiş bükülemeyecek kadar keskin (iç açı 30°'nin altında)`);
    }
    if (parcalar.length) {
      warnings.push(
        `${parcalar.join('; ')}. Bunlar kaynakla birleşir; montaj listesinde "kaynak" diye işaretli.`
      );
    }
    birlesim.kaynak += birlesim.keskin;
  }
  const reliefHoleCount = built.parts.reduce((t, q) => t + (q.meta.reliefHoles || 0), 0);
  cleanupJointFields(built.parts);

  const maxDev = a.facets.reduce((m, f) => Math.max(m, f ? f.deviation : 0), 0);
  if (p.angleTol > 1 && maxDev > p.thickness) {
    warnings.push(
      `Yüzey birleştirme ${p.angleTol}° yüzünden bazı fasetler tam düz değil ` +
      `(en büyük sapma ${maxDev.toFixed(1)} mm). Sac bu kadar bükülmek zorunda kalır.`
    );
  }
  if (built.parts.length > 150) {
    warnings.push(
      `${built.parts.length} parça çok fazla. Yüzey birleştirme açısını artırın, ` +
      'açınımı açın veya modeli Blender\'da Decimate ile sadeleştirin.'
    );
  }
  if (built.parts.length && built.parts.length < 4) {
    warnings.push(`Yalnızca ${built.parts.length} parça çıktı — kapalı bir hacim için çok az.`);
  }

  return {
    parts: built.parts,
    seams: a.seams,
    folds: built.folds || [],
    info: {
      mode: 'facets',
      unfold: p.unfold,
      facetCount: a.facets.filter(Boolean).length,
      partCount: built.parts.length,
      seamCount: a.seams.length,
      foldCount: (built.folds || []).length,
      openEdges: a.openEdges,
      joinMethod: p.joinMethod,
      rivetCount: birlesim.rivets,
      tabCount: birlesim.tabs,
      weldSeamCount: p.joinMethod === 'percin' ? birlesim.kaynak : a.seams.length,
      reliefHoleCount,
      triangleCount: mesh.faces.length,
      maxDeviation: maxDev,
      modelSize: scaled.size,
      panelW: scaled.size.x,
      panelH: scaled.size.z || scaled.size.y,
      totalDepth: scaled.size.y,
      totalArea: a.groups.reduce((s, g) => s + groupArea(mesh, g), 0),
      triangles: scaled.tris,
      params: p,
    },
    warnings,
  };
}

// --------------------------------------------------------------- ÇÖZÜMLEME

/**
 * Ağı fasetlere ayırır, her fasetin düzlem içi poligonunu ve komşuluk
 * grafiğini kurar. Hem gevşek hem açınım çıktısı buradan beslenir.
 */
function analyze(mesh, p) {
  const groups = groupCoplanar(mesh, p.angleTol);
  const centroids = groups.map((g) => centroidOf(mesh, g));

  const edgeOwners = new Map();
  const boundaries = groups.map((g, gi) => {
    const b = groupBoundary(mesh, g);
    for (const [x, y] of b.boundaryEdges) {
      const k = x < y ? `${x}_${y}` : `${y}_${x}`;
      let list = edgeOwners.get(k);
      if (!list) edgeOwners.set(k, (list = []));
      if (!list.includes(gi)) list.push(gi);
    }
    return b;
  });

  const facets = new Array(groups.length).fill(null);
  const seams = [];
  const seamIdByKey = new Map();
  const neighborOf = new Map();
  let openEdges = 0;

  // Faset neden elendi? Hepsini "en küçük faset filtresi" diye raporlamak
  // kullanıcıyı yanlış ayara gönderiyordu: alan filtresi hiçbir şey elemese
  // bile mesaj onu suçluyordu.
  const elenen = { halka: 0, kenar: 0, duzlem: 0, alan: 0 };

  groups.forEach((group, gi) => {
    const loop = boundaries[gi].loops[0];
    if (!loop || loop.length < 3) { elenen.halka++; return; }

    const runs = splitIntoRuns(loop, gi, edgeOwners);
    if (runs.length < 3) { elenen.kenar++; return; }

    const basis = planeBasis(group.normal);
    const verts = runs.map((r) => r.start);
    const { pts, deviation } = projectToPlane(
      verts.map((vi) => mesh.vertices[vi]), basis, centroids[gi]
    );
    if (pts.length < 3) { elenen.duzlem++; return; }

    const area = Math.abs(signedArea(pts));
    if (area < p.minArea) { elenen.alan++; return; }

    // Halkayı CCW'ye çevir; kenar verilerini aynı sıraya taşı.
    let ring = pts;
    let orderedRuns = runs;
    let orderedVerts = verts;
    if (signedArea(pts) < 0) {
      ring = pts.slice().reverse();
      orderedVerts = verts.slice().reverse();
      // Ters çevrilen halkada kenar sırası bir kayar: [s0,s1,s2,s3] → [s2,s1,s0,s3]
      const rev = runs.slice().reverse();
      orderedRuns = rev.slice(1).concat(rev[0]);
    }

    const vmap = new Map();
    orderedVerts.forEach((vi, i) => vmap.set(vi, ring[i]));

    const edgeKeys = [];
    const seamOfEdge = [];
    const neighbors = [];

    orderedRuns.forEach((run) => {
      if (run.partner === null) {
        openEdges++;
        edgeKeys.push(null);
        seamOfEdge.push(null);
        return;
      }
      // Dikiş anahtarı koşunun UÇ NOKTALARINDAN türetilir. Karşı faset aynı
      // koşuyu ters yönde dolaştığından, ilk kenardan türetilen anahtar iki
      // tarafta farklı çıkar ve tek dikiş iki kez numaralanırdı.
      const k = run.start < run.end ? `${run.start}_${run.end}` : `${run.end}_${run.start}`;
      let id = seamIdByKey.get(k);
      if (id === undefined) {
        id = seams.length + 1;
        seamIdByKey.set(k, id);
        seams.push({
          id, a: gi, b: run.partner, key: k,
          angle: dihedralAngle(
            group.normal, groups[run.partner].normal, centroids[gi], centroids[run.partner]
          ),
          length: edgeLength(mesh, run),
        });
      }
      edgeKeys.push(k);
      seamOfEdge.push(id);
      neighbors.push({
        facet: run.partner, edgeKey: k, angle: seams[id - 1].angle,
        v1: run.start, v2: run.end,
      });
    });

    neighborOf.set(gi, neighbors);
    facets[gi] = {
      index: gi, poly2d: ring, vmap, edgeKeys, seamOfEdge,
      area, deviation, normal: group.normal,
    };
  });

  // Elenen fasetleri komşuluk grafiğinden çıkar.
  for (const [gi, list] of neighborOf) {
    neighborOf.set(gi, list.filter((n) => facets[n.facet]));
  }

  return { mesh, groups, centroids, facets, seams, seamIdByKey, neighborOf, openEdges, elenen };
}

// ------------------------------------------------------------ GEVŞEK FASET

function buildLooseParts(a, p, warnings) {
  const parts = [];
  const groupToId = new Map();

  let telafiCoken = 0;
  a.facets.forEach((f) => {
    if (!f) return;
    let ring = f.poly2d;
    if (p.thicknessComp && p.thickness > 0) {
      const dists = f.seamOfEdge.map((id) => (id ? seamInset(a.seams[id - 1].angle, p.thickness) : 0));
      const moved = offsetPerEdge(ring, dists);
      if (moved && !telafiCokerMi(ring, moved)) ring = moved;
      else if (moved) telafiCoken++;
    }
    if (p.offset !== 0) {
      const moved = offsetPerEdge(ring, ring.map(() => -p.offset));
      if (moved) ring = moved;
    }

    const b = bbox(ring);
    const id = `P${String(parts.length + 1).padStart(2, '0')}`;
    groupToId.set(f.index, id);

    const engrave = [centerLabel(id, b, p.labelSize)];
    const seamEdges = [];
    for (let i = 0; i < ring.length; i++) {
      const sid = f.seamOfEdge[i];
      if (!sid) continue;
      const lbl = edgeLabel(ring, i, String(sid), p.seamLabelSize);
      if (lbl) engrave.push(lbl);
      seamEdges.push({ i, sid, label: lbl });
    }

    parts.push({
      id, kind: 'faset', outline: ring, holes: [], engrave,
      w: b.w, h: b.h,
      meta: {
        group: f.index, area: f.area, deviation: f.deviation,
        seams: f.seamOfEdge.filter(Boolean),
      },
      _ring0: f.poly2d, _seamEdges: seamEdges, _circles: [],
    });
  });

  linkSeams(a.seams, groupToId, warnings, a.elenen);
  if (telafiCoken) warnings.push(telafiUyarisi(telafiCoken, p.thickness));
  return { parts };
}

// ----------------------------------------------------------------- AÇINIM

function buildPatchParts(a, p, warnings) {
  let yaprakTelafiCoken = 0;
  const facetList = [];
  const denseToGroup = [];
  a.facets.forEach((f) => {
    if (!f) return;
    denseToGroup.push(f.index);
    facetList.push(f);
  });
  if (!facetList.length) return { parts: [], folds: [] };

  const denseOf = new Map();
  facetList.forEach((f, i) => denseOf.set(f.index, i));
  const neighborDense = new Map();
  for (const [gi, list] of a.neighborOf) {
    const d = denseOf.get(gi);
    if (d === undefined) continue;
    // Bükülemeyecek kadar keskin kenar açınıma bağlanmaz, dikiş olarak
    // kalır. Sınır yokken bıçak sırtı kenarlar (neredeyse kendi üstüne
    // katlanan iki faset) büküm sayılıyor, büküm payı hesabı tavana vurup
    // "672.7 mm" gibi anlamsız uyarılar veriyordu — sac öyle bükülmez.
    neighborDense.set(d, list
      .filter((n) => denseOf.has(n.facet) && Math.abs(180 - n.angle) <= p.maxBend)
      .map((n) => ({ ...n, facet: denseOf.get(n.facet) })));
  }

  // Perçinli birleşimde kulakçıklar açınımdan SONRA eklenir ve yaprağı her
  // iki yanda kulakçık derinliği kadar büyütebilir. Sınır o kadar daraltılır;
  // yoksa 400 mm istenen yaprak 427 mm çıkıyordu (levhaya/kabine sığmaz).
  const kulakPayi = p.joinMethod === 'percin' ? 2 * Math.max(p.tabWidth, 10) : 0;
  const { patches } = unfoldPatches(facetList, neighborDense, {
    maxFacets: Math.max(1, Math.round(p.maxFacetsPerPatch)),
    clearance: Math.max(0.2, p.thickness * 0.15),
    maxW: p.maxPatchW - kulakPayi,
    maxH: p.maxPatchH - kulakPayi,
  });

  const parts = [];
  const folds = [];
  const groupToId = new Map();
  const weldedKeys = new Set();
  const radius = p.bendRadius > 0 ? p.bendRadius : p.thickness;

  patches.forEach((patch) => {
    const traced = patchOutline(patch);
    if (!traced) return;

    let ring = traced.ring;
    let edges = traced.edges;
    if (signedArea(ring) < 0) {
      const n = ring.length;
      ring = ring.slice().reverse();
      edges = edges.map((_, i) => traced.edges[(n - 2 - i + n) % n]);
    }
    const ring0 = ring;

    // Kaynak kenarlarına kalınlık telafisi; büküm kenarlarına gerekmez.
    if (p.thicknessComp && p.thickness > 0) {
      const dists = edges.map((e) => {
        const sid = e.edgeKey ? a.seamIdByKey.get(e.edgeKey) : null;
        return sid ? seamInset(a.seams[sid - 1].angle, p.thickness) : 0;
      });
      const moved = offsetPerEdge(ring, dists);
      if (moved && !telafiCokerMi(ring, moved)) ring = moved;
      else if (moved) yaprakTelafiCoken++;
    }
    if (p.offset !== 0) {
      const moved = offsetPerEdge(ring, ring.map(() => -p.offset));
      if (moved) ring = moved;
    }

    const b = bbox(ring);
    const id = `Y${String(parts.length + 1).padStart(2, '0')}`;
    for (const [fi] of patch.placed) groupToId.set(denseToGroup[fi], id);

    const engrave = [centerLabel(id, b, p.labelSize)];
    const seamEdges = [];

    for (let i = 0; i < ring.length; i++) {
      const ek = edges[i]?.edgeKey;
      if (!ek) continue;
      const sid = a.seamIdByKey.get(ek);
      if (!sid) continue;
      weldedKeys.add(ek);
      const lbl = edgeLabel(ring, i, String(sid), p.seamLabelSize);
      if (lbl) engrave.push(lbl);
      seamEdges.push({ i, sid, label: lbl });
    }

    const kose = p.reliefHoles ? reliefHoles(ring, patch.folds, reliefDiameter(p)) : [];

    for (const f of patch.folds) {
      folds.push({
        patch: id, angle: f.angle,
        deduction: bendDeduction(f.angle, p.thickness, radius, p.kFactor),
        length: Math.hypot(f.p2[0] - f.p1[0], f.p2[1] - f.p1[1]),
      });

      // İz çizgisi — yüzeysel gravür, bükümü buradan yaparsınız.
      engrave.push({ type: 'polyline', points: [f.p1, f.p2], closed: false, layer: 'BUKUM' });

      // Kertikler — TAM KESİM. Sacı delip geçer; büküm buradan olur.
      for (const seg of bridgeLine(f.p1, f.p2, {
        mode: p.bridgeMode, cut: p.dashCut, gap: p.dashGap,
        bridge: p.bridgeWidth, autoLimit: p.autoLimit,
      })) {
        engrave.push({ type: 'polyline', points: seg, closed: false, layer: 'KESIM' });
      }

      const mx = (f.p1[0] + f.p2[0]) / 2, my = (f.p1[1] + f.p2[1]) / 2;
      const dx = f.p2[0] - f.p1[0], dy = f.p2[1] - f.p1[1];
      const len = Math.hypot(dx, dy) || 1;
      engrave.push({
        type: 'text', text: `${Math.round(f.angle)}°`,
        x: mx + (-dy / len) * p.seamLabelSize * 1.6,
        y: my + (dx / len) * p.seamLabelSize * 1.6,
        size: p.seamLabelSize,
      });
    }

    parts.push({
      id, kind: 'yaprak', outline: ring, holes: kose.map((k) => k.ring), engrave,
      w: b.w, h: b.h,
      meta: {
        facets: patch.placed.size,
        folds: patch.folds.length,
        reliefHoles: kose.length,
        seams: edges.map((e) => (e.edgeKey ? a.seamIdByKey.get(e.edgeKey) : null)).filter(Boolean),
      },
      _ring0: ring0, _seamEdges: seamEdges, _circles: kose.slice(),
    });
  });

  if (yaprakTelafiCoken) warnings.push(telafiUyarisi(yaprakTelafiCoken, p.thickness));

  // Büküme dönüşen dikişler artık kaynaklanmıyor — listeden düşür.
  const welded = a.seams.filter((s) => weldedKeys.has(s.key));
  linkSeams(welded, groupToId, warnings, a.elenen,
    'bazı fasetler hiçbir yaprağa yerleştirilemedi (yaprak başına faset sınırını veya levha ölçüsünü artırın)');
  a.seams.length = 0;
  a.seams.push(...welded);

  const maxDed = folds.reduce((m, f) => Math.max(m, Math.abs(f.deduction)), 0);
  if (maxDed > p.thickness) {
    warnings.push(
      `Keskin köşe varsayımıyla kesilen açınımda en büyük büküm payı ${maxDed.toFixed(1)} mm. ` +
      'Kertikli bükümde bu fark küçülür; bükümü kertik çizgisinin tam ortasından yapın.'
    );
  }

  return { parts, folds };
}

/**
 * Dikişleri parça kimlikleriyle eşler. Karşılığı bulunmayan dikiş "öksüz"dür.
 *
 * Öksüzlüğün sebebi TEK DEĞİL, ve hepsini "en küçük faset filtresi" diye
 * raporlamak kullanıcıyı yanlış ayara gönderiyordu: alan filtresini sıfıra
 * çekmek hiçbir şeyi değiştirmediği hâlde mesaj onu suçluyordu. Sebep,
 * çözümlemede tutulan sayaçlardan okunup yazılır.
 */
function linkSeams(seams, groupToId, warnings, elenen = null, baglam = '') {
  let orphan = 0;
  for (const seam of seams) {
    seam.aId = groupToId.get(seam.a) || null;
    seam.bId = groupToId.get(seam.b) || null;
    if (!seam.aId || !seam.bId) orphan++;
  }
  if (!orphan) return;

  const sebepler = [];
  if (elenen) {
    if (elenen.alan) {
      sebepler.push(`${elenen.alan} faset en küçük faset alanının altında kaldı ` +
        '("En küçük faset" değerini düşürün ya da heykel boyunu büyütün)');
    }
    if (elenen.kenar) {
      sebepler.push(`${elenen.kenar} faset üçten az komşuya dayanıyor ` +
        '(modelde şerit/ince yüzey var)');
    }
    if (elenen.halka) {
      sebepler.push(`${elenen.halka} fasetin kapalı sınırı çıkarılamadı ` +
        '(delik, çakışan yüzey ya da ters normal)');
    }
    if (elenen.duzlem) {
      sebepler.push(`${elenen.duzlem} faset düzleme yassıldı (bozuk üçgenler)`);
    }
  }
  if (!sebepler.length && baglam) sebepler.push(baglam);

  warnings.push(
    `${orphan} dikişin karşı parçası yok — bu dikişler kaynaklanamaz. ` +
    (sebepler.length ? `Sebep: ${sebepler.join('; ')}.` : 'Sebep çözümlenemedi.') +
    ' Model kapalı ve temiz bir hacim değilse Blender\'da "Merge by Distance" + ' +
    '"Recalculate Normals" uygulayıp tekrar deneyin.'
  );
}

// ------------------------------------------------------------- YARDIMCILAR

/**
 * Kalınlık telafisi faseti yok etti mi?
 *
 * Telafi her kenarı (t/2)·cot(θ/2) kadar içe kaydırır. Küçük bir fasette ve
 * keskin dihedral açıda bu kayma fasetin iç yarıçapını aşar: halka sıfıra
 * iner ya da ters döner. offsetPerEdge yine de bir halka döndürüyordu ve
 * parça öyle tutuluyordu — 0 mm²'lik, kesilemeyen parçalar çıkıyordu.
 * Ölçüldü: 250 üçgene sadeleştirilmiş bir modelde telafi açıkken en küçük
 * parçalar 0, 0, 1, 2, 5 mm²; kapalıyken 34, 35, 35, 39, 47 mm².
 */
function telafiCokerMi(once, sonra) {
  const a0 = signedArea(once);
  const a1 = signedArea(sonra);
  // Yön değiştiyse halka kendini kesmiştir; alanın %15'inin altına indiyse
  // parça kullanılamayacak kadar küçülmüştür.
  return Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) < Math.abs(a0) * 0.15;
}

function telafiUyarisi(n, t) {
  return (
    `${n} fasette kalınlık telafisi parçayı yok ediyordu (${t} mm sac, keskin ` +
    'açı, küçük faset). Bu parçalar telafisiz kesildi — kenarları birkaç ' +
    'milimetre fazla çıkar, montajda taşlayın. Sayı yüksekse heykeli büyütün ' +
    'ya da "Hedef yüzey sayısı"nı düşürüp fasetleri büyütün.'
  );
}

function centerLabel(text, b, size) {
  return { type: 'text', text, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, size };
}

/** Kenar ortasına, içeri kaydırılmış küçük etiket. Sığmıyorsa null. */
function edgeLabel(ring, i, text, size) {
  const a = ring[i], c = ring[(i + 1) % ring.length];
  const dx = c[0] - a[0], dy = c[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < size * 2.5) return null;
  return {
    type: 'text', text, size,
    x: (a[0] + c[0]) / 2 + (-dy / len) * size * 1.4,
    y: (a[1] + c[1]) / 2 + (dx / len) * size * 1.4,
  };
}

function splitIntoRuns(loop, gi, edgeOwners) {
  const n = loop.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const owners = edgeOwners.get(k) || [];
    const other = owners.find((o) => o !== gi);
    edges.push({ partner: other === undefined ? null : other, key: k, a, b });
  }

  let startIdx = 0;
  for (let i = 0; i < n; i++) {
    if (edges[i].partner !== edges[(i - 1 + n) % n].partner) { startIdx = i; break; }
  }

  const runs = [];
  let cur = null;
  for (let s = 0; s < n; s++) {
    const e = edges[(startIdx + s) % n];
    if (cur && cur.partner === e.partner && e.partner !== null) {
      cur.end = e.b;
      cur.edges.push(e);
    } else {
      cur = { partner: e.partner, start: e.a, end: e.b, edges: [e] };
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

function emptyInfo(p, scaled) {
  return {
    mode: 'facets', unfold: p.unfold, facetCount: 0, partCount: 0, seamCount: 0,
    foldCount: 0, openEdges: 0, triangleCount: 0, maxDeviation: 0,
    modelSize: scaled.size, panelW: scaled.size.x || 1, panelH: scaled.size.z || 1,
    totalDepth: scaled.size.y || 0, totalArea: 0, triangles: scaled.tris, params: p,
  };
}

/**
 * Sac kalınlığı telafisi: iki plaka θ iç açısıyla birleşirken dış yüzey
 * ölçüsüyle kesilirse içeride çakışır. Orta yüzeye inmek için her kenar
 * (t/2)·cot(θ/2) kadar içeri çekilir.
 */
export function seamInset(angleDeg, thickness) {
  const t = Math.tan((angleDeg / 2) * (Math.PI / 180));
  if (Math.abs(t) < 1e-6) return 0;
  const d = (thickness / 2) / t;
  const limit = thickness * 3;
  return Math.max(-limit, Math.min(limit, d));
}

/** Her kenarı kendi mesafesiyle içeri kaydırır (CCW halka varsayılır). */
export function offsetPerEdge(ring, dists) {
  const n = ring.length;
  if (n < 3 || dists.length !== n) return null;

  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const d = dists[i];
    lines.push({
      px: a[0] + (-dy / len) * d, py: a[1] + (dx / len) * d,
      dx: dx / len, dy: dy / len,
    });
  }

  // Köşe, iki kaydırılmış kenar çizgisinin kesişimidir. Ama iki kenar
  // neredeyse AYNI DOĞRUDAYSA ve farklı miktarda kaydırıldıysa kesişim
  // uzaklara kaçar: ölçüldü — 1200 mm'lik bir heykelde bir köşe 6 metre öteye
  // gitti, parça 543 × 6138 mm çıktı. Kaçış sınırı aşılırsa köşe, iki
  // kenarın ayrı ayrı kaydırılmış köşe noktalarının ortasına konur (köşe
  // sayısı değişmez; kenar sırası başka yerlerde kullanılıyor).
  const maxD = Math.max(1e-9, ...dists.map(Math.abs));
  const sinir = 4 * maxD + 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const V = ring[i];
    const orta = () => {
      const d1 = dists[(i - 1 + n) % n], d2 = dists[i];
      return [
        V[0] + (-l1.dy * d1 - l2.dy * d2) / 2,
        V[1] + (l1.dx * d1 + l2.dx * d2) / 2,
      ];
    };
    const det = l1.dx * (-l2.dy) - l1.dy * (-l2.dx);
    if (Math.abs(det) < 1e-9) { out.push(orta()); continue; }
    const rx = l2.px - l1.px, ry = l2.py - l1.py;
    const t = (rx * (-l2.dy) - ry * (-l2.dx)) / det;
    const P = [l1.px + l1.dx * t, l1.py + l1.dy * t];
    // Yalnızca kenarların AYNI yöne gittiği (dönüş < 90°) köşelerde: orada
    // doğru kesişim en fazla ~1.4·d uzaktadır, fazlası kaçıştır. Sivri uçta
    // (dönüş > 90°) kesişim meşru olarak uzaktır; ona dokunulmaz.
    const ayniYon = l1.dx * l2.dx + l1.dy * l2.dy > 0;
    out.push(ayniYon && Math.hypot(P[0] - V[0], P[1] - V[1]) > sinir ? orta() : P);
  }

  if (signedArea(out) <= 0) return null;
  return out;
}
