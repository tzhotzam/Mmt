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

function addPlaneQuadric(q, a, b, c, d, w = 1) {
  q[0] += w * a * a; q[1] += w * a * b; q[2] += w * a * c; q[3] += w * a * d;
  q[4] += w * b * b; q[5] += w * b * c; q[6] += w * b * d;
  q[7] += w * c * c; q[8] += w * c * d;
  q[9] += w * d * d;
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

/**
 * Kenar kuyruğu: en ucuz çökertmeyi üstte tutan ikili yığın (lazy silme).
 *
 * Kayıtlar nesne değil, tipli dizilerde tutulur; boşalan yuvalar yeniden
 * kullanılır. Nesneli ilk sürümde 100 bin üçgenlik bir ağı sadeleştirmenin
 * yarısı kuyrukta ve çöp toplamada geçiyordu (yarım milyonu aşkın kayıt).
 */
class EdgeHeap {
  constructor(cap = 1024) {
    this.n = 0;              // yığındaki kayıt sayısı
    this.cap = 0;
    this.bos = [];           // yeniden kullanılabilir yuvalar
    this.sonYuva = 0;
    this.buyut(cap);
  }
  buyut(cap) {
    const eski = this;
    const yeni = (Tip, k, dizi) => { const a = new Tip(cap * k); if (dizi) a.set(dizi); return a; };
    this.cost = yeni(Float64Array, 1, eski.cost);
    this.pos = yeni(Float64Array, 3, eski.pos);
    this.uv = yeni(Int32Array, 4, eski.uv);   // u, v, su, sv
    this.yigin = yeni(Int32Array, 1, eski.yigin);
    this.cap = cap;
  }
  get size() { return this.n; }
  push(u, v, cost, x, y, z, su, sv) {
    let k;
    if (this.bos.length) k = this.bos.pop();
    else {
      if (this.sonYuva >= this.cap) this.buyut(this.cap * 2);
      k = this.sonYuva++;
    }
    this.cost[k] = cost;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.uv[k * 4] = u; this.uv[k * 4 + 1] = v; this.uv[k * 4 + 2] = su; this.uv[k * 4 + 3] = sv;
    const a = this.yigin, c = this.cost;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[a[p]] <= cost) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = k;
  }
  /** En ucuz kaydın yuvasını döndürür; çağıran işi bitince free() etmeli. */
  pop() {
    if (!this.n) return -1;
    const a = this.yigin, c = this.cost;
    const top = a[0];
    const last = a[--this.n];
    const n = this.n;
    if (n) {
      const lc = c[last];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && c[a[r]] < c[a[l]] ? r : l;
        if (c[a[m]] >= lc) break;
        a[i] = a[m];
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
  free(k) { this.bos.push(k); }
}

/** Üçgenin en küçük iç açısı (radyan). Kıymık üçgende sıfıra yaklaşır. */
function enKucukAci(P, f) {
  const a = f[0] * 3, b = f[1] * 3, c = f[2] * 3;
  const kare = (i, j) => {
    const dx = P[j] - P[i], dy = P[j + 1] - P[i + 1], dz = P[j + 2] - P[i + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const ab = kare(a, b), bc = kare(b, c), ca = kare(c, a);
  if (ab < 1e-40 || bc < 1e-40 || ca < 1e-40) return 0;
  // Kosinüs teoremi; en kısa kenarın karşısındaki açı en küçüktür, yalnızca
  // o hesaplanır.
  let x = ab, y = bc, z = ca;
  if (bc < x) { x = bc; y = ab; z = ca; }
  if (ca < x) { x = ca; y = ab; z = bc; }
  return Math.acos(Math.max(-1, Math.min(1, (y + z - x) / (2 * Math.sqrt(y * z)))));
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
  // Aynı köşe NESNESİ birden çok üçgende geçiyorsa (hacimden yeniden
  // kurulan ağlar böyle gelir) metin anahtarı hiç kurulmaz; 120 bin
  // üçgende kaynaklama süresinin çoğu anahtar metinlerini üretmekti.
  const nesne = new Map();
  for (const t of tris) {
    const idx = t.map((p) => {
      let i = nesne.get(p);
      if (i !== undefined) return i;
      const k = anahtar(p);
      i = indexOf.get(k);
      if (i === undefined) { i = pos.length / 3; indexOf.set(k, i); pos.push(p[0], p[1], p[2]); }
      nesne.set(p, i);
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
      // ALAN AĞIRLIĞI: her düzlem, üçgenin alanı kadar sayılır. Ağırlıksız
      // hâlde sık bölünmüş bölgeler (çok sayıda küçük üçgen) aynı yüzeyi
      // defalarca oylayıp aşırı pahalı görünüyor, seyrek bölgeler ucuz
      // kalıp önce eriyordu. Hacimden kurulan ağlarda üçgen boyu çok
      // düzensizdir; ağırlıksız sadeleştirme gövdeyi yassılttı.
      const w = L / 2;
      for (const v of f) addPlaneQuadric(Q.subarray(v * 10, v * 10 + 10), a, b, c, d, w);
    }
    for (const v of f) vFaces[v].push(fi);
  });

  const alive = new Uint8Array(faces.length).fill(1);
  const olcek2 = olcek * olcek;
  const vAlive = new Uint8Array(vn).fill(1);
  // Köşe birleştikçe takip: birleşen köşe hangi köşeye gitti?
  const yerine = new Int32Array(vn);
  for (let i = 0; i < vn; i++) yerine[i] = i;
  const kok = (i) => { while (yerine[i] !== i) { yerine[i] = yerine[yerine[i]]; i = yerine[i]; } return i; };

  // ---- Kenarları topla ---------------------------------------------------
  const heap = new EdgeHeap(Math.max(1024, faces.length * 2));
  const surum = new Int32Array(vn);       // köşe her değiştiğinde artar
  const qs = new Float64Array(10);        // tekrar kullanılan çalışma alanı
  const kenarEkle = (u, v) => {
    if (u === v) return;
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
    let bx = (ux + wx) / 2, by = (uy + wy) / 2, bz = (uz + wz) / 2;
    let enUcuz = quadricError(qs, bx, by, bz);
    let e = quadricError(qs, ux, uy, uz);
    if (e < enUcuz) { enUcuz = e; bx = ux; by = uy; bz = uz; }
    e = quadricError(qs, wx, wy, wz);
    if (e < enUcuz) { enUcuz = e; bx = wx; by = wy; bz = wz; }
    const opt = optimalPoint(qs);
    if (opt && icerde(opt) && segmenteUzaklik(opt, ux, uy, uz, wx, wy, wz) <= 0.5 * Math.hypot(wx - ux, wy - uy, wz - uz)) {
      // İki sınır birden:
      //  - Nokta kenar segmentinden en fazla yarım kenar boyu uzakta olmalı.
      //    Eskiden "orta noktadan 2 kenar boyu" idi; kenarlar uzadıkça izin
      //    de büyüyor, köşe her çökertmede biraz daha dışarı itiliyordu —
      //    200 üçgende bir köşe model boyunun milyonlarca katı uzağa kaçtı.
      //  - Modelin kutusunun dışına hiç çıkamaz. Son emniyet; kaçak artık
      //    imkânsız.
      e = quadricError(qs, opt[0], opt[1], opt[2]);
      if (e < enUcuz) { enUcuz = e; bx = opt[0]; by = opt[1]; bz = opt[2]; }
    }
    heap.push(u, v, enUcuz, bx, by, bz, surum[u], surum[v]);
  };

  /** Yaşayan bütün kenarları kuyruğa koy. */
  const kenarlariTopla = () => {
    const gorulen = new Set();
    for (let fi = 0; fi < faces.length; fi++) {
      if (!alive[fi]) continue;
      const f = faces[fi].map(kok);
      for (let k = 0; k < 3; k++) {
        const a = f[k], b = f[(k + 1) % 3];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (gorulen.has(key)) continue;
        gorulen.add(key);
        kenarEkle(a, b);
      }
    }
  };

  // ---- Çökert -------------------------------------------------------------
  let yasayanYuz = faces.length;
  let collapsed = 0;
  const red = { sinir: 0, bag: 0, ters: 0, kiymik: 0 };

  // Komşu kümeleri Set yerine damga dizileriyle tutulur: her çökertme
  // denemesinde iki Set kurmak, büyük ağlarda süreyi ve çöp toplamayı
  // belirgin biçimde artırıyordu.
  const damgaU = new Int32Array(vn);
  const damgaV = new Int32Array(vn);
  let damga = 0;
  /** u ile v'nin ortak komşu sayısı (u ve v hariç). */
  const ortakKomsu = (u, v) => {
    damga++;
    for (const fi of vFaces[u]) {
      if (!alive[fi]) continue;
      for (const y of faces[fi]) { const k = kok(y); if (k !== u) damgaU[k] = damga; }
    }
    let ortak = 0;
    for (const fi of vFaces[v]) {
      if (!alive[fi]) continue;
      for (const y of faces[fi]) {
        const k = kok(y);
        if (k === v || damgaV[k] === damga) continue;
        damgaV[k] = damga;
        if (damgaU[k] === damga) ortak++;
      }
    }
    return ortak;
  };

  // KADEMELİ GEVŞETME. Reddedilen bir kenar, komşusu değişmedikçe kuyruğa
  // geri girmez; kıymık eşiği sıkıysa kuyruk hedefe varmadan boşalır.
  // Ölçüldü — hacimden yeniden kurulan (voxel remesh) at modelinde işlem
  // 300 hedefinde 878 üçgende duruyordu, reddedilenlerin %70'i kıymık
  // yüzündendi. Kuyruk boşalınca eşik yarıya indirilip bütün kenarlar
  // yeniden fiyatlanır; 0.5°'nin altında eşik tamamen kalkar. Önce kaliteli
  // çökertmeler yapıldığı için kıymık yalnızca gerçekten gerektiği kadar
  // oluşur. Ters dönme ve bağlantı koşulu ASLA gevşetilmez: onlar ağı
  // bozar, kıymık yalnızca çirkindir.
  let esik = minAci;
  kenarlariTopla();
  while (yasayanYuz > targetFaces) {
    if (!heap.size) {
      if (esik === 0) break;
      esik = esik > (0.5 * Math.PI) / 180 ? esik / 2 : 0;
      kenarlariTopla();
      continue;
    }
    const k = heap.pop();
    const eu = heap.uv[k * 4], ev = heap.uv[k * 4 + 1];
    const taze = heap.uv[k * 4 + 2] === surum[eu] && heap.uv[k * 4 + 3] === surum[ev];
    const e = taze ? { pos: [heap.pos[k * 3], heap.pos[k * 3 + 1], heap.pos[k * 3 + 2]] } : null;
    heap.free(k);
    // Bayat kayıt: köşelerden biri bu kayıt kuyruğa girdikten sonra değişti.
    if (!taze) continue;
    const u = kok(eu), v = kok(ev);
    if (u === v || !vAlive[u] || !vAlive[v]) continue;

    // BAĞLANTI KOŞULU (link condition). Bu kontrol olmadan çökertme ağı
    // manifold olmaktan çıkarıyordu: örnek modelde açık kenar 6'dan 28'e
    // fırlıyor, hacim %72 sapıyordu. Kural şu — u ve v'nin ORTAK komşuları,
    // tam olarak (u,v) kenarını paylaşan yüzeylerin karşı köşeleri olmalı.
    // Fazladan bir ortak komşu varsa çökertme yüzeyde delik açar ya da
    // birbirine değmeyen iki bölgeyi yapıştırır.
    const ortak = ortakKomsu(u, v);
    let kenarYuzu = 0;
    for (const fi of vFaces[u]) {
      if (!alive[fi]) continue;
      const f = faces[fi].map(kok);
      if (f.includes(u) && f.includes(v)) kenarYuzu++;
    }
    if (kenarYuzu !== 2) { red.sinir++; continue; }      // sınır/kenar kenarına dokunma
    if (ortak !== kenarYuzu) { red.bag++; continue; }

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
      // Neredeyse sıfır alanlı eski yüzeyin normali anlamsızdır; onunla
      // kıyaslamak her çökertmeyi rastgele reddeder. O yüzey atlanır.
      const eskiL = Math.hypot(eski[0], eski[1], eski[2]);
      if (eskiL > 1e-14 * olcek2 && eski[0] * n2[0] + eski[1] * n2[1] + eski[2] * n2[2] <= 0) { ters = 'ters'; break; }
      // KIYMIK OLUŞTURAN çökertmeyi reddet — ama yalnızca kaliteyi
      // KÖTÜLEŞTİRİYORSA. Eşik altındaki her üçgeni reddetmek sadeleştirmeyi
      // kilitliyordu: modelin kendisinde zaten kıymıklar var ve onlara
      // dokunan her çökertme reddedilince işlem hedef ne olursa olsun ~580
      // üçgende takılıyordu. Mevcut bir kıymığı iyileştiren ya da ortadan
      // kaldıran çökertme serbest.
      if (kalite < esik && kalite < eskiKalite) { ters = 'kiymik'; break; }
    }
    if (ters) { red[ters]++; continue; }

    // v -> u. Konumu yeni noktaya taşı.
    P[u * 3] = e.pos[0]; P[u * 3 + 1] = e.pos[1]; P[u * 3 + 2] = e.pos[2];
    for (let i = 0; i < 10; i++) Q[u * 10 + i] += Q[v * 10 + i];
    yerine[v] = u;
    vAlive[v] = 0;
    // İKİ köşenin de sürümü artar. Yalnızca u artınca v'yi içeren eski
    // kayıtlar (v,x) kok() ile (u,x)'e dönüp "taze" görünüyordu; konumu ve
    // bedeli artık var olmayan bir kenar için hesaplanmıştı, köşe yanlış
    // yere sıçrıyordu.
    surum[u]++;
    surum[v]++;
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
  return { tris: out, before, after: out.length, collapsed, rejected: red };
}
