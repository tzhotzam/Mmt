// STL (3D model) girişi → yükseklik haritası.
//
// Model tepeden ortografik olarak "z-buffer" ile taranır: her ızgara
// hücresinde en yüksek Z değeri tutulur. Bu, kabartma panel için doğru
// yaklaşımdır — panel zaten tek yönden bakılan bir rölyeftir.

/**
 * ASCII veya binary STL ayrıştırır.
 * @param {ArrayBuffer} buffer
 * @returns {Array<Array<[number,number,number]>>} üçgenler
 */
export function parseStl(buffer) {
  const bytes = new Uint8Array(buffer);
  if (isBinaryStl(bytes)) return parseBinaryStl(buffer);
  return parseAsciiStl(new TextDecoder().decode(bytes));
}

function isBinaryStl(bytes) {
  if (bytes.length < 84) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(80, true);
  if (84 + count * 50 === bytes.length) return true;
  // Boyut uymuyorsa "solid" başlığına bak. Başlık da yoksa ikili sayılır,
  // ama o durumda üçgen sayısına güvenilmez — parseBinaryStl kırpar.
  const head = String.fromCharCode(...bytes.subarray(0, 5)).toLowerCase();
  return head !== 'solid';
}

function parseBinaryStl(buffer) {
  const dv = new DataView(buffer);
  // Bildirilen sayı, dosyada gerçekten yer olan üçgen sayısıyla sınırlanır.
  // STL olmayan bir dosya seçildiğinde 80. bayttan okunan değer rastgeledir
  // ve sınırsız güvenilirse arabellek dışına taşıp hata fırlatır.
  const declared = dv.getUint32(80, true);
  const fits = Math.max(0, Math.floor((buffer.byteLength - 84) / 50));
  const count = Math.min(declared, fits);
  const tris = [];
  for (let i = 0; i < count; i++) {
    const o = 84 + i * 50 + 12; // normal atlanır
    const v = [];
    for (let k = 0; k < 3; k++) {
      v.push([
        dv.getFloat32(o + k * 12, true),
        dv.getFloat32(o + k * 12 + 4, true),
        dv.getFloat32(o + k * 12 + 8, true),
      ]);
    }
    tris.push(v);
  }
  return tris;
}

function parseAsciiStl(text) {
  const tris = [];
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let m;
  let cur = [];
  while ((m = re.exec(text)) !== null) {
    cur.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
    if (cur.length === 3) {
      tris.push(cur);
      cur = [];
    }
  }
  return tris;
}

export function stlBounds(tris) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const [x, y, z] of t) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ, w: maxX - minX, h: maxY - minY, d: maxZ - minZ };
}

/**
 * Bakış eksenine göre üçgenleri döndürür.
 * 'z' tepeden, 'y' önden, 'x' yandan bakıştır.
 */
function orient(tris, axis) {
  if (axis === 'z') return tris;
  if (axis === 'y') return tris.map((t) => t.map(([x, y, z]) => [x, z, y]));
  return tris.map((t) => t.map(([x, y, z]) => [y, z, x]));
}

/** Bakış eksenine göre izdüşümün en/boy ölçüsü. */
export function projectedSize(tris, axis) {
  const b = stlBounds(orient(tris, axis));
  return { w: b.w, h: b.h, depth: b.d };
}

/**
 * Bir bakış yönünün ne kadar "bilgi" verdiğini ölçer.
 *
 * İki şeye bakılır:
 *  - SİLUET: izdüşüm dolu bir dikdörtgene ne kadar benziyor? Ayakta duran
 *    bir figüre tepeden bakınca sadece gövdenin dış hattı görünür ve çerçeve
 *    tamamen dolar — siluet hiçbir şey anlatmaz. Önden bakınca kol, bacak,
 *    baş arasındaki boşluklar çıkar.
 *  - DERİNLİK: kapsanan hücrelerdeki yükseklik değişkenliği, modelin genel
 *    boyutuna oranla. Model birimlerinde ölçülür; her ekseni kendi derinlik
 *    aralığına göre normalleştirmek sığ görünümleri haksız yere şişiriyordu.
 */
export function axisScore(tris, axis, res = 96) {
  const { w, h } = projectedSize(tris, axis);
  if (!(w > 0) || !(h > 0)) return 0;
  const cols = w >= h ? res : Math.max(8, Math.round(res * (w / h)));
  const rows = w >= h ? Math.max(8, Math.round(res * (h / w))) : res;
  const { data, covered } = heightmapWithCoverage(tris, cols, rows, { axis });

  const b = stlBounds(orient(tris, axis));
  const diag = Math.hypot(b.w, b.h, b.d) || 1;

  let n = 0, sum = 0, sum2 = 0;
  for (let i = 0; i < data.length; i++) {
    if (!covered[i]) continue;
    const z = data[i] * b.d;   // model birimine geri çevir
    n++;
    sum += z;
    sum2 += z * z;
  }
  if (n < 4) return 0;
  const mean = sum / n;
  const derinlik = Math.sqrt(Math.max(0, sum2 / n - mean * mean)) / diag;
  const coverage = n / data.length;
  const siluet = 1 - coverage;

  return siluet + derinlik;
}

/**
 * En uygun bakış eksenini seçer.
 *
 * Ana kural: modelin EN İNCE olduğu eksen boyunca bak. Nesneler hemen her
 * zaman önden arkaya incedir (insan, hayvan, figür, tabela), rölyef de
 * zaten yüze bakan bir şeydir. Bu kural hem ayakta duran figürlerde hem
 * zaten düz olan rölyeflerde doğru yönü verir.
 *
 * İki eksenin kalınlığı birbirine yakınsa (küpe benzer modeller) siluet ve
 * derinlik puanıyla eşitlik bozulur.
 */
export function pickBestAxis(tris) {
  const b = stlBounds(tris);
  const kalinlik = { z: b.d, y: b.h, x: b.w };
  const scores = {};
  for (const axis of ['z', 'y', 'x']) scores[axis] = axisScore(tris, axis);

  const sirali = ['z', 'y', 'x'].sort((p, q) => kalinlik[p] - kalinlik[q]);
  const enInce = sirali[0];
  const ikinci = sirali[1];

  // %20'den fazla farklıysa incelik kararı verir; değilse puana bakılır.
  const belirgin = kalinlik[enInce] < kalinlik[ikinci] * 0.8;
  let axis = belirgin
    ? enInce
    : (scores[enInce] >= scores[ikinci] ? enInce : ikinci);
  // Baş ve büstte ön ile yan neredeyse eşit ince ve eşit puanlıdır (ölçülen
  // kadın başı: 0,425'e 0,434); kılpayı yan seçilince yüz profil çıkıyordu.
  // Başa baş durumda insanın beklediği ön kazanır.
  if (!belirgin && (enInce === 'y' || ikinci === 'y')) {
    const diger = enInce === 'y' ? ikinci : enInce;
    if (scores[diger] < scores.y * 1.1) axis = 'y';
  }

  return { axis, scores, thickness: kalinlik };
}

/**
 * Üçgenleri tarayıp 0..1 yükseklik haritası üretir; hangi hücrelerin model
 * tarafından kapsandığını da bildirir.
 */
export function heightmapWithCoverage(tris, cols, rows, opts = {}) {
  const axis = opts.axis || 'z';
  const t3 = orient(tris, axis);

  const b = stlBounds(t3);
  const data = new Float32Array(cols * rows).fill(-Infinity);
  if (!Number.isFinite(b.w) || b.w <= 0 || b.h <= 0) {
    return {
      w: cols, h: rows,
      data: new Float32Array(cols * rows),
      covered: new Uint8Array(cols * rows),
    };
  }

  const sx = (cols - 1) / b.w;
  const sy = (rows - 1) / b.h;

  for (const t of t3) {
    // Model koordinatlarını ızgara koordinatlarına taşı (gy=0 modelin üst kenarı).
    const p = t.map(([x, y, z]) => [(x - b.minX) * sx, (b.maxY - y) * sy, z]);
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const maxX = Math.min(cols - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const maxY = Math.min(rows - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));

    const d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
    if (Math.abs(d) < 1e-12) continue;

    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const l0 = ((p[1][1] - p[2][1]) * (gx - p[2][0]) + (p[2][0] - p[1][0]) * (gy - p[2][1])) / d;
        const l1 = ((p[2][1] - p[0][1]) * (gx - p[2][0]) + (p[0][0] - p[2][0]) * (gy - p[2][1])) / d;
        const l2 = 1 - l0 - l1;
        const E = -1e-6;
        if (l0 < E || l1 < E || l2 < E) continue;
        const z = l0 * p[0][2] + l1 * p[1][2] + l2 * p[2][2];
        const i = gy * cols + gx;
        if (z > data[i]) data[i] = z;
      }
    }
  }

  const zMin = b.minZ;
  const range = b.maxZ - b.minZ || 1;
  const covered = new Uint8Array(cols * rows);
  for (let i = 0; i < data.length; i++) {
    if (data[i] === -Infinity) {
      data[i] = 0;
    } else {
      covered[i] = 1;
      data[i] = (data[i] - zMin) / range;
    }
  }
  return { w: cols, h: rows, data, covered };
}

/** Kapsama maskesi gerekmeyen çağrılar için ince sarmalayıcı. */
export function heightmapFromStl(tris, cols, rows, opts = {}) {
  const { w, h, data } = heightmapWithCoverage(tris, cols, rows, opts);
  return { w, h, data };
}

/**
 * OBJ okuma. Tarama uygulamalarının (Polycam, Scaniverse) çoğu OBJ verir;
 * STL'e çevirmek için ayrı bir adım gerekmesin diye doğrudan destekleniyor.
 *
 * Sadece köşe (v) ve yüz (f) satırları okunur — doku, normal ve malzeme
 * bilgisi geometriyi etkilemediği için atlanır.
 */
export function parseObj(text) {
  const verts = [];
  const tris = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line[0] === '#') continue;
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const tag = line.slice(0, sp);

    if (tag === 'v') {
      const p = line.slice(sp + 1).trim().split(/\s+/);
      const x = parseFloat(p[0]), y = parseFloat(p[1]), z = parseFloat(p[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) verts.push([x, y, z]);
    } else if (tag === 'f') {
      const parts = line.slice(sp + 1).trim().split(/\s+/);
      const idx = [];
      for (const part of parts) {
        // "12", "12/3", "12/3/4", "12//4" biçimlerinin hepsi geçerli
        const n = parseInt(part.split('/')[0], 10);
        if (!Number.isFinite(n)) continue;
        // OBJ 1'den başlar; negatif indis sondan sayar.
        idx.push(n > 0 ? n - 1 : verts.length + n);
      }
      // Çokgen yüzler yelpaze biçiminde üçgenlenir.
      for (let i = 1; i + 1 < idx.length; i++) {
        const a = verts[idx[0]], b = verts[idx[i]], c = verts[idx[i + 1]];
        if (a && b && c) tris.push([a, b, c]);
      }
    }
  }
  return tris;
}

/**
 * "Y yukarı" ağı programın "Z yukarı" düzenine çevirir: (x, y, z) → (x, z, y).
 *
 * OBJ'de yerleşik düzen Y yukarı, ön +Z'dir (Blender'ın varsayılan OBJ
 * çıkışı, Meshy, tarama uygulamaları). Program ise Z'yi yukarı, "önden"
 * bakışı +Y'den sayar. Çevrilmezse "Tepeden" seçeneği yüzü, "Önden" seçeneği
 * başın tepesini gösteriyordu. Eksen değişimi aynalama olduğu için üçgenin
 * köşe sırası da çevrilir; yüzey yönü (normal) bozulmaz.
 */
export function yYukaridanZYukariya(tris) {
  const yeni = new Map();   // paylaşılan köşe bir kez çevrilir
  const cevir = (p) => {
    let q = yeni.get(p);
    if (!q) { q = [p[0], p[2], p[1]]; yeni.set(p, q); }
    return q;
  };
  return tris.map(([a, b, c]) => [cevir(a), cevir(c), cevir(b)]);
}

/** Yüklemede izin verilen en çok üçgen; üstü `seyrelt` ile indirilir. */
export const MAKS_UCGEN = 400000;

/**
 * Çok büyük ağı hızlıca seyreltir (köşe kümeleme): uzay eşit hücrelere
 * bölünür, aynı hücreye düşen köşeler ortalamalarında birleşir, çökmüş
 * üçgenler atılır.
 *
 * Neden: Blender'dan ya da taramadan gelen milyonlarca üçgenli OBJ sayfanın
 * belleğini aşıp programı çökertiyordu (2,5 milyon üçgen ölçüldü). Karesel
 * hatalı sadeleştirme (decimate.js) aynı ağda 40 sn ve 1,5 GB istiyor; bu
 * yöntem tek geçiştir. Panel ızgarası hücreden çok daha kaba olduğu için
 * kabartmada fark görünmez.
 *
 * Hücre boyu yüzey alanından seçilir (üçgen ≈ 2 × köşe ≈ 2 × alan / hücre²);
 * hedef aşılırsa hücre büyütülüp yeniden denenir.
 */
export function seyrelt(tris, hedef = MAKS_UCGEN) {
  if (tris.length <= hedef) return tris;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let alan = 0;
  for (const [a, b, c] of tris) {
    for (const p of [a, b, c]) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
    }
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    alan += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
  }
  let hucre = Math.sqrt((2 * alan) / hedef) || (maxX - minX) / 200;

  for (let deneme = 0; deneme < 6; deneme++, hucre *= 1.3) {
    const nx = Math.floor((maxX - minX) / hucre) + 1;
    const ny = Math.floor((maxY - minY) / hucre) + 1;
    const indis = new Map();
    const top = [];   // hücre başına [Σx, Σy, Σz, adet]
    const kume = (p) => {
      const k = Math.floor((p[0] - minX) / hucre)
        + nx * (Math.floor((p[1] - minY) / hucre) + ny * Math.floor((p[2] - minZ) / hucre));
      let i = indis.get(k);
      if (i === undefined) { i = top.length; indis.set(k, i); top.push([0, 0, 0, 0]); }
      return i;
    };
    const yuzler = [];
    const gorulen = new Set();
    for (const t of tris) {
      const ia = kume(t[0]), ib = kume(t[1]), ic = kume(t[2]);
      if (ia === ib || ib === ic || ia === ic) continue;
      // Aynı üç hücreyi birleştiren ikinci üçgen fazladır.
      const s = [ia, ib, ic].sort((x, y) => x - y);
      const anahtar = `${s[0]},${s[1]},${s[2]}`;
      if (gorulen.has(anahtar)) continue;
      gorulen.add(anahtar);
      yuzler.push(ia, ib, ic);
      for (let j = 0; j < 3; j++) {
        const q = top[[ia, ib, ic][j]], p = t[j];
        q[0] += p[0]; q[1] += p[1]; q[2] += p[2]; q[3]++;
      }
    }
    if (yuzler.length / 3 > hedef && deneme < 5) continue;
    const kose = top.map((q) => (q[3] ? [q[0] / q[3], q[1] / q[3], q[2] / q[3]] : null));
    const sonuc = [];
    for (let i = 0; i < yuzler.length; i += 3) {
      sonuc.push([kose[yuzler[i]], kose[yuzler[i + 1]], kose[yuzler[i + 2]]]);
    }
    return sonuc;
  }
  return tris;
}

/**
 * Okunan geometrinin anlamlı olup olmadığını denetler.
 *
 * STL olmayan bir dosya (fotoğraf, ZIP, rastgele bayt) ikili STL gibi
 * okunduğunda "başarıyla" çöp üçgenler üretir. Kullanıcının saçma bir model
 * yerine net bir hata görmesi için sonuç burada elenir.
 */
export function validateMesh(tris) {
  if (!tris.length) return { ok: false, reason: 'bos' };

  let bad = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const [x, y, z] of t) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { bad++; continue; }
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }

  // Sağlam bir modelde geçersiz köşe olmaz; birkaç tanesi kabul edilebilir.
  if (bad > tris.length * 3 * 0.02) return { ok: false, reason: 'gecersiz-koordinat' };
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return { ok: false, reason: 'gecersiz-koordinat' };

  const size = [maxX - minX, maxY - minY, maxZ - minZ].sort((a, b) => b - a);
  if (!(size[0] > 0) || !(size[1] > 0)) return { ok: false, reason: 'duz' };
  // Rastgele float32'ler genelde uçsuz bucaksız veya mikroskobik bir kutu verir.
  if (size[0] > 1e9 || size[0] / Math.max(size[1], 1e-12) > 1e6) {
    return { ok: false, reason: 'olcek-bozuk' };
  }
  return { ok: true, reason: null };
}

/**
 * Dosya adına ve içeriğine bakarak doğru okuyucuyu seçer.
 * Uzantıya güvenilmez: telefondan gelen dosyaların adı değişmiş olabilir.
 * @returns {{tris:Array, format:string|null, reason:string|null}}
 */
export function parseMesh(buffer, filename = '') {
  const name = filename.toLowerCase();
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(2048, bytes.length)));
  const text = () => new TextDecoder().decode(bytes);

  const looksObj = /^\s*(v|vn|vt|f|mtllib|usemtl|o|g)\s/m.test(head);
  const adaylar = [];
  if (name.endsWith('.obj') || looksObj) adaylar.push(['OBJ', () => parseObj(text())]);
  adaylar.push(['STL', () => parseStl(buffer)]);
  if (!adaylar.some(([f]) => f === 'OBJ')) adaylar.push(['OBJ', () => parseObj(text())]);

  let lastReason = 'bos';
  for (const [format, run] of adaylar) {
    let tris = [];
    try {
      tris = run();
    } catch {
      continue; // bozuk dosya — sıradaki biçimi dene
    }
    const v = validateMesh(tris);
    if (v.ok) return { tris, format, reason: null };
    if (tris.length) lastReason = v.reason;
  }
  return { tris: [], format: null, reason: lastReason };
}
