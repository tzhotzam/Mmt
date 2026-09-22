// Tarayıcıya gerek duymadan üretim zincirini doğrular:  node tests/pipeline.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  makeGrid, applyFilters, gridFromImageData, sampleBilinear, suggestInvert,
  sampleBandColumn, sampleBandRow, bandSamples,
  toneConcentration, fineDetailRatio,
} from '../js/heightmap.js';
import { contourRings } from '../js/marchingsquares.js';
import { signedArea, classifyRings, simplify, pointInRing, offsetRing, centroid } from '../js/geom.js';
import { generateRibs } from '../js/modes/ribs.js';
import { generateContours } from '../js/modes/contour.js';
import { nest, applyPlacement } from '../js/nest.js';
import { sheetToDxf } from '../js/export/dxf.js';
import { sheetToSvg } from '../js/export/svg.js';
import { buildCutList, assemblyGuide, cutListToCsv } from '../js/cutlist.js';
import {
  heightmapFromStl, parseStl, parseObj, parseMesh, validateMesh,
  pickBestAxis, projectedSize, heightmapWithCoverage,
} from '../js/stl.js';
import { facetize } from '../js/facet.js';
import {
  PATTERNS, PATTERN_KEYS, renderPattern, textSeed,
  encodePatternCode, decodePatternCode,
} from '../js/patterns.js';
import { otsuThreshold, distanceTransform, inflateSilhouette, blendRelief } from '../js/relief.js';
import { createPaintLayer, applyPaint, stamp, stroke, isEmpty } from '../js/paint.js';
import { generateFacets, seamInset, offsetPerEdge } from '../js/modes/facets.js';
import { generateSlices } from '../js/modes/slices.js';
import { sliceMesh, crossSectionSegments, stitchSegments } from '../js/slice.js';
import { decimate } from '../js/decimate.js';
import { voxelRemesh, meshHealth } from '../js/remesh.js';
import { meshFromHeightmap, checkClosed } from '../js/relief3d.js';
import { buildMesh, groupCoplanar, dihedralAngle } from '../js/mesh.js';
import { dashLine, bridgeLine, bendDeduction, polysOverlap } from '../js/unfold.js';
import {
  classifyCorners, dogbone, cornerRelief, filletConvex,
  countTightCorners, applyCornerRelief,
} from '../js/corners.js';

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

const KOK = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oku = (f) => fs.readFileSync(path.join(KOK, f), 'utf8');

console.log('sürüm tutarlılığı');
test('index.html, main.js ve sw.js aynı sürümü taşıyor', () => {
  // Üçü ayrışırsa tarayıcı yeni HTML'i eski JavaScript'le birleştirebiliyor:
  // arayüzde yeni alanlar görünür ama onları dolduran kod yoktur.
  const html = oku('index.html').match(/<meta name="app-version" content="([^"]+)"/)?.[1];
  const js = oku('js/main.js').match(/const APP_VERSION = '([^']+)'/)?.[1];
  const sw = oku('sw.js').match(/const VERSION = '([^']+)'/)?.[1];
  assert.ok(html, 'index.html içinde app-version meta etiketi yok');
  assert.ok(js, 'main.js içinde APP_VERSION yok');
  assert.ok(sw, 'sw.js içinde VERSION yok');
  assert.equal(js, html, `main.js (${js}) ile index.html (${html}) uyuşmuyor`);
  assert.equal(sw, html, `sw.js (${sw}) ile index.html (${html}) uyuşmuyor`);
});

test('sürüm kurtarma betiği HTML içinde ve modülsüz', () => {
  // Kurtarma kodu bir js dosyasında olsaydı, tam da çalışması gereken
  // durumda (bayat js) kendisi de bayat olurdu. HTML'in parçası olmalı.
  const html = oku('index.html');
  const surum = html.match(/<meta name="app-version" content="([^"]+)"/)?.[1];
  const betik = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  assert.ok(betik.includes(surum), 'satır içi kurtarma betiği sürümü taşımıyor');
  assert.ok(/caches\.keys\(\)/.test(betik), 'önbellek temizliği yok');
  assert.ok(/getRegistrations\(\)/.test(betik), 'servis çalışanı kaldırma yok');
  assert.ok(/location\.reload\(\)/.test(betik), 'yeniden yükleme yok');
  // Modül olmamalı: type="module" ertelenir ve import zinciri bayat kalabilir.
  const konum = html.indexOf('<script>');
  const modulKonum = html.indexOf('type="module"');
  assert.ok(konum > 0 && konum < modulKonum, 'kurtarma betiği modüllerden önce gelmeli');
});

test('servis çalışanı tarayıcı önbelleğini atlıyor', () => {
  const sw = oku('sw.js');
  assert.ok(/cache:\s*'no-cache'/.test(sw),
    "fetch çağrısında cache:'no-cache' yok — tarayıcı bayat dosya sunabilir");
  assert.ok(/cache:\s*'reload'/.test(sw),
    "kurulumda cache:'reload' yok — ilk yükleme bayat olabilir");
});

test('tüm js dosyaları servis çalışanı listesinde', () => {
  const sw = oku('sw.js');
  const dosyalar = [];
  const tara = (dir) => {
    for (const e of fs.readdirSync(path.join(KOK, dir), { withFileTypes: true })) {
      if (e.isDirectory()) tara(`${dir}/${e.name}`);
      else if (e.name.endsWith('.js')) dosyalar.push(`${dir}/${e.name}`);
    }
  };
  tara('js');
  for (const f of dosyalar) {
    assert.ok(sw.includes(`./${f}`), `${f} sw.js listesinde yok — çevrimdışı çalışmaz`);
  }
});

test('desen seçeneklerinin HTML yedeği gerçek desenlerle aynı', () => {
  // JS eski sürümden gelirse liste boş kalmasın diye HTML'de de duruyor.
  const html = oku('index.html');
  const blok = html.match(/<select id="p-pattern">([\s\S]*?)<\/select>/)?.[1] || '';
  const degerler = [...blok.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(degerler, PATTERN_KEYS,
    `HTML yedek listesi patterns.js ile uyuşmuyor:\n  HTML: ${degerler}\n  JS:   ${PATTERN_KEYS}`);
});

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

console.log('hazır desenler');

test('her desen 0..1 aralığını tam kullanır ve geçersiz değer üretmez', () => {
  for (const key of PATTERN_KEYS) {
    const g = renderPattern(160, 110, key, { scale: 0.5, angle: 0.15, detail: 0.5, seed: 0.42 });
    let min = Infinity, max = -Infinity;
    for (const v of g.data) {
      assert.ok(Number.isFinite(v), `${key}: geçersiz değer ${v}`);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    assert.ok(Math.abs(min) < 1e-6 && Math.abs(max - 1) < 1e-6,
      `${key}: aralık ${min}..${max} — normalize edilmiş olmalı`);
  }
});

test('desenler düz değil — gerçek bir kabartma üretiyor', () => {
  for (const key of PATTERN_KEYS) {
    const g = renderPattern(160, 110, key, { scale: 0.5, angle: 0.15, detail: 0.5, seed: 0.42 });
    let sum = 0, sum2 = 0;
    for (const v of g.data) { sum += v; sum2 += v * v; }
    const n = g.data.length;
    const std = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
    assert.ok(std > 0.05, `${key}: neredeyse düz (std ${std.toFixed(3)})`);
  }
});

test('desenler deterministik: aynı ayar aynı sonucu verir', () => {
  for (const key of PATTERN_KEYS) {
    const o = { scale: 0.3, angle: 0.6, detail: 0.7, seed: 0.9 };
    const a = renderPattern(80, 60, key, o);
    const b = renderPattern(80, 60, key, o);
    for (let i = 0; i < a.data.length; i++) {
      assert.equal(a.data[i], b.data[i], `${key}: ${i}. hücre farklı`);
    }
  }
});

test('dalga tohumla YAPISAL olarak değişiyor, sadece kaymıyor', () => {
  // Tohum yalnızca fazı kaydırsaydı desenler birbirinin ötelenmiş hâli
  // olurdu ve ortalama fark çok küçük kalırdı.
  const uret = (seed) => renderPattern(120, 90, 'dalga',
    { scale: 0.5, angle: 0.1, detail: 0.5, seed });
  const a = uret(0.06);
  let enKucukFark = Infinity;
  for (const seed of [0.18, 0.31, 0.43, 0.56, 0.69, 0.81]) {
    const b = uret(seed);
    let toplam = 0;
    for (let i = 0; i < a.data.length; i++) toplam += Math.abs(a.data[i] - b.data[i]);
    enKucukFark = Math.min(enKucukFark, toplam / a.data.length);
  }
  assert.ok(enKucukFark > 0.1,
    `dalgalar birbirine çok benziyor (en küçük fark ${enKucukFark.toFixed(3)})`);
});

test('textSeed: aynı metin aynı tohum, bir harf fark bile ayırır', () => {
  assert.equal(textSeed('Ahmet'), textSeed('Ahmet'));
  assert.notEqual(textSeed('Ahmet'), textSeed('Ahmed'));
  assert.notEqual(textSeed('Ahmet'), textSeed('ahmet'));
  assert.notEqual(textSeed('Ayşe'), textSeed('Ayse'));
  for (const t of ['', 'a', 'Mehmet 2026', 'çok uzun bir müşteri adı ve tarih 12.03.2026']) {
    const v = textSeed(t);
    assert.ok(v >= 0 && v < 1 && Number.isFinite(v), `${t} → ${v}`);
  }
});

test('metin tohumu farklı kişilere farklı desen verir', () => {
  const desenler = ['Ahmet', 'Ayşe', 'Mehmet 2026', 'Zeynep'].map((ad) =>
    renderPattern(100, 75, 'dalga', { scale: 0.5, angle: 0.1, detail: 0.5, seed: textSeed(ad) }));
  for (let i = 0; i < desenler.length; i++) {
    for (let j = i + 1; j < desenler.length; j++) {
      const ayni = desenler[i].data.every((v, k) => Math.abs(v - desenler[j].data[k]) < 1e-9);
      assert.ok(!ayni, `${i}. ve ${j}. desen aynı çıktı`);
    }
  }
});

test('desen kodu aynı deseni birebir geri üretir', () => {
  for (const key of PATTERN_KEYS) {
    const o = { scale: 0.37, angle: 0.62, detail: 0.81, seed: 0.911427 };
    const kod = encodePatternCode(key, o);
    const geri = decodePatternCode(kod);
    assert.ok(geri, `${key}: kod çözülemedi (${kod})`);
    assert.equal(geri.key, key);
    const a = renderPattern(90, 70, key, o);
    const b = renderPattern(90, 70, geri.key, geri);
    for (let i = 0; i < a.data.length; i++) {
      assert.ok(Math.abs(a.data[i] - b.data[i]) < 1e-6,
        `${key}: ${i}. hücre yeniden üretilemedi`);
    }
  }
});

test('bozuk desen kodu reddedilir', () => {
  for (const kod of ['', 'DALGA', 'DALGA.50.10.50', 'YOK.50.10.50.ABC',
                     'DALGA.999.10.50.ABC', 'DALGA.50.10.50.!!!', 'DALGA.-5.10.50.ABC']) {
    assert.equal(decodePatternCode(kod), null, `kabul edilmemeliydi: ${JSON.stringify(kod)}`);
  }
  // Küçük harf ve boşluk hoş görülür — telefonda yazarken kolaylık.
  assert.ok(decodePatternCode('  dalga.50.10.50.f2n1ko  '));
});

test('her desende tohum değişince desen de değişir', () => {
  // "Rastgele" düğmesinin her desende işe yaraması gerekiyor.
  for (const key of PATTERN_KEYS) {
    const a = renderPattern(120, 90, key, { scale: 0.5, angle: 0.2, detail: 0.5, seed: 0.1 });
    const b = renderPattern(120, 90, key, { scale: 0.5, angle: 0.2, detail: 0.5, seed: 0.83 });
    const ayni = a.data.every((v, i) => Math.abs(v - b.data[i]) < 1e-9);
    assert.ok(!ayni, `${key}: tohum deseni değiştirmiyor`);
  }
});

test('ayarlar deseni gerçekten etkiliyor', () => {
  for (const key of PATTERN_KEYS) {
    const taban = renderPattern(100, 80, key, { scale: 0.2, angle: 0.1, detail: 0.3, seed: 0.5 });
    const olcek = renderPattern(100, 80, key, { scale: 0.9, angle: 0.1, detail: 0.3, seed: 0.5 });
    const farkli = !taban.data.every((v, i) => Math.abs(v - olcek.data[i]) < 1e-9);
    assert.ok(farkli, `${key}: ölçek ayarı bir şey değiştirmiyor`);
  }
});

test('her desenin etiketi ve açıklaması var', () => {
  assert.ok(PATTERN_KEYS.length >= 6, `az desen: ${PATTERN_KEYS.length}`);
  for (const key of PATTERN_KEYS) {
    assert.ok(PATTERNS[key].label?.length > 2, `${key}: etiket yok`);
    assert.ok(PATTERNS[key].hint?.length > 15, `${key}: açıklama yok`);
    assert.equal(typeof PATTERNS[key].fn, 'function');
  }
});

test('desenler üretim zincirinden geçiyor', () => {
  for (const key of PATTERN_KEYS) {
    const g = renderPattern(200, 140, key, { scale: 0.5, angle: 0.2, detail: 0.5, seed: 0.3 });
    const r = generateRibs(applyFilters(g, { blur: 1 }), {
      panelW: 900, panelH: 630, thickness: 18, gap: 6,
    });
    assert.ok(r.parts.length > 10, `${key}: parça üretilmedi`);
    for (const part of r.parts) {
      assert.ok(signedArea(part.outline) > 0, `${key}/${part.id}: geçersiz halka`);
    }
  }
});

console.log('fotoğraftan kabartma');

function diskGrid(n = 200, r = 60) {
  const g = makeGrid(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) g.data[y * n + x] = Math.hypot(x - n / 2, y - n / 2) < r ? 1 : 0;
  return g;
}

test('otsuThreshold iki kümenin arasına düşer', () => {
  const g = makeGrid(60, 60);
  for (let i = 0; i < g.data.length; i++) g.data[i] = i % 3 === 0 ? 0.15 : 0.85;
  const thr = otsuThreshold(g);
  assert.ok(thr > 0.15 && thr < 0.85, `eşik aralık dışı: ${thr}`);
  // Eşiğin üstü konu sayıldığında yalnızca 0.85'ler kalmalı (üçte iki).
  let fg = 0;
  for (const v of g.data) if (v >= thr) fg++;
  assert.ok(Math.abs(fg / g.data.length - 2 / 3) < 0.02, `konu oranı ${fg / g.data.length}`);
});

test('distanceTransform dairede yarıçapı verir', () => {
  const n = 200, r = 60;
  const g = diskGrid(n, r);
  const mask = new Uint8Array(n * n);
  for (let i = 0; i < mask.length; i++) mask[i] = g.data[i] > 0.5 ? 1 : 0;
  const d = distanceTransform(mask, n, n);
  const center = d[(n / 2) * n + (n / 2)];
  assert.ok(Math.abs(center - r) < 1.5, `merkez uzaklığı ${center}, ~${r} olmalı`);
  // Dışarısı sıfır
  assert.equal(d[5 * n + 5], 0);
});

test('inflateSilhouette merkezi 1, kenarı 0 yapar', () => {
  const r = inflateSilhouette(diskGrid(), { threshold: 0.5, roundness: 0, detail: 0 });
  const n = 200;
  assert.ok(Math.abs(r.grid.data[100 * n + 100] - 1) < 1e-6, 'merkez en yüksek olmalı');
  assert.equal(r.grid.data[100 * n + 190], 0, 'silüet dışı sıfır olmalı');
  assert.ok(r.info.maxDist > 55 && r.info.maxDist < 65);
  assert.ok(r.info.coverage > 0.2 && r.info.coverage < 0.35);
});

test('inflateSilhouette yükseklik merkeze doğru monoton artar', () => {
  const n = 200;
  const r = inflateSilhouette(diskGrid(n, 60), { threshold: 0.5, roundness: 0.7, detail: 0 });
  let prev = -1;
  for (let x = 45; x <= 100; x += 5) {
    const v = r.grid.data[100 * n + x];
    assert.ok(v >= prev - 1e-9, `x=${x}: ${v} < ${prev} — merkeze doğru azalmamalı`);
    prev = v;
  }
});

test('inflateSilhouette küçük lekeleri eler', () => {
  const n = 200, g = makeGrid(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const buyuk = Math.hypot(x - 60, y - 100) < 40;
      const leke = Math.hypot(x - 170, y - 30) < 2;
      g.data[y * n + x] = buyuk || leke ? 1 : 0;
    }
  const r = inflateSilhouette(g, { threshold: 0.5, minRegion: 50 });
  assert.equal(r.info.dropped, 1, 'tek küçük leke elenmeliydi');
  assert.equal(r.grid.data[30 * n + 170], 0, 'elenen leke sıfırlanmalı');
});

test('blendRelief uçlarda saf kaynakları verir', () => {
  // Izgaralar Float32; tolerans buna göre (eps ~1.2e-7).
  const EPS = 1e-6;
  const a = makeGrid(10, 10, 0.2);
  const b = makeGrid(10, 10, 0.9);
  assert.ok(Math.abs(blendRelief(a, b, 0).data[0] - 0.2) < EPS);
  assert.ok(Math.abs(blendRelief(a, b, 1).data[0] - 0.9) < EPS);
  assert.ok(Math.abs(blendRelief(a, b, 0.5).data[0] - 0.55) < EPS);
});

console.log('derinlik çizimi');
test('stamp merkezde en güçlü, yarıçap dışında sıfır', () => {
  const l = createPaintLayer(60, 60);
  stamp(l, 30, 30, 10, 0.5, 0);
  assert.ok(Math.abs(l.data[30 * 60 + 30] - 0.5) < 1e-6, 'merkez tam güç almalı');
  assert.ok(l.data[30 * 60 + 36] > 0 && l.data[30 * 60 + 36] < 0.5, 'kenara doğru sönmeli');
  assert.equal(l.data[30 * 60 + 45], 0, 'yarıçap dışı dokunulmamalı');
});

test('stamp -1..1 aralığını aşmaz', () => {
  const l = createPaintLayer(40, 40);
  for (let i = 0; i < 30; i++) stamp(l, 20, 20, 8, 0.5, 1);
  assert.ok(l.data[20 * 40 + 20] <= 1 + 1e-9, `üst sınır aşıldı: ${l.data[20 * 40 + 20]}`);
  for (let i = 0; i < 80; i++) stamp(l, 20, 20, 8, -0.5, 1);
  assert.ok(l.data[20 * 40 + 20] >= -1 - 1e-9, 'alt sınır aşıldı');
});

test('stroke iki nokta arasında boşluk bırakmaz', () => {
  const l = createPaintLayer(120, 40);
  const base = makeGrid(120, 40, 0.5);
  stroke(l, base, 10, 20, 110, 20, { radius: 5, amount: 0.3, hardness: 1, mode: 'raise' });
  for (let x = 12; x <= 108; x += 2) {
    assert.ok(l.data[20 * 120 + x] > 0.01, `x=${x} boyanmamış — darbeler arası boşluk var`);
  }
});

test('applyPaint tabana ekler ve 0..1 aralığında kırpar', () => {
  const base = makeGrid(10, 10, 0.8);
  const l = createPaintLayer(10, 10);
  l.data.fill(0.5);
  assert.equal(applyPaint(base, l).data[0], 1, 'üst sınıra kırpılmalı');
  l.data.fill(-0.9);
  assert.equal(applyPaint(base, l).data[0], 0, 'alt sınıra kırpılmalı');
  l.data.fill(0.1);
  assert.ok(Math.abs(applyPaint(base, l).data[0] - 0.9) < 1e-6);
});

test('isEmpty boş katmanı tanır', () => {
  const l = createPaintLayer(20, 20);
  assert.equal(isEmpty(l), true);
  stamp(l, 10, 10, 3, 0.2, 0.5);
  assert.equal(isEmpty(l), false);
});

test('lower modu yükseltmeyi geri alır', () => {
  const l = createPaintLayer(60, 60);
  const base = makeGrid(60, 60, 0.5);
  stroke(l, base, 30, 30, 30, 30, { radius: 10, amount: 0.3, hardness: 1, mode: 'raise' });
  const yukari = l.data[30 * 60 + 30];
  stroke(l, base, 30, 30, 30, 30, { radius: 10, amount: 0.3, hardness: 1, mode: 'lower' });
  assert.ok(l.data[30 * 60 + 30] < yukari, 'alçaltma yükseltmeyi azaltmalı');
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

console.log('bakış yönü');

function kutu(cx, cy, cz, sx, sy, sz) {
  const v = [];
  for (const dz of [-1, 1]) for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
    v.push([cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2]);
  }
  const q = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [1, 3, 7, 5], [3, 2, 6, 7], [2, 0, 4, 6]];
  const t = [];
  for (const [a, b, c, d] of q) { t.push([v[a], v[b], v[c]]); t.push([v[a], v[c], v[d]]); }
  return t;
}

/** Ayakta duran figür: Z yukarı, önden arkaya ince. */
function ayaktaFigur() {
  return [].concat(
    kutu(0, 0, 120, 100, 45, 120),   // gövde
    kutu(0, 12, 205, 50, 40, 50),    // baş
    kutu(-70, -4, 130, 35, 30, 90),  // kollar
    kutu(70, -4, 130, 35, 30, 90),
    kutu(-30, 0, 30, 25, 25, 60),    // bacaklar
    kutu(30, 0, 30, 25, 25, 60)
  );
}

test('pickBestAxis ayakta figürde ÖNDEN bakar, tepeden değil', () => {
  // Bu tam olarak "STL yükledim ama hiçbir şey çıkmadı" hatasıydı:
  // ayakta duran figüre tepeden bakınca sadece omuz üstü görünüyordu.
  assert.equal(pickBestAxis(ayaktaFigur()).axis, 'y');
});

test('pickBestAxis model yatık kaydedilmişse de doğru yüzü bulur', () => {
  // Y yukarı (OBJ standardı): aynı figür, eksenler takas edilmiş
  const yatik = ayaktaFigur().map((t) => t.map(([x, y, z]) => [x, z, y]));
  assert.equal(pickBestAxis(yatik).axis, 'z');
});

test('pickBestAxis zaten düz olan rölyefte TEPEDEN bakar', () => {
  const rolyef = [].concat(
    kutu(0, 0, 5, 200, 150, 10),
    kutu(20, -10, 20, 80, 60, 30),
    kutu(-50, 30, 16, 40, 40, 22)
  );
  assert.equal(pickBestAxis(rolyef).axis, 'z');
});

test('tepeden bakış figürün boyunu ve siluetini yok eder', () => {
  // "STL yükledim ama hiçbir şey çıkmadı" hatasının ölçülebilir hâli.
  const tris = ayaktaFigur();

  // 1) Tepeden bakış modelin en uzun boyutunu tamamen kaybeder.
  const tepeden = projectedSize(tris, 'z');
  const onden = projectedSize(tris, 'y');
  assert.ok(onden.h > tepeden.h * 4,
    `önden bakış boyu korumalı: önden ${onden.h.toFixed(0)}mm, tepeden ${tepeden.h.toFixed(0)}mm`);

  // 2) Tepeden bakışta siluet dolu bir dikdörtgene yakındır; kol/bacak
  //    arasındaki boşluklar kaybolur, yani biçim bilgisi kalmaz.
  const kapsama = (axis) => {
    const { data, covered } = heightmapWithCoverage(tris, 140, 140, { axis });
    let n = 0;
    for (const c of covered) if (c) n++;
    return n / data.length;
  };
  assert.ok(kapsama('z') > kapsama('y') + 0.15,
    `tepeden siluet daha dolu olmalı: tepeden %${(kapsama('z') * 100).toFixed(0)}, ` +
    `önden %${(kapsama('y') * 100).toFixed(0)}`);
});

test('projectedSize bakış yönüne göre en-boy verir', () => {
  const tris = kutu(0, 0, 0, 100, 40, 200);
  const z = projectedSize(tris, 'z');   // XY düzlemi
  const y = projectedSize(tris, 'y');   // XZ düzlemi
  const x = projectedSize(tris, 'x');   // YZ düzlemi
  assert.ok(Math.abs(z.w - 100) < 1e-6 && Math.abs(z.h - 40) < 1e-6, `z: ${z.w}x${z.h}`);
  assert.ok(Math.abs(y.w - 100) < 1e-6 && Math.abs(y.h - 200) < 1e-6, `y: ${y.w}x${y.h}`);
  assert.ok(Math.abs(x.w - 40) < 1e-6 && Math.abs(x.h - 200) < 1e-6, `x: ${x.w}x${x.h}`);
  assert.ok(Math.abs(y.depth - 40) < 1e-6, 'önden bakışta derinlik Y ekseni olmalı');
});

test('heightmapWithCoverage kapsama maskesini doğru verir', () => {
  // Modelin kapladığı alan, izdüşüm çerçevesinin tamamı değil
  const tris = [].concat(kutu(-40, 0, 0, 20, 20, 100), kutu(40, 0, 0, 20, 20, 100));
  const { data, covered } = heightmapWithCoverage(tris, 100, 100, { axis: 'y' });
  let n = 0;
  for (const c of covered) if (c) n++;
  assert.ok(n > 0 && n < data.length, `kapsama %${(n / data.length * 100).toFixed(0)} — tam dolu olmamalı`);
  // Ortada boşluk var: iki çubuk arasında
  const orta = covered[50 * 100 + 50];
  assert.equal(orta, 0, 'iki çubuk arası boş kalmalı');
});

test('OBJ okunur: çokgen yüzler üçgenlenir, negatif indis çalışır', () => {
  const obj = [
    '# yorum', 'mtllib m.mtl', 'o parca',
    'v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 5',
    'vt 0 0', 'vn 0 0 1',
    'f 1/1/1 2/1/1 3/1/1',      // üçgen, doku+normal indisli
    'f 1 2 3 4',                 // dörtgen → 2 üçgen
    'f -4 -3 -2',                // negatif indis
  ].join('\n');
  const tris = parseObj(obj);
  assert.equal(tris.length, 4, `beklenen 4 üçgen, gelen ${tris.length}`);
  for (const t of tris) {
    assert.equal(t.length, 3);
    for (const p of t) assert.ok(p.every(Number.isFinite));
  }
});

test('parseMesh biçimi içerikten tanır, uzantıya güvenmez', () => {
  const obj = 'v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 5\nf 1 2 3\nf 1 3 4\n';
  const buf = new TextEncoder().encode(obj).buffer;
  assert.equal(parseMesh(buf, 'model.obj').format, 'OBJ');
  // Tarama uygulaması yanlış uzantıyla verse bile okunmalı
  assert.equal(parseMesh(buf, 'tarama.stl').format, 'OBJ');
  assert.equal(parseMesh(buf, '').format, 'OBJ');

  const ascii = 'solid a\nfacet normal 0 0 1\n outer loop\n  vertex 0 0 0\n' +
    '  vertex 10 0 0\n  vertex 0 10 5\n endloop\nendfacet\nendsolid a';
  assert.equal(parseMesh(new TextEncoder().encode(ascii).buffer, 'a.stl').format, 'STL');
});

test('bozuk ikili STL çökmez — üçgen sayısı dosyaya göre kırpılır', () => {
  // 80. bayttan okunan sayı dosyada olandan çok büyük
  const buf = new ArrayBuffer(200);
  new DataView(buf).setUint32(80, 999999, true);
  const tris = parseStl(buf);
  assert.ok(Array.isArray(tris));
  assert.ok(tris.length <= Math.floor((200 - 84) / 50), `taşma: ${tris.length}`);
});

test('3B model olmayan dosyalar reddedilir', () => {
  assert.equal(parseMesh(new ArrayBuffer(0), 'x.stl').format, null);

  const rastgele = new Uint8Array(5000);
  for (let i = 0; i < rastgele.length; i++) rastgele[i] = (i * 2654435761) % 256;
  const r = parseMesh(rastgele.buffer, 'tarama.stl');
  assert.equal(r.format, null, `rastgele bayt kabul edildi: ${r.tris.length} üçgen`);
  assert.ok(r.reason, 'sebep bildirilmeli');

  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, ...new Array(2000).fill(7)]);
  assert.equal(parseMesh(jpeg.buffer, 'foto.stl').format, null);
});

test('validateMesh geçersiz koordinatı ve bozuk ölçeği yakalar', () => {
  const saglam = [[[0, 0, 0], [10, 0, 0], [0, 10, 5]]];
  assert.equal(validateMesh(saglam).ok, true);
  assert.equal(validateMesh([]).ok, false);
  assert.equal(validateMesh([[[0, 0, 0], [NaN, 0, 0], [0, 1, 1]]]).ok, false);
  assert.equal(validateMesh([[[0, 0, 0], [1e15, 0, 0], [0, 1, 1]]]).ok, false);
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

// --- Dilim modu ---------------------------------------------------------
console.log('dilim (katmanlı heykel) modu');

function cylinderTris(cx, cy, z0, z1, r, seg = 32) {
  const v = [];
  for (const z of [z0, z1]) {
    for (let i = 0; i < seg; i++) {
      const a = (2 * Math.PI * i) / seg;
      v.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
    }
  }
  v.push([cx, cy, z0]); const mAlt = v.length - 1;
  v.push([cx, cy, z1]); const mUst = v.length - 1;
  const f = [];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    f.push([i, j, seg + j]); f.push([i, seg + j, seg + i]);
    f.push([j, i, mAlt]); f.push([seg + i, seg + j, mUst]);
  }
  return f.map(([a, b, c]) => [v[a], v[b], v[c]]);
}

test('küpün her dilimi tam kare çıkar', () => {
  const s = sliceMesh(cubeTris(100), { axis: 'z', pitch: 20 });
  assert.ok(s.count >= 4, `dilim sayısı ${s.count}`);
  for (const l of s.layers) {
    assert.equal(l.rings.length, 1, `dilim ${l.index}: ${l.rings.length} halka`);
    assert.equal(l.open, 0, 'kapalı modelde açık zincir olmamalı');
    assert.ok(Math.abs(Math.abs(signedArea(l.rings[0])) - 10000) < 1,
      `dilim ${l.index} alanı ${Math.abs(signedArea(l.rings[0]))}`);
  }
});

test('delikli gövdede kesit iç ve dış halka verir', () => {
  // Büyük silindirin içine küçük bir silindir oyulmuş gibi: iki halka.
  const dis = cylinderTris(0, 0, 0, 100, 60);
  const ic = cylinderTris(0, 0, -10, 110, 25).map((t) => [t[0], t[2], t[1]]); // ters normal = boşluk
  const s = sliceMesh([...dis, ...ic], { axis: 'z', pitch: 25 });
  const orta = s.layers[Math.floor(s.layers.length / 2)];
  assert.equal(orta.rings.length, 2, 'dış halka + delik bekleniyor');
  const sinif = classifyRings(orta.rings);
  assert.equal(sinif.filter((x) => !x.hole).length, 1);
  assert.equal(sinif.filter((x) => x.hole).length, 1);
});

test('açık model kapanmayan zincir olarak bildirilir', () => {
  // Tek üçgen: kapalı hacim değil.
  const s = sliceMesh([[[0, 0, 0], [100, 0, 0], [0, 100, 50]]], { axis: 'z', pitch: 10 });
  const acik = s.layers.reduce((a, l) => a + l.open, 0);
  assert.ok(acik > 0, 'açık yüzeyde kapanmayan zincir bildirilmeli');
});

test('ayrı gövdeler ayrı parça olur ve mil ikisinden de geçer', () => {
  // Gövde + iki ayrı bacak: alt dilimlerde 3 ada, üst dilimlerde 1.
  const tris = [
    ...cylinderTris(0, 0, 300, 900, 90),
    ...cylinderTris(-70, 0, 0, 300, 45),
    ...cylinderTris(70, 0, 0, 300, 45),
  ];
  const r = generateSlices(tris, { targetSize: 1200, thickness: 18, gap: 0, rodCount: 2 });
  assert.ok(r.parts.length > r.info.layerCount,
    'ayrı bacaklar yüzünden parça sayısı dilim sayısını aşmalı');
  assert.equal(r.info.rodPoints.length, 2, 'iki mil yerleştirilmeli');
  assert.equal(r.info.rodlessParts, 0, 'her parçadan bir mil geçmeli');
  // Gövde dilimi tek ada, iki mil deliği.
  const govde = r.parts.filter((p) => p.meta.layer === r.info.layerCount - 6);
  assert.equal(govde.length, 1);
  assert.equal(govde[0].holes.length, 2);
  // Delikler CW, dış halka CCW — DXF/dolgu kuralı.
  assert.ok(signedArea(govde[0].outline) > 0, 'dış halka CCW olmalı');
  for (const h of govde[0].holes) assert.ok(signedArea(h) < 0, 'delik CW olmalı');
  // Bacak diliminde iki ayrı parça, her birinde bir mil.
  const bacak = r.parts.filter((p) => p.meta.layer === 3);
  assert.equal(bacak.length, 2, 'iki bacak ayrı parça olmalı');
  for (const b of bacak) assert.equal(b.meta.rods, 1);
  // Aynı dilimin adaları harfle ayrılmalı.
  assert.notEqual(bacak[0].id, bacak[1].id);
});

test('milden geçmeyen parça sessizce bırakılmaz', () => {
  // Gövdeden tamamen uzakta duran ikinci bir kule: tek mil ikisini tutamaz.
  const tris = [
    ...cylinderTris(0, 0, 0, 900, 90),
    ...cylinderTris(600, 0, 0, 900, 40),
  ];
  const r = generateSlices(tris, { targetSize: 1200, thickness: 18, rodCount: 1 });
  assert.ok(r.info.rodlessParts > 0, 'uzaktaki kule milsiz kalmalı');
  assert.ok(r.warnings.some((w) => w.includes('mil geçmiyor')),
    'milsiz parçalar için uyarı yok');
});

test('her ada elendiğinde boş çıktı değil, sebep döner', () => {
  const r = generateSlices(cubeTris(100), { targetSize: 200, minArea: 1e9 });
  assert.equal(r.parts.length, 0);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Hiç parça üretilemedi/);
  assert.match(r.warnings[0], /En küçük ada|en küçük ada/);
});

test('dilim montaj kılavuzu mil boyunu ve yapıştırılacakları yazar', () => {
  const tris = [
    ...cylinderTris(0, 0, 0, 900, 90),
    ...cylinderTris(600, 0, 0, 900, 40),
  ];
  const r = generateSlices(tris, { targetSize: 1200, thickness: 18, rodCount: 1 });
  const g = assemblyGuide(r.info);
  assert.match(g, /MİL/, 'mil bilgisi yok');
  assert.match(g, /mm boyunda olmalı/, 'mil boyu yazılmıyor');
  assert.match(g, /mil geçmiyor/, 'milsiz parçalar kılavuzda anılmıyor');
  assert.match(g, /TEK MİL/, 'tek milin dönme riski yazılmıyor');
});

test('parça önizlemesi delikleri çiziyor', () => {
  // Delikler hiç çizilmiyordu; faset modunda delik olmadığı için fark
  // edilmemişti, ama dilim modunda mil deliği en kritik bilgi.
  const js = oku('js/preview2d.js');
  const govde = js.match(/export function drawParts[\s\S]*?\n}/)?.[0] || '';
  assert.ok(/part\.holes/.test(govde), 'drawParts delikleri çizmiyor');
  assert.ok(/evenodd/.test(govde), 'delikler çift-tek kuralıyla boşaltılmalı');
});

test('3B önizleme dilimleri kendi ekseni boyunca dizer', () => {
  // Dilim modu için dal yoktu; katman dalına düşüp `meta.z` arıyordu ve
  // dilimde öyle bir alan olmadığı için 48 dilim z=0'a yığılıyordu.
  const js = oku('js/preview3d.js');
  assert.ok(/info\.mode === 'slices'/.test(js), 'dilim modu için dal yok');
  const dal = js.match(/info\.mode === 'slices'[\s\S]*?\n    \} else \{/)?.[0] || '';
  assert.ok(/meta\.coord/.test(dal), 'dilim konumu meta.coord\'dan alınmıyor');
  assert.ok(/info\.axis === 'x'/.test(dal) && /info\.axis === 'y'/.test(dal),
    'üç dilim ekseni için ayrı yerleşim yok');
  // Serbest duran heykelin arkasına duvar konmamalı.
  assert.ok(/wall\.visible = false/.test(dal), 'dilim modunda duvar kapatılmıyor');
});

test('model gerektiren moda modelsiz geçince önizleme temizlenir', () => {
  // Temizlenmezse önceki modun paneli 3B sahnede asılı kalıyor ve kullanıcı
  // yeni modun çalışmadığını sanıyor.
  const js = oku('js/main.js');
  const govde = js.match(/function regenerateMesh[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(govde, 'regenerateMesh bulunamadı');
  assert.ok(/preview3d\?\.update\(state\)/.test(govde), '3B sahne temizlenmiyor');
  assert.ok(/drawParts\(els\['view-plan'\], \[\]\)/.test(govde), 'plan tuvali temizlenmiyor');
});

test('dilim düzlem eksenleri çevrimsel (sağ elli)', () => {
  // Çevrimsel olmayan sıra sol elli çerçeve verir; kesim doğru çıkar ama
  // 3B önizlemede heykel aynalanmış görünür.
  const js = oku('js/slice.js');
  assert.ok(/if \(ai === 1\) return \[2, 0\]/.test(js),
    'y ekseni için düzlem (z, x) olmalı — (x, z) sol elli çerçeve verir');
  // Üç eksende de dış halka CCW çıkmalı.
  for (const axis of ['x', 'y', 'z']) {
    const s = sliceMesh(cubeTris(100), { axis, pitch: 25 });
    for (const l of s.layers) {
      assert.ok(signedArea(l.rings[0]) > 0, `${axis} ekseninde halka ters`);
      assert.ok(Math.abs(Math.abs(signedArea(l.rings[0])) - 10000) < 1,
        `${axis} ekseninde alan yanlış`);
    }
  }
});

test('kare kazık yuvası köşe paylı ve ters yönde', () => {
  const tris = cylinderTris(0, 0, 0, 900, 90);
  const kare = generateSlices(tris, {
    targetSize: 1200, rodShape: 'kare', rodDiameter: 60, rodCount: 1, toolDiameter: 6,
  });
  const p0 = kare.parts.find((p) => p.holes.length === 1);
  assert.ok(p0, 'kazık yuvası açılmamış');
  const yuva = p0.holes[0];
  // Delik CW olmalı (dış halka CCW).
  assert.ok(signedArea(yuva) < 0, 'yuva ters yönde değil');
  // Köşe payı yuvayı BÜYÜTMELİ: pay olmasa kazık eksik otururdu.
  const alan = Math.abs(signedArea(yuva));
  assert.ok(alan > 3600, `yuva alanı ${alan.toFixed(0)}, ham kareden (3600) büyük olmalı`);
  assert.ok(alan < 3600 * 1.2, 'köşe payı gereğinden çok malzeme almış');
  assert.ok(yuva.length > 8, 'köşe payı eklenmemiş (düz kare)');
  // Paysız istenirse ham kare çıkmalı.
  const paysiz = generateSlices(tris, {
    targetSize: 1200, rodShape: 'kare', rodDiameter: 60, rodCount: 1, toolDiameter: 0,
  });
  assert.equal(paysiz.parts.find((p) => p.holes.length === 1).holes[0].length, 4);
});

test('hiçbir yuva parçanın dışına taşmaz', () => {
  // Kemik payı karenin KÖŞESİNDEN uç yarıçapı kadar daha dışarı çıkar.
  // Boşluk yalnızca çevrel yarıçapla ölçülürse dar kesitlerde yuva kenardan
  // taşar ve parça o köşeden kopar.
  const tris = [...cylinderTris(0, 0, 300, 900, 90),
    ...cylinderTris(-70, 0, 0, 300, 45), ...cylinderTris(70, 0, 0, 300, 45)];
  for (const rodShape of ['yuvarlak', 'kare']) {
    for (const rodDiameter of [10, 40, 60]) {
      const r = generateSlices(tris, {
        targetSize: 1200, rodShape, rodDiameter, rodCount: 1, toolDiameter: 6,
      });
      for (const part of r.parts) {
        for (const h of part.holes) {
          for (const pt of h) {
            assert.ok(pointInRing(pt, part.outline),
              `${rodShape} ${rodDiameter} mm: ${part.id} yuvası parçadan taşıyor`);
          }
        }
      }
    }
  }
});

test('kare kazık çevrel yarıçapıyla ölçülür', () => {
  // Karenin köşesi merkeze kenar·√2/2 uzaklıktadır. Yarıçap olarak kenar/2
  // kullanılsaydı kazık kâğıtta sığar, tezgâhta köşesi parçadan taşardı.
  const tris = cylinderTris(0, 0, 0, 900, 40);   // ince kule
  const r = generateSlices(tris, {
    targetSize: 1200, rodShape: 'kare', rodDiameter: 100, rodCount: 1, toolDiameter: 6,
  });
  // 100 mm kare, çevrel yarıçap 70,7 — kulenin yarıçapından büyük, sığmamalı.
  assert.equal(r.info.rodPoints.length, 0, 'sığmayan kazık yerleştirilmiş');
  assert.ok(r.warnings.some((w) => w.includes('sığmıyor')), 'sığmama uyarısı yok');
});

test('önerilen omurga ölçüsü gerçekten çalışıyor', () => {
  // Uyarının verdiği sayı işe yaramıyorsa uyarı değil, tuzaktır.
  const modeller = [
    cylinderTris(0, 0, 0, 900, 90),
    [...cylinderTris(0, 0, 300, 900, 90),
      ...cylinderTris(-70, 0, 0, 300, 45), ...cylinderTris(70, 0, 0, 300, 45)],
  ];
  for (const tris of modeller) {
    for (const rodShape of ['yuvarlak', 'kare']) {
      const buyuk = generateSlices(tris, {
        targetSize: 1200, rodShape, rodDiameter: 500, rodCount: 1, toolDiameter: 6,
      });
      const u = buyuk.warnings.find((w) => w.includes('sığmıyor'));
      assert.ok(u, `${rodShape}: 500 mm için sığmama uyarısı yok`);
      const onerilen = Number(u.match(/~(\d+) mm/)[1]);
      assert.ok(onerilen > 0, 'önerilen ölçü sıfır');
      const dene = generateSlices(tris, {
        targetSize: 1200, rodShape, rodDiameter: onerilen, rodCount: 1, toolDiameter: 6,
      });
      assert.ok(dene.info.rodPoints.length > 0,
        `${rodShape}: önerilen ${onerilen} mm yerleştirilemedi`);
      assert.ok(!dene.warnings.some((w) => w.includes('sığmıyor')),
        `${rodShape}: önerilen ${onerilen} mm hâlâ sığmıyor`);
    }
  }
});

test('sığan ölçüde gereksiz uyarı çıkmaz', () => {
  // Ölçü bilgisi yalnızca işe yaradığında uyarıdır; her seferinde yazmak
  // gürültüdür ve gerçek uyarıları gölgeler.
  const r = generateSlices(cylinderTris(0, 0, 0, 900, 90), {
    targetSize: 1200, rodShape: 'kare', rodDiameter: 60, rodCount: 1, toolDiameter: 6,
  });
  assert.ok(!r.warnings.some((w) => w.includes('sığmıyor')), 'sığdığı hâlde uyarı var');
  // Boşluk payı kılavuzda durmalı.
  assert.match(assemblyGuide(r.info), /kadar kaldırır/, 'boşluk payı kılavuzda yok');
});

test('kare kazık kılavuzu köşe payını ve dönmeyi anlatır', () => {
  const r = generateSlices(cylinderTris(0, 0, 0, 900, 90), {
    targetSize: 1200, rodShape: 'kare', rodDiameter: 60, rodCount: 1, toolDiameter: 6,
  });
  const g = assemblyGuide(r.info);
  assert.match(g, /KAZIK/, 'kazık başlığı yok');
  assert.match(g, /60×60 mm/, 'kesit ölçüsü yazılmıyor');
  assert.match(g, /kemik payı/, 'köşe payı anlatılmıyor');
  assert.match(g, /dönmeyi kendi engeller/, 'kare kesitin dönme avantajı yazılmıyor');
});

test('dilim modu arayüzde ve önbellek listesinde', () => {
  const html = oku('index.html');
  assert.ok(html.includes('id="mode-slices"'), 'mod düğmesi yok');
  assert.ok(html.includes('id="slices-params"'), 'ayar bölümü yok');
  for (const id of ['p-sculptSize', 'p-sliceAxis', 'p-rodDiameter', 'p-rodCount']) {
    assert.ok(html.includes(`id="${id}"`), `${id} yok`);
  }
  const js = oku('js/main.js');
  assert.ok(/'ribs', 'contour', 'facets', 'slices'/.test(js), 'mod listesine eklenmemiş');
  const sw = oku('sw.js');
  assert.ok(sw.includes("'./js/slice.js'"), 'slice.js önbellek listesinde yok');
  assert.ok(sw.includes("'./js/modes/slices.js'"), 'slices.js önbellek listesinde yok');
});

// --- Sadeleştirme ve görselden kabartma ---------------------------------
console.log('sadeleştirme ve görselden kabartma');

/** Yoğun, EĞRİ yüzeyli kapalı küre — yapay zekâ modellerinin tipik hâli. */
function denseSphere(r = 100, seg = 48, ring = 32) {
  const v = [];
  for (let i = 0; i <= ring; i++) {
    const phi = (Math.PI * i) / ring;
    for (let j = 0; j < seg; j++) {
      const th = (2 * Math.PI * j) / seg;
      v.push([r * Math.sin(phi) * Math.cos(th), r * Math.sin(phi) * Math.sin(th), r * Math.cos(phi)]);
    }
  }
  const idx = (i, j) => i * seg + (j % seg);
  const f = [];
  for (let i = 0; i < ring; i++) {
    for (let j = 0; j < seg; j++) {
      if (i > 0) f.push([idx(i, j), idx(i + 1, j), idx(i, j + 1)]);
      if (i < ring - 1) f.push([idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1)]);
    }
  }
  return f.map(([a, b, c]) => [v[a], v[b], v[c]]);
}

test('sadeleştirme hedefe iner ve ağı kapalı tutar', () => {
  const tris = denseSphere();
  const once = checkClosed(tris, 1e-6);
  assert.ok(once.closed, 'test küresi kapalı değil');
  const d = decimate(tris, 200);
  assert.ok(d.after <= 220, `hedef 200, ${d.after} üçgende kaldı`);
  const sonra = checkClosed(d.tris, 1e-6);
  // Bağlantı koşulu olmadan çökertme ağı manifold olmaktan çıkarıyordu:
  // gerçek bir modelde açık kenar 6'dan 28'e fırlıyordu.
  assert.ok(sonra.closed, `sadeleştirme ağda ${sonra.openEdges} açık kenar bıraktı`);
  assert.ok(sonra.volume > 0, 'sadeleştirme ağı ters çevirdi');
});

test('sadeleştirme biçimi korur, büzmez', () => {
  // Yalnızca orta noktaya çökertmek dışbükey yüzeyi içe büzer; en iyi
  // nokta çözülmezse küre küçülür.
  const tris = denseSphere(100);
  const d = decimate(tris, 300);
  let enUzak = 0, enYakin = Infinity;
  for (const t of d.tris) {
    for (const p of t) {
      const r = Math.hypot(p[0], p[1], p[2]);
      enUzak = Math.max(enUzak, r);
      enYakin = Math.min(enYakin, r);
    }
  }
  // Köşeler 100 mm yarıçaplı yüzeyin yakınında kalmalı.
  assert.ok(enYakin > 90, `küre içe büzülmüş: en yakın köşe ${enYakin.toFixed(1)} mm`);
  assert.ok(enUzak < 110, `köşe dışarı kaçmış: ${enUzak.toFixed(1)} mm`);
});

test('sadeleştirme hiçbir köşeyi modelin dışına kaçırmaz', () => {
  // "Orta noktadan 2 kenar boyu" izni kenarlar uzadıkça katlanıyor, bir
  // köşe model boyunun milyonlarca katı uzağa gidiyordu.
  const tris = denseSphere(100);
  for (const hedef of [400, 150, 60]) {
    const d = decimate(tris, hedef);
    for (const t of d.tris) {
      for (const p of t) {
        for (const c of p) assert.ok(Math.abs(c) < 105, `hedef ${hedef}: köşe ${c} dışarıda`);
      }
    }
  }
});

test('zaten az üçgenli model sadeleştirilmez', () => {
  const tris = cubeTris(100);
  const d = decimate(tris, 300);
  assert.equal(d.after, tris.length);
  assert.equal(d.tris, tris, 'düşük poligonlu model olduğu gibi dönmeli');
});

test('görselden kurulan kabartma kapalı ve dışa dönük', () => {
  const g = makeGrid(60, 40);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 60; x++) {
      g.data[y * 60 + x] = Math.exp(-(((x - 30) ** 2) / 200 + ((y - 20) ** 2) / 100));
    }
  }
  for (const cells of [8, 16, 28]) {
    const tris = meshFromHeightmap(g, { width: 600, height: 400, depth: 60, cells });
    const k = checkClosed(tris, 1e-6);
    assert.ok(k.closed, `hücre ${cells}: kabartma kapalı değil (${k.openEdges} açık kenar)`);
    // İlk sürümde normaller içe dönüktü — faset modunda dışbükey/içbükey
    // dikişler yer değiştirirdi.
    assert.ok(k.volume > 0, `hücre ${cells}: normaller içe dönük`);
  }
});

test('kabartma kameraya bakan yöne çıkar', () => {
  // Önizleme model (x,y,z) → sahne (x,z,-y) eşler, kamera +z'de. Kabartma
  // +y'ye çıksaydı kamera düz arka yüze bakardı; ilk sürümde tam bu oldu.
  const g = makeGrid(20, 20, 1);
  const tris = meshFromHeightmap(g, { width: 200, height: 200, depth: 50, backThickness: 10, cells: 6 });
  let enKucukY = Infinity, enBuyukY = -Infinity;
  for (const t of tris) for (const p of t) { enKucukY = Math.min(enKucukY, p[1]); enBuyukY = Math.max(enBuyukY, p[1]); }
  assert.ok(enBuyukY <= 1e-9, 'arka yüz y=0 olmalı');
  assert.ok(enKucukY < -50, 'kabartma -y yönüne çıkmalı');
});

test('görselden kabartma poligonal kabukta parça üretir', () => {
  const g = makeGrid(60, 40);
  for (let i = 0; i < g.data.length; i++) g.data[i] = 0.5 + 0.5 * Math.sin(i / 37);
  const tris = meshFromHeightmap(g, { width: 600, height: 400, depth: 60, cells: 10 });
  const r = generateFacets(tris, { targetSize: 600, minArea: 0, unfold: false });
  assert.ok(r.parts.length > 10, `yalnızca ${r.parts.length} parça çıktı`);
  assert.ok(!r.warnings.some((w) => w.includes('karşı tarafı yok')), 'kabartma kapalı değil');
});

test('kalınlık telafisi faseti yok etmez', () => {
  // Telafi küçük fasette halkayı sıfıra indiriyordu ve parça öyle
  // tutuluyordu: 0 mm²'lik, kesilemeyen parçalar çıkıyordu.
  const d = decimate(denseSphere(100), 250);
  const r = generateFacets(d.tris, { targetSize: 300, minArea: 0, thickness: 4, thicknessComp: true, unfold: false });
  for (const p of r.parts) {
    assert.ok(Math.abs(signedArea(p.outline)) > 0.5, `${p.id} telafide yok olmuş`);
  }
});

test('poligonal kabuk arayüzü sadeleştirme ve kabartma alanlarını taşır', () => {
  const html = oku('index.html');
  for (const id of ['p-targetFaces', 'p-reliefCells', 'p-reliefDepth']) {
    assert.ok(html.includes(`id="${id}"`), `${id} yok`);
  }
  const js = oku('js/main.js');
  assert.ok(/function facetMeshSource/.test(js), 'kaynak seçimi yok');
  // Önbellek model KİMLİĞİNE bakmalı; üçgen sayısına bakan anahtar aynı
  // sayıda üçgenli iki modeli karıştırırdı.
  assert.ok(/decimateCache\?\.src !== taban/.test(js), 'önbellek modeli referansla ayırmıyor');
  assert.ok(/remeshCache\?\.src !== state\.tris/.test(js), 'onarım önbelleği modeli referansla ayırmıyor');
  // Görsel yüklenince eski 3B model kaynak olmaktan çıkmalı.
  const yukle = js.match(/async function loadImageFile[\s\S]*?\n}/)?.[0] || '';
  assert.ok(/state\.tris = null/.test(yukle), 'görsel yüklenince eski model temizlenmiyor');
});

test('hiç faset kalmayınca sessiz kalmaz, sebebini söyler', () => {
  // En küçük faset değeri modelin tamamını eliyor. Eskiden uygulama boş
  // çıktı veriyordu: ne parça ne uyarı. Kullanıcı bomboş ekrana bakıyordu.
  const r = generateFacets(icoTris(), { targetSize: 100, minArea: 100000 });
  assert.equal(r.parts.length, 0);
  assert.equal(r.warnings.length, 1, 'tek ve net bir uyarı bekleniyor');
  assert.match(r.warnings[0], /Hiç parça üretilemedi/);
  assert.match(r.warnings[0], /En küçük faset/, 'suçlu ayar adıyla anılmalı');
  assert.match(r.warnings[0], /100000 mm²/, 'kullanılan değer yazılmalı');
});

test('öksüz dikiş uyarısı gerçek sebebi gösterir', () => {
  // Eski mesaj her durumu "en küçük faset filtresi" diye raporluyordu;
  // filtre hiçbir şey elemese bile. Sebep artık sayılardan geliyor.
  const buyuk = icoTris().map((t) => t.map(([x, y, z]) => [x, y, z]));
  const r = generateFacets(buyuk, { targetSize: 300, minArea: 2000 });
  const u = r.warnings.find((w) => w.includes('karşı parçası'));
  if (u) {
    assert.match(u, /Sebep:/, 'sebep yazılmıyor');
    assert.match(u, /kaynaklanamaz/, 'sonucun ne olduğu söylenmiyor');
  }
  // Filtre hiçbir şeyi elemediğinde uyarı da çıkmamalı.
  const temiz = generateFacets(icoTris(), { targetSize: 600, minArea: 1 });
  assert.equal(temiz.warnings.filter((w) => w.includes('karşı parçası')).length, 0,
    'eleme yokken öksüz dikiş uyarısı çıkmamalı');
});

test('eleme sebepleri ayrı ayrı sayılır', () => {
  const js = oku('js/modes/facets.js');
  assert.ok(/elenen = \{ halka: 0, kenar: 0, duzlem: 0, alan: 0 \}/.test(js),
    'eleme sayaçları yok');
  // Dört eleme noktasının hepsi sayılmalı; biri sayılmazsa sebep yanlış çıkar.
  for (const k of ['elenen.halka++', 'elenen.kenar++', 'elenen.duzlem++', 'elenen.alan++']) {
    assert.ok(js.includes(k), `${k} sayılmıyor`);
  }
  // Eski mesaj, sebebi ne olursa olsun alan filtresini suçluyordu.
  assert.ok(!/karşı parçası elendi \(en küçük faset filtresi\)/.test(js),
    'eski, her sebebi alan filtresine yıkan mesaj hâlâ duruyor');
});

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

console.log('bozuk model onarımı');

/**
 * At modelindeki bozuklukların küçük bir taklidi: kapalı bir kürenin
 * bir bölgesi DELİNMİŞ (açık kenarlar), üstüne gövdeye dokunan ince bir
 * "saç teli" ve havada asılı kopuk bir kırıntı eklenmiş.
 */
function bozukKure() {
  const kure = denseSphere(100, 48, 32);
  // Delik: kutup çevresindeki üçgenlerin bir kısmını sil.
  const delikli = kure.filter((t) => !(t[0][2] > 92 && t[0][0] > 0));
  const tel = [];
  // İnce tel: 1 mm kalınlığında, 60 mm uzunluğunda üçgen prizma.
  const a = [[0, 0.6, 95], [0.5, -0.3, 95], [-0.5, -0.3, 95]];
  const b = a.map(([x, y, z]) => [x + 60, y, z + 40]);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    tel.push([a[i], b[i], b[j]], [a[i], b[j], a[j]]);
  }
  tel.push([a[0], a[2], a[1]], [b[0], b[1], b[2]]);
  // Kırıntı: gövdeden uzakta küçük bir dörtyüzlü.
  const k = [[150, 0, 0], [180, 0, 0], [165, 26, 0], [165, 9, 25]];
  const kirinti = [[k[0], k[2], k[1]], [k[0], k[1], k[3]], [k[1], k[2], k[3]], [k[0], k[3], k[2]]];
  return delikli.concat(tel, kirinti);
}

test('ağ sağlığı delikli modeli bozuk, temiz modeli sağlam bulur', () => {
  const temiz = meshHealth(denseSphere());
  assert.equal(temiz.openEdges, 0);
  assert.equal(temiz.nonManifold, 0);
  assert.equal(temiz.euler, 2, 'küre Euler karakteristiği 2 olmalı');
  assert.equal(temiz.bozuk, false);
  const bozuk = meshHealth(bozukKure());
  assert.ok(bozuk.openEdges > 20, `delik görülmedi (${bozuk.openEdges})`);
  assert.equal(bozuk.bozuk, true);
});

test('birkaç açık kenar onarım tetiklemez', () => {
  // Temiz yapay zekâ modelinde 6 çakışık kenar vardı; onarım ince
  // bacakları yumuşatıp siliyordu. Az sayıda kusur doğrudan sadeleşmeli.
  const kure = denseSphere();
  const h = meshHealth(kure.slice(0, kure.length - 2));
  assert.ok(h.openEdges > 0 && h.openEdges <= 6);
  assert.equal(h.bozuk, false);
});

test('onarım bozuk modelden kapalı ve tek parça ağ kurar', () => {
  const r = voxelRemesh(bozukKure(), { resolution: 64, smooth: 1 });
  const c = checkClosed(r.tris, 1e-9);
  assert.ok(c.closed, `onarılan ağda ${c.openEdges} açık kenar`);
  // Hacim korunmalı: 100 mm yarıçaplı küre ≈ 4.19 milyon mm³.
  const kure = (4 / 3) * Math.PI * 100 ** 3;
  assert.ok(Math.abs(c.volume - kure) / kure < 0.08, `hacim ${c.volume.toFixed(0)} (beklenen ~${kure.toFixed(0)})`);
  // Kopuk kırıntı atılmalı: ağ kürenin kutusunun dışına taşmamalı.
  const maxX = r.tris.flat().reduce((m, p) => Math.max(m, p[0]), -Infinity);
  assert.ok(maxX < 145, `kırıntı atılmadı (x = ${maxX.toFixed(1)})`);
  assert.ok(r.info.removed > 0, 'atılan parça bildirilmedi');
});

test('onarım ince teli yumuşatıp siler', () => {
  const r = voxelRemesh(bozukKure(), { resolution: 64, smooth: 1 });
  // Tel ucu (x≈60, z≈135) ile gövdeden en uzak nokta karşılaştırılır.
  const uzak = r.tris.flat().reduce((m, p) => Math.max(m, Math.hypot(p[0], p[1], p[2])), 0);
  assert.ok(uzak < 115, `tel duruyor (en uzak nokta ${uzak.toFixed(1)} mm)`);
});

test('onarılan ağ hedef yüzey sayısına tam iner', () => {
  // Hacimden kurulan ağ kıymık üçgen doludur; kıymık eşiği sabit kalınca
  // sadeleştirme at modelinde 300 hedefinde 878 üçgende duruyordu.
  const r = voxelRemesh(bozukKure(), { resolution: 64, smooth: 1 });
  const d = decimate(r.tris, 300);
  assert.equal(d.after, 300);
  assert.ok(checkClosed(d.tris, 1e-9).closed, 'sadeleştirme onarılan ağı açtı');
});

test('bozuk modelde poligonal kabuk dağılmaz', () => {
  // Doğrudan sadeleştirilen bozuk modelde açık kenarlar kalıyor ve dikişler
  // eşsiz çıkıyordu; onarımdan geçen model kapalı fasetler vermeli.
  const r = voxelRemesh(bozukKure(), { resolution: 64, smooth: 1 });
  const d = decimate(r.tris, 300);
  const f = generateFacets(d.tris, { targetSize: 600, minArea: 0, unfold: true });
  assert.equal(f.info.openEdges, 0);
  assert.ok(!f.warnings.some((w) => w.includes('karşı tarafı yok')), 'açık kenar kaldı');
});

test('bükülemeyecek kadar keskin kenar büküme dönmez', () => {
  // Bıçak sırtı kenar (iç açı ~10°) açınımda büküm sayılıyor, büküm payı
  // hesabı tavana vurup 672.7 mm gibi anlamsız sonuç veriyordu.
  const r = voxelRemesh(bozukKure(), { resolution: 64, smooth: 1 });
  const d = decimate(r.tris, 300);
  const f = generateFacets(d.tris, { targetSize: 600, minArea: 0, unfold: true, maxBend: 150 });
  for (const fold of f.folds || []) {
    assert.ok(Math.abs(180 - fold.angle) <= 150, `${fold.angle.toFixed(0)}° büküm açınıma girdi`);
  }
  assert.ok(!f.warnings.some((w) => /büküm payı \d{3,}/.test(w)), 'yüzlerce mm büküm payı uyarısı');
});

test('model onarımı arayüzde seçilebilir ve servis çalışanında', () => {
  const html = oku('index.html');
  assert.ok(html.includes('id="p-remesh"'), 'p-remesh yok');
  for (const v of ['oto', 'acik', 'kapali']) assert.ok(html.includes(`value="${v}"`), `${v} seçeneği yok`);
  const js = oku('js/main.js');
  assert.ok(/els\['p-remesh'\]/.test(js), 'main.js seçimi okumuyor');
  assert.ok(/state\.remeshCache = null/.test(js), 'görsel yüklenince onarım önbelleği temizlenmiyor');
  assert.ok(oku('sw.js').includes("'./js/remesh.js'"), 'remesh.js çevrimdışı listede yok');
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
  assert.ok(segs.every(([a, b]) => b[0] - a[0] <= 8 + 1e-9), 'kesim boyu aşılmamalı');
});

test('tek köprü: ortada tam istenen genişlikte dolu pay bırakır', () => {
  // Köprünün sığdığı uzunluklarda genişlik tam korunmalı.
  for (const len of [80, 150, 300, 500]) {
    const segs = bridgeLine([0, 0], [len, 0], { mode: 'tek', bridge: 25 });
    assert.equal(segs.length, 2, `${len}mm: iki kesim beklenir`);
    const bridge = segs[1][0][0] - segs[0][1][0];
    assert.ok(Math.abs(bridge - 25) < 1e-6, `${len}mm: köprü ${bridge}, 25 olmalı`);
    // Köprü tam ortada olmalı
    const mid = (segs[0][1][0] + segs[1][0][0]) / 2;
    assert.ok(Math.abs(mid - len / 2) < 1e-6, `${len}mm: köprü ortada değil (${mid})`);
    // Uçlarda dolu pay kalmalı, çizgi dışına taşmamalı
    assert.ok(segs[0][0][0] > 0 && segs[1][1][0] < len);
  }
});

test('tek köprü: sığmayan köprü kısaltılır, çok kısa kenarda hiç kesilmez', () => {
  // 30 mm kenara 25 mm köprü sığmaz; köprü kısalır ama kenar yine rahatlatılır.
  const dar = bridgeLine([0, 0], [30, 0], { mode: 'tek', bridge: 25 });
  assert.equal(dar.length, 2);
  const bridge = dar[1][0][0] - dar[0][1][0];
  assert.ok(bridge > 0 && bridge < 25, `köprü kısaltılmalıydı: ${bridge}`);
  assert.ok(dar.every(([a, b]) => b[0] - a[0] > 1), 'anlamsız minik kesim üretilmemeli');

  // Hiç yer kalmayan kenarda kesim yapılmaz, çizgi dolu bırakılır.
  assert.equal(bridgeLine([0, 0], [15, 0], { mode: 'tek', bridge: 25 }).length, 0);
});

test('oto mod: sınırın altı tek köprü, üstü dağıtık', () => {
  const kisa = bridgeLine([0, 0], [150, 0], { mode: 'oto', autoLimit: 250, bridge: 25, cut: 30, gap: 8 });
  const uzun = bridgeLine([0, 0], [400, 0], { mode: 'oto', autoLimit: 250, bridge: 25, cut: 30, gap: 8 });
  assert.equal(kisa.length, 2, 'kısa kenar tek köprü olmalı');
  assert.ok(uzun.length > 3, `uzun kenar dağıtık olmalı, ${uzun.length} kesim`);
});

test('her modda kesimler çizgi içinde ve birbirine değmez', () => {
  for (const mode of ['tek', 'dagitik', 'oto']) {
    for (const len of [60, 120, 350, 700]) {
      const segs = bridgeLine([0, 0], [len, 0], { mode, bridge: 25, cut: 30, gap: 8, autoLimit: 250 });
      let prevEnd = 0;
      for (const [a, b] of segs) {
        assert.ok(a[0] >= 0 && b[0] <= len, `${mode}/${len}: kesim çizgiyi aşıyor`);
        assert.ok(a[0] > prevEnd, `${mode}/${len}: kesimler üst üste biniyor`);
        assert.ok(b[0] > a[0], `${mode}/${len}: sıfır uzunlukta kesim`);
        prevEnd = b[0];
      }
      assert.ok(prevEnd <= len, `${mode}/${len}: son kesim taşıyor`);
    }
  }
});

test('parça hiçbir modda ikiye ayrılmaz — daima dolu pay kalır', () => {
  for (const mode of ['tek', 'dagitik', 'oto']) {
    for (const len of [60, 200, 600]) {
      const segs = bridgeLine([0, 0], [len, 0], { mode, bridge: 25, cut: 30, gap: 8 });
      const cut = segs.reduce((s2, [a, b]) => s2 + (b[0] - a[0]), 0);
      assert.ok(len - cut > 5, `${mode}/${len}: dolu pay ${len - cut} mm — çok az`);
    }
  }
});

test('dashLine eski çağrı biçimi çalışmaya devam eder', () => {
  const segs = dashLine([0, 0], [100, 0], 8, 4);
  assert.ok(segs.length >= 3);
  assert.ok(segs.every(([a, b]) => b[0] - a[0] <= 8 + 1e-9));
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

console.log('levha yönü');
test('autoOrient levhayı çeviremediğinde sonucu bozmaz', () => {
  const kare = nest(ribs.parts, { sheetW: 2000, sheetH: 2000, autoOrient: true });
  const kareOff = nest(ribs.parts, { sheetW: 2000, sheetH: 2000, autoOrient: false });
  assert.equal(kare.sheets.length, kareOff.sheets.length);
});

test('autoOrient hiçbir zaman daha kötü sonuç seçmez', () => {
  for (const [w, h] of [[2100, 2800], [2440, 1220], [3000, 1500]]) {
    const a = nest(ribs.parts, { sheetW: w, sheetH: h, autoOrient: false });
    const b = nest(ribs.parts, { sheetW: h, sheetH: w, autoOrient: false });
    const oto = nest(ribs.parts, { sheetW: w, sheetH: h, autoOrient: true });
    assert.ok(oto.oversized.length <= Math.min(a.oversized.length, b.oversized.length));
    if (a.oversized.length === b.oversized.length) {
      assert.ok(oto.sheets.length <= Math.min(a.sheets.length, b.sheets.length),
        `${w}x${h}: oto ${oto.sheets.length}, dik ${a.sheets.length}, yatay ${b.sheets.length}`);
    }
  }
});

test('MDF 210x280 levhada 2600 mm lamel sığar, 2440 levhada sığmaz', () => {
  const uzun = generateRibs(applyFilters(testGrid(), {}), {
    panelW: 1200, panelH: 2600, thickness: 18, gap: 6,
  });
  const mdf = nest(uzun.parts, { sheetW: 2100, sheetH: 2800 });
  const kontrplak = nest(uzun.parts, { sheetW: 2440, sheetH: 1220 });
  assert.equal(mdf.oversized.length, 0, `MDF'de sığmayan: ${mdf.oversized.length}`);
  assert.ok(kontrplak.oversized.length > 0, 'kontrplakta sığmaması beklenir');
});

test('seçilen yön dışa aktarıma da yansır', () => {
  const r = nest(ribs.parts, { sheetW: 2100, sheetH: 2800, autoOrient: true });
  for (const sh of r.sheets) {
    assert.equal(sh.w, r.opts.sheetW);
    assert.equal(sh.h, r.opts.sheetH);
  }
  assert.ok((r.opts.sheetW === 2100 && r.opts.sheetH === 2800) ||
            (r.opts.sheetW === 2800 && r.opts.sheetH === 2100));
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
  // Sığmayan parçalar doluluğa katılmamalı.
  const tall = generateRibs(applyFilters(testGrid(), {}), {
    panelW: 1200, panelH: 2600, thickness: 18, gap: 6,
  });
  const tallNest = nest(tall.parts, { sheetW: 2440, sheetH: 1220 });
  const tallList = buildCutList(tall.parts, tallNest, tall.info, {});
  assert.ok(tallNest.oversized.length > 0, 'bu senaryoda sığmayan parça olmalı');
  assert.ok(tallList.summary.utilisation <= 100,
    `doluluk %100'ü aşamaz: ${tallList.summary.utilisation}`);
  assert.equal(tallList.summary.placedCount, tall.parts.length - tallNest.oversized.length);
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

// --- Köşe payı (kemik) --------------------------------------------------
console.log('köşe payı');

// Alt kenarında 40..60 arası, 10 mm derinliğinde kanal olan dikdörtgen.
function kanalliHalka(a = 40, b = 60, d = 10, L = 100, H = 50) {
  return [[0, 0], [a, 0], [a, d], [b, d], [b, 0], [L, 0], [L, H], [0, H]];
}

function kendiniKesiyorMu(ring) {
  const n = ring.length;
  const cr = (o, x, y) => (x[0] - o[0]) * (y[1] - o[1]) - (x[1] - o[1]) * (y[0] - o[0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const p1 = ring[i], p2 = ring[(i + 1) % n], p3 = ring[j], p4 = ring[(j + 1) % n];
      const d1 = cr(p3, p4, p1), d2 = cr(p3, p4, p2);
      const d3 = cr(p1, p2, p3), d4 = cr(p1, p2, p4);
      const kesisir = ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9))
        && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
      if (kesisir) return [i, j];
    }
  }
  return null;
}

test('iç ve dış köşeler doğru ayrılır', () => {
  const ring = kanalliHalka();
  const k = classifyCorners(ring);
  // Kanal dibindeki iki köşe (40,10) ve (60,10) içbükey, kalan altısı dışbükey.
  assert.equal(k.filter((c) => !c.convex).length, 2, 'iç köşe sayısı 2 olmalı');
  assert.equal(k[2].convex, false);
  assert.equal(k[3].convex, false);
  assert.ok(Math.abs(Math.abs(k[2].turn) - Math.PI / 2) < 1e-9, '90° dönüş beklenir');
});

test('kemik yayının merkezi tam köşede ve yarıçapı takım yarıçapı', () => {
  // Kesimde takım merkezi, çizginin r kadar ötelenmişini izler. Merkezi
  // köşede olan r yarıçaplı yay r kadar ötelenince yarıçapı sıfıra iner —
  // yani takım merkezi TAM köşeden geçer, köşede et kalmaz. Merkez başka
  // yerde olsaydı bu özellik bozulurdu.
  const r = 3;
  const res = dogbone(kanalliHalka(), r, {});
  assert.equal(res.applied, 2);
  assert.equal(res.skipped, 0);
  for (const p of res.ring) {
    const d = Math.hypot(p[0] - 40, p[1] - 10);
    if (d > 1e-9 && d < r * 1.5) {
      assert.ok(Math.abs(d - r) < 1e-9, `yay noktası ${d} mm, ${r} mm olmalıydı`);
    }
  }
});

test('kemik payı köşeyi gerçekten boşaltır', () => {
  const r = 3;
  const res = dogbone(kanalliHalka(), r, {});
  // Köşenin malzeme tarafındaki (sol-üst) yakın nokta artık dışarıda kalmalı:
  // orası freze ucunun temizlediği yer.
  assert.equal(pointInRing([39.5, 10.5], res.ring), false, 'köşe dibi boşalmamış');
  // Yaydan uzak malzeme yerinde durmalı.
  assert.equal(pointInRing([36, 14], res.ring), true, 'gereğinden fazla et alınmış');
  assert.equal(pointInRing([20, 20], res.ring), true);
  // Kanalın içi hâlâ boş.
  assert.equal(pointInRing([50, 5], res.ring), false);
});

test('kemik payı yalnızca malzeme eksiltir ve halkayı bozmaz', () => {
  const ring = kanalliHalka();
  const res = dogbone(ring, 3, {});
  const eski = signedArea(ring);
  const yeni = signedArea(res.ring);
  assert.ok(yeni > 0, 'halkanın yönü bozulmuş');
  assert.ok(yeni < eski, 'kemik alanı büyütmüş — yay yanlış tarafa dönüyor');
  // İki köşe × 270°'lik daire dilimi kadar; yaklaşık üst sınır.
  assert.ok(eski - yeni < 2 * Math.PI * 9, 'gereğinden çok alan gitmiş');
  assert.equal(kendiniKesiyorMu(res.ring), null, 'halka kendini kesiyor');
});

test('sığmayan kemik sessizce küçültülmez, atlanır ve sayılır', () => {
  // 2 mm genişliğinde kanal; 6 mm uç (r=3) buraya kemik sığdıramaz.
  const dar = kanalliHalka(40, 42, 2);
  const res = dogbone(dar, 3, {});
  assert.equal(res.applied, 0);
  assert.equal(res.skipped, 2);
  assert.deepEqual(res.ring, dar, 'atlanan köşeler değiştirilmemeli');
  assert.equal(countTightCorners(dar, 3), 2);
});

test('yumuşak iç köşelere dokunulmaz', () => {
  // minTurn (≈20°) altındaki dönüşler kemik istemez.
  const yumusak = [[0, 0], [100, 0], [100, 50], [50, 49], [0, 50]];
  const res = dogbone(yumusak, 3, { minTurn: 0.35 });
  assert.equal(res.applied, 0);
  assert.equal(res.skipped, 0);
});

test('dış köşe yuvarlatma alanı küçültür ve teğet kalır', () => {
  const kare = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const f = filletConvex(kare, 5, {});
  assert.equal(f.applied, 4);
  const yeni = signedArea(f.ring);
  assert.ok(yeni > 0 && yeni < signedArea(kare), 'yuvarlatma alanı büyütmüş');
  // Kaybedilen alan köşe başına en çok r² (kare köşe - çeyrek daire) kadardır.
  assert.ok(signedArea(kare) - yeni < 4 * 25, 'fazla malzeme alınmış');
  assert.equal(kendiniKesiyorMu(f.ring), null);
});

test('applyCornerRelief geri adım atarsa ham halkayı korur', () => {
  const ring = kanalliHalka();
  // Kapalıyken hiçbir şey değişmemeli.
  const kapali = applyCornerRelief(ring, { toolRadius: 3, dogboneOn: false });
  assert.deepEqual(kapali.ring, ring);
  assert.equal(kapali.applied, 0);
  // Takım çapı sıfırsa da dokunmamalı.
  const sifir = applyCornerRelief(ring, { toolRadius: 0, dogboneOn: true });
  assert.deepEqual(sifir.ring, ring);
});

// Tarak: iki kanal arasında ince bir diş bırakır. Kanal 20 mm, diş 6 mm.
function tarakliHalka(disGenisligi = 6, kanal = 20, d = 15, H = 40) {
  const L = kanal * 2 + disGenisligi;
  return [
    [0, 0], [L, 0], [L, d], [kanal + disGenisligi, d],
    [kanal + disGenisligi, H], [kanal, H], [kanal, d], [0, d],
  ];
}

test('ince dişte kemik yerine T payı seçilir', () => {
  // Diş 6 mm; iki yandan 3'er mm kemik açılsa diş kopardı.
  const ring = tarakliHalka(6);
  const r = cornerRelief(ring, 3, { mode: 'oto' });
  assert.equal(r.applied, 2, 'iki kanal dibi de işlenmeli');
  assert.equal(r.dogbones, 0, 'ince dişte kemik kullanılmamalı');
  assert.equal(r.tbones, 2);
  assert.equal(kendiniKesiyorMu(r.ring), null, 'halka kendini kesiyor');
  assert.ok(signedArea(r.ring) > 0 && signedArea(r.ring) < signedArea(ring));
});

test('T payı dişi ayakta bırakır, kemik keserdi', () => {
  const ring = tarakliHalka(6);
  const t = cornerRelief(ring, 3, { mode: 'oto' }).ring;
  // Diş 20..26 arasında, y 15..40. Gövdesi yerinde durmalı.
  assert.equal(pointInRing([23, 30], t), true, 'diş gövdesi gitmiş');
  assert.equal(pointInRing([23, 16], t), true, 'diş dibi kesilmiş — diş kopar');
  // Pay kanal dibinin altına, kalın gövdeye inmiş olmalı.
  assert.equal(pointInRing([17, 14], t), false, 'T payı hiç malzeme almamış');
  // Kanalın kendisi hâlâ boş.
  assert.equal(pointInRing([10, 30], t), false);

  // Aynı halkada kemik zorlanırsa köşeler atlanır — sessizce dişi kesmez.
  const k = cornerRelief(ring, 3, { mode: 'kemik' });
  assert.equal(k.applied, 0);
  assert.equal(k.skipped, 2);
});

test('geniş dişte kemik tercih edilir', () => {
  // Diş 30 mm; 3 mm yarıçap iki yandan girse bile 24 mm et kalır.
  const r = cornerRelief(tarakliHalka(30), 3, { mode: 'oto' });
  assert.equal(r.dogbones, 2, 'yer varken kemik kullanılmalı');
  assert.equal(r.tbones, 0);
  assert.equal(kendiniKesiyorMu(r.ring), null);
});

test('T payı da köşeyi boşaltır', () => {
  // Payın amacı köşedeki eti almak. Kanal dibindeki köşenin hemen içi
  // (kanal tarafı) temizlenmiş olmalı.
  const ring = tarakliHalka(6);
  const t = cornerRelief(ring, 3, { mode: 'oto' }).ring;
  // Kanal dibi köşesi (20,15); kanalın içindeki yakın nokta zaten boştu,
  // asıl kazanç köşenin altındaki ete inilmesi.
  assert.equal(pointInRing([19.5, 14.5], t), false, 'köşe dibi temizlenmemiş');
});

test('sadece işaretlenen köşelere pay açılır', () => {
  const ring = kanalliHalka();
  const hepsi = cornerRelief(ring, 3, { mode: 'oto' });
  const biri = cornerRelief(ring, 3, { mode: 'oto', only: (V) => V[0] < 50 });
  assert.equal(hepsi.applied, 2);
  assert.equal(biri.applied, 1, 'süzgeç dışındaki köşe işlenmiş');
});

test('lamel modu kanal diplerine kemik açar', () => {
  const g = testGrid();
  const ortak = { panelW: 900, panelH: 600, thickness: 18, gap: 6, railCount: 2, railHeight: 60 };
  const acik = generateRibs(g, { ...ortak, toolDiameter: 6, dogbone: true });
  const kapali = generateRibs(g, { ...ortak, toolDiameter: 6, dogbone: false });

  // Her lamelde 2 kızak kanalı × 2 iç köşe, her kızakta lamel sayısı × 2.
  assert.ok(acik.info.dogboneApplied > 0, 'hiç kemik açılmamış');
  assert.equal(acik.info.dogboneSkipped, 0);
  assert.equal(kapali.info.dogboneApplied, 0);
  assert.ok(kapali.info.tightCorners > 0, 'kapalıyken sıkışık köşeler sayılmalı');
  assert.ok(
    kapali.warnings.some((w) => w.includes('Kemik payı kapalı')),
    'kemik payı kapalıyken uyarı verilmiyor'
  );

  // Kemik sadece eksiltir; parçalar levhaya sığmaya devam eder.
  for (let i = 0; i < acik.parts.length; i++) {
    const a = signedArea(acik.parts[i].outline);
    const b = signedArea(kapali.parts[i].outline);
    assert.ok(a > 0, `${acik.parts[i].id}: halka yönü bozulmuş`);
    assert.ok(a <= b + 1e-6, `${acik.parts[i].id}: kemik alanı büyütmüş`);
    assert.equal(kendiniKesiyorMu(acik.parts[i].outline), null,
      `${acik.parts[i].id}: halka kendini kesiyor`);
  }
});

test('dar kızak kanalında kemik atlanır ve kullanıcıya söylenir', () => {
  // 20 mm'lik uç, 18,2 mm'lik lamel kanalına sığmaz.
  const res = generateRibs(testGrid(), { toolDiameter: 20, dogbone: true, railCount: 2 });
  assert.ok(res.info.dogboneSkipped > 0, 'sığmayan kemik atlanmamış');
  assert.ok(res.warnings.some((w) => w.includes('sığmadı')), 'uyarı verilmiyor');
});

test('kemik payı arayüzde açılıp kapanabiliyor', () => {
  // Kontrol HTML'de yoksa readParams hep varsayılanı okur ve düğme kaybolur.
  const html = oku('index.html');
  assert.ok(html.includes('id="p-dogbone"'), 'kemik payı anahtarı HTML\'de yok');
  assert.ok(html.includes('id="p-filletRadius"'), 'yuvarlatma alanı HTML\'de yok');
  const js = oku('js/main.js');
  assert.ok(/dogbone:\s*bool\('p-dogbone'\)/.test(js), 'main.js anahtarı okumuyor');
  assert.ok(/filletRadius:\s*num\('p-filletRadius'/.test(js), 'main.js yarıçapı okumuyor');
});

test('corners.js servis çalışanı listesinde', () => {
  // Listede olmayan dosya çevrimdışı açılışta 404 verir ve uygulama patlar.
  assert.ok(oku('sw.js').includes("'./js/corners.js'"), 'corners.js önbellek listesinde yok');
});

// --- Şerit örneklemesi --------------------------------------------------
console.log('şerit örneklemesi');

/** Sütunları 0,1,0,1… giden ızgara: gerçek ortalaması her şeritte ~0,5. */
function zebraGrid(w = 768, h = 512) {
  const g = makeGrid(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.data[y * w + x] = x % 2;
  return g;
}

test('şerit örneği sayısı ızgara çözünürlüğüyle büyür', () => {
  // Sabit 3 örnek, çözünürlük yükseldiğinde şeridi temsil etmiyordu.
  const dar = makeGrid(320, 240);
  const genis = makeGrid(768, 512);
  const u0 = 0.2, u1 = 0.2 + 18 / 900;   // 900 mm panelde 18 mm'lik lamel
  assert.ok(bandSamples(genis, u0, u1) > bandSamples(dar, u0, u1),
    'örnek sayısı çözünürlükle artmıyor');
  assert.ok(bandSamples(genis, u0, u1) >= 15, '768 ızgarada şerit ~15 hücre');
  assert.ok(bandSamples(dar, u0, u1) >= 3, 'en az 3 örnek olmalı');
});

test('şerit gerçekten ortalanıyor, üç noktadan okunmuyor', () => {
  const g = zebraGrid();
  const u0 = 0.2, u1 = 0.2 + 18 / 900;
  const dogru = sampleBandColumn(g, u0, u1, 0.5, bandSamples(g, u0, u1));
  const eski = sampleBandColumn(g, u0, u1, 0.5, 3);
  assert.ok(Math.abs(dogru - 0.5) < 0.08, `şerit ortalaması ${dogru}, 0,5 olmalıydı`);
  assert.ok(Math.abs(dogru - 0.5) < Math.abs(eski - 0.5),
    'yoğun örnekleme üç noktadan daha iyi olmalı');
});

test('komşu şeritler sınır örneğini paylaşmaz', () => {
  // Uçlara konan örnekler iki lamelde ortak olur ve ortalamayı yanlı yapar.
  const g = makeGrid(100, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 100; x++) g.data[y * 100 + x] = x / 99;
  const a = sampleBandColumn(g, 0.0, 0.5, 0.5, 8);
  const b = sampleBandColumn(g, 0.5, 1.0, 0.5, 8);
  // Rampanın iki yarısının ortalamaları 0,25 ve 0,75 civarı olmalı.
  assert.ok(Math.abs(a - 0.25) < 0.05, `sol yarı ${a}`);
  assert.ok(Math.abs(b - 0.75) < 0.05, `sağ yarı ${b}`);
});

test('yatay şerit de ortalanır', () => {
  const g = makeGrid(10, 100);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 10; x++) g.data[y * 10 + x] = y / 99;
  assert.ok(Math.abs(sampleBandRow(g, 0.5, 0.0, 0.5, 8) - 0.25) < 0.05);
  assert.ok(Math.abs(sampleBandRow(g, 0.5, 0.5, 1.0, 8) - 0.75) < 0.05);
});

test('lamel profili şeridin ortalamasını okur', () => {
  // Zebra ızgarada her lamel ~0,5 okumalı. Az örnekle lameller 0 ile 1
  // arasında zıplardı — fotoğrafın "kadife" görünmesinin sebebi buydu.
  const res = generateRibs(zebraGrid(), {
    panelW: 900, panelH: 600, thickness: 18, gap: 6,
    maxDepth: 60, baseDepth: 40, railCount: 0,
  });
  const lameller = res.parts.filter((p) => p.kind === 'lamel');
  const ortalamalar = lameller.map((p) => {
    const pr = p.meta.profile;
    return pr.reduce((s, q) => s + q[1], 0) / pr.length;
  });
  // Derinlik = 40 + h*60; h≈0,5 ise ~70 mm.
  for (const d of ortalamalar) {
    assert.ok(Math.abs(d - 70) < 9, `lamel derinliği ${d.toFixed(1)} mm, ~70 beklenir`);
  }
  // Komşu lameller birbirine yakın olmalı — zıplamamalı.
  for (let i = 1; i < ortalamalar.length; i++) {
    assert.ok(Math.abs(ortalamalar[i] - ortalamalar[i - 1]) < 9,
      `komşu lameller ${ortalamalar[i - 1].toFixed(1)} / ${ortalamalar[i].toFixed(1)} — zıplıyor`);
  }
});

test('yatay lamelde de şerit ortalanır', () => {
  // Eskiden yatay lamel şeridi TEK noktadan okuyordu.
  const g = makeGrid(768, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 768; x++) g.data[y * 768 + x] = y % 2;
  const res = generateRibs(g, {
    panelW: 900, panelH: 600, thickness: 18, gap: 6, orientation: 'horizontal',
    maxDepth: 60, baseDepth: 40, railCount: 0,
  });
  for (const p of res.parts.filter((q) => q.kind === 'lamel')) {
    const pr = p.meta.profile;
    const ort = pr.reduce((s, q) => s + q[1], 0) / pr.length;
    assert.ok(Math.abs(ort - 70) < 9, `yatay lamel derinliği ${ort.toFixed(1)} mm`);
  }
});

test('otomatik yumuşatma lamel adımına bağlı', () => {
  const html = oku('index.html');
  const js = oku('js/main.js');
  assert.ok(html.includes('id="p-autoBlur"'), 'otomatik yumuşatma anahtarı yok');
  assert.ok(/function autoFilterRadii/.test(js), 'autoFilterRadii yok');
  // Adım = kalınlık + boşluk; yumuşatma adım/3, netlik yarıçapı adım/2.
  const govde = js.match(/function autoFilterRadii[\s\S]*?\n}/)?.[0] || '';
  assert.ok(/p-thickness[\s\S]*p-gap/.test(govde), 'adım kalınlık+boşluktan gelmiyor');
  assert.ok(/adim \/ 3/.test(govde) && /adim \/ 2/.test(govde),
    'yumuşatma adım/3 ve netlik yarıçapı adım/2 olmalı');
  // Desenler kodla üretilir, gren içermez; güçlü yumuşatma onlara zarar verir.
  assert.ok(/sourceKind !== 'foto'/.test(govde), 'desenler otomatik yumuşatmadan muaf değil');
  assert.ok(/uploadKind = 'foto'/.test(js) && /sourceKind = 'desen'/.test(js),
    'kaynak türü işaretlenmiyor');
});

test('desen karışımı yüklenen görseli silmez', () => {
  const js = oku('js/main.js');
  const govde = js.match(/function composeSource[\s\S]*?\n}/)?.[0] || '';
  assert.ok(govde, 'composeSource yok');
  // Karışım: görsel*(1-k) + desen*k. Zeminde desen kalır, konu üstüne biner.
  assert.ok(/\* \(1 - k\)/.test(govde) && /\* k/.test(govde), 'karışım formülü yok');
  // Yumuşatma kararı karışıma değil yüklenen içeriğe göre verilmeli.
  assert.ok(/sourceKind = state\.uploadKind/.test(govde),
    'karışımda kaynak türü yüklenen içerikten gelmiyor');
  // Pay sıfıra çekilince görsel geri gelmeli, desen onu yutmamalı.
  assert.ok(/state\.sourceGrid = yukleme/.test(govde), 'pay 0 iken görsele dönülmüyor');
  // applyPattern yüklü görsel varken onu değiştirmemeli.
  assert.ok(/state\.uploadGrid && num\('p-patMix', 0\) > 0/.test(js),
    'applyPattern karışım durumunu gözetmiyor');
  // Kaydırıcı özel ele alınmalı; yoksa applyPattern görseli deseni ile değiştirir.
  assert.ok(/input\.id === 'p-patMix' && state\.uploadGrid/.test(js),
    'desen payı kaydırıcısı özel ele alınmıyor');
  assert.ok(oku('index.html').includes('id="p-patMix"'), 'kaydırıcı HTML\'de yok');
});

// --- Kaynak teşhisi -----------------------------------------------------
console.log('kaynak teşhisi');

test('düz renkli grafik ile sürekli ton ayrılır', () => {
  // Logo: birkaç düz ton. Fotoğraf: sürekli ton + gren.
  const logo = makeGrid(200, 200);
  for (let i = 0; i < logo.data.length; i++) logo.data[i] = i % 97 === 0 ? 0.1 : (i % 13 === 0 ? 0.5 : 0.95);
  const foto = makeGrid(200, 200);
  let s = 7;
  for (let i = 0; i < foto.data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    foto.data[i] = 0.5 + 0.3 * Math.sin(i / 311) + (s / 4294967296 - 0.5) * 0.25;
  }
  const tLogo = toneConcentration(logo);
  const tFoto = toneConcentration(foto);
  assert.ok(tLogo > 0.75, `logo ton yoğunluğu ${tLogo.toFixed(2)}, eşik 0,75`);
  assert.ok(tFoto < 0.75, `fotoğraf ton yoğunluğu ${tFoto.toFixed(2)}, eşiğin altında olmalı`);
});

test('adımdan ince ayrıntı oranı ölçülür', () => {
  // Dama tahtası: tamamı ince ayrıntı. Rampa: tamamı kaba.
  const dama = makeGrid(200, 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
    dama.data[y * 200 + x] = ((x >> 1) + (y >> 1)) % 2;
  }
  const rampa = makeGrid(200, 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) rampa.data[y * 200 + x] = x / 199;
  assert.ok(fineDetailRatio(dama, 10) > 0.8, 'dama ince sayılmadı');
  assert.ok(fineDetailRatio(rampa, 10) < 0.1, 'rampa ince sayıldı');
  // Sabit ızgarada sıfıra bölme olmamalı.
  assert.equal(fineDetailRatio(makeGrid(50, 50, 0.4), 5), 0);
});

test('çözünürlük uyarısı HAM kaynağı ölçer', () => {
  // Filtrelenmiş ızgarayı ölçmek döngüseldir: yumuşatma ayrıntıyı siler,
  // sonra "ayrıntı yok" denir. Gerçek logoda ham %40, filtre sonrası %24 —
  // yani eşiğin yanlış tarafına düşüyordu.
  const js = oku('js/main.js');
  const govde = js.match(/function cozunurlukUyarilari[\s\S]*?\n}/)?.[0] || '';
  assert.ok(govde, 'cozunurlukUyarilari yok');
  assert.ok(/state\.sourceGrid/.test(govde), 'ham kaynak yerine filtreli ızgara ölçülüyor');
  assert.ok(!/fineDetailRatio\(state\.grid/.test(govde), 'filtreli ızgara ölçülüyor');
  assert.ok(/gerekenPanelGenisligi/.test(govde),
    'uyarı gereken panel genişliğini söylemiyor — "mod değiştir" tek başına yanlış tavsiye');
  // Eşik üretilen planlara bakılarak kalibre edildi: 882 mm (%40) kötü,
  // 1100 mm (%34) kabul edilebilir.
  assert.ok(/INCE_DETAY_ESIGI = 0\.36/.test(js), 'eşik kalibre edilen değerde değil');
});

test('gereken panel genişliği araması artan genişlikte biter', () => {
  const js = oku('js/main.js');
  const govde = js.match(/function gerekenPanelGenisligi[\s\S]*?\n}/)?.[0] || '';
  assert.ok(govde, 'gerekenPanelGenisligi yok');
  // Sonsuz döngü olmasın: üst sınır ve adım olmalı.
  assert.ok(/w \+= 100/.test(govde), 'arama adımı yok');
  assert.ok(/<= 6000/.test(govde), 'üst sınır yok');
  assert.ok(/return null/.test(govde), 'bulunamadığında null dönmüyor');
});

test('çizgi işine fotoğraf yumuşatması uygulanmaz', () => {
  const js = oku('js/main.js');
  const govde = js.match(/function autoFilterRadii[\s\S]*?\n}/)?.[0] || '';
  assert.ok(/cizgiIsiMi\(\)/.test(govde), 'çizgi iş kontrolü yok');
  assert.ok(/CIZGI_ISI_ESIGI = 0\.75/.test(js), 'eşik ölçülen değerle uyuşmuyor');
});

// --- Görsel yükleme -----------------------------------------------------
console.log('görsel yükleme');

test('görsel ölçüleri close() öncesinde okunuyor', () => {
  // ImageBitmap.close() çağrıldıktan sonra width/height 0 döner. Durum
  // mesajı sonradan kurulursa her görsel "0×0 piksel" görünür.
  const js = oku('js/main.js');
  const govde = js.match(/async function loadImageFile[\s\S]*?\n}/)?.[0] || '';
  assert.ok(govde, 'loadImageFile bulunamadı');
  const kapatma = govde.indexOf('bitmap.close');
  const mesaj = govde.indexOf('setSourceStatus');
  assert.ok(kapatma > 0 && mesaj > 0, 'kapatma veya durum mesajı yok');
  assert.ok(
    !/bitmap\.(width|height)/.test(govde.slice(kapatma)),
    'close() sonrasında bitmap.width/height okunuyor — ölçüler 0 çıkar'
  );
});

console.log(`\n${passed} test geçti${process.exitCode ? ' (hatalar var)' : ''}`);
