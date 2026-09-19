// Üçgen ağ işlemleri: köşe kaynaklama, komşuluk, eş-düzlem yüz birleştirme,
// sınır halkası çıkarma ve düzleme izdüşüm.
//
// Amaç: STL'den gelen üçgen çorbasını, sac levhadan kesilip kaynakla
// birleştirilebilecek GERÇEK yüzeylere (faset) indirgemek. Low-poly bir
// modelde her görünen yüzey aslında 2+ üçgene bölünmüştür; bunları geri
// birleştirmezsek gereksiz yere iki kat parça keser ve düz bir yüzeyin
// ortasından kaynak çekmiş oluruz.

/**
 * Aynı konumdaki köşeleri birleştirir.
 * @param {Array<Array<[number,number,number]>>} tris parseStl çıktısı
 * @param {number} [eps] kaynaklama toleransı (varsayılan: köşegenin 1e-5'i)
 */
export function buildMesh(tris, eps) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const [x, y, z] of t) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const tol = eps || diag * 1e-5;

  const vertices = [];
  const lookup = new Map();
  const key = (x, y, z) =>
    `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;

  function addVertex(p) {
    // Yuvarlamanın hücre sınırına denk gelme ihtimaline karşı komşuları da tara.
    const [x, y, z] = p;
    const cx = Math.round(x / tol), cy = Math.round(y / tol), cz = Math.round(z / tol);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const hit = lookup.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (hit === undefined) continue;
          const q = vertices[hit];
          if (Math.hypot(q[0] - x, q[1] - y, q[2] - z) <= tol) return hit;
        }
    const idx = vertices.length;
    vertices.push([x, y, z]);
    lookup.set(key(x, y, z), idx);
    return idx;
  }

  const faces = [];
  const normals = [];
  const areas = [];
  for (const t of tris) {
    const a = addVertex(t[0]);
    const b = addVertex(t[1]);
    const c = addVertex(t[2]);
    if (a === b || b === c || a === c) continue; // yozlaşmış üçgen
    const n = faceNormal(vertices[a], vertices[b], vertices[c]);
    if (!n) continue;
    faces.push([a, b, c]);
    normals.push(n.normal);
    areas.push(n.area);
  }

  return { vertices, faces, normals, areas, bounds: { minX, minY, minZ, maxX, maxY, maxZ, diag } };
}

function faceNormal(p, q, r) {
  const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
  const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  return { normal: [nx / len, ny / len, nz / len], area: len / 2 };
}

const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Kenar → o kenarı paylaşan yüzlerin listesi. */
export function buildAdjacency(mesh) {
  const map = new Map();
  mesh.faces.forEach((f, fi) => {
    for (let i = 0; i < 3; i++) {
      const k = edgeKey(f[i], f[(i + 1) % 3]);
      let list = map.get(k);
      if (!list) map.set(k, (list = []));
      list.push(fi);
    }
  });
  return map;
}

/**
 * Eş düzlemli (ve birbirine komşu) üçgenleri tek fasette birleştirir.
 *
 * Komşuluk testi, komşunun normali ile GRUBUN ortalama normali arasında
 * yapılır; böylece tolerans büyütüldüğünde eğri yüzeyde sonsuza kadar
 * yayılma olmaz ve toplam sapma sınırlı kalır.
 *
 * @param {number} angleTolDeg 0 = yalnızca tam eş düzlem; 10–25 = hafif
 *        eğri yüzeyleri de tek faset sayar (parça sayısını düşürür)
 */
export function groupCoplanar(mesh, angleTolDeg = 1) {
  const adj = buildAdjacency(mesh);
  const cosTol = Math.cos((Math.max(0, angleTolDeg) * Math.PI) / 180);
  const seen = new Uint8Array(mesh.faces.length);
  const groups = [];

  for (let start = 0; start < mesh.faces.length; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    const group = [start];
    let avg = mesh.normals[start].slice();
    let wsum = mesh.areas[start];
    const queue = [start];

    while (queue.length) {
      const fi = queue.pop();
      const f = mesh.faces[fi];
      for (let i = 0; i < 3; i++) {
        const k = edgeKey(f[i], f[(i + 1) % 3]);
        for (const nb of adj.get(k) || []) {
          if (seen[nb]) continue;
          const n = mesh.normals[nb];
          if (n[0] * avg[0] + n[1] * avg[1] + n[2] * avg[2] < cosTol - 1e-9) continue;
          seen[nb] = 1;
          group.push(nb);
          queue.push(nb);
          // Alan ağırlıklı ortalama normali güncelle.
          const w = mesh.areas[nb];
          avg = normalize([
            avg[0] * wsum + n[0] * w,
            avg[1] * wsum + n[1] * w,
            avg[2] * wsum + n[2] * w,
          ]);
          wsum += w;
        }
      }
    }
    groups.push({ faces: group, normal: avg });
  }
  return groups;
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Bir yüz grubunun dış sınır halkasını (yönlü) çıkarır.
 * Grup içinde paylaşılmayan kenarlar sınırı oluşturur.
 * @returns {{loops: number[][], boundaryEdges: Array<[number,number]>}}
 */
export function groupBoundary(mesh, group) {
  const inGroup = new Set(group.faces);
  const count = new Map();
  const directed = [];

  for (const fi of group.faces) {
    const f = mesh.faces[fi];
    for (let i = 0; i < 3; i++) {
      const a = f[i], b = f[(i + 1) % 3];
      const k = edgeKey(a, b);
      count.set(k, (count.get(k) || 0) + 1);
      directed.push([a, b, k]);
    }
  }

  const next = new Map();
  const boundaryEdges = [];
  for (const [a, b, k] of directed) {
    if (count.get(k) !== 1) continue; // grup içinde paylaşılıyor → iç kenar
    next.set(a, b);
    boundaryEdges.push([a, b]);
  }

  const loops = [];
  const used = new Set();
  for (const [startA] of boundaryEdges) {
    if (used.has(startA)) continue;
    const loop = [];
    let cur = startA;
    for (let guard = 0; guard <= boundaryEdges.length; guard++) {
      if (used.has(cur)) break;
      used.add(cur);
      loop.push(cur);
      const nxt = next.get(cur);
      if (nxt === undefined) break;
      if (nxt === startA) break;
      cur = nxt;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  // En uzun çevre dış sınır kabul edilir.
  loops.sort((x, y) => y.length - x.length);
  return { loops, boundaryEdges, inGroup };
}

/** Düzlem içinde ortonormal taban (u, v) kurar. */
export function planeBasis(normal) {
  const n = normalize(normal);
  const helper = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(helper, n));
  const v = cross(n, u);
  return { n, u, v };
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * 3B noktaları fasetin düzlemine izdüşürür.
 * @returns {{pts: Array<[number,number]>, deviation: number}}
 *          deviation = noktaların düzlemden en büyük sapması (mm)
 */
export function projectToPlane(points3, basis, origin) {
  const pts = [];
  let deviation = 0;
  for (const p of points3) {
    const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    pts.push([dot(d, basis.u), dot(d, basis.v)]);
    deviation = Math.max(deviation, Math.abs(dot(d, basis.n)));
  }
  return { pts, deviation };
}

/**
 * İki faset arasındaki iç (dihedral) açı — derece.
 * 180° = düz devam, <180° dışbükey (dıştan V açılır), >180° içbükey.
 */
export function dihedralAngle(nA, nB, centroidA, centroidB) {
  const c = Math.max(-1, Math.min(1, dot(normalize(nA), normalize(nB))));
  const between = (Math.acos(c) * 180) / Math.PI;
  const away = [
    centroidB[0] - centroidA[0],
    centroidB[1] - centroidA[1],
    centroidB[2] - centroidA[2],
  ];
  // B'nin merkezi A'nın normali yönündeyse kıvrım içe doğrudur.
  return dot(nA, away) > 0 ? 180 + between : 180 - between;
}

export function centroidOf(mesh, group) {
  let x = 0, y = 0, z = 0, w = 0;
  for (const fi of group.faces) {
    const f = mesh.faces[fi];
    const a = mesh.vertices[f[0]], b = mesh.vertices[f[1]], c = mesh.vertices[f[2]];
    const area = mesh.areas[fi];
    x += ((a[0] + b[0] + c[0]) / 3) * area;
    y += ((a[1] + b[1] + c[1]) / 3) * area;
    z += ((a[2] + b[2] + c[2]) / 3) * area;
    w += area;
  }
  return w > 0 ? [x / w, y / w, z / w] : [0, 0, 0];
}

export function groupArea(mesh, group) {
  let s = 0;
  for (const fi of group.faces) s += mesh.areas[fi];
  return s;
}

/** Modeli istenen boyuta ölçekler (en uzun kenar hedef alınır). */
export function scaleTriangles(tris, targetSize, axis = 'max') {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) for (const [x, y, z] of t) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
  const ref = axis === 'max' ? Math.max(size.x, size.y, size.z) : size[axis];
  if (!(ref > 0)) return { tris, scale: 1, size };
  const k = targetSize / ref;
  return {
    tris: tris.map((t) => t.map(([x, y, z]) => [
      (x - minX) * k, (y - minY) * k, (z - minZ) * k,
    ])),
    scale: k,
    size: { x: size.x * k, y: size.y * k, z: size.z * k },
  };
}
