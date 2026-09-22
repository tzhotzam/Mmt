// YÜKSEKLİK HARİTASINDAN KAPALI HACİM.
//
// Poligonal kabuk modu kapalı bir hacim ister; düz bir görselde derinlik
// yoktur. Ama görselden bir KABARTMA hacmi kurulabilir:
//
//   ön yüz  — yükseklik haritasından türeyen düşük poligonlu yüzey
//   arka yüz— düz levha
//   etek    — ön ve arka yüzün kenarlarını birleştiren şerit
//
// Sonuç kapalı ve su sızdırmaz bir ağdır; poligonal kabuk zinciri onu
// olduğu gibi işler. Çıkan iş, duvara asılan düşük poligonlu bir metal
// kabartmadır — serbest duran bir heykel DEĞİLDİR, çünkü tek fotoğrafta
// arka taraf yoktur ve olmayan bilgi uydurulmaz.
//
// Eksen düzeni faset modunun beklentisine göredir: x = en, z = boy,
// y = derinlik (kabartma yönü).

import { sampleBilinear } from './heightmap.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{w:number,h:number,data:Float32Array}} grid 0..1 yükseklik haritası
 * @param {object} opts
 *   width, height   panel ölçüleri (mm)
 *   depth           kabartmanın en yüksek noktası (mm)
 *   backThickness   arka levhanın kalınlığı (mm) — hacmi kapatır
 *   cells           uzun kenar boyunca poligon sayısı
 *   jitter          köşe kaydırma oranı (0 = düzenli ızgara)
 *   seed            tohum
 * @returns {Array} üçgenler
 */
export function meshFromHeightmap(grid, opts = {}) {
  const {
    width = 600, height = 400, depth = 60, backThickness = 20,
    cells = 22, jitter = 0.32, seed = 7,
  } = opts;
  if (!grid || grid.w < 2 || grid.h < 2) return [];

  const en = Math.max(2, Math.round(width >= height ? cells : cells * (width / height)));
  const boy = Math.max(2, Math.round(width >= height ? cells * (height / width) : cells));
  const nx = en + 1;
  const rand = mulberry32(seed);

  // Köşe ağı. Kenardaki köşeler panel sınırını bozmasın diye yalnızca kenar
  // boyunca kaydırılır — etek şeridi böylece düzlemsel kalır.
  const X = new Float64Array(nx * (boy + 1));
  const Z = new Float64Array(nx * (boy + 1));
  const Y = new Float64Array(nx * (boy + 1));
  for (let j = 0; j <= boy; j++) {
    for (let i = 0; i <= en; i++) {
      const k = j * nx + i;
      const kenarXd = i === 0 || i === en;
      const kenarZd = j === 0 || j === boy;
      const u0 = i / en;
      const v0 = j / boy;
      const du = kenarXd ? 0 : (rand() - 0.5) * 2 * jitter / en;
      const dv = kenarZd ? 0 : (rand() - 0.5) * 2 * jitter / boy;
      const u = Math.min(1, Math.max(0, u0 + du));
      const v = Math.min(1, Math.max(0, v0 + dv));
      X[k] = u * width;
      Z[k] = (1 - v) * height;          // v=0 görselin üst satırı
      // Kabartma -y yönüne çıkar. Önizleme model (x,y,z)'yi sahne
      // (x, z, -y)'ye eşler ve kamera sahnede +z tarafındadır; kabartma +y'ye
      // çıksaydı kamera düz ARKA yüze bakar, ekranda yalnızca düz bir levha
      // görünürdü (ilk sürümde tam olarak bu oldu).
      Y[k] = -(backThickness + sampleBilinear(grid, u, v) * depth);
    }
  }

  const tris = [];
  const on = (k) => [X[k], Y[k], Z[k]];
  const arka = (k) => [X[k], 0, Z[k]];

  for (let j = 0; j < boy; j++) {
    for (let i = 0; i < en; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // ÖN yüz: normal +y (dışa). Köşegen dönüşümlü seçilir; hep aynı yöne
      // konsaydı yüzeyde belirgin bir tarama deseni oluşurdu.
      if ((i + j) % 2 === 0) {
        tris.push([on(a), on(c), on(d)], [on(a), on(d), on(b)]);
      } else {
        tris.push([on(a), on(c), on(b)], [on(b), on(c), on(d)]);
      }
      // ARKA yüz: aynı ağ, ters sarım (normal -y).
      if ((i + j) % 2 === 0) {
        tris.push([arka(a), arka(d), arka(c)], [arka(a), arka(b), arka(d)]);
      } else {
        tris.push([arka(a), arka(b), arka(c)], [arka(b), arka(d), arka(c)]);
      }
    }
  }

  // ETEK: dört kenarda ön ve arka sınırı birleştirir. Sarım yönü her kenarda
  // dışa bakacak şekilde ayrı ayrı verilir.
  const kenarSerit = (k1, k2, tersle) => {
    const p1 = on(k1), p2 = on(k2), q1 = arka(k1), q2 = arka(k2);
    if (tersle) tris.push([p1, q1, q2], [p1, q2, p2]);
    else tris.push([p1, q2, q1], [p1, p2, q2]);
  };
  for (let i = 0; i < en; i++) {
    kenarSerit(i, i + 1, true);                                   // üst (z=height)
    kenarSerit(boy * nx + i, boy * nx + i + 1, false);            // alt (z=0)
  }
  for (let j = 0; j < boy; j++) {
    kenarSerit(j * nx, (j + 1) * nx, false);                      // sol (x=0)
    kenarSerit(j * nx + en, (j + 1) * nx + en, true);             // sağ (x=width)
  }

  // YÖN DENETİMİ. Sarım yönünü elle akıl yürüterek vermek hataya açık:
  // (x, derinlik, boy) düzeni sağ elli değil ve ilk sürümde bütün normaller
  // İÇE dönüktü — hacim negatif çıkıyordu. Faset modu dikiş açılarını ve
  // kalınlık telafisinin yönünü normallerden hesapladığı için içe dönük ağda
  // dışbükey ve içbükey dikişler yer değiştirirdi. Ağ tutarlı sarıldığı
  // için hacim işaretine bakıp gerekirse hepsini çevirmek yeterli ve kesin.
  if (checkClosed(tris).volume < 0) {
    for (const t of tris) { const x = t[1]; t[1] = t[2]; t[2] = x; }
  }

  return tris;
}

/**
 * Ağ gerçekten kapalı mı? Her kenar TAM İKİ üçgende geçmeli.
 * Kapalı olmayan ağ faset modunda "kenarın karşı tarafı yok" uyarısı üretir;
 * burada üretimde yakalamak için kullanılır.
 * @returns {{closed: boolean, openEdges: number, volume: number}}
 */
export function checkClosed(tris, tol = 1e-6) {
  const say = new Map();
  const anahtar = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)},${Math.round(p[2] / tol)}`;
  let volume = 0;
  for (const t of tris) {
    const k = t.map(anahtar);
    for (let i = 0; i < 3; i++) {
      const a = k[i], b = k[(i + 1) % 3];
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      say.set(e, (say.get(e) || 0) + 1);
    }
    // İmzalı hacim (diverjans teoremi): kapalı ve dışa dönük ağda pozitiftir.
    const [p, q, r] = t;
    volume += (
      p[0] * (q[1] * r[2] - q[2] * r[1])
      - p[1] * (q[0] * r[2] - q[2] * r[0])
      + p[2] * (q[0] * r[1] - q[1] * r[0])
    ) / 6;
  }
  let openEdges = 0;
  for (const n of say.values()) if (n !== 2) openEdges++;
  return { closed: openEdges === 0, openEdges, volume };
}
