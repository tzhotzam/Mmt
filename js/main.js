// Uygulama kabuğu: girdi → yükseklik haritası → parça üretimi → önizleme → dışa aktarma.

import {
  gridFromImageData, applyFilters, suggestInvert, makeGrid,
  toneConcentration, fineDetailRatio,
} from './heightmap.js';
import { parseMesh, heightmapFromStl, pickBestAxis, projectedSize } from './stl.js';
import { facetize } from './facet.js';
import { inflateSilhouette, blendRelief } from './relief.js';
import { demoMeshTris } from './demomesh.js';
import {
  PATTERNS, PATTERN_KEYS, renderPattern, textSeed,
  encodePatternCode, decodePatternCode,
} from './patterns.js';
import { generateRibs, RIB_DEFAULTS } from './modes/ribs.js';
import { generateContours, CONTOUR_DEFAULTS } from './modes/contour.js';
import { generateFacets, FACET_DEFAULTS } from './modes/facets.js';
import { generateSlices, SLICE_DEFAULTS } from './modes/slices.js';
import { decimate } from './decimate.js';
import { voxelRemesh, meshHealth } from './remesh.js';
import { meshFromHeightmap } from './relief3d.js';
import { nest, applyPlacement } from './nest.js';
import { sheetToDxf } from './export/dxf.js';
import { sheetToSvg } from './export/svg.js';
import { buildCutList, cutListToCsv, assemblyGuide } from './cutlist.js';
import { drawPlan, drawNest, drawSource, drawParts, drawPaintView, screenToGrid } from './preview2d.js';
import { createPaintLayer, applyPaint, stroke, isEmpty } from './paint.js';
import { createPreview3d } from './preview3d.js';

// Yükseklik haritasının uzun kenardaki örnek sayısı. 320 idi; 2,6 m'lik bir
// panelde 8 mm/örnek demekti ve görselin detayı daha okunmadan atılıyordu.
// 768'de tipik panellerde ~1-2 mm/örnek düşüyor, lamel profilinin 1,5 mm'lik
// adımıyla örtüşüyor.
const APP_VERSION = '2026-09-22-l';

/**
 * HTML ile JavaScript aynı sürümden mi?
 *
 * Tarayıcı bazen yeni index.html'i alıp eski main.js'i önbellekten veriyor.
 * O durumda arayüzde yeni alanlar görünür ama onları dolduran kod yoktur —
 * desen listesi "Seçenek Yok" kalır gibi. Uyuşmazlıkta önbellek temizlenip
 * sayfa bir kez yenilenir; ikinci kez de uyuşmazsa kullanıcıya söylenir.
 */
(function checkVersion() {
  const html = document.querySelector('meta[name="app-version"]')?.content;
  if (!html || html === APP_VERSION) return;

  const ANAHTAR = 'surum-yenileme';
  if (sessionStorage.getItem(ANAHTAR) === html) {
    const el = document.getElementById('source-status');
    if (el) {
      el.textContent =
        'Tarayıcı eski bir sürümü gösteriyor. Sayfayı kapatıp yeniden açın ' +
        '(ana ekrandan açtıysanız uygulamayı tamamen kapatın).';
      el.style.color = 'var(--danger)';
    }
    return;
  }
  try { sessionStorage.setItem(ANAHTAR, html); } catch { /* yoksay */ }

  const temizle = window.caches
    ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
    : Promise.resolve();
  temizle.catch(() => {}).then(() => location.reload());
})();

const GRID_MAX = 768;

/** Filtre yarıçapları mm cinsinden girilir; ızgara örneğine burada çevrilir. */
function mmToSamples(mm) {
  const g = state.sourceGrid;
  if (!g) return 0;
  const mmPerSample = num('p-panelW', 900) / Math.max(1, g.w);
  return mmPerSample > 0 ? mm / mmPerSample : 0;
}

const els = {};
for (const el of document.querySelectorAll('[id]')) els[el.id] = el;

const state = {
  mode: 'ribs',
  view: '3d',
  invert: false,         // false = açık alanlar öne, true = koyu alanlar öne
  tris: null,            // STL üçgenleri (poligonal kabuk modu için)
  seams: [],
  folds: [],
  sourceGrid: null,      // filtresiz ham harita
  grid: null,            // filtrelenmiş harita
  aspect: 1,
  parts: [],
  info: null,
  warnings: [],
  nestResult: null,
  cutList: null,
  sheetIndex: 0,
  planFocus: -1,         // plan görünümünde tam ekran açılan parça (-1: ızgara)
  planCells: [],
  planView: { k: 1, px: 0, py: 0 },   // tek parça görünümünde yakınlaştırma
  notes: [],             // bilgi notları (uyarı değil) — kapalı gri kutuda
  reliefInfo: null,
  viewAxis: 'z',
  sourceKind: null,      // 'foto' | 'desen' | 'model' — otomatik yumuşatma buna bakar
  sourceStats: null,     // kaynak teşhisi (ton yoğunluğu)
  uploadGrid: null,      // YÜKLENEN içerik (görsel/model) — desen değil
  uploadKind: null,      // 'foto' | 'model'
  decimateCache: null,   // sadeleştirilmiş ağ (model + hedef değişmedikçe)
  remeshCache: null,     // onarılmış (hacimden yeniden kurulmuş) ağ ve ağ sağlığı
  meshInfo: null,
  patternSeed: 0.42,
  patternAspect: 1.5,
  paintLayer: null,       // elle çizilen derinlik düzeltmesi (-1..1)
  brushMode: 'raise',
  undoStack: [],          // Int8'e nicemlenmiş anlık görüntüler
};

let preview3d = null;
let regenTimer = null;

// ------------------------------------------------------------ parametreler

function num(id, fallback = 0) {
  const v = parseFloat(els[id]?.value);
  return Number.isFinite(v) ? v : fallback;
}
function bool(id) {
  return !!els[id]?.checked;
}

/** Yaprak ölçü sınırı: levha ile "yaprak en büyük ölçüsü"nden küçüğü. */
function yaprakSiniri(levha) {
  const k = num('p-maxLeafSize', 0);
  return k > 0 ? Math.min(levha, k) : levha;
}

function readParams() {
  const common = {
    panelW: num('p-panelW', 900),
    panelH: num('p-panelH', 600),
    thickness: num('p-thickness', 18),
    offset: num('p-offset', 0),
    toolDiameter: num('p-toolDiameter', 6),
  };
  if (state.mode === 'facets') {
    return {
      ...FACET_DEFAULTS,
      thickness: common.thickness,
      offset: common.offset,
      targetSize: num('p-targetSize', 600),
      sizeAxis: els['p-sizeAxis'].value,
      angleTol: num('p-angleTol', 1),
      minArea: num('p-facetMinArea', 40),
      thicknessComp: bool('p-thicknessComp'),
      unfold: bool('p-unfold'),
      maxFacetsPerPatch: Math.round(num('p-maxFacetsPerPatch', 24)),
      targetParts: Math.round(num('p-targetParts', 0)),
      bridgeMode: els['p-bridgeMode'].value,
      bridgeWidth: num('p-bridgeWidth', 25),
      autoLimit: num('p-autoLimit', 250),
      dashCut: num('p-dashCut', 30),
      dashGap: num('p-dashGap', 8),
      joinMethod: els['p-joinMethod'].value,
      tabWidth: num('p-tabWidth', 15),
      rivetDiameter: num('p-rivetDiameter', 4),
      rivetPitch: num('p-rivetPitch', 80),
      reliefHoles: bool('p-reliefHoles'),
      // Yaprak levhaya sığmalı; kullanıcı daha küçüğünü isteyebilir (taşıma,
      // boya kabini, elle bükme). İki sınırdan küçüğü geçerli.
      maxPatchW: yaprakSiniri(num('p-sheetW', 2440) - 2 * num('p-margin', 10)),
      maxPatchH: yaprakSiniri(num('p-sheetH', 1220) - 2 * num('p-margin', 10)),
    };
  }
  if (state.mode === 'slices') {
    return {
      ...SLICE_DEFAULTS,
      thickness: common.thickness,
      targetSize: num('p-sculptSize', 1200),
      sizeAxis: els['p-sliceSizeAxis'].value,
      axis: els['p-sliceAxis'].value,
      gap: num('p-sliceGap', 0),
      minArea: num('p-sliceMinArea', 300),
      rodShape: els['p-rodShape'].value,
      rodDiameter: num('p-rodDiameter', 10),
      rodCount: Math.round(num('p-rodCount', 2)),
      toolDiameter: common.toolDiameter,
    };
  }
  if (state.mode === 'ribs') {
    return {
      ...RIB_DEFAULTS, ...common,
      gap: num('p-gap', 6),
      maxDepth: num('p-maxDepth', 60),
      baseDepth: num('p-baseDepth', 30),
      orientation: els['p-orientation'].value,
      railCount: Math.round(num('p-railCount', 2)),
      railHeight: num('p-railHeight', 60),
      fit: num('p-fit', 0.2),
      dogbone: bool('p-dogbone'),
      filletRadius: num('p-filletRadius', 0),
    };
  }
  return {
    ...CONTOUR_DEFAULTS, ...common,
    layerCount: Math.round(num('p-layerCount', 8)),
    minArea: num('p-minArea', 400),
    withBase: bool('p-withBase'),
    guideEngrave: bool('p-guideEngrave'),
  };
}

const SHARPEN_RADIUS_MM = 5;

/**
 * Lamel modunda yumuşatma ve netlik yarıçapı LAMEL ADIMINA bağlanır.
 *
 * Panelin lameller ARASI çözünürlüğü adımdır (kalınlık + boşluk): 24 mm
 * adımda 900 mm'lik panel yatayda 37 "piksel" demektir. Lamel BOYUNCA ise
 * çözünürlük 1,5 mm. Haritada adımdan ince detay bırakılırsa bu detay
 * yatayda temsil edilemez, dikeyde ise aynen kesilir — komşu lameller
 * birbirinden bağımsız zıplar, yüzey kadife/parazit gibi çıkar.
 *
 * Ölçüm — hakem olarak temiz görselin, her lamelin GERÇEK ayak izi
 * üzerindeki ortalaması alındı; hiçbir filtre varsayımı içermez. İki sentetik
 * gürültülü fotoğrafın ortalaması, hata (mm) / profilde yön değişimi:
 *   v1 (320 ızgara, ≈5,6 mm)     0,31 /  832
 *   3 mm  (önceki varsayılan)    0,41 / 2191   <- bozulma buradaydı
 *   adım/4 = 6 mm                0,40 / 1310
 *   adım/3 = 8 mm                0,28 /  929   <- seçilen
 * Hata ile zıplama ayrı şeylerdir. Önceki varsayılan hem daha hatalıydı hem
 * de paraziti 2,6 katına çıkarıyordu; fiziksel panelde yüksek frekanslı hata,
 * yumuşak sapmadan çok daha göze batar. v1'in daha iyi görünmesinin sebebi
 * en SADIK ayar olması değil, en DÜZGÜN olmasıydı.
 *
 * DESENLERE uygulanmaz: desenler kodla üretilir, gren içermez ve ince
 * ayrıntıları kasıtlıdır. İnce desenli kaynakta adım/3 hatayı 0,33'ten
 * 0,77'ye çıkarıyordu; orada 3 mm doğru değerdir.
 */
function autoFilterRadii() {
  const yumusak = { blur: 3, sharpenRadius: SHARPEN_RADIUS_MM };
  if (state.mode !== 'ribs') return yumusak;
  // Dosyadan gelen her görsel fotoğraf değildir. Logo ve çizgi iş, desenler
  // gibi grensizdir ve keskin kenarları kasıtlıdır; onlara fotoğraf
  // yumuşatması uygulamak yanlış.
  if (state.sourceKind !== 'foto' || cizgiIsiMi()) return yumusak;
  const adim = num('p-thickness', 18) + num('p-gap', 6);
  return { blur: adim / 3, sharpenRadius: adim / 2 };
}

/**
 * Kaynak düz renkli bir grafik mi (logo, çizgi iş, silüet)?
 * Ölçüldü: logo 0,94 | fotoğraf 0,58 | üretilmiş desenler 0,17-0,25.
 */
const CIZGI_ISI_ESIGI = 0.75;
function cizgiIsiMi() {
  return (state.sourceStats?.tone ?? 0) >= CIZGI_ISI_ESIGI;
}

/** Kaynak her değiştiğinde bir kez ölçülür; filtreler ve uyarılar kullanır. */
function updateSourceStats() {
  state.sourceStats = state.sourceGrid
    ? { tone: toneConcentration(state.sourceGrid) }
    : null;
}

/** Yumuşatma alanında gerçekte kullanılan mm değeri. */
function effectiveBlurMm() {
  return bool('p-autoBlur') ? autoFilterRadii().blur : num('p-blur', 0);
}

function readFilters() {
  const oto = bool('p-autoBlur');
  const r = autoFilterRadii();
  return {
    blur: mmToSamples(oto ? r.blur : num('p-blur', 0)),
    sharpen: num('p-sharpen', 0),
    sharpenRadius: Math.max(1, Math.round(mmToSamples(oto ? r.sharpenRadius : SHARPEN_RADIUS_MM))),
    contrast: num('p-contrast', 0),
    brightness: num('p-brightness', 0),
    gamma: num('p-gamma', 1),
    invert: state.invert,
    autoNormalize: true,
    facetCells: Math.round(num('p-facetCells', 0)),
    facetFlat: bool('p-facetFlat'),
    inflate: num('p-inflate', 0),
    roundness: num('p-roundness', 0.7),
    reliefDetail: num('p-reliefDetail', 0.25),
  };
}

function readNestOpts() {
  return {
    sheetW: num('p-sheetW', 2440),
    sheetH: num('p-sheetH', 1220),
    margin: num('p-margin', 10),
    spacing: num('p-spacing', 6),
    allowRotate: bool('p-allowRotate'),
    autoOrient: bool('p-autoOrient'),
  };
}

// ------------------------------------------------------------ kaynak kurulumu

/**
 * Kaynağı kurar: yüklenen görsel, hazır desen, ya da İKİSİNİN KARIŞIMI.
 *
 * Karışım neden gerekli: logo ya da ürün fotoğrafı düz bir zemin üzerinde
 * gelir. Düz zemin sabit yükseklik demektir, sabit yükseklik de hiç
 * kesilmemiş düz çıta. SAPCI logosunda 66 lamelin 17'si böyleydi — panel
 * "lamel paneli" gibi durmuyor, ortasında kabartma olan düz bir levha gibi
 * duruyordu.
 *
 * Çözüm: deseni TAŞIYICI dalga yapmak, görseli onun üstüne bindirmek.
 *     çıktı = görsel·(1-k) + desen·k
 * Zeminde (görsel sabit) geriye desen kalır, yani panelin her yeri dalgalanır.
 * Konunun olduğu yerde görsel deseni yukarı iter, yani logo dalganın üstünde
 * kabartma olarak durur. k = "desen payı".
 *
 * Ters çevirme (koyu alanlar öne) sonradan, filtre zincirinde uygulanır;
 * karışımı bozmaz, yalnızca dalganın yönünü çevirir.
 */
function composeSource() {
  const yukleme = state.uploadGrid;
  if (!yukleme) return false;

  const k = Math.min(1, Math.max(0, num('p-patMix', 0)));
  if (k <= 0) {
    state.sourceGrid = yukleme;
  } else {
    const key = els['p-pattern']?.value || PATTERN_KEYS[0];
    const desen = renderPattern(yukleme.w, yukleme.h, key, patternOpts());
    const out = makeGrid(yukleme.w, yukleme.h);
    for (let i = 0; i < out.data.length; i++) {
      out.data[i] = yukleme.data[i] * (1 - k) + desen.data[i] * k;
    }
    state.sourceGrid = out;
  }
  // Yumuşatma kararı KARIŞIMA değil, yüklenen içeriğe göre verilir: fotoğrafta
  // gren vardır, desen eklenmesi bunu değiştirmez.
  state.sourceKind = state.uploadKind;
  updateSourceStats();
  return true;
}

function gridDimsFor(aspect) {
  if (aspect >= 1) return [GRID_MAX, Math.max(24, Math.round(GRID_MAX / aspect))];
  return [Math.max(24, Math.round(GRID_MAX * aspect)), GRID_MAX];
}

async function loadImageFile(file) {
  const bitmap = await createImageBitmap(file);
  // Ölçüler HEMEN alınır: close() çağrıldıktan sonra ImageBitmap'in width ve
  // height alanları şartname gereği 0'a düşer. Durum mesajını sonradan
  // kurduğumuz için her görsel "0×0 piksel" görünüyordu.
  const pxW = bitmap.width;
  const pxH = bitmap.height;
  if (!(pxW > 0 && pxH > 0)) throw new Error('Görselin ölçüleri okunamadı.');

  state.aspect = pxW / pxH;
  const [cols, rows] = gridDimsFor(state.aspect);

  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = pxH;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  bitmap.close?.();

  state.uploadGrid = gridFromImageData(img, cols, rows);
  state.uploadKind = 'foto';
  // Önceden yüklenmiş 3B model artık kaynak değil. Temizlenmezse poligonal
  // kabuk, yeni yüklenen görsel yerine eski modeli işlemeye devam ederdi.
  state.tris = null;
  state.decimateCache = null;
  state.remeshCache = null;
  composeSource();
  setSourceStatus(`Görsel yüklendi: ${file.name} — ${pxW}×${pxH} piksel`);
  resetPaint();
  // Koyu konu + açık zemin ise ters çevirmezsek konu panele gömülür.
  setInvert(suggestInvert(state.sourceGrid), true);
  syncAspect();
  scheduleRegen();
}

const MAX_MESH_BYTES = 120 * 1024 * 1024;

async function loadStlFile(file) {
  if (file.size > MAX_MESH_BYTES) {
    throw new Error(
      `Dosya çok büyük (${(file.size / 1048576).toFixed(0)} MB). ` +
      'Modeli Blender veya tarama uygulamasında sadeleştirip tekrar deneyin.'
    );
  }
  const buf = await file.arrayBuffer();
  const { tris, format, reason } = parseMesh(buf, file.name);
  if (!tris.length) {
    const aciklama = {
      'gecersiz-koordinat': 'Dosya 3B model gibi görünmüyor (koordinatlar okunamadı).',
      'olcek-bozuk': 'Dosya 3B model gibi görünmüyor (ölçüler anlamsız).',
      duz: 'Model tek bir düzlemde — hacimli bir model gerekiyor.',
      bos: 'Dosyada üçgen bulunamadı.',
    }[reason] || 'Dosya okunamadı.';
    throw new Error(
      `${aciklama} Desteklenen biçimler: STL (ikili veya metin) ve OBJ. ` +
      'Dosya ZIP veya USDZ ise önce açıp içinden STL/OBJ çıkarın.'
    );
  }
  state.tris = tris;
  state.planFocus = -1;
  state.planView = { k: 1, px: 0, py: 0 };
  state.meshInfo = { format, name: file.name, count: tris.length };
  const r = rebuildFromMesh();
  reportMesh(r);
  setInvert(false);
  syncAspect();
  scheduleRegen();
}

const AXIS_NAMES = { z: 'tepeden', y: 'önden', x: 'yandan' };

/**
 * Modeli seçilen bakış yönünden tarayıp yükseklik haritasını kurar.
 *
 * Bakış yönü kritik: ayakta duran bir figüre tepeden bakılırsa yalnızca
 * omuz üstü görünür, yükseklik haritası neredeyse düz çıkar ve panelde
 * hiçbir şey oluşmaz. Otomatikte modelin en ince olduğu eksen seçilir —
 * nesneler hemen her zaman önden arkaya incedir.
 */
function rebuildFromMesh() {
  const tris = state.tris;
  if (!tris) return null;

  const secim = els['p-viewAxis'].value;
  const otomatik = secim === 'auto';
  const axis = otomatik ? pickBestAxis(tris).axis : secim;
  state.viewAxis = axis;

  const proj = projectedSize(tris, axis);
  state.aspect = proj.h > 0 ? proj.w / proj.h : 1;
  const [cols, rows] = gridDimsFor(state.aspect);
  state.uploadGrid = heightmapFromStl(tris, cols, rows, { axis });
  state.uploadKind = 'model';
  composeSource();
  resetPaint();
  return { axis, otomatik };
}

function reportMesh(r) {
  const b = state.meshInfo;
  if (!r || !b) return;
  setSourceStatus(
    `${b.format}: ${b.name} — ${b.count.toLocaleString('tr-TR')} üçgen, ` +
    `${AXIS_NAMES[r.axis]} bakılıyor${r.otomatik ? ' (otomatik)' : ''}`
  );
}

/** Desen listesini doldurur ve açıklamayı bağlar. */
(function initPatterns() {
  const sel = els['p-pattern'];
  const secili = sel.value;
  sel.innerHTML = '';   // HTML'deki yedek listenin yerine gerçek listeyi kur
  for (const key of PATTERN_KEYS) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = PATTERNS[key].label;
    sel.appendChild(o);
  }
  if (PATTERN_KEYS.includes(secili)) sel.value = secili;
})();

function patternHint() {
  syncPatternAvailability();
}

/**
 * Etkin tohum: metin yazıldıysa ondan türetilir, yoksa rastgele sayıdan.
 * Metin tohumu paneli kişiye bağlar — aynı isim hep aynı deseni verir.
 */
function etkinTohum() {
  const metin = els['p-seedText'].value.trim();
  return metin ? textSeed(metin) : state.patternSeed;
}

function patternOpts() {
  return {
    scale: num('p-patScale', 0.5),
    angle: num('p-patAngle', 0.1),
    detail: num('p-patDetail', 0.5),
    seed: etkinTohum(),
  };
}

function refreshPatternCode() {
  const key = els['p-pattern'].value || PATTERN_KEYS[0];
  els['p-patternCode'].value = encodePatternCode(key, patternOpts());
}

/** Koddan ayarları geri yükler. Bozuk kod sessizce yok sayılır. */
function applyPatternCode() {
  const c = decodePatternCode(els['p-patternCode'].value);
  if (!c) return false;
  els['p-pattern'].value = c.key;
  els['p-patScale'].value = c.scale;
  els['p-patAngle'].value = c.angle;
  els['p-patDetail'].value = c.detail;
  els['p-seedText'].value = '';      // kod sayısal tohum taşır
  state.patternSeed = c.seed;
  syncRangeOutputs();
  applyPattern();
  return true;
}

/** Desenler düzlem üretir; poligonal kabuk kapalı bir hacim ister. */
function syncPatternAvailability() {
  const kapali = state.mode === 'facets' || state.mode === 'slices';
  for (const id of ['p-pattern', 'p-patMix', 'p-patScale', 'p-patAngle', 'p-patDetail',
                    'p-seedText', 'p-patternCode', 'btn-pattern-random', 'btn-copy-code']) {
    if (els[id]) els[id].disabled = kapali;
  }
  els['pattern-hint'].textContent = kapali
    ? 'Bu mod kapalı bir 3B model ister; hazır desenler düz yüzey ürettiği '
      + 'için burada kullanılamaz. Lamel veya Katman moduna geçin.'
    : (PATTERNS[els['p-pattern'].value]?.hint || '');
}

function applyPattern() {
  if (state.mode === 'facets' || state.mode === 'slices') {
    // Bu modlar kapalı bir hacim ister; düz desen işe yaramaz.
    state.tris = demoMeshTris();
    state.meshInfo = { format: 'Örnek', name: 'gömülü model', count: state.tris.length };
    reportMesh(rebuildFromMesh());
    setInvert(false);
    scheduleRegen();
    return;
  }
  const key = els['p-pattern'].value || PATTERN_KEYS[0];

  // Yüklü bir görsel varsa ve desen payı açıksa desen onun YERİNE geçmez,
  // altına taşıyıcı dalga olarak girer.
  if (state.uploadGrid && num('p-patMix', 0) > 0) {
    composeSource();
    refreshPatternCode();
    patternHint();
    setSourceStatus(
      `${state.uploadKind === 'model' ? 'Model' : 'Görsel'} + ${PATTERNS[key].label} deseni ` +
      `(desen payı %${Math.round(num('p-patMix', 0) * 100)})`
    );
    scheduleRegen();
    return;
  }

  const [cols, rows] = gridDimsFor(state.patternAspect);
  state.sourceGrid = renderPattern(cols, rows, key, patternOpts());
  state.sourceKind = 'desen';
  state.uploadGrid = null;      // artık saf desen kaynağındayız
  state.uploadKind = null;
  updateSourceStats();
  refreshPatternCode();
  state.tris = null;
  state.aspect = state.patternAspect;
  state.meshInfo = null;
  const metin = els['p-seedText'].value.trim();
  setSourceStatus(
    `Desen: ${PATTERNS[key].label}${metin ? ` — "${metin}" tohumundan` : ''}`
  );
  patternHint();
  resetPaint();
  setInvert(false);
  syncAspect();
  scheduleRegen();
}


/**
 * Kabartma yönünü ayarlar.
 * @param {boolean} v true ise koyu alanlar öne çıkar
 * @param {boolean} auto otomatik seçildiyse kullanıcıya nedenini söyler
 */
function setInvert(v, auto = false) {
  state.invert = !!v;
  const light = !state.invert;
  els['dir-light'].classList.toggle('active', light);
  els['dir-dark'].classList.toggle('active', !light);
  els['dir-light'].setAttribute('aria-checked', String(light));
  els['dir-dark'].setAttribute('aria-checked', String(!light));

  const hint = els['dir-hint'];
  hint.classList.toggle('auto', auto && state.invert);
  if (auto && state.invert) {
    hint.textContent = 'Zemin konudan açık olduğu için otomatik olarak "koyu alanlar" seçildi. ' +
      'Ters isterseniz diğerine dokunun.';
  } else {
    hint.textContent = 'Görsel yüklediğinizde otomatik seçilir. Konu panele gömülüyorsa diğerine geçin.';
  }
}

function syncAspect() {
  if (!bool('p-lockAspect') || !state.sourceGrid) return;
  const w = num('p-panelW', 900);
  els['p-panelH'].value = Math.round(w / state.aspect);
}

// ------------------------------------------------------------ üretim

function scheduleRegen() {
  clearTimeout(regenTimer);
  els.busy.hidden = false;
  regenTimer = setTimeout(() => {
    try {
      regenerate();
    } catch (err) {
      console.error(err);
      showWarnings([`Hesaplama hatası: ${err.message}`]);
    } finally {
      els.busy.hidden = true;
    }
  }, 120);
}

function regenerate() {
  if (state.mode === 'facets' || state.mode === 'slices') {
    regenerateMesh();
    return;
  }
  if (!state.sourceGrid) return;
  // Otomatik yumuşatma kaynak türüne de bakar; kaynak değiştiğinde ekrandaki
  // değer bayat kalmasın (hesap doğruydu ama gösterge yanıltıyordu).
  syncRangeOutputs();
  const filters = readFilters();
  state.grid = applyFilters(state.sourceGrid, filters);
  if (filters.facetCells >= 6) {
    state.grid = facetize(state.grid, { cells: filters.facetCells, flat: filters.facetFlat });
  }

  // Elle çizilen derinlik düzeltmesi — fotoğrafta olmayan biçim bilgisi.
  if (state.paintLayer && !isEmpty(state.paintLayer)) {
    state.grid = applyPaint(state.grid, state.paintLayer);
  }

  // Silüet şişirme: derinliği parlaklıktan değil, kenara uzaklıktan türetir.
  state.reliefInfo = null;
  if (filters.inflate > 0) {
    const r = inflateSilhouette(state.grid, {
      roundness: filters.roundness,
      detail: filters.reliefDetail,
    });
    state.grid = blendRelief(state.grid, r.grid, filters.inflate);
    state.reliefInfo = r.info;
  }

  const params = readParams();
  const result = state.mode === 'ribs'
    ? generateRibs(state.grid, params)
    : generateContours(state.grid, params);

  state.parts = result.parts;
  state.info = result.info;
  state.warnings = result.warnings;

  state.nestResult = nest(state.parts, readNestOpts());
  state.sheetIndex = Math.min(state.sheetIndex, Math.max(0, state.nestResult.sheets.length - 1));
  state.cutList = buildCutList(state.parts, state.nestResult, state.info, {
    feedRate: num('p-feedRate', 3000),
  });

  els['stage-hint'].hidden = true;
  render();
}

/** Onarımda uzun kenar boyunca voksel sayısı. At modelinde 64 ve 80'de
 * ince bacaklar koptu, 96'da alt bacak parçalandı, 128'de sağlam kaldı. */
const REMESH_RES = 128;

/**
 * Poligonal kabuk için üçgen ağı hazırlar.
 *
 *  - Model bozuksa (delik, çakışık kenar, düğümlü yüzey) önce hacimden
 *    yeniden kurulur — bkz. remesh.js.
 *  - 3B model yüklüyse ve hedef yüzey sayısından yoğunsa SADELEŞTİRİLİR.
 *    Yapay zekâ/tarama modelleri adında "low poly" yazsa da ince bölünmüş
 *    eğri yüzeylerdir; sadeleştirilmeden faset modunda yüzlerce parça ve
 *    binlerce kaynaklanamaz dikiş çıkar.
 *  - Model yoksa ama görsel varsa, görselden KAPALI bir kabartma hacmi
 *    kurulur (ön yüz düşük poligonlu, arka düz, yanlar etek). Serbest duran
 *    heykel değil, duvara asılan kabartmadır — tek fotoğrafta arka taraf yok.
 *
 * @returns {{tris, not}|null}
 */
function facetMeshSource() {
  if (state.tris) {
    const hedef = Math.round(num('p-targetFaces', 300));
    const secim = els['p-remesh']?.value || 'oto';

    // ONARIM (hacimden yeniden kurma). Delikli, çakışık kenarlı ya da
    // düğüm düğüm kulplu modeller doğrudan sadeleştirilemez — at modelinde
    // gövde dev kıymıklara dönüştü. Ağ sağlığı model başına bir kez ölçülür.
    if (state.remeshCache?.src !== state.tris) {
      state.remeshCache = { src: state.tris, health: meshHealth(state.tris), tris: null, info: null };
    }
    const rc = state.remeshCache;
    const onar = secim === 'acik' || (secim === 'oto' && rc.health.bozuk);
    if (onar && !rc.tris) {
      const r = voxelRemesh(state.tris, { resolution: REMESH_RES, smooth: 1 });
      rc.tris = r.tris;
      rc.info = r.info;
    }
    const taban = onar ? rc.tris : state.tris;
    const notlar = [];
    if (onar) {
      const h = rc.health;
      notlar.push(
        'Model onarıldı' +
        (secim === 'oto' ? ` (${h.openEdges} delik kenarı, ${h.nonManifold} çakışık kenar vardı)` : '') +
        ': delikler kapandı, ince teller yumuşadı.'
      );
    }

    if (hedef > 0 && taban.length > hedef) {
      // Aynı ağ ve aynı hedef için sonucu sakla; kaydırıcı her oynadığında
      // yeniden sadeleştirmek saniyeler yer.
      // Ağ kimliği referansla karşılaştırılır: üçgen sayısına bakmak,
      // aynı sayıda üçgenli iki farklı modeli karıştırırdı.
      if (state.decimateCache?.src !== taban || state.decimateCache.hedef !== hedef) {
        const d = decimate(taban, hedef);
        state.decimateCache = { src: taban, hedef, tris: d.tris, before: state.tris.length, after: d.after };
      }
      const c = state.decimateCache;
      notlar.push(`${c.before} üçgen → ${c.after} üçgene sadeleştirildi (hedef yüzey sayısı).`);
      return { tris: c.tris, not: notlar.join(' ') };
    }
    return { tris: taban, not: notlar.length ? notlar.join(' ') : null };
  }
  if (state.sourceGrid) {
    const g = applyFilters(state.sourceGrid, readFilters());
    const boy = num('p-targetSize', 600);
    const a = state.aspect || 1;
    return {
      tris: meshFromHeightmap(g, {
        width: a >= 1 ? boy : boy * a,
        height: a >= 1 ? boy / a : boy,
        depth: num('p-reliefDepth', 60),
        backThickness: Math.max(5, num('p-reliefDepth', 60) * 0.25),
        cells: Math.round(num('p-reliefCells', 14)),
      }),
      not: 'Görselden duvar kabartması kuruldu (arkası düz). Serbest duran heykel ' +
        'için 3B model yükleyin.',
    };
  }
  return null;
}

function regenerateMesh() {
  state.seams = [];
  const kaynak = state.mode === 'facets' ? facetMeshSource() : (state.tris ? { tris: state.tris, not: null } : null);
  if (!kaynak || !kaynak.tris?.length) {
    state.parts = [];
    state.info = null;
    state.cutList = null;
    state.nestResult = null;
    state.warnings = [];
    state.notes = [];
    els['stage-hint'].hidden = false;
    els['stage-hint'].textContent = state.mode === 'facets'
      ? 'Görsel ya da 3B model (STL/OBJ) yükleyin. Görselden duvar kabartması, ' +
        'modelden serbest duran heykel çıkar.'
      : 'Bu mod için 3B model gerekir (görsel yeterli değil): STL veya OBJ yükleyin. ' +
        'Denemek için "Hazır desen"e dokunun — gömülü bir model gelir.';
    els.summary.innerHTML = '';
    showWarnings([]);
    // Önizlemeler de TEMİZLENMELİ. Eskiden temizlenmiyordu: modele ihtiyaç
    // duyan bir moda model olmadan geçilince önceki modun paneli 3B sahnede
    // asılı kalıyor, kullanıcı "yeni mod çalışmıyor" sanıyordu.
    preview3d?.update(state);
    drawParts(els['view-plan'], []);
    return;
  }
  const result = state.mode === 'slices'
    ? generateSlices(kaynak.tris, readParams())
    : generateFacets(kaynak.tris, readParams());
  state.notes = (result.notes || []).slice();
  if (kaynak.not) state.notes.unshift(kaynak.not);
  state.parts = result.parts;
  state.info = result.info;
  state.seams = result.seams || [];
  state.folds = result.folds || [];
  state.warnings = result.warnings;

  state.nestResult = nest(state.parts, readNestOpts());
  state.sheetIndex = Math.min(state.sheetIndex, Math.max(0, state.nestResult.sheets.length - 1));
  state.cutList = buildCutList(state.parts, state.nestResult, state.info, {
    feedRate: num('p-feedRate', 3000),
  });
  els['stage-hint'].hidden = true;
  render();
}

// ------------------------------------------------------------ görselleştirme

function render() {
  if (state.view === '3d') preview3d?.update(state);
  else if (state.view === 'plan') {
    if (state.mode === 'facets' || state.mode === 'slices') {
      if (state.planFocus >= state.parts.length) state.planFocus = -1;
      state.planCells = drawParts(els['view-plan'], state.parts, state.planFocus, state.planView);
    }
    else drawPlan(els['view-plan'], state);
  }
  else if (state.view === 'nest') drawNest(els['view-nest'], state.nestResult, state.sheetIndex);
  else if (state.view === 'paint') {
    drawPaintView(els['view-paint'], state.grid, state.paintLayer);
  } else drawSource(els['view-source'], state.grid);

  renderSummary();
  showWarnings(collectWarnings());
  renderCutList();
}

/**
 * "Neden böyle çıktı?" uyarıları.
 *
 * Lamel panelin yatayda çözünürlüğü lamel adımıdır: 24 mm adımda 882 mm'lik
 * panel yatayda 37 "piksel" demektir. Adımdan ince olan her şey kaybolur.
 * Bunu söylemezsek kullanıcı, yazısı okunmayan bir logoya bakıp yazılımın
 * bozuk olduğunu düşünür — panel aslında yapabileceğinin en iyisini
 * yapmıştır.
 *
 * Ölçüldü (adımdan ince değişim oranı): logo %40 | fotoğraf %8 |
 * dalga deseni %0 | voronoi %13 | akustik difüzör %35.
 */
// Eşik, üretilen panellere BAKILARAK kalibre edildi (aynı logo, 24 mm adım):
//   panel  882 mm -> %40  yazı parazite dönüyor
//   panel 1100 mm -> %34  "SAPCI" okunuyor, alt satır bulanık ama düzgün
//   panel 1300 mm -> %31  temiz
//   panel 1600 mm -> %29  alt satır da okunuyor
// Dönüm noktası %40 ile %34 arasında; eşik 0,36 seçildi.
const INCE_DETAY_ESIGI = 0.36;

/**
 * Bu kaynak hangi panel genişliğinden sonra düzgün çıkar?
 * Adım sabitken panel büyüdükçe bir lamele düşen ayrıntı azalır; oranın
 * eşiğin altına indiği ilk genişlik aranır.
 * @returns {number|null} mm — bulunamazsa null
 */
function gerekenPanelGenisligi(kaynak, adim, simdiki) {
  for (let w = Math.ceil(simdiki / 100) * 100; w <= simdiki * 5 && w <= 6000; w += 100) {
    const oran = fineDetailRatio(kaynak, (adim * kaynak.w) / w / 2);
    if (oran < INCE_DETAY_ESIGI) return w;
  }
  return null;
}

function cozunurlukUyarilari() {
  const out = [];
  // HAM kaynak ölçülür, filtrelenmiş hâli değil. Yumuşatma ince ayrıntıyı
  // zaten siliyor; filtre sonrasını ölçmek "ayrıntıyı sildim, demek ki
  // ayrıntı yokmuş" demek olurdu. Bu logoda ham %40, filtre sonrası %24.
  const kaynak = state.sourceGrid;
  if (state.mode !== 'ribs' || !kaynak) return out;

  const adim = num('p-thickness', 18) + num('p-gap', 6);
  const panelW = state.info?.panelW || num('p-panelW', 900);
  const lamel = state.info?.count;
  const mmBasinaOrnek = kaynak.w / Math.max(1, panelW);
  const ince = fineDetailRatio(kaynak, (adim * mmBasinaOrnek) / 2);

  if (ince > INCE_DETAY_ESIGI) {
    const gereken = gerekenPanelGenisligi(kaynak, adim, panelW);
    const cozum = gereken
      ? `Paneli ~${gereken} mm genişliğe çıkarın` +
        (adim > 16 ? `, ya da 12 mm lamel + 4 mm boşluk kullanın (adım ${adim} → 16 mm).` : '.')
      : 'Paneli büyütün ya da lamel kalınlığını/boşluğunu küçültün.';
    out.push(
      `Kaynak bu ölçüye sığmıyor: panel yatayda ${lamel || '—'} lamel ` +
      `genişliğinde (adım ${adim} mm) ve kaynaktaki değişimin ` +
      `%${Math.round(ince * 100)}'i bundan ince. İnce ayrıntı kaybolur. ` +
      cozum
    );
  }

  if (cizgiIsiMi()) {
    out.push(
      'Kaynak düz renkli bir grafik (logo, yazı, çizgi iş) gibi görünüyor. ' +
      'Lamel panelde yazı, harf gövdesi 2-3 lamel genişliğine ulaştığında ' +
      'okunur; küçük punto her ölçüde kaybolur. Paneli büyütmek işe yarar. ' +
      'Küçük ölçüde yapılacaksa Katman / Rölyef modu ya da düz siluet kesimi ' +
      'daha iyi sonuç verir. (Fotoğraf yumuşatması bu kaynağa uygulanmadı — ' +
      'grafiklerde keskin kenar kasıtlıdır.)'
    );
  }
  return out;
}

function collectWarnings() {
  const out = state.warnings.slice();
  if (state.nestResult?.oversized.length) {
    out.push(`Levhaya sığmayan parça(lar): ${state.nestResult.oversized.map((p) => p.id).join(', ')}. ` +
      'Levha ölçüsünü büyütün veya paneli küçültün.');
  }
  const ri = state.reliefInfo;
  if (ri) {
    if (ri.coverage < 0.02) {
      out.push('Silüet şişirme: konu olarak neredeyse hiç alan seçilmedi. ' +
        'Kabartma yönünü değiştirin veya kontrastı artırın.');
    } else if (ri.coverage > 0.96) {
      out.push('Silüet şişirme: görselin tamamı konu sayıldı, zemin ayrılamadı. ' +
        'Yüksek kontrastlı bir görsel veya net bir zemin gerekir.');
    }
  }
  out.push(...cozunurlukUyarilari());
  const tool = num('p-toolDiameter', 6);
  if (state.mode === 'ribs' && num('p-gap', 6) > 0 && num('p-gap', 6) < tool) {
    out.push(`Lamel boşluğu (${num('p-gap', 6)} mm) takım çapından (${tool} mm) küçük — ` +
      'lameller ayrı ayrı kesildiği için sorun değil, ancak montajda parmak girmez.');
  }
  return out;
}

function renderSummary() {
  const s = state.cutList?.summary;
  if (!s) { els.summary.innerHTML = ''; return; }
  const i = state.info;
  const chips = i.mode === 'facets' ? [
    ['Boyut', `${Math.round(i.modelSize.x)}×${Math.round(i.modelSize.y)}×${Math.round(i.modelSize.z)} mm`],
    ['Faset', i.facetCount],
    ...(i.unfold ? [['Yaprak', i.partCount], ['Büküm', i.foldCount]] : []),
    ...(i.joinMethod === 'percin'
      ? [['Perçin', i.rivetCount], ['Kaynak dikişi', i.weldSeamCount]]
      : [['Kaynak dikişi', i.seamCount]]),
    ['Sac', `${i.params.thickness} mm`],
    ['Levha', `${s.sheetCount} × ${s.sheetSize}`],
    ['Doluluk', `%${s.utilisation}`],
    ['Kesim yolu', `${(s.totalCutLength / 1000).toFixed(1)} m`],
  ] : [
    ['Panel', s.panel],
    ['Derinlik', `${Math.round(s.totalDepth)} mm`],
    ['Parça', s.partCount],
    ['Levha', `${s.sheetCount} × ${s.sheetSize}`],
    ['Doluluk', `%${s.utilisation}`],
    ['Kesim yolu', `${(s.totalCutLength / 1000).toFixed(1)} m`],
    ['Tahmini süre', `${s.estimatedMinutes} dk`],
  ];
  els.summary.innerHTML = chips
    .map(([k, v]) => `<span class="chip">${k} <b>${v}</b></span>`)
    .join('');
}

function showWarnings(list) {
  if (!list?.length) {
    els.warnings.hidden = true;
    els.warnings.innerHTML = '';
  } else {
    els.warnings.hidden = false;
    els.warnings.innerHTML = `<ul>${list.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
  }
  showNotes();
}

/**
 * Bilgi notları ayrı, KAPALI bir kutuda. Uyarı değildir; kullanıcı istediğinde
 * açar. Açık/kapalı tercihi mod değişse de korunur.
 */
function showNotes() {
  const el = els.notes;
  if (!el) return;
  const list = (state.mode === 'facets' || state.mode === 'slices') ? state.notes : [];
  if (!list?.length) { el.hidden = true; el.innerHTML = ''; return; }
  const acik = el.querySelector('details')?.open || false;
  el.hidden = false;
  el.innerHTML = `<details${acik ? ' open' : ''}><summary>Bilgi · ${list.length} not</summary>` +
    `<ul>${list.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></details>`;
}

function renderCutList() {
  const cl = state.cutList;
  if (!cl) return;
  els['cutlist-panel'].hidden = false;
  const head = '<tr><th>Parça</th><th>Tür</th><th>En</th><th>Boy</th><th>Kalınlık</th><th>Delik</th><th>Kesim (mm)</th></tr>';
  const body = cl.rows.map((r) =>
    `<tr><td>${r.id}</td><td>${r.kind}</td><td>${r.w}</td><td>${r.h}</td>` +
    `<td>${r.thickness}</td><td>${r.holes}</td><td>${r.cutLength}</td></tr>`).join('');
  els.cutlist.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ------------------------------------------------------------ dışa aktarma

function download(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Birden fazla levhayı tek dosyada, yan yana kaydırarak birleştirir. */
function sheetsCombined() {
  const sheets = state.nestResult?.sheets || [];
  const opts = state.nestResult?.opts;
  if (!sheets.length) return null;
  const gap = 80;
  const total = {
    w: opts.sheetW,
    h: sheets.length * opts.sheetH + (sheets.length - 1) * gap,
    placements: [],
  };
  const applied = [];
  sheets.forEach((sheet, i) => {
    const dy = i * (opts.sheetH + gap);
    for (const pl of sheet.placements) {
      const a = applyPlacement(pl);
      applied.push({
        outline: a.outline.map(([x, y]) => [x, y + dy]),
        holes: a.holes.map((h) => h.map(([x, y]) => [x, y + dy])),
        engrave: a.engrave.map((e) => e.type === 'polyline'
          ? { ...e, points: e.points.map(([x, y]) => [x, y + dy]) }
          : { ...e, y: e.y + dy }),
      });
    }
    // Levha sınırı referansı
    applied.push({
      outline: [],
      holes: [],
      engrave: [{
        type: 'polyline', closed: true,
        points: [[0, dy], [opts.sheetW, dy], [opts.sheetW, dy + opts.sheetH], [0, dy + opts.sheetH]],
      }],
    });
  });
  return { sheet: total, applied };
}

function baseName() {
  const s = state.info;
  return `panel_${s.mode}_${Math.round(s.panelW)}x${Math.round(s.panelH)}_${s.params.thickness}mm`;
}

function requireModel() {
  if (!state.info) {
    alert('Önce bir görsel veya STL yükleyin (ya da “Örnek desen”e dokunun).');
    return false;
  }
  return true;
}

els['dl-dxf'].onclick = () => {
  if (!requireModel()) return;
  const c = sheetsCombined();
  if (!c) return;
  download(`${baseName()}.dxf`, sheetToDxf(c.sheet, c.applied, { withSheetOutline: false }), 'application/dxf');
};

els['dl-svg'].onclick = () => {
  if (!requireModel()) return;
  const c = sheetsCombined();
  if (!c) return;
  download(`${baseName()}.svg`, sheetToSvg(c.sheet, c.applied, {
    withSheetOutline: false, title: baseName(),
  }), 'image/svg+xml');
};

els['dl-csv'].onclick = () => {
  if (!requireModel()) return;
  download(`${baseName()}_kesim_listesi.csv`, cutListToCsv(state.cutList), 'text/csv');
};

els['dl-guide'].onclick = () => {
  if (!requireModel()) return;
  const s = state.cutList.summary;
  const text = [
    `${baseName()}`,
    '='.repeat(60),
    assemblyGuide(state.info, state.seams, state.folds),
    '',
    'MALZEME ÖZETİ',
    `  Parça sayısı      : ${s.partCount}`,
    `  Levha             : ${s.sheetCount} adet ${s.sheetSize}`,
    `  Levha doluluğu    : %${s.utilisation}`,
    `  Toplam kesim yolu : ${(s.totalCutLength / 1000).toFixed(1)} m`,
    `  Tahmini süre      : ${s.estimatedMinutes} dakika (${num('p-feedRate', 3000)} mm/dk)`,
    '',
    'CNC NOTLARI',
    `  Yumuşatma         : ${effectiveBlurMm().toFixed(1)} mm` +
      (bool('p-autoBlur') ? ` (otomatik — kaynak: ${state.sourceKind || 'yok'})` : ' (elle)'),
    `  Takım çapı        : ${num('p-toolDiameter', 6)} mm`,
    `  Uygulanan ofset   : ${num('p-offset', 0)} mm`,
    ...(state.info?.mode === 'ribs' ? [
      state.info.dogboneApplied > 0
        ? `  Köşe payı         : ${state.info.dogboneApplied} köşe (Ø${num('p-toolDiameter', 6)} mm uca göre) — ` +
          `${state.info.dogboneApplied - state.info.tboneApplied} kemik, ${state.info.tboneApplied} T payı` +
          (state.info.dogboneSkipped > 0 ? `, ${state.info.dogboneSkipped} köşeye sığmadı` : '')
        : `  Köşe payı         : yok — kanal dipleri ${(num('p-toolDiameter', 6) / 2).toFixed(1)} mm yarıçapla kalır`,
    ] : []),
    '  KESIM katmanı     : malzemeyi tam kes (kalınlık + 1 mm dalma)',
    '  GRAVUR katmanı    : 1–2 mm yüzeysel dalma (numara ve hizalama çizgileri)',
  ].join('\n');
  download(`${baseName()}_montaj.txt`, text, 'text/plain');
};

els['dl-json'].onclick = () => {
  const data = { mode: state.mode, params: readParams(), filters: readFilters(), nest: readNestOpts() };
  download('panel_ayarlari.json', JSON.stringify(data, null, 2), 'application/json');
};

els['load-json'].onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    setMode(data.mode || 'ribs');
    applySettings(data);
    scheduleRegen();
  } catch (err) {
    alert(`Ayar dosyası okunamadı: ${err.message}`);
  }
  e.target.value = '';
};

function applySettings(data) {
  const all = { ...(data.params || {}), ...(data.filters || {}), ...(data.nest || {}) };
  if ('invert' in all) setInvert(all.invert);
  for (const [k, v] of Object.entries(all)) {
    if (k === 'invert') continue;
    const el = els[`p-${k}`];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
  syncRangeOutputs();
}

// ------------------------------------------------------------ derinlik çizimi

function setSourceStatus(text, isError = false) {
  const el = els['source-status'];
  el.textContent = text || '';
  el.style.color = isError ? 'var(--danger)' : 'var(--accent-2)';
}

function resetPaint() {
  const g = state.sourceGrid;
  state.paintLayer = g ? createPaintLayer(g.w, g.h) : null;
  state.undoStack = [];
}

/** Anlık görüntü Int8'e nicemlenir — 768x530 katman 1,6 MB yerine 400 KB. */
function pushUndo() {
  const l = state.paintLayer;
  if (!l) return;
  const snap = new Int8Array(l.data.length);
  for (let i = 0; i < snap.length; i++) snap[i] = Math.round(l.data[i] * 127);
  state.undoStack.push(snap);
  if (state.undoStack.length > 8) state.undoStack.shift();
}

function popUndo() {
  const snap = state.undoStack.pop();
  const l = state.paintLayer;
  if (!snap || !l) return false;
  for (let i = 0; i < snap.length; i++) l.data[i] = snap[i] / 127;
  return true;
}

/** Fırça çapı mm cinsinden girilir; ızgara hücresine çevrilir. */
function brushRadiusCells() {
  return Math.max(1, mmToSamples(num('p-brushSize', 120)) / 2);
}

function setBrushMode(mode) {
  state.brushMode = mode;
  for (const m of ['raise', 'lower', 'smooth']) {
    els[`brush-${m}`].classList.toggle('active', m === mode);
  }
}

function paintAt(e, prev) {
  const g = state.sourceGrid;
  if (!g || !state.paintLayer) return null;
  const [x, y] = screenToGrid(els['view-paint'], g, e.clientX, e.clientY);
  const from = prev || [x, y];
  stroke(state.paintLayer, state.grid || g, from[0], from[1], x, y, {
    radius: brushRadiusCells(),
    amount: num('p-brushAmount', 0.12),
    hardness: num('p-brushHardness', 0.3),
    mode: state.brushMode,
  });
  drawPaintView(els['view-paint'], applyPaint(state.grid || g, state.paintLayer), state.paintLayer);
  return [x, y];
}

(function wirePaint() {
  const cv = els['view-paint'];
  let last = null;
  let drawing = false;

  cv.addEventListener('pointerdown', (e) => {
    if (!state.sourceGrid) return;
    cv.setPointerCapture(e.pointerId);
    pushUndo();
    drawing = true;
    last = paintAt(e, null);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    last = paintAt(e, last);
    e.preventDefault();
  });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    last = null;
    scheduleRegen();   // tam yeniden hesap ancak fırça kalkınca
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);
  cv.addEventListener('pointerleave', finish);

  els['brush-raise'].onclick = () => setBrushMode('raise');
  els['brush-lower'].onclick = () => setBrushMode('lower');
  els['brush-smooth'].onclick = () => setBrushMode('smooth');
  els['btn-undo'].onclick = () => { if (popUndo()) scheduleRegen(); };
  els['btn-clear-paint'].onclick = () => {
    if (isEmpty(state.paintLayer)) return;
    pushUndo();
    state.paintLayer.data.fill(0);
    scheduleRegen();
  };
})();

// ------------------------------------------------- levha ölçüsü ve hafıza

function applySheetPreset() {
  const v = els['p-sheetPreset'].value;
  if (v === 'custom') return;
  const [w, h] = v.split('x').map(Number);
  els['p-sheetW'].value = w;
  els['p-sheetH'].value = h;
}

/** Elle ölçü girilince hazır seçim "Özel"e düşsün. */
function syncSheetPreset() {
  const key = `${Math.round(num('p-sheetW', 0))}x${Math.round(num('p-sheetH', 0))}`;
  const match = [...els['p-sheetPreset'].options].some((o) => o.value === key);
  els['p-sheetPreset'].value = match ? key : 'custom';
}

const STORE_KEY = 'cnc-panel-ayarlar-v1';

/**
 * Ayarlar tarayıcıda saklanır — atölyede hep aynı levha ve takım kullanılır,
 * her açılışta yeniden girmek anlamsız. Gizli sekmede veya site verisi
 * kapalıyken erişim hata verebilir, o yüzden her erişim korumalı.
 */
function saveSettings() {
  try {
    const data = { mode: state.mode, invert: state.invert, fields: {} };
    for (const el of document.querySelectorAll('.panel input, .panel select')) {
      if (el.type === 'file' || !el.id) continue;
      data.fields[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch { /* depolama yok — sorun değil */ }
}

function restoreSettings() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch { return false; }
  if (!data || !data.fields) return false;

  for (const [id, v] of Object.entries(data.fields)) {
    const el = els[id];
    if (!el || el.type === 'file') continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
  setInvert(!!data.invert);
  if (data.mode && data.mode !== 'ribs') setMode(data.mode);
  syncRangeOutputs();
  return true;
}

els['p-viewAxis'].onchange = () => {
  saveSettings();
  if (!state.tris) return;
  reportMesh(rebuildFromMesh());
  syncAspect();
  scheduleRegen();
};

els['p-sheetPreset'].onchange = () => {
  applySheetPreset();
  saveSettings();
  scheduleRegen();
};

els['btn-reset'].onclick = () => {
  if (!confirm('Tüm ayarlar varsayılana dönecek. Devam edilsin mi?')) return;
  try { localStorage.removeItem(STORE_KEY); } catch { /* yoksay */ }
  location.reload();
};

// ------------------------------------------------------------ arayüz olayları

function setMode(mode, persist = true) {
  state.mode = mode;
  for (const m of ['ribs', 'contour', 'facets', 'slices']) {
    const btn = els[`mode-${m}`];
    btn.classList.toggle('active', mode === m);
    btn.setAttribute('aria-selected', String(mode === m));
    els[`${m}-params`].hidden = mode !== m;
  }
  // Poligonal kabukta panel ölçüleri modelden gelir, "malzeme kalınlığı" sac kalınlığıdır.
  els['lbl-thickness'].firstChild.nodeValue =
    mode === 'facets' ? 'Sac kalınlığı (mm)' : 'Malzeme kalınlığı (mm)';
  if (mode === 'facets' && num('p-thickness', 18) > 8) els['p-thickness'].value = 3;
  if (mode !== 'facets' && num('p-thickness', 3) < 6) els['p-thickness'].value = 18;
  syncPatternAvailability();
  syncRangeOutputs();   // otomatik yumuşatma moda göre değişir
  if (persist) saveSettings();
  scheduleRegen();
}

function setView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.tab')) {
    const on = tab.dataset.view === view;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
  }
  for (const v of document.querySelectorAll('.view')) {
    v.classList.toggle('active', v.id === `view-${view}`);
  }
  els['paint-tools'].hidden = view !== 'paint';
  if (view === '3d') preview3d?.resize();
  render();
}

function syncRangeOutputs() {
  for (const input of document.querySelectorAll('input[type=range]')) {
    const out = document.querySelector(`output[for="${input.id}"]`);
    if (out) out.textContent = input.value;
  }
  // Otomatik yumuşatmada kaydırıcı kilitlenir ve hesaplanan değeri gösterir;
  // aksi hâlde ekranda duran sayı ile kullanılan sayı ayrışır.
  const oto = bool('p-autoBlur');
  if (els['p-blur']) els['p-blur'].disabled = oto;
  const cikti = document.querySelector('output[for="p-blur"]');
  if (cikti && oto) cikti.textContent = `${effectiveBlurMm().toFixed(1)} (oto)`;
}

els['dir-light'].onclick = () => { setInvert(false); saveSettings(); scheduleRegen(); };
els['dir-dark'].onclick = () => { setInvert(true); saveSettings(); scheduleRegen(); };

els['mode-ribs'].onclick = () => setMode('ribs');
els['mode-contour'].onclick = () => setMode('contour');
els['mode-facets'].onclick = () => setMode('facets');
els['mode-slices'].onclick = () => setMode('slices');

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => setView(tab.dataset.view);
}

// Plan: parçaya dokun → tam ekran. Tam ekranda iki parmak (ya da fare
// tekerleği) yakınlaştırır, tek parmak kaydırır. Sol/sağ kenara dokunmak
// önceki/sonraki parça, ortaya dokunmak: yakınsa sığdır, değilse ızgara.
// Yakınlaştırma yokken 4 mm'lik perçin deliği telefonda 1-2 piksele
// düşüyor, etiketler okunmuyordu.
const planDokunma = { noktalar: new Map(), surukledi: false, bas: null };

function planCiz() {
  state.planCells = drawParts(els['view-plan'], state.parts, state.planFocus, state.planView);
  // Tam ekranda sayfa kaydırma/yakınlaştırma yerine tuval hareketi.
  els['view-plan'].style.touchAction = state.planFocus >= 0 ? 'none' : '';
}

function planGorunumSifirla() { state.planView = { k: 1, px: 0, py: 0 }; }

/** (sx, sy) tuval noktası sabit kalacak şekilde k'ya yakınlaştır. */
function planYakinlas(sx, sy, yeniK) {
  const v = state.planView;
  const cv = els['view-plan'];
  const dpr = cv.width / (cv.getBoundingClientRect().width || 1);
  const k2 = Math.max(1, Math.min(20, yeniK));
  // Parça merkezi C = (w/2 + px, orta + py); S - C oranla ölçeklenir.
  const cx = cv.width / 2, cy = cv.height / 2;
  const X = sx * dpr, Y = sy * dpr;
  v.px = X - cx - (X - cx - v.px) * (k2 / v.k);
  v.py = Y - cy - (Y - cy - v.py) * (k2 / v.k);
  v.k = k2;
  if (k2 === 1) { v.px = 0; v.py = 0; }
}

const planNokta = (e) => {
  const r = els['view-plan'].getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

els['view-plan'].addEventListener('pointerdown', (e) => {
  if (state.planFocus < 0) return;
  els['view-plan'].setPointerCapture?.(e.pointerId);
  planDokunma.noktalar.set(e.pointerId, planNokta(e));
  if (planDokunma.noktalar.size === 1) planDokunma.surukledi = false;
  if (planDokunma.noktalar.size === 2) {
    const [a, b] = [...planDokunma.noktalar.values()];
    planDokunma.bas = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: state.planView.k };
  }
});

els['view-plan'].addEventListener('pointermove', (e) => {
  const onceki = planDokunma.noktalar.get(e.pointerId);
  if (!onceki || state.planFocus < 0) return;
  const p = planNokta(e);
  planDokunma.noktalar.set(e.pointerId, p);
  const cv = els['view-plan'];
  const dpr = cv.width / (cv.getBoundingClientRect().width || 1);
  if (planDokunma.noktalar.size >= 2 && planDokunma.bas) {
    const [a, b] = [...planDokunma.noktalar.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    planYakinlas((a.x + b.x) / 2, (a.y + b.y) / 2, planDokunma.bas.k * (d / planDokunma.bas.d));
    planDokunma.surukledi = true;
  } else {
    const dx = p.x - onceki.x, dy = p.y - onceki.y;
    if (Math.abs(dx) + Math.abs(dy) > 0 && state.planView.k > 1) {
      state.planView.px += dx * dpr;
      state.planView.py += dy * dpr;
    }
    if (Math.hypot(dx, dy) > 3) planDokunma.surukledi = true;
  }
  planCiz();
});

const planBirak = (e) => {
  planDokunma.noktalar.delete(e.pointerId);
  if (planDokunma.noktalar.size < 2) planDokunma.bas = null;
};
els['view-plan'].addEventListener('pointerup', planBirak);
els['view-plan'].addEventListener('pointercancel', planBirak);

els['view-plan'].addEventListener('wheel', (e) => {
  if (state.planFocus < 0) return;
  e.preventDefault();
  const p = planNokta(e);
  planYakinlas(p.x, p.y, state.planView.k * Math.exp(-e.deltaY * 0.0015));
  planCiz();
}, { passive: false });

els['view-plan'].onclick = (e) => {
  if (state.mode !== 'facets' && state.mode !== 'slices') return;
  const n = state.parts?.length || 0;
  if (!n) return;
  // Sürükleme ya da iki parmak hareketinin sonundaki tıklama dokunma sayılmaz.
  if (planDokunma.surukledi) { planDokunma.surukledi = false; return; }
  const r = els['view-plan'].getBoundingClientRect();
  const { x, y } = planNokta(e);
  if (state.planFocus >= 0) {
    if (x < r.width * 0.2) { state.planFocus = (state.planFocus - 1 + n) % n; planGorunumSifirla(); }
    else if (x > r.width * 0.8) { state.planFocus = (state.planFocus + 1) % n; planGorunumSifirla(); }
    else if (state.planView.k > 1.01) planGorunumSifirla();
    else state.planFocus = -1;
  } else {
    const i = state.planCells.findIndex((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
    if (i < 0) return;
    state.planFocus = i;
    planGorunumSifirla();
  }
  planCiz();
};

els['view-nest'].onclick = () => {
  if (!state.nestResult?.sheets.length) return;
  state.sheetIndex = (state.sheetIndex + 1) % state.nestResult.sheets.length;
  drawNest(els['view-nest'], state.nestResult, state.sheetIndex);
};

for (const input of document.querySelectorAll('.panel input, .panel select')) {
  if (input.type === 'file') continue;
  const evt = input.type === 'range' ? 'input' : 'change';
  input.addEventListener(evt, () => {
    syncRangeOutputs();
    if (input.id.startsWith('p-brush')) { saveSettings(); return; }
    if (input.id === 'p-patternCode' || input.id === 'p-seedText') return;
    // Desen payı özel: yüklü görsel varken applyPattern() onu deseni ile
    // DEĞİŞTİRİRDİ. Pay sıfıra çekildiğinde de görsel kaybolurdu.
    if (input.id === 'p-patMix' && state.uploadGrid) {
      saveSettings(); composeSource(); scheduleRegen(); return;
    }
    if (input.id.startsWith('p-pat')) { saveSettings(); applyPattern(); return; }
    if (input.id === 'p-panelW' || input.id === 'p-lockAspect') syncAspect();
    if (input.id === 'p-sheetW' || input.id === 'p-sheetH') syncSheetPreset();
    saveSettings();
    scheduleRegen();
  });
}

for (const id of ['file-image', 'file-image-cam']) {
  els[id].onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSourceStatus(`${file.name} okunuyor…`);
    els.busy.hidden = false;
    try {
      await loadImageFile(file);
    } catch (err) {
      setSourceStatus(`Görsel okunamadı: ${err.message}`, true);
      els.busy.hidden = true;
    }
    e.target.value = '';
  };
}

els['file-stl'].onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  // Eski durum mesajı hemen silinir; yoksa başarısız yüklemede kullanıcı
  // bir önceki dosyanın "yüklendi" yazısını görmeye devam eder.
  setSourceStatus(`${file.name} okunuyor…`);
  els.busy.hidden = false;
  try {
    await loadStlFile(file);
  } catch (err) {
    setSourceStatus(err.message, true);
    els.busy.hidden = true;
  }
  e.target.value = '';
};

els['btn-demo'].onclick = () => {
  els['pattern-block'].open = true;
  applyPattern();
};
els['btn-pattern-random'].onclick = () => {
  els['p-seedText'].value = '';   // rastgele, kişiye özel tohumun yerini alır
  state.patternSeed = Math.random();
  applyPattern();
};

els['p-seedText'].oninput = () => { saveSettings(); applyPattern(); };

els['p-patternCode'].onchange = () => {
  if (!applyPatternCode()) refreshPatternCode();   // bozuksa eskisine dön
};

els['btn-copy-code'].onclick = async () => {
  const kod = els['p-patternCode'].value;
  try {
    await navigator.clipboard.writeText(kod);
    setSourceStatus(`Kod kopyalandı: ${kod}`);
  } catch {
    els['p-patternCode'].select();   // pano yoksa seçili bırak, elle kopyalasın
  }
};
els['p-pattern'].onchange = () => { saveSettings(); applyPattern(); };

// ------------------------------------------------------------ başlangıç

restoreSettings();
patternHint();
syncSheetPreset();
syncRangeOutputs();
createPreview3d(els['view-3d']).then((p) => {
  preview3d = p;
  if (state.parts.length) p.update(state);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js')
    // Her açılışta yeni sürüm var mı diye bak — beklemede kalan bir servis
    // çalışanı eski dosyaları sunmaya devam edebiliyor.
    .then((reg) => reg.update())
    .catch(() => {});
}
