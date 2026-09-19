// AÇINIM (unfold) — fasetleri "yaprak"lara açar.
//
// Kapalı bir yüzey tek parçaya açılamaz (küre düzleme serilmez). Bu yüzden
// fasetler, düzleme serildiğinde üst üste BİNMEYEN öbeklere bölünür. Her
// öbek tek parça olarak kesilir, iç kenarlarından bükülür; öbekler birbirine
// kaynakla bağlanır.
//
// Kazanç: gevşek üçgenleri havada tutmak yerine bükülebilir levhalar.
// Açıyı büküm çizgisi tutar, kaynakçının gözü değil.

/**
 * İki nokta çiftini eşleyen katı dönüşüm (döndürme + öteleme, aynalama yok).
 * Komşu faset ortak kenarı ters yönde dolaştığı için b1→a1, b2→a2 eşlemesi
 * onu kendiliğinden kenarın öbür yanına yerleştirir.
 */
function rigidFrom(b1, b2, a1, a2) {
  const bdx = b2[0] - b1[0], bdy = b2[1] - b1[1];
  const adx = a2[0] - a1[0], ady = a2[1] - a1[1];
  const blen2 = bdx * bdx + bdy * bdy;
  if (blen2 < 1e-18) return null;
  const cos = (adx * bdx + ady * bdy) / blen2;
  const sin = (ady * bdx - adx * bdy) / blen2;
  return ([x, y]) => {
    const dx = x - b1[0], dy = y - b1[1];
    return [a1[0] + dx * cos - dy * sin, a1[1] + dx * sin + dy * cos];
  };
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
  }
  return inside;
}

export function polysOverlap(A, B) {
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      if (segmentsCross(a1, a2, B[j], B[(j + 1) % B.length])) return true;
    }
  }
  return pointInPoly(A[0], B) || pointInPoly(B[0], A);
}

/** Poligonu merkezine doğru küçültür — ortak kenar teması çakışma sayılmasın. */
function shrink(poly, amount) {
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, len - amount) / len;
    return [cx + dx * k, cy + dy * k];
  });
}

function boundsOf(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function mergeBounds(a, b) {
  const minX = Math.min(a.minX, b.minX), minY = Math.min(a.minY, b.minY);
  const maxX = Math.max(a.maxX, b.maxX), maxY = Math.max(a.maxY, b.maxY);
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Fasetleri açınım öbeklerine böler.
 *
 * @param {Array} facets  { poly2d, vmap: Map(vi->[x,y]), edgeKeys, area }
 * @param {Map}   neighborOf  fi -> [{ facet, edgeKey, v1, v2, angle }]
 * @param {object} opts { maxW, maxH, maxFacets, clearance }
 */
export function unfoldPatches(facets, neighborOf, opts = {}) {
  const { maxW = Infinity, maxH = Infinity, maxFacets = 40, clearance = 0.4 } = opts;

  const assigned = new Int32Array(facets.length).fill(-1);
  const order = facets.map((_, i) => i).sort((a, b) => facets[b].area - facets[a].area);
  const patches = [];

  for (const seed of order) {
    if (assigned[seed] !== -1) continue;
    const pi = patches.length;
    assigned[seed] = pi;

    const placed = new Map();
    placed.set(seed, {
      poly: facets[seed].poly2d,
      vmap: facets[seed].vmap,
      edgeKeys: facets[seed].edgeKeys,
    });
    const folds = [];
    let bounds = boundsOf(facets[seed].poly2d);
    const queue = [seed];

    while (queue.length && placed.size < maxFacets) {
      const cur = queue.shift();
      for (const nb of neighborOf.get(cur) || []) {
        if (placed.size >= maxFacets) break;
        if (assigned[nb.facet] !== -1) continue;

        const host = placed.get(cur);
        const src = facets[nb.facet];
        const a1 = host.vmap.get(nb.v1), a2 = host.vmap.get(nb.v2);
        const b1 = src.vmap.get(nb.v1), b2 = src.vmap.get(nb.v2);
        if (!a1 || !a2 || !b1 || !b2) continue;

        const T = rigidFrom(b1, b2, a1, a2);
        if (!T) continue;
        const poly = src.poly2d.map(T);

        const probe = shrink(poly, clearance);
        let clash = false;
        for (const [fi, p] of placed) {
          if (fi === cur) continue; // ortak kenarlı komşu — yalnızca temas eder
          if (polysOverlap(probe, p.poly)) { clash = true; break; }
        }
        if (clash) continue;

        // Yaprak levhaya sığmalı. Dar/uzun yapraklar için iki yön de denenir.
        const nextBounds = mergeBounds(bounds, boundsOf(poly));
        const fits = (nextBounds.w <= maxW && nextBounds.h <= maxH) ||
                     (nextBounds.h <= maxW && nextBounds.w <= maxH);
        if (!fits) continue;

        const vmap = new Map();
        for (const [vi, p] of src.vmap) vmap.set(vi, T(p));
        placed.set(nb.facet, { poly, vmap, edgeKeys: src.edgeKeys });
        assigned[nb.facet] = pi;
        bounds = nextBounds;
        folds.push({
          a: cur, b: nb.facet, angle: nb.angle, edgeKey: nb.edgeKey,
          p1: a1, p2: a2,
        });
        queue.push(nb.facet);
      }
    }

    patches.push({ seed, placed, folds, bounds, index: pi });
  }

  return { patches, assigned };
}

/**
 * Açılmış öbeğin dış sınırını, kenar bilgisiyle birlikte çıkarır.
 *
 * Öbek AĞAÇ olarak büyütüldüğü için (her faset tek kenardan bağlanır) yalnızca
 * büküm kenarları iç kenardır. Bu, sınırın tek ve kapalı bir halka olmasını
 * garanti eder.
 *
 * @returns {{ring: Array<[number,number]>, edges: Array<{facet,edgeKey}>}}
 *          edges[i], ring[i] → ring[i+1] kenarına aittir.
 */
export function patchOutline(patch, tol = 0.01) {
  const foldSet = new Set();
  for (const f of patch.folds) {
    foldSet.add(`${f.a}|${f.edgeKey}`);
    foldSet.add(`${f.b}|${f.edgeKey}`);
  }

  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const outgoing = new Map();
  let first = null;

  for (const [fi, data] of patch.placed) {
    const { poly, edgeKeys } = data;
    for (let i = 0; i < poly.length; i++) {
      const ek = edgeKeys[i];
      if (ek && foldSet.has(`${fi}|${ek}`)) continue; // büküm → iç kenar
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const rec = { a, b, facet: fi, edgeKey: ek };
      outgoing.set(key(a), rec);
      if (!first) first = rec;
    }
  }
  if (!first) return null;

  const ring = [];
  const edges = [];
  let cur = first;
  const startKey = key(first.a);
  for (let guard = 0; guard <= outgoing.size + 1; guard++) {
    ring.push(cur.a);
    edges.push({ facet: cur.facet, edgeKey: cur.edgeKey });
    const nxt = outgoing.get(key(cur.b));
    if (!nxt || key(cur.b) === startKey) break;
    cur = nxt;
  }
  return ring.length >= 3 ? { ring, edges } : null;
}

/**
 * Büküm çizgisi köprüleri.
 *
 * Çizgi boyunca malzemenin bir kısmı kesilir, kalan "köprü"ler parçayı bir
 * arada tutar ve bükümden sonra istenirse kaynakla doldurulur. İki strateji:
 *
 *   DAĞITIK — çizgi boyunca birçok kısa köprü. Büküm ekseni iyi tutulur,
 *             kanatlar birbirine göre burulmaz. Uzun kenarlarda tek seçenek.
 *   TEK      — ortada tek bir köprü, gerisi kesik. Elle bükmesi çok daha
 *             kolay; ama eksen serbest kaldığı için uzun kenarda kanatlar
 *             burulur. Kısa kenarlarda idealdir.
 *
 * @param {object} opts
 *  - mode: 'dagitik' | 'tek' | 'oto'
 *  - cut, gap: dağıtık modda kesim ve köprü uzunluğu (mm)
 *  - bridge: tek modda ortadaki köprünün genişliği (mm)
 *  - autoLimit: 'oto' modda bu uzunluğun altı tek köprü sayılır (mm)
 *  - endMargin: uçlarda bırakılacak dolu pay (mm)
 */
export function bridgeLine(p1, p2, opts = {}) {
  const {
    mode = 'dagitik', cut = 8, gap = 4, bridge = 25,
    autoLimit = 250, endMargin,
  } = opts;

  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const ux = dx / len, uy = dy / len;
  // Uç payı köşeyi sağlam tutar ama büyümemeli: 3 mm sacda 5-12 mm yeterli.
  const margin = endMargin ?? Math.min(Math.max(4, len * 0.06), 12, len * 0.3);
  const at = (t) => [p1[0] + ux * t, p1[1] + uy * t];

  const single = mode === 'tek' || (mode === 'oto' && len <= autoLimit);
  if (single) {
    const usable = len - margin * 2;
    // Köprü, kalan boşluğun yarısından geniş olamaz — yoksa kesim kalmaz.
    const b = Math.min(bridge, usable * 0.6);
    if (usable - b < 4) return [];       // kesilecek yer yok, çizgiyi dolu bırak
    const a1 = margin, a2 = (len - b) / 2;
    const b1 = (len + b) / 2, b2 = len - margin;
    const segs = [];
    if (a2 - a1 > 1) segs.push([at(a1), at(a2)]);
    if (b2 - b1 > 1) segs.push([at(b1), at(b2)]);
    return segs;
  }

  const usable = len - margin * 2;
  if (usable <= cut) return [];
  const period = cut + gap;
  const n = Math.max(1, Math.floor((usable + gap) / period));
  const span = n * period - gap;
  let t = margin + (usable - span) / 2;

  const segs = [];
  for (let i = 0; i < n; i++) {
    segs.push([at(t), at(t + cut)]);
    t += period;
  }
  return segs;
}

/** Geriye dönük uyum: dağıtık kertik. */
export function dashLine(p1, p2, cut, gap, endMargin) {
  return bridgeLine(p1, p2, { mode: 'dagitik', cut, gap, endMargin });
}

/**
 * Büküm payı (bend deduction) — bilgi amaçlı.
 * Kertikli bükümde malzeme zaten boşaltıldığı için gerçek fark bundan
 * küçüktür; kullanıcı büyüklük mertebesini görsün diye raporlanır.
 */
export function bendDeduction(angleDeg, t, radius = t, k = 0.4) {
  const bend = 180 - angleDeg;
  if (Math.abs(bend) < 0.5) return 0;
  const rad = (Math.abs(bend) * Math.PI) / 180;
  const allowance = rad * (radius + k * t);
  const setback = 2 * (radius + t) * Math.tan(Math.min(rad / 2, 1.5533));
  return Math.sign(bend) * (setback - allowance);
}
