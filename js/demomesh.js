// Örnek low-poly model: bir kez bölünmüş ikosahedron (80 yüz), köşeleri
// konumlarının deterministik bir fonksiyonuyla kaydırılmış. Paylaşılan
// köşeler aynı kaydırmayı aldığı için hacim kapalı kalır.
export function demoMeshTris() {
  const g = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g],
               [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]]
    .map((v) => norm(v));
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9],
               [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2],
               [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10],
               [8, 6, 7], [9, 8, 1]];

  // Bir kez böl: 20 → 80 yüz
  const mid = new Map();
  const out = [];
  const midpoint = (a, b) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    let i = mid.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push(norm([
        (verts[a][0] + verts[b][0]) / 2,
        (verts[a][1] + verts[b][1]) / 2,
        (verts[a][2] + verts[b][2]) / 2,
      ]));
      mid.set(k, i);
    }
    return i;
  };
  for (const [a, b, c] of faces) {
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    out.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  faces = out;

  // Köşeleri konuma bağlı olarak kaydır — kaya/kristal görünümü.
  const shaped = verts.map(([x, y, z]) => {
    const r = 1 + 0.30 * Math.sin(2.7 * x + 1.1) * Math.cos(2.1 * y - 0.4)
                + 0.18 * Math.sin(3.3 * z + 2.2);
    return [x * r * 1.35, y * r, z * r * 0.85];
  });

  return faces.map(([a, b, c]) => [shaped[a], shaped[b], shaped[c]]);
}

function norm([x, y, z]) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
