// Temel 2B geometri yardımcıları.
// Tüm halkalar (ring) [[x,y], ...] dizisidir ve kapalı kabul edilir
// (son nokta ilk noktaya eşit yazılmaz).

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function isCCW(ring) {
  return signedArea(ring) > 0;
}

export function ensureOrientation(ring, ccw) {
  return isCCW(ring) === ccw ? ring : ring.slice().reverse();
}

export function perimeter(ring, closed = true) {
  let s = 0;
  const n = ring.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    s += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return s;
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Poligonun ağırlık merkezi (alan merkezi).
 *
 * Dikkat: İÇBÜKEY bir poligonda bu nokta poligonun DIŞINDA kalabilir
 * (hilal, U biçimi). Mil deliği gibi "içeride olmalı" gereken işlerde
 * sonucu pointInRing ile doğrulayın.
 */
export function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const b = bbox(ring);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bboxOfRings(rings) {
  const all = [];
  for (const r of rings) for (const p of r) all.push(p);
  return bbox(all);
}

export function translateRing(ring, dx, dy) {
  return ring.map(([x, y]) => [x + dx, y + dy]);
}

export function rotateRing90(ring) {
  // Saat yönünün tersine 90 derece: (x,y) -> (-y,x)
  return ring.map(([x, y]) => [-y, x]);
}

export function pointInRing(pt, ring) {
  // Ray casting (even-odd).
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Douglas–Peucker sadeleştirme. CNC dosya boyutunu makul tutar.
 */
export function simplify(points, tolerance, closed = false) {
  if (points.length < 3 || tolerance <= 0) return points.slice();
  const pts = closed ? points.concat([points[0]]) : points;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = -1;
    let index = -1;
    const [ax, ay] = pts[first];
    const [bx, by] = pts[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = pts[i];
      let d;
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  if (closed) out.pop();
  return out;
}

/**
 * Basit poligon ofseti (köşe açıortayı yöntemi).
 * Organik, dışbükey-ağırlıklı konturlar için yeterlidir; keskin iç köşelerde
 * kendini kesebileceğinden `dist` değeri parça boyutuna göre küçük tutulmalıdır.
 * Pozitif `dist` halkayı dışarı büyütür (CCW halkalar için).
 */
export function offsetRing(ring, dist) {
  if (Math.abs(dist) < 1e-9 || ring.length < 3) return ring.slice();
  const n = ring.length;
  const out = [];
  const MITER_LIMIT = 4;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];

    const n1 = normalOf(prev, cur);
    const n2 = normalOf(cur, next);
    if (!n1 || !n2) continue;

    let bx = n1[0] + n2[0];
    let by = n1[1] + n2[1];
    const blen = Math.hypot(bx, by);
    if (blen < 1e-9) {
      out.push([cur[0] + n1[0] * dist, cur[1] + n1[1] * dist]);
      continue;
    }
    bx /= blen;
    by /= blen;
    const cosHalf = bx * n1[0] + by * n1[1];
    let scale = 1 / Math.max(cosHalf, 1e-6);
    if (scale > MITER_LIMIT) scale = MITER_LIMIT;
    out.push([cur[0] + bx * dist * scale, cur[1] + by * dist * scale]);
  }
  return out;
}

function normalOf(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return null;
  // CCW halkada dışa bakan normal: (dy, -dx)
  return [dy / len, -dx / len];
}

/**
 * Halkaları dış/iç (delik) olarak sınıflandırır ve yönlerini düzeltir.
 * Dış halkalar CCW, delikler CW olur.
 */
export function classifyRings(rings) {
  const items = rings.map((ring) => ({ ring, area: Math.abs(signedArea(ring)), depth: 0 }));
  for (let i = 0; i < items.length; i++) {
    const probe = interiorPoint(items[i].ring);
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (items[j].area <= items[i].area) continue;
      if (pointInRing(probe, items[j].ring)) items[i].depth++;
    }
  }
  return items.map((it) => {
    const hole = it.depth % 2 === 1;
    return { ring: ensureOrientation(it.ring, !hole), hole, area: it.area };
  });
}

function interiorPoint(ring) {
  // Halkanın üzerindeki bir kenarın orta noktası yeterince iyi bir temsilcidir
  // (içerik testi büyük halkalara karşı yapıldığı için sınır hassasiyeti kritik değil).
  const a = ring[0];
  const b = ring[Math.floor(ring.length / 2)];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
