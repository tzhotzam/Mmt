// Dolap programının arayüzü: proje durumu → hesap → çizim.

import { varsayilanProje, modul, LEVHA_HAZIR, RENKLER, kapakTuru } from './model.js';
import { projeyiCoz } from './govde.js';
import { kesimListesi, kesimCsv, levhaPlani, hirdavatListesi, maliyet, MALZEME_ADI } from './kesim.js';
import { levhaDxf, levhalarDxf } from './dxf.js';
import { olustur3d } from './onizleme3d.js';
import { parcaCiz, levhaCiz, DELIK_RENK, DELIK_AD } from './cizim2d.js';

const ANAHTAR = 'dolap-proje-1';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let proje = yukle();
const durum = {
  modulId: proje.moduller[0]?.id ?? null,
  parcaNo: null,
  gorunum: '3d',
  levhaMalzeme: 'govde',
  levhaNo: 0,
  liste: 'modul',
};
let cozum = null, plan = null, levhaKutulari = [];
let uc = null;

// ------------------------------------------------------------ saklama

function yukle() {
  try {
    const s = localStorage.getItem(ANAHTAR);
    if (s) return birlestir(JSON.parse(s));
  } catch { /* bozuk ya da erişilemez: örnekle başla */ }
  return varsayilanProje();
}

/** Eski/eksik kayıtları güncel varsayılanlarla tamamlar. */
function birlestir(kayit) {
  const v = varsayilanProje();
  const derin = (a, b) => {
    for (const k of Object.keys(b || {})) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') derin(a[k], b[k]);
      else if (b[k] !== undefined) a[k] = b[k];
    }
    return a;
  };
  const { moduller, ...geri } = kayit || {};
  const p = derin(v, geri);
  if (Array.isArray(moduller)) {
    p.moduller = moduller
      .filter((m) => m && ['alt', 'ust', 'boy'].includes(m.tip))
      .map((m) => ({ ...modul(m.tip), ...m }));
  }
  return p;
}

let saklaZaman = 0;
function sakla() {
  clearTimeout(saklaZaman);
  saklaZaman = setTimeout(() => {
    try { localStorage.setItem(ANAHTAR, JSON.stringify(proje)); } catch { /* yer yok */ }
  }, 300);
}

// ------------------------------------------------------------ hesap

let hesapZaman = 0;
function sonra() {
  clearTimeout(hesapZaman);
  hesapZaman = setTimeout(hesapla, 120);
}

function hesapla() {
  cozum = projeyiCoz(proje);
  plan = levhaPlani(cozum.parcalar, proje);
  if (!plan[durum.levhaMalzeme]) durum.levhaMalzeme = Object.keys(plan)[0] || 'govde';
  const lv = plan[durum.levhaMalzeme]?.levhalar.length || 0;
  durum.levhaNo = Math.min(durum.levhaNo, Math.max(0, lv - 1));
  if (durum.parcaNo && !cozum.parcalar.some((p) => p.no === durum.parcaNo)) durum.parcaNo = null;

  modulListesi();
  ozet();
  kesimTablosu();
  levhaOzeti();
  hirdavatTablosu();
  gorunumCiz();
  uc?.guncelle(cozum, proje, durum.modulId);
  sakla();
}

const seciliModul = () => proje.moduller.find((m) => m.id === durum.modulId) || null;
const seciliParca = () => cozum?.parcalar.find((p) => p.no === durum.parcaNo) || null;

// ------------------------------------------------------------ modüller

const TIP_AD = { alt: 'Alt', ust: 'Üst', boy: 'Boy' };
const KAPAK_AD = { tek: 'tek kapak', cift: 'çift kapak', cekmece: 'çekmeceli', yok: 'açık' };

function modulListesi() {
  const kap = $('#modul-listesi');
  kap.innerHTML = '';
  proje.moduller.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'modul-kart' + (m.id === durum.modulId ? ' secili' : '');
    const kt = kapakTuru(m);
    b.innerHTML = `<span class="rozet">M${i + 1} · ${TIP_AD[m.tip]}</span><b></b>` +
      `<span>${m.w} × ${m.h} × ${m.d}</span><span>${KAPAK_AD[kt]}${kt === 'cekmece' ? ` (${m.cekmeceSayisi})` : ''}</span>`;
    b.querySelector('b').textContent = m.ad;
    b.addEventListener('click', () => modulSec(m.id));
    kap.appendChild(b);
  });
  if (!proje.moduller.length) kap.innerHTML = '<p class="hint">Henüz modül yok. Aşağıdan ekleyin.</p>';
}

function modulSec(id) {
  durum.modulId = id;
  formuDoldur();
  modulListesi();
  uc?.guncelle(cozum, proje, durum.modulId);
}

function formuDoldur() {
  const m = seciliModul();
  $('#modul-duzen').hidden = !m;
  if (!m) return;
  for (const el of $$('[data-m]')) el.value = m[el.dataset.m] ?? '';
  gorunurluk();
}

function gorunurluk() {
  const m = seciliModul();
  if (!m) return;
  const kt = kapakTuru(m);
  const goster = {
    tek: kt === 'tek',
    cekmece: kt === 'cekmece',
    raf: kt !== 'cekmece',
    boy: m.tip === 'boy',
  };
  for (const el of $$('#modul-duzen [data-goster]')) el.hidden = !goster[el.dataset.goster];
  for (const o of $$('#modul-duzen option[data-sadece]')) o.disabled = o.dataset.sadece !== m.tip;
}

for (const el of $$('[data-m]')) {
  const olay = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(olay, () => {
    const m = seciliModul();
    if (!m) return;
    const k = el.dataset.m;
    if (el.type === 'number') {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      m[k] = v;
    } else {
      m[k] = el.value;
    }
    if (k === 'tip') {
      // Tip değişince ölçüler o tipin makul değerlerine döner; genişlik kalır.
      const v = modul(m.tip);
      Object.assign(m, { h: v.h, d: v.d, rafSayisi: v.rafSayisi, sabitRaf: v.sabitRaf, ustRafSayisi: v.ustRafSayisi });
      if (['Alt dolap', 'Üst dolap', 'Boy dolap'].includes(m.ad)) m.ad = v.ad;
      if (m.kapak === 'cekmece' && m.tip !== 'alt') m.kapak = 'otomatik';
      formuDoldur();
    }
    gorunurluk();
    sonra();
  });
}

for (const b of $$('[data-ekle]')) {
  b.addEventListener('click', () => {
    const m = modul(b.dataset.ekle);
    const i = proje.moduller.findIndex((x) => x.id === durum.modulId);
    proje.moduller.splice(i >= 0 ? i + 1 : proje.moduller.length, 0, m);
    durum.modulId = m.id;
    formuDoldur();
    hesapla();
  });
}

function tasi(yon) {
  const i = proje.moduller.findIndex((x) => x.id === durum.modulId);
  const j = i + yon;
  if (i < 0 || j < 0 || j >= proje.moduller.length) return;
  [proje.moduller[i], proje.moduller[j]] = [proje.moduller[j], proje.moduller[i]];
  hesapla();
}
$('#m-sola').addEventListener('click', () => tasi(-1));
$('#m-saga').addEventListener('click', () => tasi(1));
$('#m-kopya').addEventListener('click', () => {
  const m = seciliModul();
  if (!m) return;
  const k = { ...m, id: modul(m.tip).id };
  proje.moduller.splice(proje.moduller.indexOf(m) + 1, 0, k);
  durum.modulId = k.id;
  formuDoldur();
  hesapla();
});
$('#m-sil').addEventListener('click', () => {
  const i = proje.moduller.findIndex((x) => x.id === durum.modulId);
  if (i < 0) return;
  proje.moduller.splice(i, 1);
  durum.modulId = proje.moduller[Math.min(i, proje.moduller.length - 1)]?.id ?? null;
  formuDoldur();
  hesapla();
});

// ------------------------------------------------------------ proje ayarları

const yolOku = (yol) => yol.split('.').reduce((o, k) => o?.[k], proje);
function yolYaz(yol, v) {
  const k = yol.split('.');
  const son = k.pop();
  k.reduce((o, x) => o[x], proje)[son] = v;
}

for (const sel of $$('select[data-renk]')) {
  for (const ad of Object.keys(RENKLER)) sel.add(new Option(ad, ad));
}
const hazir = $('#levha-hazir');
hazir.add(new Option('Özel', ''));
LEVHA_HAZIR.forEach((l, i) => hazir.add(new Option(l.ad, String(i))));
hazir.addEventListener('change', () => {
  const l = LEVHA_HAZIR[+hazir.value];
  if (!l) return;
  proje.levha.w = l.w;
  proje.levha.h = l.h;
  ayarlariDoldur();
  hesapla();
});

function ayarlariDoldur() {
  for (const el of $$('[data-yol]')) {
    const v = yolOku(el.dataset.yol);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  }
  const i = LEVHA_HAZIR.findIndex((l) => l.w === proje.levha.w && l.h === proje.levha.h);
  hazir.value = i >= 0 ? String(i) : '';
}

for (const el of $$('[data-yol]')) {
  const olay = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
  el.addEventListener(olay, () => {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') {
      v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
    } else v = el.value;
    yolYaz(el.dataset.yol, v);
    if (el.dataset.yol.startsWith('levha.')) {
      const i = LEVHA_HAZIR.findIndex((l) => l.w === proje.levha.w && l.h === proje.levha.h);
      hazir.value = i >= 0 ? String(i) : '';
    }
    sonra();
  });
}

// ------------------------------------------------------------ özet

const para = (v) => Math.round(v).toLocaleString('tr-TR') + ' ₺';
const sayi = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

function ozet() {
  const m = maliyet(cozum, plan, proje);
  const levhalar = Object.values(plan).map((x) => `${MALZEME_ADI[x.malzeme].toLowerCase()} ${x.levhalar.length}`).join(' · ');
  const chip = (a, b) => `<span class="chip">${a} <b>${b}</b></span>`;
  $('#ozet').innerHTML =
    chip('Modül', proje.moduller.length) +
    chip('Parça', cozum.parcalar.length) +
    chip('Levha', levhalar || '—') +
    chip('Bant', `${m.bantM} m`) +
    chip('Malzeme', para(m.toplam));

  const u = [...cozum.uyarilar];
  for (const x of Object.values(plan)) {
    for (const p of x.sigmayan) u.push(`${p.no} ${p.ad} (${p.kesimBoy}×${p.kesimEn}) levhaya sığmıyor.`);
  }
  const kutu = $('#uyarilar');
  kutu.hidden = !u.length;
  kutu.innerHTML = u.length ? `<ul>${u.map((x) => `<li>${kac(x)}</li>`).join('')}</ul>` : '';
}

// ------------------------------------------------------------ kesim listesi

function kesimTablosu() {
  const satirlar = kesimListesi(cozum.parcalar, durum.liste);
  const t = $('#kesim-tablo');
  let html = '<thead><tr><th>Parça</th><th>Adet</th><th>Boy</th><th>En</th><th>Kal.</th><th title="Bantlı kenar: boy / en">Bant</th></tr></thead><tbody>';
  let grup = null;
  for (const s of satirlar) {
    if (durum.liste === 'modul' && s.modulNo !== grup) {
      grup = s.modulNo;
      html += `<tr class="grup"><td colspan="6">M${s.modulNo} · ${kac(s.modulAd)}</td></tr>`;
    }
    const sec = s.nolar.includes(durum.parcaNo) ? ' secili' : '';
    html += `<tr data-no="${s.nolar[0]}" class="${sec}"><td class="ad">${kac(s.ad)}` +
      (durum.liste === 'toplu' || s.malzeme !== 'govde' ? ` <span class="malz">${MALZEME_ADI[s.malzeme]}</span>` : '') +
      `</td><td>${s.adet}</td><td>${sayi(s.boy)}</td><td>${sayi(s.en)}</td><td>${s.kalinlik}</td>` +
      `<td>${s.boyBant}/${s.enBant}</td></tr>`;
  }
  t.innerHTML = html + '</tbody>';
}

$('#kesim-tablo').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-no]');
  if (!tr) return;
  parcaSec(tr.dataset.no, true);
});

for (const b of $$('[data-liste]')) {
  b.addEventListener('click', () => {
    durum.liste = b.dataset.liste;
    for (const x of $$('[data-liste]')) x.classList.toggle('active', x === b);
    kesimTablosu();
  });
}

function parcaSec(no, goster) {
  durum.parcaNo = no;
  const p = seciliParca();
  if (p && p.modulId !== durum.modulId) {
    durum.modulId = p.modulId;
    formuDoldur();
    modulListesi();
    uc?.guncelle(cozum, proje, durum.modulId);
  }
  // Parçanın bulunduğu levhaya geç.
  for (const [k, x] of Object.entries(plan)) {
    const i = x.levhalar.findIndex((lv) => lv.yerlesim.some((y) => y.parca.no === no));
    if (i >= 0) { durum.levhaMalzeme = k; durum.levhaNo = i; }
  }
  kesimTablosu();
  if (goster) gorunumSec('parca');
  else gorunumCiz();
}

$('#csv').addEventListener('click', () => {
  indir(`${dosyaAdi()}_kesim_listesi.csv`, kesimCsv(kesimListesi(cozum.parcalar, durum.liste), proje), 'text/csv');
});

// ------------------------------------------------------------ levha & DXF

function levhaOzeti() {
  const kap = $('#levha-ozet');
  const dug = $('#dxf-dugmeler');
  kap.innerHTML = '';
  dug.innerHTML = '';
  for (const x of Object.values(plan)) {
    const ort = x.levhalar.reduce((a, l) => a + l.doluluk, 0) / Math.max(1, x.levhalar.length);
    const d = document.createElement('div');
    d.innerHTML = `<div class="satir"><span>${kac(x.ad)}</span><b>${x.levhalar.length} levha · %${Math.round(ort * 100)} dolu</b></div>` +
      `<div class="bar"><i style="width:${Math.round(ort * 100)}%"></i></div>`;
    kap.appendChild(d);
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${MALZEME_ADI[x.malzeme]} · ${x.levhalar.length} levha DXF`;
    b.addEventListener('click', () => {
      indir(`${dosyaAdi()}_${x.malzeme}_tum_levhalar.dxf`, levhalarDxf(x.levhalar, dxfSecenek()), 'application/dxf');
    });
    dug.appendChild(b);
  }
  const sel = $('#levha-malzeme');
  sel.innerHTML = '';
  for (const x of Object.values(plan)) sel.add(new Option(`${MALZEME_ADI[x.malzeme]} (${x.kalinlik} mm)`, x.malzeme));
  sel.value = durum.levhaMalzeme;
}

const dxfSecenek = () => ({ etiket: $('#dxf-etiket').checked, levhaSiniri: $('#dxf-levha').checked });

$('#levha-malzeme').addEventListener('change', (e) => {
  durum.levhaMalzeme = e.target.value;
  durum.levhaNo = 0;
  gorunumCiz();
});
$('#levha-onceki').addEventListener('click', () => { durum.levhaNo = Math.max(0, durum.levhaNo - 1); gorunumCiz(); });
$('#levha-sonraki').addEventListener('click', () => {
  const n = plan[durum.levhaMalzeme]?.levhalar.length || 1;
  durum.levhaNo = Math.min(n - 1, durum.levhaNo + 1);
  gorunumCiz();
});
$('#levha-dxf').addEventListener('click', () => {
  const lv = plan[durum.levhaMalzeme]?.levhalar[durum.levhaNo];
  if (lv) indir(`${dosyaAdi()}_${durum.levhaMalzeme}_levha${durum.levhaNo + 1}.dxf`, levhaDxf(lv, dxfSecenek()), 'application/dxf');
});
$('#view-levha').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const k = levhaKutulari.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  if (!k) return;
  if (k.no === durum.parcaNo) parcaSec(k.no, true);   // ikinci dokunuş: çizimi aç
  else parcaSec(k.no, false);
});

// ------------------------------------------------------------ hırdavat & maliyet

function hirdavatTablosu() {
  const h = hirdavatListesi(cozum, proje);
  $('#hirdavat-tablo').innerHTML = '<thead><tr><th>Hırdavat</th><th>Adet</th></tr></thead><tbody>' +
    h.map((x) => `<tr><td>${kac(x.ad)}</td><td>${x.adet}</td></tr>`).join('') + '</tbody>';
  const m = maliyet(cozum, plan, proje);
  $('#maliyet-tablo').innerHTML = '<thead><tr><th>Malzeme</th><th>Miktar</th><th>Tutar</th></tr></thead><tbody>' +
    m.kalemler.map((k) => `<tr><td>${kac(k.ad)}</td><td>${k.miktar}</td><td>${para(k.tutar)}</td></tr>`).join('') +
    `</tbody><tfoot><tr><td>Toplam</td><td></td><td>${para(m.toplam)}</td></tr></tfoot>`;
}

// ------------------------------------------------------------ görünümler

function gorunumSec(ad) {
  durum.gorunum = ad;
  for (const t of $$('.tab')) {
    const a = t.dataset.view === ad;
    t.classList.toggle('active', a);
    t.setAttribute('aria-selected', String(a));
  }
  $('#view-3d').classList.toggle('active', ad === '3d');
  $('#view-levha').classList.toggle('active', ad === 'levha');
  $('#view-parca').classList.toggle('active', ad === 'parca');
  $('#ctl-3d').hidden = ad !== '3d';
  $('#ctl-levha').hidden = ad !== 'levha';
  $('#ctl-parca').hidden = ad !== 'parca';
  gorunumCiz();
}
for (const t of $$('.tab')) t.addEventListener('click', () => gorunumSec(t.dataset.view));

function gorunumCiz() {
  if (!cozum) return;
  if (durum.gorunum === 'levha') {
    const x = plan[durum.levhaMalzeme];
    const lv = x?.levhalar[durum.levhaNo];
    const n = x?.levhalar.length || 0;
    $('#levha-no').textContent = n ? `${durum.levhaNo + 1} / ${n}` : '—';
    $('#levha-malzeme').value = durum.levhaMalzeme;
    levhaKutulari = levhaCiz($('#view-levha'), lv, {
      seciliNo: durum.parcaNo,
      baslik: lv ? `${x.ad} · ${lv.w}×${lv.h} · %${Math.round(lv.doluluk * 100)} dolu · ${lv.yerlesim.length} parça` : '',
    });
  } else if (durum.gorunum === 'parca') {
    const p = seciliParca() || cozum.parcalar.find((q) => q.modulId === durum.modulId) || cozum.parcalar[0];
    if (p && !durum.parcaNo) durum.parcaNo = p.no;
    parcaCiz($('#view-parca'), p);
    parcaLejant(p);
  }
}

function parcaLejant(p) {
  const kap = $('#ctl-parca');
  if (!p) { kap.innerHTML = ''; return; }
  const turler = [...new Set(p.delikler.map((d) => d.tur))];
  const sayac = (tur) => p.delikler.filter((d) => d.tur === tur).length;
  kap.innerHTML =
    turler.map((t) => `<span><i style="background:${DELIK_RENK[t]}"></i>${DELIK_AD[t]} ${sayac(t)}</span>`).join('') +
    (p.kenarDelik.length ? `<span><i style="background:#34d399;border-radius:1px"></i>Kenar deliği ${p.kenarDelik.length}</span>` : '') +
    (Object.values(p.bant).some(Boolean) ? '<span><i class="bant" style="background:#f43f5e"></i>Bant</span>' : '') +
    `<span>Net ${sayi(p.boy)} × ${sayi(p.en)} · ${MALZEME_ADI[p.malzeme]} ${p.kalinlik} mm</span>`;
}

new ResizeObserver(() => gorunumCiz()).observe($('.stage'));

// ------------------------------------------------------------ 3B kontrolleri

$('#ac').addEventListener('input', (e) => uc?.ac(parseFloat(e.target.value)));
$('#kapak-goster').addEventListener('change', (e) => uc?.ayar({ kapaklar: e.target.checked }));
$('#odakla').addEventListener('click', () => uc?.odakla());

// ------------------------------------------------------------ proje dosyası

$('#kaydet').addEventListener('click', () => {
  indir(`${dosyaAdi()}.dolap.json`, JSON.stringify({ tur: 'dolap-projesi', surum: 1, proje }, null, 2), 'application/json');
});
$('#ac-dosya').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  try {
    const veri = JSON.parse(await f.text());
    projeyiKur(birlestir(veri.proje || veri));
  } catch {
    alert('Bu dosya okunamadı. Dolap programından kaydedilmiş bir .json seçin.');
  }
});
$('#sifirla').addEventListener('click', () => {
  if (confirm('Mevcut proje silinip örnek mutfak yüklenecek. Emin misiniz?')) projeyiKur(varsayilanProje());
});

function projeyiKur(p) {
  proje = p;
  durum.modulId = proje.moduller[0]?.id ?? null;
  durum.parcaNo = null;
  durum.levhaNo = 0;
  ayarlariDoldur();
  formuDoldur();
  hesapla();
}

// ------------------------------------------------------------ yardımcılar

function indir(ad, metin, tur) {
  const blob = new Blob([metin], { type: `${tur};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ad;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function dosyaAdi() {
  return (proje.ad || 'dolap').toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c])
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'dolap';
}

function kac(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ------------------------------------------------------------ başlangıç

ayarlariDoldur();
formuDoldur();
hesapla();
olustur3d($('#view-3d'), { secince: modulSec }).then((x) => {
  uc = x;
  uc.guncelle(cozum, proje, durum.modulId);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('../sw.js', { scope: '../' }).then((r) => r.update()).catch(() => {});
}
