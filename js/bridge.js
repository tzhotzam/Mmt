// KÖPRÜ — aynı dilimde birbirine çok yakın iki adayı ince bir şeritle tek
// parça yapar.
//
// Aralıklı dilimde komşu dilime yapıştırılamayan kopuk bir ada (tampon
// köşesi, ayna) ne kızağa ne mile ulaşıyorsa havada kalır. Çoğu zaman aynı
// dilimin ana parçasından yalnızca birkaç mm uzaktadır; oraya kanat
// kalınlığında bir köprü koymak, parçayı tutmanın en temiz yoludur —
// tezgâhta tek parça kesilir, montajda ayrıca bir şey gerekmez.

import { signedArea } from './geom.js';

function uzunluk(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

function konum(ring, i, t) {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** Sınır boyunca (i, t) noktasından `d` mm yürür (eksi: geriye). */
function yuru(ring, i, t, d) {
  const n = ring.length;
  for (let g = 0; g < 2 * n + 2; g++) {
    const L = uzunluk(ring[i], ring[(i + 1) % n]) || 1e-12;
    if (d >= 0) {
      const kalan = L * (1 - t);
      if (d <= kalan) return { i, t: t + d / L };
      d -= kalan; i = (i + 1) % n; t = 0;
    } else {
      const kalan = L * t;
      if (-d <= kalan) return { i, t: t + d / L };
      d += kalan; i = (i - 1 + n) % n; t = 1;
    }
  }
  return { i, t };
}

/** p noktasının [a, b] parçasına en yakın noktası: { t, d }. */
function izdusum(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return { t, d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) };
}

/** İki halka arasındaki en kısa bağlantı: { d, ia, ta, ib, tb }. */
export function enYakin(A, B) {
  let best = { d: Infinity };
  const tara = (P, Q, ters) => {
    for (let k = 0; k < P.length; k++) {
      for (let j = 0; j < Q.length; j++) {
        const r = izdusum(P[k], Q[j], Q[(j + 1) % Q.length]);
        if (r.d < best.d) {
          best = ters
            ? { d: r.d, ia: j, ta: r.t, ib: k, tb: 0 }
            : { d: r.d, ia: k, ta: 0, ib: j, tb: r.t };
        }
      }
    }
  };
  tara(A, B, false);
  tara(B, A, true);
  return best;
}

function kesisir(p1, p2, q1, q2) {
  const c = (a, b, o) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = c(q1, q2, p1), d2 = c(q1, q2, p2), d3 = c(p1, p2, q1), d4 = c(p1, p2, q2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) &&
    Math.abs(d1) > 1e-9 && Math.abs(d2) > 1e-9 && Math.abs(d3) > 1e-9 && Math.abs(d4) > 1e-9;
}

/**
 * A ve B dış halkalarını `genislik` mm'lik köprüyle birleştirir. İkisi de
 * CCW kabul edilir (değilse çevrilir). Köprü kenarları halkaları kesiyorsa
 * ya da boy `enUzun`u aşıyorsa null.
 */
export function kopruKur(A, B, genislik, enUzun) {
  if (signedArea(A) < 0) A = A.slice().reverse();
  if (signedArea(B) < 0) B = B.slice().reverse();
  const y = enYakin(A, B);
  if (!(y.d <= enUzun)) return null;
  const nA = A.length, nB = B.length;
  const a1 = yuru(A, y.ia, y.ta, -genislik / 2), a2 = yuru(A, y.ia, y.ta, genislik / 2);
  const b1 = yuru(B, y.ib, y.tb, genislik / 2), b2 = yuru(B, y.ib, y.tb, -genislik / 2);
  const A1 = konum(A, a1.i, a1.t), A2 = konum(A, a2.i, a2.t);
  const B1 = konum(B, b1.i, b1.t), B2 = konum(B, b2.i, b2.t);

  // Köprü kenarları iki halkanın hiçbir kenarını kesmemeli.
  for (const [p, q] of [[A1, B1], [B2, A2]]) {
    for (const R of [A, B]) {
      for (let k = 0; k < R.length; k++) {
        if (kesisir(p, q, R[k], R[(k + 1) % R.length])) return null;
      }
    }
  }

  const out = [A2];
  let say = (a1.i - a2.i + nA) % nA;
  if (say === 0 && a1.t <= a2.t) say = nA;
  for (let j = 0; j < say; j++) out.push(A[(a2.i + 1 + j) % nA]);
  out.push(A1, B1);
  let sayB = (b2.i - b1.i + nB) % nB;
  if (sayB === 0 && b2.t <= b1.t) sayB = nB;
  for (let j = 0; j < sayB; j++) out.push(B[(b1.i + 1 + j) % nB]);
  out.push(B2);

  // Sağlama: birleşik alan ikisinin toplamından küçük olamaz.
  if (signedArea(out) < signedArea(A) + signedArea(B) - 1e-6) return null;
  return out;
}
