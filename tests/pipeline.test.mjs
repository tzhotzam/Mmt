// Tarayıcıya gerek duymadan üretim zincirini doğrular:  node tests/pipeline.test.mjs
import assert from 'node:assert/strict';

import { makeGrid, applyFilters, gridFromImageData, sampleBilinear, suggestInvert } from '../js/heightmap.js';
import { contourRings } from '../js/marchingsquares.js';
import { signedArea, classifyRings, simplify, pointInRing, offsetRing } from '../js/geom.js';
import { generateRibs } from '../js/modes/ribs.js';
import { generateContours } from '../js/modes/contour.js';
import { nest, applyPlacement } from '../js/nest.js';
import { sheetToDxf } from '../js/export/dxf.js';
import { sheetToSvg } from '../js/export/svg.js';
import { buildCutList, assemblyGuide, cutListToCsv } from '../js/cutlist.js';
import { heightmapFromStl, parseStl } from '../js/stl.js';
import { facetize } from '../js/facet.js';
import { generateFacets, seamInset, offsetPerEdge } from '../js/modes/facets.js';
import { buildMesh, groupCoplanar, dihedralAngle } from '../js/mesh.js';
import { dashLine, bendDeduction, polysOverlap } from '../js/unfold.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

// --- Test verisi: asimetrik iki tepe ------------------------------------
function testGrid(w = 160, h = 120) {
  const g = makeGrid(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1), v = y / (h - 1);
      const a = Math.exp(-(((u - 0.32) ** 2) / 0.02 + ((v - 0.4) ** 2) / 0.03));
      const b = 0.7 * Math.exp(-(((u - 0.72) ** 2) / 0.012 + ((v - 0.65) ** 2) / 0.018));
      g.data[y * w + x] = Math.min(1, a + b);
    }
  }
  return g;
}

console.log('geom');
test('signedArea CCW pozitif', () => {
  assert.ok(signedArea([[0, 0], [10, 0], [10, 10], [0, 10]]) > 0);
  assert.ok(signedArea([[0, 0], [0, 10], [10, 10], [10, 0]]) < 0);
});

test('pointInRing', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInRing([5, 5], sq), true);
  assert.equal(pointInRing([15, 5], sq), false);
});

test('simplify düz çizgiyi 2 noktaya indirir', () => {
  const line = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  assert.equal(simplify(line, 0.01).length, 2);
});

test('offsetRing kareyi büyütür', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const big = offsetRing(sq, 1);
  assert.ok(Math.abs(signedArea(big)) > Math.abs(signedArea(sq)));
  assert.ok(Math.abs(Math.abs(signedArea(big)) - 144) < 1e-6, 'beklenen alan 12x12');
});

console.log('marching squares');
test('daire konturu tek kapalı halka verir', () => {
  const g = makeGrid(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      g.data[y * 64 + x] = Math.hypot(x - 32, y - 32) < 20 ? 1 : 0;
  const rings = contourRings(g, 0.5);
  assert.equal(rings.length, 1, `beklenen 1 halka, gelen ${rings.length}`);
  const area = Math.abs(signedArea(rings[0]));
  assert.ok(Math.abs(area - Math.PI * 400) / (Math.PI * 400) < 0.05, `alan sapması yüksek: ${area}`);
});

test('halka (delikli daire) iki halka ve doğru sınıflandırma verir', () => {
  const g = makeGrid(80, 80);
  for (let y = 0; y < 80; y++)
    for (let x = 0; x < 80; x++) {
      const r = Math.hypot(x - 40, y - 40);
      g.data[y * 80 + x] = r < 30 && r > 14 ? 1 : 0;
    }
  const rings = contourRings(g, 0.5);
  assert.equal(rings.length, 2);
  const cls = classifyRings(rings);
  assert.equal(cls.filter((c) => c.hole).length, 1);
  assert.equal(cls.filter((c) => !c.hole).length, 1);
  assert.ok(signedArea(cls.find((c) => !c.hole).ring) > 0, 'dış halka CCW olmalı');
  assert.ok(signedArea(cls.find((c) => c.hole).ring) < 0, 'delik CW olmalı');
});

test('tüm halkalar kapalı ve en az 3 noktalı', () => {
  const g = testGrid();
  for (const level of [0.2, 0.4, 0.6, 0.8]) {
    for (const r of contourRings(g, level)) {
      assert.ok(r.length >= 3);
      assert.ok(Math.abs(signedArea(r)) > 0);
    }
  }
});

console.log('heightmap');
test('gridFromImageData luminance', () => {
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
  const g = gridFromImageData(img, 2, 1);
  assert.ok(g.data[0] < 0.01);
  assert.ok(g.data[1] > 0.99);
});

test('applyFilters invert + normalize 0..1 aralığında kalır', () => {
  const g = applyFilters(testGrid(), { invert: true, blur: 2, contrast: 0.3 });
  let min = Infinity, max = -Infinity;
  for (const v of g.data) { min = Math.min(min, v); max = Math.max(max, v); }
  assert.ok(min >= -1e-6 && max <= 1 + 1e-6, `${min}..${max}`);
  assert.ok(Math.abs(max - 1) < 1e-6 && Math.abs(min) < 1e-6, 'normalize tam aralığı kullanmalı');
});

test('posterize kademe sayısını sınırlar', () => {
  const g = applyFilters(testGrid(), { posterize: 5 });
  const uniq = new Set(Array.from(g.data).map((v) => v.toFixed(4)));
  assert.ok(uniq.size <= 5, `kademe sayısı ${uniq.size}`);
});

test('suggestInvert: açık zeminde koyu konu için ters çevirme önerir', () => {
  // Beyaz zemin, ortada koyu bir logo
  const g = makeGrid(120, 120, 1);
  for (let y = 30; y < 90; y++)
    for (let x = 30; x < 90; x++) g.data[y * 120 + x] = 0.05;
  assert.equal(suggestInvert(g), true);
});

test('suggestInvert: koyu zeminde açık konu için ters çevirmez', () => {
  const g = makeGrid(120, 120, 0.05);
  for (let y = 30; y < 90; y++)
    for (let x = 30; x < 90; x++) g.data[y * 120 + x] = 1;
  assert.equal(suggestInvert(g), false);
});

test('suggestInvert: düz görselde ters çevirmez', () => {
  assert.equal(suggestInvert(makeGrid(120, 120, 0.5)), false);
  assert.equal(suggestInvert(testGrid()), false);
});

test('sampleBilinear sınırları kırpar', () => {
  const g = testGrid();
  assert.ok(Number.isFinite(sampleBilinear(g, -5, 9)));
});

console.log('poligonal yüzey');
test('facetize yüzeyi değiştirir ama aralığı korur', () => {
  const g = testGrid(200, 200);
  const f = facetize(g, { cells: 20 });
  assert.notEqual(f, g);
  let changed = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < g.data.length; i++) {
    if (Math.abs(f.data[i] - g.data[i]) > 1e-6) changed++;
    min = Math.min(min, f.data[i]);
    max = Math.max(max, f.data[i]);
    assert.ok(Number.isFinite(f.data[i]), `geçersiz değer @${i}`);
  }
  assert.ok(changed > g.data.length * 0.3, `çok az piksel değişti: ${changed}`);
  assert.ok(min >= -1e-6 && max <= 1 + 1e-6, `aralık taştı: ${min}..${max}`);
});

test('facetize düşük yoğunlukta ızgarayı aynen bırakır', () => {
  const g = testGrid();
  assert.equal(facetize(g, { cells: 4 }), g);
  assert.equal(facetize(g, { cells: 0 }), g);
});

test('facetize deterministik — aynı ayar aynı sonucu verir', () => {
  const g = testGrid(120, 120);
  const a = facetize(g, { cells: 16, seed: 3 });
  const b = facetize(g, { cells: 16, seed: 3 });
  for (let i = 0; i < a.data.length; i++) assert.equal(a.data[i], b.data[i]);
});

test('facetize flat: her üçgen tek yükseklikte — kademe sayısı sınırlı', () => {
  const g = testGrid(200, 200);
  const f = facetize(g, { cells: 12, flat: true });
  const uniq = new Set(Array.from(f.data).map((v) => v.toFixed(5)));
  // 12x12 hücre x 2 üçgen = ~288 kademe; düzgün yüzeyde binlerce olurdu.
  assert.ok(uniq.size < 400, `beklenenden fazla kademe: ${uniq.size}`);
});

test('facetize panel kenarlarını düz bırakır', () => {
  const g = testGrid(120, 120);
  const f = facetize(g, { cells: 14 });
  // Kenar pikselleri kapsanmış olmalı (NaN/boşluk yok)
  for (let x = 0; x < 120; x++) {
    assert.ok(Number.isFinite(f.data[x]), `üst kenar @${x}`);
    assert.ok(Number.isFinite(f.data[119 * 120 + x]), `alt kenar @${x}`);
  }
});

console.log('lamel modu');
const ribs = generateRibs(applyFilters(testGrid(), {}), {
  panelW: 900, panelH: 600, thickness: 18, gap: 6, maxDepth: 60, baseDepth: 30,
});

test('lamel sayısı ve hatve doğru', () => {
  assert.equal(ribs.info.pitch, 24);
  assert.equal(ribs.info.count, Math.floor((900 + 6) / 24));
  assert.ok(ribs.info.actualAcross <= 900);
});

test('her lamel kapalı, basit olmayan sıfır alanlı değil', () => {
  const lamels = ribs.parts.filter((p) => p.kind === 'lamel');
  assert.equal(lamels.length, ribs.info.count);
  for (const p of lamels) {
    assert.ok(p.outline.length >= 4, `${p.id} nokta sayısı az`);
    assert.ok(signedArea(p.outline) > 0, `${p.id} CCW olmalı`);
    assert.ok(p.h > 30 && p.h <= 90 + 1e-6, `${p.id} derinlik aralık dışı: ${p.h}`);
    assert.ok(Math.abs(p.w - 600) < 1e-6, `${p.id} boyu panel yüksekliği olmalı`);
  }
});

test('kızaklar üretildi ve lamel sayısı kadar kanal içeriyor', () => {
  const rails = ribs.parts.filter((p) => p.kind === 'kizak');
  assert.equal(rails.length, 2);
  for (const r of rails) {
    assert.ok(signedArea(r.outline) > 0);
    assert.ok(Math.abs(r.h - 60) < 1e-6, `kızak yüksekliği: ${r.h}`);
    // Her kanal 4 nokta ekler.
    assert.ok(r.outline.length >= ribs.info.count * 4, 'kanal sayısı yetersiz');
  }
});

test('lamel profili yükseklik haritasını takip ediyor', () => {
  const flat = generateRibs(makeGrid(64, 64, 0), { panelW: 400, panelH: 400, baseDepth: 20, maxDepth: 50, railCount: 0 });
  for (const p of flat.parts.filter((x) => x.kind === 'lamel')) {
    assert.ok(Math.abs(p.meta.maxDepth - 20) < 1e-3, `düz haritada derinlik taban olmalı: ${p.meta.maxDepth}`);
  }
  const full = generateRibs(makeGrid(64, 64, 1), { panelW: 400, panelH: 400, baseDepth: 20, maxDepth: 50, railCount: 0 });
  for (const p of full.parts.filter((x) => x.kind === 'lamel')) {
    assert.ok(Math.abs(p.meta.maxDepth - 70) < 1e-3, `dolu haritada derinlik taban+maks olmalı: ${p.meta.maxDepth}`);
  }
});

console.log('katman modu');
const cont = generateContours(applyFilters(testGrid(), {}), {
  panelW: 600, panelH: 450, thickness: 12, layerCount: 6, withBase: true,
});

test('taban + katman parçaları üretildi', () => {
  assert.ok(cont.parts.length > 6, `parça sayısı ${cont.parts.length}`);
  assert.equal(cont.parts[0].id, 'T0');
  assert.equal(cont.info.totalDepth, 7 * 12);
});

test('parçalar panel sınırları içinde', () => {
  for (const p of cont.parts) {
    for (const [x, y] of p.outline) {
      assert.ok(x >= -1e-6 && x <= 600 + 1e-6, `x taşması: ${x}`);
      assert.ok(y >= -1e-6 && y <= 450 + 1e-6, `y taşması: ${y}`);
    }
  }
});

test('üst katmanlar alt katmanlardan küçük', () => {
  const areaOf = (lvl) => cont.parts
    .filter((p) => p.meta.layer === lvl)
    .reduce((s, p) => s + Math.abs(signedArea(p.outline)), 0);
  const a1 = areaOf(1), a3 = areaOf(3), a6 = areaOf(6);
  assert.ok(a1 > a3 && a3 > a6, `alanlar azalmalı: ${a1} ${a3} ${a6}`);
});

test('her katmanın Z yüksekliği artıyor', () => {
  const zs = cont.parts.map((p) => p.meta.z);
  assert.equal(Math.min(...zs), 0);
  assert.equal(Math.max(...zs), 6 * 12);
});

console.log('poligonal kabuk (kaynak) modu');

function cubeTris(s = 1) {
  const v = [];
  for (const dz of [0, 1]) for (const dy of [0, 1]) for (const dx of [0, 1]) v.push([dx * s, dy * s, dz * s]);
  const q = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [1, 3, 7, 5], [3, 2, 6, 7], [2, 0, 4, 6]];
  const t = [];
  for (const [a, b, c, d] of q) { t.push([v[a], v[b], v[c]]); t.push([v[a], v[c], v[d]]); }
  return t;
}

function icoTris() {
  const g = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g],
             [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]];
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
             [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
             [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return f.map(([a, b, c]) => [v[a], v[b], v[c]]);
}

test('buildMesh köşeleri kaynaklar', () => {
  const mesh = buildMesh(cubeTris(10));
  assert.equal(mesh.vertices.length, 8, `küpte 8 köşe olmalı, ${mesh.vertices.length} çıktı`);
  assert.equal(mesh.faces.length, 12);
});

test('groupCoplanar küpün 12 üçgenini 6 yüzeye indirir', () => {
  const groups = groupCoplanar(buildMesh(cubeTris(10)), 1);
  assert.equal(groups.length, 6);
  assert.ok(groups.every((g) => g.faces.length === 2));
});

test('küp: 6 kare parça, 12 dikiş, hepsi 90°', () => {
  const r = generateFacets(cubeTris(), { targetSize: 100, thickness: 3, thicknessComp: false });
  assert.equal(r.parts.length, 6);
  assert.equal(r.seams.length, 12);
  for (const part of r.parts) {
    assert.equal(part.outline.length, 4, `${part.id} 4 köşeli olmalı`);
    assert.ok(Math.abs(part.w - 100) < 1e-6 && Math.abs(part.h - 100) < 1e-6);
    assert.ok(signedArea(part.outline) > 0, `${part.id} CCW olmalı`);
  }
  for (const s of r.seams) assert.ok(Math.abs(s.angle - 90) < 1e-6, `açı ${s.angle}`);
  assert.equal(r.warnings.length, 0, `beklenmeyen uyarı: ${r.warnings}`);
});

test('kalınlık telafisi: 100 mm dış ölçülü küpün plakaları 100-t olur', () => {
  // Her yüzün orta düzlemi dış yüzeyden t/2 içeride; plaka iki komşu orta
  // düzlem arasını kapatır, yani her kenardan t/2 → toplam t kısalır.
  for (const t of [3, 4, 6]) {
    const r = generateFacets(cubeTris(), { targetSize: 100, thickness: t, thicknessComp: true });
    for (const part of r.parts) {
      assert.ok(Math.abs(part.w - (100 - t)) < 1e-6, `t=${t}: beklenen ${100 - t}, gelen ${part.w}`);
      assert.ok(Math.abs(part.h - (100 - t)) < 1e-6);
    }
  }
});

test('ikosahedron: 20 üçgen faset, 30 dikiş, dihedral 138.19°', () => {
  const r = generateFacets(icoTris(), { targetSize: 200, thickness: 2, thicknessComp: false, minArea: 10 });
  assert.equal(r.parts.length, 20);
  assert.equal(r.seams.length, 30);
  assert.ok(r.parts.every((p) => p.outline.length === 3));
  for (const s of r.seams) assert.ok(Math.abs(s.angle - 138.1897) < 0.01, `açı ${s.angle}`);
});

test('her dikiş numarası tam iki parçada geçer', () => {
  const r = generateFacets(icoTris(), { targetSize: 200, thicknessComp: false, minArea: 10 });
  const tally = new Map();
  for (const part of r.parts) {
    for (const id of part.meta.seams) tally.set(id, (tally.get(id) || 0) + 1);
  }
  assert.equal(tally.size, r.seams.length, 'her dikiş bir parçada geçmeli');
  for (const [id, n] of tally) assert.equal(n, 2, `dikiş ${id} ${n} parçada geçiyor, 2 olmalı`);
});

test('dikiş listesindeki parça numaraları gerçek parçalara işaret eder', () => {
  const r = generateFacets(cubeTris(), { targetSize: 100, thicknessComp: false });
  const ids = new Set(r.parts.map((p) => p.id));
  for (const s of r.seams) {
    assert.ok(ids.has(s.aId), `bilinmeyen parça ${s.aId}`);
    assert.ok(ids.has(s.bId), `bilinmeyen parça ${s.bId}`);
    assert.notEqual(s.aId, s.bId, 'dikiş parçayı kendine bağlayamaz');
  }
});

test('gravürlenen dikiş numarası, parçanın kendi dikiş listesiyle tutarlı', () => {
  const r = generateFacets(cubeTris(), { targetSize: 200, thicknessComp: false });
  for (const part of r.parts) {
    const engraved = part.engrave.filter((e) => e.type === 'text' && /^\d+$/.test(e.text))
      .map((e) => Number(e.text)).sort((a, b) => a - b);
    const listed = part.meta.seams.slice().sort((a, b) => a - b);
    assert.deepEqual(engraved, listed, `${part.id} gravür/liste uyuşmuyor`);
  }
});

test('açık (kapalı olmayan) model uyarı verir', () => {
  const open = cubeTris(10).slice(0, 10); // bir yüzü eksik
  const r = generateFacets(open, { targetSize: 100, thicknessComp: false });
  assert.ok(r.info.openEdges > 0);
  assert.ok(r.warnings.some((w) => w.includes('kapalı bir hacim değil')), r.warnings.join('|'));
});

test('seamInset işaretleri ve sınırları', () => {
  assert.ok(Math.abs(seamInset(90, 4) - 2) < 1e-9);
  assert.ok(Math.abs(seamInset(180, 4)) < 1e-9);
  assert.ok(seamInset(270, 4) < 0, 'içbükey kenar uzatılmalı');
  assert.ok(Math.abs(seamInset(1, 4)) <= 12 + 1e-9, 'çok dar açıda sınırlanmalı');
});

test('offsetPerEdge kareyi her kenardan eşit içeri çeker', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const r = offsetPerEdge(sq, [1, 1, 1, 1]);
  assert.ok(Math.abs(Math.abs(signedArea(r)) - 64) < 1e-9, `beklenen 8x8, alan ${signedArea(r)}`);
});

test('dihedralAngle dışbükey/içbükey ayrımı', () => {
  // Dışbükey: normaller birbirinden uzaklaşır
  assert.ok(Math.abs(dihedralAngle([0, 0, 1], [1, 0, 0], [0, 0, 0], [1, 0, -1]) - 90) < 1e-6);
  // İçbükey: B'nin merkezi A'nın normali yönünde
  assert.ok(dihedralAngle([0, 0, 1], [1, 0, 0], [0, 0, 0], [1, 0, 1]) > 180);
});

console.log('açınım (kertikli büküm)');

test('açınım fasetlerin hepsini korur, hiçbirini iki kez saymaz', () => {
  for (const tris of [cubeTris(), icoTris()]) {
    const loose = generateFacets(tris, { targetSize: 300, thicknessComp: false, minArea: 10 });
    const un = generateFacets(tris, { targetSize: 300, thicknessComp: false, minArea: 10, unfold: true });
    const total = un.parts.reduce((s2, q) => s2 + q.meta.facets, 0);
    assert.equal(total, loose.parts.length, `faset sayısı korunmadı: ${total} != ${loose.parts.length}`);
  }
});

test('açınım: büküm + kaynak = gevşek moddaki toplam dikiş', () => {
  for (const tris of [cubeTris(), icoTris()]) {
    const loose = generateFacets(tris, { targetSize: 300, thicknessComp: false, minArea: 10 });
    const un = generateFacets(tris, { targetSize: 300, thicknessComp: false, minArea: 10, unfold: true });
    assert.equal(un.info.foldCount + un.seams.length, loose.seams.length,
      `${un.info.foldCount}+${un.seams.length} != ${loose.seams.length}`);
  }
});

test('her yaprak bir ağaçtır: büküm sayısı = faset - 1', () => {
  const un = generateFacets(icoTris(), { targetSize: 300, thicknessComp: false, minArea: 10, unfold: true });
  for (const part of un.parts) {
    assert.equal(part.meta.folds, part.meta.facets - 1,
      `${part.id}: ${part.meta.folds} büküm / ${part.meta.facets} faset`);
  }
});

test('küp tek yaprağa açılır (klasik haç), 5 büküm 7 kaynak', () => {
  const un = generateFacets(cubeTris(), { targetSize: 300, thicknessComp: false, unfold: true });
  assert.equal(un.parts.length, 1);
  assert.equal(un.info.foldCount, 5);
  assert.equal(un.seams.length, 7);
});

test('açınım halkaları CCW ve kapalı', () => {
  const un = generateFacets(icoTris(), { targetSize: 300, thicknessComp: false, minArea: 10, unfold: true });
  for (const part of un.parts) {
    assert.ok(signedArea(part.outline) > 0, `${part.id} CCW değil`);
    assert.ok(part.outline.length >= 3);
    for (const [x, y] of part.outline) assert.ok(Number.isFinite(x) && Number.isFinite(y));
  }
});

test('levha sınırı aşılmaz — küçük levhada yaprak bölünür', () => {
  const big = generateFacets(icoTris(), { targetSize: 400, thicknessComp: false, minArea: 10, unfold: true });
  const small = generateFacets(icoTris(), {
    targetSize: 400, thicknessComp: false, minArea: 10, unfold: true,
    maxPatchW: 500, maxPatchH: 500,
  });
  assert.ok(small.parts.length > big.parts.length,
    `dar levhada daha çok yaprak olmalı: ${small.parts.length} vs ${big.parts.length}`);
  // Tek fasetli yaprak bölünemez (düz üçgen katlanarak küçülmez); büyümeyi
  // durduran sınır yalnızca faset EKLERKEN uygulanabilir.
  for (const part of small.parts) {
    if (part.meta.facets < 2) continue;
    assert.ok(part.w <= 500 + 1e-6 && part.h <= 500 + 1e-6,
      `${part.id} (${part.meta.facets} faset) levhaya sığmıyor: ${part.w}x${part.h}`);
  }
  assert.ok(small.parts.some((q) => q.meta.facets >= 2), 'hiç birleşme olmamış');
  // Sınır daraldıkça yaprak sayısı monoton artmalı.
  const counts = [700, 500, 400, 300].map((lim) => generateFacets(icoTris(), {
    targetSize: 400, thicknessComp: false, minArea: 10, unfold: true,
    maxPatchW: lim, maxPatchH: lim,
  }).parts.length);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1], `sınır daralınca yaprak azalamaz: ${counts}`);
  }
});

test('büküm çizgileri KESIM katmanında kertik, BUKUM katmanında iz üretir', () => {
  const un = generateFacets(cubeTris(), { targetSize: 400, thicknessComp: false, unfold: true });
  const part = un.parts[0];
  const cuts = part.engrave.filter((e) => e.layer === 'KESIM');
  const scribes = part.engrave.filter((e) => e.layer === 'BUKUM');
  assert.equal(scribes.length, un.info.foldCount, 'her büküm için bir iz çizgisi olmalı');
  assert.ok(cuts.length >= un.info.foldCount, 'her bükümde en az bir kertik olmalı');
  const angles = part.engrave.filter((e) => e.type === 'text' && e.text.endsWith('°'));
  assert.equal(angles.length, un.info.foldCount, 'her bükümün açısı yazılmalı');
  assert.ok(angles.every((e) => Math.abs(parseFloat(e.text) - 90) < 1), 'küpte bükümler 90°');
});

test('dashLine uçlarda dolu pay bırakır ve çizgiyi aşmaz', () => {
  const p1 = [0, 0], p2 = [100, 0];
  const segs = dashLine(p1, p2, 8, 4);
  assert.ok(segs.length >= 3, `az kertik: ${segs.length}`);
  const first = segs[0][0][0];
  const last = segs[segs.length - 1][1][0];
  assert.ok(first > 3, `baş pay yok: ${first}`);
  assert.ok(last < 97, `son pay yok: ${last}`);
  for (const [a, b] of segs) {
    assert.ok(b[0] > a[0] && b[0] - a[0] <= 8 + 1e-9);
    assert.ok(a[0] >= 0 && b[0] <= 100);
  }
  assert.equal(dashLine(p1, [5, 0], 8, 4).length, 0, 'kısa çizgide kertik olmaz');
});

test('bendDeduction: düz kenarda sıfır, büküm arttıkça büyür', () => {
  assert.equal(bendDeduction(180, 3), 0);
  assert.ok(bendDeduction(90, 3) > bendDeduction(150, 3));
  assert.ok(Number.isFinite(bendDeduction(5, 3)));
});

test('polysOverlap: çakışanı bulur, sadece temas edeni bulmaz', () => {
  const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(polysOverlap(a, [[5, 5], [15, 5], [15, 15], [5, 15]]), true);
  assert.equal(polysOverlap(a, [[10, 0], [20, 0], [20, 10], [10, 10]]), false, 'ortak kenar çakışma değil');
  assert.equal(polysOverlap(a, [[20, 20], [30, 20], [30, 30], [20, 30]]), false);
});

console.log('yerleşim ve dışa aktarım');
const nr = nest(ribs.parts, { sheetW: 2440, sheetH: 1220, margin: 10, spacing: 6 });

test('tüm parçalar levhalara yerleşti', () => {
  const placed = nr.sheets.reduce((s, sh) => s + sh.placements.length, 0);
  assert.equal(nr.oversized.length, 0, `sığmayan: ${nr.oversized.map((p) => p.id)}`);
  assert.equal(placed, ribs.parts.length);
});

test('parçalar levha sınırları içinde ve üst üste binmiyor', () => {
  for (const sh of nr.sheets) {
    const boxes = [];
    for (const pl of sh.placements) {
      const a = applyPlacement(pl);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of a.outline) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      assert.ok(minX >= -1e-6 && minY >= -1e-6, `negatif konum ${pl.part.id}`);
      assert.ok(maxX <= sh.w + 1e-6 && maxY <= sh.h + 1e-6, `${pl.part.id} levhayı taşıyor`);
      boxes.push({ id: pl.part.id, minX, minY, maxX, maxY });
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 &&
                        a.minY < b.maxY - 1e-6 && b.minY < a.maxY - 1e-6;
        assert.ok(!overlap, `${a.id} ile ${b.id} çakışıyor`);
      }
  }
});

test('DXF yapısı geçerli', () => {
  const sh = nr.sheets[0];
  const dxf = sheetToDxf(sh, sh.placements.map(applyPlacement));
  assert.ok(dxf.startsWith('0\r\nSECTION'));
  assert.ok(dxf.trimEnd().endsWith('EOF'));
  assert.ok(dxf.includes('AC1009'), 'R12 sürüm etiketi yok');
  assert.ok(dxf.includes('KESIM') && dxf.includes('GRAVUR'));
  const open = (dxf.match(/\r\nPOLYLINE\r\n/g) || []).length;
  const close = (dxf.match(/\r\nSEQEND\r\n/g) || []).length;
  assert.equal(open, close, 'POLYLINE/SEQEND dengesiz');
  assert.ok(open >= sh.placements.length);
  // Satır sayısı çift olmalı (her biri kod + değer çifti)
  assert.equal(dxf.trimEnd().split('\r\n').length % 2, 0);
});

test('SVG yapısı geçerli', () => {
  const sh = nr.sheets[0];
  const svg = sheetToSvg(sh, sh.placements.map(applyPlacement), { title: 'Test' });
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('</svg>'));
  assert.ok(svg.includes('mm"'), 'mm birimi yok');
  assert.ok(!/NaN|undefined/.test(svg), 'SVG içinde NaN/undefined var');
});

test('kesim listesi ve montaj kılavuzu', () => {
  const cl = buildCutList(ribs.parts, nr, ribs.info, { feedRate: 3000 });
  assert.equal(cl.rows.length, ribs.parts.length);
  assert.ok(cl.summary.totalCutLength > 0);
  assert.ok(cl.summary.sheetCount >= 1);
  assert.ok(cutListToCsv(cl).split('\n').length === ribs.parts.length + 2);
  assert.ok(cl.summary.utilisation > 0 && cl.summary.utilisation <= 100,
    `doluluk %0-100 arasında olmalı: ${cl.summary.utilisation}`);
  assert.ok(cl.summary.partArea <= cl.summary.sheetArea + 1e-9,
    'parça alanı levha alanını aşamaz');
  assert.ok(assemblyGuide(ribs.info).includes('Montaj sırası'));
  assert.ok(assemblyGuide(cont.info).includes('Montaj sırası'));
});

console.log('STL girişi');
test('ASCII STL ayrıştırılır ve yükseklik haritasına döner', () => {
  const ascii = `solid t
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 10 0 0
    vertex 0 10 5
  endloop
endfacet
endsolid t`;
  const tris = parseStl(new TextEncoder().encode(ascii).buffer);
  assert.equal(tris.length, 1);
  const hm = heightmapFromStl(tris, 32, 32);
  let max = 0;
  for (const v of hm.data) max = Math.max(max, v);
  assert.ok(Math.abs(max - 1) < 1e-6, 'en yüksek nokta 1 olmalı');
});

test('binary STL ayrıştırılır', () => {
  const n = 2;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const verts = [0, 0, 0, 10, 0, 0, 0, 10, i + 1];
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, verts[k], true);
  }
  const tris = parseStl(buf);
  assert.equal(tris.length, 2);
});

console.log(`\n${passed} test geçti${process.exitCode ? ' (hatalar var)' : ''}`);
