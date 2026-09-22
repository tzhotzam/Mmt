// AĞ SADELEŞTİRME (mesh decimation) — kenar çökertme + karesel hata ölçütü.
//
// Neden gerekli: poligonal kabuk modu DÜZ yüzeyler ister. Yapay zekâ ile
// üretilen ya da taranan modeller adında "low poly" yazsa bile ince
// bölünmüş EĞRİ yüzeylerdir; ölçüldü — örnek bir modelde 16.126 üçgenin
// komşuluk açılarının yalnızca %14'ü 1°'nin altında, yani düz. Böyle bir ağda
// birleştirilecek düz yüzey yoktur: her üçgen ayrı faset olur, binlerce
// parça çıkar ve iş yapılamaz.
//
// Çözüm, ağı GERÇEKTEN azaltmaktır: kenarları tek tek çökerterek üçgen
// sayısını hedefe indirmek. Hangi kenarın çökeceğini karesel hata ölçütü
// (Garland & Heckbert) seçer: her köşe, kendisine dokunan yüzeylerin
// düzlemlerine olan uzaklığının karelerini toplayan bir Q matrisi taşır;
// bir kenarı çökertmenin bedeli, yeni köşenin bu toplam matristeki
// değeridir. Ucuz kenarlar düz bölgelerde, pahalı olanlar keskin
// kenarlardadır — yani biçimi taşıyan hatlar en sona kalır.
//
// Q simetrik 4x4'tür, 10 katsayıyla saklanır:
//   [0 1 2 3]
//   [1 4 5 6]
//   [2 5 7 8]
//   [3 6 8 9]

/** v^T Q v */
function quadricError(q, x, y, z) {
  return (
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x
    + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y
    + q[7] * z * z + 2 * q[8] * z
    + q[9]
  );
}

function addPlaneQuadric(q, a, b, c, d) {
  q[0] += a * a; q[1] += a * b; q[2] += a * c; q[3] += a * d;
  q[4] += b * b; q[5] += b * c; q[6] += b * d;
  q[7] += c * c; q[8] += c * d;
  q[9] += d * d;
}

/**
 * Q'nun gradyanını sıfırlayan nokta: üst sol 3x3 blok A ve b = -(q3,q6,q8)
 * için A·x = b. Cramer kuralıyla çözülür; determinant küçükse (düz bölge,
 * sistem kötü koşullu) null döner ve çağıran yedek adaylara düşer.
 */
function optimalPoint(q) {
  const a = q[0], b = q[1], c = q[2];
  const d = q[4], e = q[5];
  const f = q[7];
  const r0 = -q[3], r1 = -q[6], r2 = -q[8];
  const det = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c);
  // Ölçekten bağımsız eşik: matrisin kendi büyüklüğüne göre.
  const olcek = Math.abs(a) + Math.abs(d) + Math.abs(f);
  if (!(Math.abs(det) > 1e-10 * olcek * olcek * olcek)) return null;
  const x = (r0 * (d * f - e * e) - b * (r1 * f - e * r2) + c * (r1 * e - d * r2)) / det;
  const y = (a * (r1 * f - e * r2) - r0 * (b * f - e * c) + c * (b * r2 - r1 * c)) / det;
  const z = (a * (d * r2 - r1 * e) - b * (b * r2 - r1 * c) + r0 * (b * e - d * c)) / det;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

/** p noktasının [a,b] doğru parçasına uzaklığı. */
function segmenteUzaklik(p, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-30 ? ((p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy), p[2] - (az + t * dz));
}

/** En küçük elemanı üstte tutan ikili yığın (lazy silme ile). */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Üçgenin en küçük iç açısı (radyan). Kıymık üçgende sıfıra yaklaşır. */
function enKucukAci(P, f) {
  const [a, b, c] = f;
  const kenar = (i, j) => Math.hypot(
    P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]
  );
  const ab = kenar(a, b), bc = kenar(b, c), ca = kenar(c, a);
  if (ab < 1e-20 || bc < 1e-20 || ca < 1e-20) return 0;
  // Kosinüs teoremi; en kısa kenarın karşısındaki açı en küçüktür.
  const aci = (x, y, z) => Math.acos(Math.max(-1, Math.min(1, (y * y + z * z - x * x) / (2 * y * z))));
  return Math.min(aci(bc, ab, ca), aci(ca, ab, bc), aci(ab, bc, ca));
}

function faceNormal(P, f) {
  const [a, b, c] = f;
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * Üçgen listesini hedef yüzey sayısına indirir.
 *
 * @param {Array} tris [[x,y,z],[x,y,z],[x,y,z]] üçgenler
 * @param {number} targetFaces hedef üçgen sayısı
 * @param {object} opts { weld: köşe kaynaklama toleransı (model ölçüsüne oran) }
 * @returns {{tris: Array, before: number, after: number, collapsed: number}}
 */
export function decimate(tris, targetFaces, opts = {}) {
  const before = tris.length;
  // Kıymık eşiği. Hedefe ulaşmak için bu eşik yüzünden reddedilen çökertme
  // çoksa sadeleştirme hedefin biraz üstünde durur — bozuk üçgen üretmekten
  // iyidir; kaç üçgende durduğu sonuçta döner.
  const minAci = ((opts.minAngleDeg ?? 4) * Math.PI) / 180;
  if (!(targetFaces > 0) || before <= targetFaces) {
    return { tris, before, after: before, collapsed: 0 };
  }

  // ---- Köşeleri kaynakla (OBJ/STL'de aynı nokta defalarca geçer) --------
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const p of t) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
    }
  }
  const olcek = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const tol = (opts.weld ?? 1e-6) * olcek;
  const anahtar = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)},${Math.round(p[2] / tol)}`;

  // Modelin kutusu, %2 paylı. En iyi nokta bunun dışına düşemez.
  const pay = olcek * 0.02;
  const icerde = (p) =>
    p[0] >= minX - pay && p[0] <= maxX + pay &&
    p[1] >= minY - pay && p[1] <= maxY + pay &&
    p[2] >= minZ - pay && p[2] <= maxZ + pay;

  const indexOf = new Map();
  const pos = [];
  const faces = [];
  for (const t of tris) {
    const idx = t.map((p) => {
      const k = anahtar(p);
      let i = indexOf.get(k);
      if (i === undefined) { i = pos.length / 3; indexOf.set(k, i); pos.push(p[0], p[1], p[2]); }
      return i;
    });
    // Dejenere üçgenleri (iki köşesi aynı) al­ma.
    if (idx[0] !== idx[1] && idx[1] !== idx[2] && idx[0] !== idx[2]) faces.push(idx);
  }
  const P = Float64Array.from(pos);
  const vn = P.length / 3;

  // ---- Köşe quadric'leri -------------------------------------------------
  const Q = new Float64Array(vn * 10);
  const vFaces = Array.from({ length: vn }, () => []);
  faces.forEach((f, fi) => {
    const n = faceNormal(P, f);
    const L = Math.hypot(n[0], n[1], n[2]);
    if (L > 1e-20) {
      const a = n[0] / L, b = n[1] / L, c = n[2] / L;
      const d = -(a * P[f[0] * 3] + b * P[f[0] * 3 + 1] + c * P[f[0] * 3 + 2]);
      for (const v of f) addPlaneQuadric(Q.subarray(v * 10, v * 10 + 10), a, b, c, d);
    }
    for (const v of f) vFaces[v].push(fi);
  });

  const alive = new Uint8Array(faces.length).fill(1);
  const vAlive = new Uint8Array(vn).fill(1);
  // Köşe birleştikçe takip: birleşen köşe hangi köşeye gitti?
  const yerine = new Int32Array(vn);
  for (let i = 0; i < vn; i++) yerine[i] = i;
  const kok = (i) => { while (yerine[i] !== i) { yerine[i] = yerine[yerine[i]]; i = yerine[i]; } return i; };

  // ---- Kenarları topla ---------------------------------------------------
  const heap = new Heap();
  const surum = new Int32Array(vn);       // köşe her değiştiğinde artar
  const kenarEkle = (u, v) => {
    if (u === v) return;
    const qs = new Float64Array(10);
    for (let i = 0; i < 10; i++) qs[i] = Q[u * 10 + i] + Q[v * 10 + i];
    // Aday konumlar: iki uç, orta nokta ve QUADRIC'İN EN İYİ NOKTASI.
    //
    // En iyi nokta atlanırsa heykel BÜZÜLÜR: dışbükey bir yüzeyde kirişin
    // orta noktası yüzeyin içinde kalır ve binlerce çökertmede bu birikir.
    // Ölçüldü — yalnızca uç/orta noktayla 400 üçgende hacim %45 kayboluyordu.
    // En iyi nokta Q'nun gradyanını sıfırlayan noktadır (3x3 doğrusal sistem);
    // eğri bir bölgede yüzeyin ÜSTÜNE düşer ve büzülmeyi dengeler.
    const ux = P[u * 3], uy = P[u * 3 + 1], uz = P[u * 3 + 2];
    const wx = P[v * 3], wy = P[v * 3 + 1], wz = P[v * 3 + 2];
    const adaylar = [
      [ux, uy, uz],
      [wx, wy, wz],
      [(ux + wx) / 2, (uy + wy) / 2, (uz + wz) / 2],
    ];
    const opt = optimalPoint(qs);
    if (opt && icerde(opt) && segmenteUzaklik(opt, ux, uy, uz, wx, wy, wz) <= 0.5 * Math.hypot(wx - ux, wy - uy, wz - uz)) {
      // İki sınır birden:
      //  - Nokta kenar segmentinden en fazla yarım kenar boyu uzakta olmalı.
      //    Eskiden "orta noktadan 2 kenar boyu" idi; kenarlar uzadıkça izin
      //    de büyüyor, köşe her çökertmede biraz daha dışarı itiliyordu —
      //    200 üçgende bir köşe model boyunun milyonlarca katı uzağa kaçtı.
      //  - Modelin kutusunun dışına hiç çıkamaz. Son emniyet; kaçak artık
      //    imkânsız.
      adaylar.push(opt);
    }
    let enIyi = adaylar[2];
    let enUcuz = Infinity;
    for (const c of adaylar) {
      const e = quadricError(qs, c[0], c[1], c[2]);
      if (e < enUcuz) { enUcuz = e; enIyi = c; }
    }
    heap.push({ u, v, cost: enUcuz, pos: enIyi, su: surum[u], sv: surum[v] });
  };

  const gorulen = new Set();
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (gorulen.has(key)) continue;
      gorulen.add(key);
      kenarEkle(a, b);
    }
  }

  // ---- Çökert -------------------------------------------------------------
  let yasayanYuz = faces.length;
  let collapsed = 0;

  /** Köşenin yaşayan yüzeylerinden komşu köşe kümesi. */
  const komsular = (x) => {
    const s = new Set();
    for (const fi of vFaces[x]) {
      if (!alive[fi]) continue;
      for (const y of faces[fi]) { const k = kok(y); if (k !== x) s.add(k); }
    }
    return s;
  };

  while (yasayanYuz > targetFaces && heap.size) {
    const e = heap.pop();
    const u = kok(e.u), v = kok(e.v);
    if (u === v || !vAlive[u] || !vAlive[v]) continue;
    // Bayat kayıt: köşelerden biri bu kayıt kuyruğa girdikten sonra değişti.
    if (e.su !== surum[e.u] || e.sv !== surum[e.v]) continue;

    // BAĞLANTI KOŞULU (link condition). Bu kontrol olmadan çökertme ağı
    // manifold olmaktan çıkarıyordu: örnek modelde açık kenar 6'dan 28'e
    // fırlıyor, hacim %72 sapıyordu. Kural şu — u ve v'nin ORTAK komşuları,
    // tam olarak (u,v) kenarını paylaşan yüzeylerin karşı köşeleri olmalı.
    // Fazladan bir ortak komşu varsa çökertme yüzeyde delik açar ya da
    // birbirine değmeyen iki bölgeyi yapıştırır.
    const ku = komsular(u);
    const kv = komsular(v);
    let ortak = 0;
    for (const x of ku) if (kv.has(x)) ortak++;
    let kenarYuzu = 0;
    for (const fi of vFaces[u]) {
      if (!alive[fi]) continue;
      const f = faces[fi].map(kok);
      if (f.includes(u) && f.includes(v)) kenarYuzu++;
    }
    if (ortak !== kenarYuzu) continue;
    if (kenarYuzu !== 2) continue;      // sınır/kenar kenarına dokunma

    // Yüzey ters dönüyor mu? Dönerse ağ kendini keser; o çökertmeyi atla.
    const yedek = [P[u * 3], P[u * 3 + 1], P[u * 3 + 2]];
    let ters = false;
    for (const fi of vFaces[u].concat(vFaces[v])) {
      if (!alive[fi]) continue;
      const f = faces[fi].map(kok);
      if (f.includes(u) && f.includes(v)) continue;      // zaten yok olacak
      const eski = faceNormal(P, f);
      const eskiKalite = enKucukAci(P, f);
      P[u * 3] = e.pos[0]; P[u * 3 + 1] = e.pos[1]; P[u * 3 + 2] = e.pos[2];
      const f2 = f.map((x) => (x === v ? u : x));
      const n2 = faceNormal(P, f2);
      const kalite = enKucukAci(P, f2);
      P[u * 3] = yedek[0]; P[u * 3 + 1] = yedek[1]; P[u * 3 + 2] = yedek[2];
      if (eski[0] * n2[0] + eski[1] * n2[1] + eski[2] * n2[2] <= 0) { ters = true; break; }
      // KIYMIK OLUŞTURAN çökertmeyi reddet — ama yalnızca kaliteyi
      // KÖTÜLEŞTİRİYORSA. Eşik altındaki her üçgeni reddetmek sadeleştirmeyi
      // kilitliyordu: modelin kendisinde zaten kıymıklar var ve onlara
      // dokunan her çökertme reddedilince işlem hedef ne olursa olsun ~580
      // üçgende takılıyordu. Mevcut bir kıymığı iyileştiren ya da ortadan
      // kaldıran çökertme serbest.
      if (kalite < minAci && kalite < eskiKalite) { ters = true; break; }
    }
    if (ters) continue;

    // v -> u. Konumu yeni noktaya taşı.
    P[u * 3] = e.pos[0]; P[u * 3 + 1] = e.pos[1]; P[u * 3 + 2] = e.pos[2];
    for (let i = 0; i < 10; i++) Q[u * 10 + i] += Q[v * 10 + i];
    yerine[v] = u;
    vAlive[v] = 0;
    surum[u]++;
    collapsed++;

    // Bu kenarı paylaşan yüzeyler yok olur.
    const yeniYuzler = [];
    for (const fi of vFaces[u].concat(vFaces[v])) {
      if (!alive[fi]) continue;
      const f = faces[fi].map(kok);
      if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) { alive[fi] = 0; yasayanYuz--; continue; }
      yeniYuzler.push(fi);
    }
    vFaces[u] = yeniYuzler;
    vFaces[v] = [];

    // Komşu kenarları yeniden fiyatlandır.
    for (const fi of yeniYuzler) {
      const f = faces[fi].map(kok);
      for (const x of f) if (x !== u) kenarEkle(u, x);
    }
  }

  // ---- Sonucu topla ------------------------------------------------------
  const out = [];
  for (let fi = 0; fi < faces.length; fi++) {
    if (!alive[fi]) continue;
    const f = faces[fi].map(kok);
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) continue;
    out.push(f.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]));
  }
  return { tris: out, before, after: out.length, collapsed };
}
