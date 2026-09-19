// Uygulama kabuğu: girdi → yükseklik haritası → parça üretimi → önizleme → dışa aktarma.

import { gridFromImageData, applyFilters, makeGrid, suggestInvert } from './heightmap.js';
import { parseStl, heightmapFromStl } from './stl.js';
import { facetize } from './facet.js';
import { demoMeshTris } from './demomesh.js';
import { generateRibs, RIB_DEFAULTS } from './modes/ribs.js';
import { generateContours, CONTOUR_DEFAULTS } from './modes/contour.js';
import { generateFacets, FACET_DEFAULTS } from './modes/facets.js';
import { nest, applyPlacement } from './nest.js';
import { sheetToDxf } from './export/dxf.js';
import { sheetToSvg } from './export/svg.js';
import { buildCutList, cutListToCsv, assemblyGuide } from './cutlist.js';
import { drawPlan, drawNest, drawSource, drawParts } from './preview2d.js';
import { createPreview3d } from './preview3d.js';

const GRID_MAX = 320;

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
      minArea: num('p-facetMinArea', 150),
      thicknessComp: bool('p-thicknessComp'),
      unfold: bool('p-unfold'),
      maxFacetsPerPatch: Math.round(num('p-maxFacetsPerPatch', 24)),
      bridgeMode: els['p-bridgeMode'].value,
      bridgeWidth: num('p-bridgeWidth', 25),
      autoLimit: num('p-autoLimit', 250),
      dashCut: num('p-dashCut', 30),
      dashGap: num('p-dashGap', 8),
      // Yaprak levhaya sığmalı.
      maxPatchW: num('p-sheetW', 2440) - 2 * num('p-margin', 10),
      maxPatchH: num('p-sheetH', 1220) - 2 * num('p-margin', 10),
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

function readFilters() {
  return {
    blur: num('p-blur', 0),
    contrast: num('p-contrast', 0),
    brightness: num('p-brightness', 0),
    gamma: num('p-gamma', 1),
    invert: state.invert,
    autoNormalize: true,
    facetCells: Math.round(num('p-facetCells', 0)),
    facetFlat: bool('p-facetFlat'),
  };
}

function readNestOpts() {
  return {
    sheetW: num('p-sheetW', 2440),
    sheetH: num('p-sheetH', 1220),
    margin: num('p-margin', 10),
    spacing: num('p-spacing', 6),
    allowRotate: bool('p-allowRotate'),
  };
}

// ------------------------------------------------------------ kaynak yükleme

function gridDimsFor(aspect) {
  if (aspect >= 1) return [GRID_MAX, Math.max(24, Math.round(GRID_MAX / aspect))];
  return [Math.max(24, Math.round(GRID_MAX * aspect)), GRID_MAX];
}

async function loadImageFile(file) {
  const bitmap = await createImageBitmap(file);
  state.aspect = bitmap.width / bitmap.height;
  const [cols, rows] = gridDimsFor(state.aspect);

  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  bitmap.close?.();

  state.sourceGrid = gridFromImageData(img, cols, rows);
  // Koyu konu + açık zemin ise ters çevirmezsek konu panele gömülür.
  setInvert(suggestInvert(state.sourceGrid), true);
  syncAspect();
  scheduleRegen();
}

async function loadStlFile(file) {
  const buf = await file.arrayBuffer();
  const tris = parseStl(buf);
  if (!tris.length) throw new Error('STL dosyasında üçgen bulunamadı.');
  // Modelin en-boy oranını koru.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tris) for (const [x, y] of t) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  state.tris = tris;
  state.aspect = (maxX - minX) / (maxY - minY || 1) || 1;
  const [cols, rows] = gridDimsFor(state.aspect);
  state.sourceGrid = heightmapFromStl(tris, cols, rows);
  setInvert(false);
  syncAspect();
  scheduleRegen();
}

function loadDemo() {
  if (state.mode === 'facets') {
    state.tris = demoMeshTris();
    setInvert(false);
    scheduleRegen();
    return;
  }
  const [cols, rows] = gridDimsFor(1.5);
  const g = makeGrid(cols, rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u = x / (cols - 1);
      const v = y / (rows - 1);
      // Asimetrik girdap: birbirine göre kaymış üç dalga kaynağı
      const d1 = Math.hypot(u - 0.28, (v - 0.42) * 1.3);
      const d2 = Math.hypot(u - 0.76, (v - 0.62) * 0.9);
      const val =
        0.55 * Math.sin(d1 * 26 - 1.2) * Math.exp(-d1 * 2.1) +
        0.40 * Math.sin(d2 * 19 + 0.6) * Math.exp(-d2 * 2.6) +
        0.18 * Math.sin((u * 2.1 + v * 1.4) * 4.0);
      g.data[y * cols + x] = val;
    }
  }
  state.aspect = 1.5;
  state.sourceGrid = g;
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
  if (state.mode === 'facets') {
    regenerateFacets();
    return;
  }
  if (!state.sourceGrid) return;
  const filters = readFilters();
  state.grid = applyFilters(state.sourceGrid, filters);
  if (filters.facetCells >= 6) {
    state.grid = facetize(state.grid, { cells: filters.facetCells, flat: filters.facetFlat });
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

function regenerateFacets() {
  state.seams = [];
  if (!state.tris) {
    state.parts = [];
    state.info = null;
    state.cutList = null;
    state.nestResult = null;
    els['stage-hint'].hidden = false;
    els['stage-hint'].textContent =
      'Bu mod için STL gerekir (görsel yeterli değil). Denemek için "Örnek desen"e dokunun.';
    els.summary.innerHTML = '';
    showWarnings([]);
    return;
  }
  const result = generateFacets(state.tris, readParams());
  state.parts = result.parts;
  state.info = result.info;
  state.seams = result.seams;
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
    if (state.mode === 'facets') drawParts(els['view-plan'], state.parts);
    else drawPlan(els['view-plan'], state);
  }
  else if (state.view === 'nest') drawNest(els['view-nest'], state.nestResult, state.sheetIndex);
  else drawSource(els['view-source'], state.grid);

  renderSummary();
  showWarnings(collectWarnings());
  renderCutList();
}

function collectWarnings() {
  const out = state.warnings.slice();
  if (state.nestResult?.oversized.length) {
    out.push(`Levhaya sığmayan parça(lar): ${state.nestResult.oversized.map((p) => p.id).join(', ')}. ` +
      'Levha ölçüsünü büyütün veya paneli küçültün.');
  }
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
    ['Kaynak dikişi', i.seamCount],
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
    return;
  }
  els.warnings.hidden = false;
  els.warnings.innerHTML = `<ul>${list.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
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
    `  Takım çapı        : ${num('p-toolDiameter', 6)} mm`,
    `  Uygulanan ofset   : ${num('p-offset', 0)} mm`,
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

// ------------------------------------------------------------ arayüz olayları

function setMode(mode) {
  state.mode = mode;
  for (const m of ['ribs', 'contour', 'facets']) {
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
  if (view === '3d') preview3d?.resize();
  render();
}

function syncRangeOutputs() {
  for (const input of document.querySelectorAll('input[type=range]')) {
    const out = document.querySelector(`output[for="${input.id}"]`);
    if (out) out.textContent = input.value;
  }
}

els['dir-light'].onclick = () => { setInvert(false); scheduleRegen(); };
els['dir-dark'].onclick = () => { setInvert(true); scheduleRegen(); };

els['mode-ribs'].onclick = () => setMode('ribs');
els['mode-contour'].onclick = () => setMode('contour');
els['mode-facets'].onclick = () => setMode('facets');

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => setView(tab.dataset.view);
}

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
    if (input.id === 'p-panelW' || input.id === 'p-lockAspect') syncAspect();
    scheduleRegen();
  });
}

for (const id of ['file-image', 'file-image-cam']) {
  els[id].onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    els.busy.hidden = false;
    try {
      await loadImageFile(file);
    } catch (err) {
      showWarnings([`Görsel okunamadı: ${err.message}`]);
      els.busy.hidden = true;
    }
    e.target.value = '';
  };
}

els['file-stl'].onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  els.busy.hidden = false;
  try {
    await loadStlFile(file);
  } catch (err) {
    showWarnings([`STL okunamadı: ${err.message}`]);
    els.busy.hidden = true;
  }
  e.target.value = '';
};

els['btn-demo'].onclick = () => loadDemo();

// ------------------------------------------------------------ başlangıç

syncRangeOutputs();
createPreview3d(els['view-3d']).then((p) => {
  preview3d = p;
  if (state.parts.length) p.update(state);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
