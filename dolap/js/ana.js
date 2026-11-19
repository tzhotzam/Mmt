// Dolap programının arayüzü: proje durumu → hesap → çizim.

import { varsayilanProje, modul, LEVHA_HAZIR, kapakTuru, ALT_TURLERI, BOY_TURLERI, UST_TURLERI, ENGEL_TURLERI, engel, makineMi, bolmeliOlabilir, bolumler } from './model.js';
import { cepheSvg, etiketlerHtml, teklifHtml } from './teknik.js';
import { gruplar as renkGruplari, renkAdi, renkCss, renkBul } from './renkler.js';
import { projeyiCoz } from './govde.js';
import { kesimListesi, kesimCsv, levhaPlani, hirdavatListesi, maliyet, camListesi, teklifHesapla, stokAnahtari, MALZEME_ADI } from './kesim.js';
import { levhaGcode, POSTLAR, CNC_VARSAYILAN, sureYaz } from './gcode.js';
import { KATALOG, katalogOzel, boslukDoldur, STANDART } from './katalog.js';
import { eklenirseTasar, kalanYer, kolonModu } from './mekan.js';
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
  // Mekân bilgisi olmayan eski kayıt: örnek pencere eklenmesin, duvar dolaplara göre.
  if (kayit && !kayit.mekan) {
    const alt = (moduller || []).filter((m) => m && m.tip !== 'ust').reduce((a, m) => a + (m.w || 0), 0);
    p.mekan = { tip: 'duz', duvarA: Math.max(1000, alt), duvarB: 2400, tavan: 2700, engeller: [] };
  }
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
  plan = levhaPlani(cozum.parcalar, proje, artiklar);
  if (!plan[durum.levhaMalzeme]) durum.levhaMalzeme = Object.keys(plan)[0] || 'govde';
  const lv = plan[durum.levhaMalzeme]?.levhalar.length || 0;
  durum.levhaNo = Math.min(durum.levhaNo, Math.max(0, lv - 1));
  if (durum.parcaNo && !cozum.parcalar.some((p) => p.no === durum.parcaNo)) durum.parcaNo = null;

  modulListesi();
  mekanCiz();
  gorunurluk();
  ozet();
  kesimTablosu();
  levhaOzeti();
  hirdavatTablosu();
  kartelaCiz();
  artikCiz();
  katalogCiz();
  gcodeCiz();
  teklifCiz();
  gorunumCiz();
  uc?.guncelle(cozum, proje, durum.modulId);
  sakla();
  gecmiseYaz();
}

// ------------------------------------------------------------ geri al / yinele

let gecmis = [], gecmisNo = -1, gecmisGeri = false;
function gecmiseYaz() {
  if (gecmisGeri) { gecmisGeri = false; return dugmeDurumu(); }
  const j = JSON.stringify(proje);
  if (gecmis[gecmisNo] === j) return dugmeDurumu();
  gecmis = gecmis.slice(0, gecmisNo + 1);
  gecmis.push(j);
  if (gecmis.length > 80) gecmis.shift();
  gecmisNo = gecmis.length - 1;
  dugmeDurumu();
}
function dugmeDurumu() {
  $('#geri-al').disabled = gecmisNo <= 0;
  $('#yinele').disabled = gecmisNo >= gecmis.length - 1;
}
function gecmisGit(yon) {
  const n = gecmisNo + yon;
  if (n < 0 || n >= gecmis.length) return;
  clearTimeout(hesapZaman);
  gecmisNo = n;
  gecmisGeri = true;
  proje = birlestir(JSON.parse(gecmis[n]));
  if (!proje.moduller.some((m) => m.id === durum.modulId)) durum.modulId = proje.moduller[0]?.id ?? null;
  ayarlariDoldur();
  formuDoldur();
  hesapla();
}
$('#geri-al').addEventListener('click', () => gecmisGit(-1));
$('#yinele').addEventListener('click', () => gecmisGit(1));
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.target.matches?.('input[type="text"]')) return;     // yazı alanında tarayıcının kendi geri alması
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); gecmisGit(-1); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); gecmisGit(1); }
});

// ------------------------------------------------------------ modül kütüphanesi

const BENIM = 'dolap-modullerim';
let katalogSekme = 'Alt';
const benimOku = () => { try { return JSON.parse(localStorage.getItem(BENIM) || '[]'); } catch { return []; } };
const benimYaz = (l) => { try { localStorage.setItem(BENIM, JSON.stringify(l)); } catch { /* yer yok */ } };

let hedefDuvar = 'A';
const DUVAR_AD = { A: 'A · arka', B: 'B · sol' };

/** Yeni modül nereye eklenir: seçili modül o duvardaysa onun ardına, değilse o duvarın son modülünün ardına. */
function eklemeYeri(duvar) {
  const L = proje.mekan?.tip === 'L';
  const d = L ? duvar : 'A';
  const sec = proje.moduller.findIndex((x) => x.id === durum.modulId);
  if (sec >= 0 && (!L || (proje.moduller[sec].duvar || 'A') === d)) return sec;
  let son = -1;
  proje.moduller.forEach((m, i) => { if ((m.duvar || 'A') === d) son = i; });
  return son >= 0 ? son : proje.moduller.length - 1;
}

function hedefModul(tip, ozel) {
  const { id: _yok, ...temiz } = ozel;
  const m = modul(tip, temiz);
  if (proje.mekan?.tip === 'L') m.duvar = hedefDuvar;
  return m;
}

function katalogCiz() {
  const kap = $('#katalog-liste');
  kap.innerHTML = '';
  const L = proje.mekan?.tip === 'L';
  if (!L) hedefDuvar = 'A';
  for (const b of $$('[data-hedef-duvar]')) b.classList.toggle('active', b.dataset.hedefDuvar === hedefDuvar);
  if (cozum) {
    const k = cozum.moduller.map((x) => x.konum);
    const a = kalanYer(proje, k, hedefDuvar, 'alt'), u = kalanYer(proje, k, hedefDuvar, 'ust');
    const yaz = (v) => (v >= 0 ? `${v} mm` : `${-v} mm taşıyor`);
    $('#katalog-kalan').textContent = `${L ? DUVAR_AD[hedefDuvar] + ' duvar' : 'Duvar'} sonuna kalan yer — alt sıra: ${yaz(a)} · üst sıra: ${yaz(u)}`;
  }
  const sonra = eklemeYeri(hedefDuvar);
  const sigarMi = (tip, ozel) => !eklenirseTasar(proje, hedefModul(tip, ozel), sonra);
  if (katalogSekme === 'benim') {
    const l = benimOku();
    if (!l.length) {
      kap.innerHTML = '<p class="hint">Henüz kayıtlı modül yok. Bir modülü düzenleyip "Kütüphaneme" düğmesine basın.</p>';
      return;
    }
    l.forEach((k, i) => {
      const d = document.createElement('div');
      d.className = 'katalog-oge';
      d.innerHTML = `<span></span><button type="button">${k.w / 10}</button><button type="button" class="sil" aria-label="Sil">✕</button>`;
      d.querySelector('span').textContent = k.ad;
      if (!sigarMi(k.tip, k)) { d.children[1].disabled = true; d.children[1].title = 'Bu duvara sığmıyor'; }
      d.children[1].addEventListener('click', () => modulEkle(k.tip, { ...k, id: undefined }));
      d.children[2].addEventListener('click', () => { const y = benimOku(); y.splice(i, 1); benimYaz(y); katalogCiz(); });
      kap.appendChild(d);
    });
    return;
  }
  const g = KATALOG.find((x) => x.grup === katalogSekme);
  for (const oge of g.ogeler) {
    const d = document.createElement('div');
    d.className = 'katalog-oge';
    const ad = document.createElement('span');
    ad.textContent = oge.ad;
    d.appendChild(ad);
    for (const w of oge.w) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(w / 10);
      b.title = `${oge.ad} ${w} mm`;
      if (!sigarMi(oge.tip, katalogOzel(oge, w))) { b.disabled = true; b.title = `${w} mm bu duvara sığmıyor`; }
      b.addEventListener('click', () => modulEkle(oge.tip, katalogOzel(oge, w)));
      d.appendChild(b);
    }
    kap.appendChild(d);
  }
}
for (const b of $$('[data-katalog]')) {
  b.addEventListener('click', () => {
    katalogSekme = b.dataset.katalog;
    for (const x of $$('[data-katalog]')) x.classList.toggle('active', x === b);
    katalogCiz();
  });
}

for (const b of $$('[data-hedef-duvar]')) {
  b.addEventListener('click', () => { hedefDuvar = b.dataset.hedefDuvar; katalogCiz(); });
}

/** Kütüphaneden ekle: hedef duvara; duvardan taşacaksa eklemez, söyler. */
function modulEkle(tip, ozel, sonraIndex = null) {
  const m = hedefModul(tip, ozel);
  const i = sonraIndex ?? eklemeYeri(hedefDuvar);
  const mesaj = $('#katalog-mesaj');
  if (sonraIndex === null && eklenirseTasar(proje, m, i)) {
    const k = cozum.moduller.map((x) => x.konum);
    const sira = m.tip === 'ust' ? 'ust' : 'alt';
    mesaj.hidden = false;
    mesaj.textContent = `${m.w} mm sığmıyor: ${DUVAR_AD[m.duvar || 'A']} duvarda ${sira === 'ust' ? 'üst' : 'alt'} sırada ${Math.max(0, kalanYer(proje, k, m.duvar || 'A', sira))} mm yer kaldı.` +
      (proje.mekan?.tip === 'L' && (m.duvar || 'A') === 'A' ? ' Daha dar bir genişlik seçin ya da B · sol duvara ekleyin.' : ' Daha dar bir genişlik seçin.');
    return null;
  }
  mesaj.hidden = true;
  proje.moduller.splice(i >= 0 ? i + 1 : proje.moduller.length, 0, m);
  durum.modulId = m.id;
  formuDoldur();
  hesapla();
  return m;
}

$('#m-kutuphane').addEventListener('click', () => {
  const m = seciliModul();
  if (!m) return;
  const { id, ...kopya } = m;
  const l = benimOku();
  l.push(kopya);
  benimYaz(l);
  katalogSekme = 'benim';
  for (const x of $$('[data-katalog]')) x.classList.toggle('active', x.dataset.katalog === 'benim');
  katalogCiz();
});

/** Boşluğu standart modüllerle doldur: modüller boşluktan önceki modülün ardına eklenir. */
function boslugaDoldur(b) {
  const tip = b.sira === 'ust' ? 'ust' : 'alt';
  const oneri = boslukDoldur(b.L, STANDART[tip]);
  const kapakli = KATALOG.find((g) => g.grup === (tip === 'ust' ? 'Üst' : 'Alt')).ogeler[0];
  let sonra = b.onceki >= 0 ? b.onceki : (() => {
    // Boşluktan önce modül yok: o duvar/sıradaki ilk modülün önüne.
    const ilk = cozum.moduller.filter(({ m, konum }) => konum.duvar === b.duvar && (m.tip === tip || m.tip === 'boy'))
      .sort((x, y) => x.konum.s - y.konum.s)[0];
    return ilk ? proje.moduller.indexOf(ilk.m) - 1 : proje.moduller.length - 1;
  })();
  const yeni = [];
  for (const w of oneri.genislikler) yeni.push(modul(tip, { ...katalogOzel(kapakli, w), duvar: b.duvar }));
  if (oneri.dolgu) yeni.push(modul(tip, { ad: 'Dolgu', w: oneri.dolgu, duvar: b.duvar, [tip === 'ust' ? 'ustTur' : 'altTur']: 'dolgu' }));
  if (!yeni.length) return;
  proje.moduller.splice(sonra + 1, 0, ...yeni);
  durum.modulId = yeni[0].id;
  formuDoldur();
  hesapla();
}

// ------------------------------------------------------------ artık levha stoğu

const ARTIK = 'dolap-artiklar';
let artiklar = (() => { try { return JSON.parse(localStorage.getItem(ARTIK) || '[]'); } catch { return []; } })();
const artikSakla = () => { try { localStorage.setItem(ARTIK, JSON.stringify(artiklar)); } catch { /* yer yok */ } };

/** Mevcut projedeki malzeme grupları (artık eklerken seçilecek). */
function malzemeSecenekleri() {
  const s = [];
  for (const [mz, renk] of [['govde', proje.malzeme.govde.renk], ['arkalik', '']]) {
    s.push({ anahtar: stokAnahtari(mz, renk, proje.malzeme[mz].kalinlik), ad: `${MALZEME_ADI[mz]} · ${proje.malzeme[mz].ad}` });
  }
  const renkler = new Set([proje.malzeme.kapak.renk, ...proje.moduller.map((m) => m.kapakRenk).filter(Boolean)]);
  for (const r of renkler) s.push({ anahtar: stokAnahtari('kapak', r, proje.malzeme.kapak.kalinlik), ad: `Kapak · ${renkAdi(r)}` });
  return s;
}

function artikCiz() {
  const sec = malzemeSecenekleri();
  const ad = (a) => sec.find((x) => x.anahtar === a.anahtar)?.ad || a.ad || a.anahtar;
  const kullanilan = new Set(Object.values(plan).flatMap((x) => x.levhalar.map((l) => l.artik).filter(Boolean)));
  const kap = $('#artik-listesi');
  kap.innerHTML = artiklar.length ? '' : '<p class="hint">Stokta artık yok.</p>';
  for (const a of artiklar) {
    const d = document.createElement('div');
    d.className = 'artik-satir';
    d.innerHTML = `<span><b>${a.w} × ${a.h}</b> · ${kac(ad(a))}${kullanilan.has(a.id) ? ' · <i>bu işte kullanılıyor</i>' : ''}</span><button type="button" class="ghost tehlike">Sil</button>`;
    d.querySelector('button').addEventListener('click', () => { artiklar = artiklar.filter((x) => x.id !== a.id); artikSakla(); hesapla(); });
    kap.appendChild(d);
  }
  const s = $('#artik-malz');
  const onceki = s.value;
  s.innerHTML = '';
  for (const x of sec) s.add(new Option(x.ad, x.anahtar));
  if (sec.some((x) => x.anahtar === onceki)) s.value = onceki;
  for (const el of $$('[data-ebatlama]')) el.hidden = proje.levha.yontem !== 'ebatlama';
}

$('#artik-ekle').addEventListener('click', () => {
  const w = parseFloat($('#artik-w').value), h = parseFloat($('#artik-h').value);
  if (!(w >= 100 && h >= 100)) { $('#artik-w').focus(); return; }
  const anahtar = $('#artik-malz').value;
  artiklar.push({ id: `a${Date.now().toString(36)}`, anahtar, ad: $('#artik-malz').selectedOptions[0]?.textContent, w, h });
  artikSakla();
  $('#artik-w').value = $('#artik-h').value = '';
  hesapla();
});
$('#artik-oner').addEventListener('click', () => {
  // Tam levhalarda kalan en büyük dikdörtgen, 300 × 300'den büyükse stoğa.
  let n = 0;
  for (const x of Object.values(plan)) {
    for (const lv of x.levhalar) {
      const k = lv.kalan;
      if (lv.artik || !k || Math.min(k.w, k.h) < 300) continue;
      artiklar.push({ id: `a${Date.now().toString(36)}${n}`, anahtar: x.stokAnahtar, ad: x.ad, w: Math.floor(k.w), h: Math.floor(k.h) });
      n++;
    }
  }
  artikSakla();
  hesapla();
  if (!n) $('#artik-oner').textContent = '300 × 300 üstü artık kalmadı';
});
$('#artik-dus').addEventListener('click', () => {
  const kullanilan = new Set(Object.values(plan).flatMap((x) => x.levhalar.map((l) => l.artik).filter(Boolean)));
  artiklar = artiklar.filter((a) => !kullanilan.has(a.id));
  artikSakla();
  hesapla();
});

// ------------------------------------------------------------ G-code

function cncAyar() {
  if (!proje.cnc) proje.cnc = JSON.parse(JSON.stringify(CNC_VARSAYILAN));
  return proje.cnc;
}

function takimCiz() {
  const c = cncAyar();
  const kap = $('#takim-listesi');
  const imza = JSON.stringify(c.takimlar.map((t) => [t.no, t.tur]));
  if (kap.dataset.imza === imza) return;
  kap.dataset.imza = imza;
  kap.innerHTML = '';
  c.takimlar.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'takim-satir';
    d.innerHTML = `<span>T${t.no}</span>
      <select aria-label="Tür"><option value="freze">Freze</option><option value="matkap">Matkap</option></select>
      <input type="number" min="1" max="40" step="0.5" aria-label="Çap (mm)">
      <button type="button" class="ghost tehlike">Sil</button>`;
    const [sel, inp, sil] = [d.querySelector('select'), d.querySelector('input'), d.querySelector('button')];
    sel.value = t.tur;
    inp.value = t.cap;
    sel.addEventListener('change', () => { t.tur = sel.value; sonra(); });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (v > 0) { t.cap = v; sonra(); } });
    sil.addEventListener('click', () => { c.takimlar.splice(i, 1); hesapla(); });
    kap.appendChild(d);
  });
}
$('#takim-ekle').addEventListener('click', () => {
  const c = cncAyar();
  const no = Math.max(0, ...c.takimlar.map((t) => t.no)) + 1;
  c.takimlar.push({ no, tur: 'matkap', cap: 35 });
  hesapla();
});

function levhaGcodeUret(anahtar, i) {
  const x = plan[anahtar];
  return levhaGcode(x.levhalar[i], x.kalinlik, cncAyar(), { baslik: `${proje.ad} ${x.ad}`, levhaNo: i + 1 });
}

function gcodeCiz() {
  takimCiz();
  const kap = $('#gcode-dugmeler');
  kap.innerHTML = '';
  const uyari = new Set();
  if (proje.levha.yontem === 'ebatlama') {
    kap.innerHTML = '<p class="hint">Ebatlama seçili: parçalar testereyle kesilir. G-code için kesim yöntemini CNC nesting yapın.</p>';
    $('#gcode-uyari').hidden = true;
    return;
  }
  const post = POSTLAR[cncAyar().post] || POSTLAR.ncstudio;
  for (const [anahtar, x] of Object.entries(plan)) {
    const d = document.createElement('div');
    d.className = 'gcode-satir';
    const ad = x.anahtar !== x.malzeme ? renkAdi(x.renk) : MALZEME_ADI[x.malzeme];
    d.innerHTML = `<b>${kac(ad)}</b>`;
    x.levhalar.forEach((lv, i) => {
      const r = levhaGcodeUret(anahtar, i);
      r.uyarilar.forEach((u) => uyari.add(u));
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `Levha ${i + 1} · ${sureYaz(r.sure)}`;
      b.title = `Takımlar: ${r.takimlar.map((t) => 'T' + t).join(', ')}`;
      b.addEventListener('click', () => indir(`${dosyaAdi()}_${dosyaParcasi(x)}_levha${i + 1}.${post.uzanti}`, levhaGcodeUret(anahtar, i).metin, 'text/plain'));
      d.appendChild(b);
    });
    kap.appendChild(d);
  }
  const u = $('#gcode-uyari');
  u.hidden = !uyari.size;
  u.innerHTML = uyari.size ? `<ul>${[...uyari].map((x) => `<li>${kac(x)}</li>`).join('')}</ul>` : '';
}

// ------------------------------------------------------------ teklif

function teklifCiz() {
  const h = teklifHesapla(cozum, plan, proje);
  const satir = (a, b, kalin) => `<tr${kalin ? ' class="kalin"' : ''}><td>${a}</td><td>${para(b)}</td></tr>`;
  $('#teklif-tablo').innerHTML = '<tbody>' +
    satir('Malzeme (levha, bant, cam)', h.malz) +
    satir('Hırdavat', h.hird) +
    satir(`İşçilik (${h.modulSay} modül) + montaj`, h.iscilik) +
    satir('Maliyet', h.maliyetToplam) +
    satir(`Kâr %${proje.teklif?.karOrani ?? 0}`, h.kar) +
    satir(`KDV %${proje.teklif?.kdv ?? 0}`, h.kdv) +
    `</tbody><tfoot><tr><td>Müşteriye fiyat (KDV dahil)</td><td>${para(h.toplam)}</td></tr></tfoot>`;
}
$('#teklif-yazdir').addEventListener('click', () => {
  yazdir(teklifHtml(cozum, proje, teklifHesapla(cozum, plan, proje)), 'portrait');
});

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
    if (makineMi(m)) {
      b.innerHTML = `<span class="rozet">M${i + 1} · Makine${proje.mekan?.tip === 'L' ? ` · ${m.duvar === 'B' ? 'B' : 'A'}` : ''}</span><b></b><span>${m.w} × ${m.h + proje.ayakYukseklik} yer</span>` +
        `<span>${m.altTur === 'bulasik' ? 'ankastre panel' : 'boşluk'}</span>`;
      b.querySelector('b').textContent = m.ad;
      b.addEventListener('click', () => modulSec(m.id));
      kap.appendChild(b);
      return;
    }
    const duvarHarf = proje.mekan?.tip === 'L' ? ` · ${m.duvar === 'B' ? 'B' : 'A'}` : '';
    const ek = m.kose ? ' · köşe' : m.tip === 'alt' && m.altTur !== 'normal' ? ` · ${{ evye: 'evye', firin: 'fırın' }[m.altTur] || ''}`
      : m.tip === 'boy' && m.boyTur !== 'normal' ? ` · ${{ firin: 'fırın', buzdolabi: 'buzdolabı' }[m.boyTur] || ''}`
      : m.tip === 'ust' && m.ustTur === 'davlumbaz' ? ' · davlumbaz' : m.bolme > 0 ? ` · ${m.bolme} bölme` : '';
    b.innerHTML = `<span class="rozet">M${i + 1} · ${TIP_AD[m.tip]}${duvarHarf}${ek}</span><b></b>` +
      `<span>${m.w} × ${m.h} × ${m.d}</span><span>${KAPAK_AD[kt]}${kt === 'cekmece' ? ` (${m.cekmeceSayisi})` : ''}` +
      `${m.cam && m.cam !== 'yok' && (kt === 'tek' || kt === 'cift') ? ` · camlı${m.cam === 'aluminyum' ? ' (alü.)' : ''}` : ''}</span>`;
    b.querySelector('b').textContent = m.ad;
    const rk = document.createElement('i');
    rk.className = 'kart-renk';
    rk.style.background = renkCss(m.kapakRenk || proje.malzeme.kapak.renk);
    rk.title = renkAdi(m.kapakRenk || proje.malzeme.kapak.renk);
    b.appendChild(rk);
    b.addEventListener('click', () => modulSec(m.id));
    kap.appendChild(b);
  });
  if (!proje.moduller.length) kap.innerHTML = '<p class="hint">Henüz modül yok. Aşağıdan ekleyin.</p>';
}

function modulSec(id) {
  durum.modulId = id;
  const sm = proje.moduller.find((m) => m.id === id);
  if (sm && proje.mekan?.tip === 'L') { hedefDuvar = sm.duvar || 'A'; katalogCiz(); }
  formuDoldur();
  modulListesi();
  kartelaCiz();
  uc?.guncelle(cozum, proje, durum.modulId);
}

function formuDoldur() {
  const m = seciliModul();
  $('#modul-duzen').hidden = !m;
  if (!m) return;
  for (const el of $$('[data-m]')) {
    if (el.type === 'checkbox') el.checked = !!m[el.dataset.m];
    else el.value = m[el.dataset.m] ?? '';
  }
  bolumIcerikCiz();
  gorunurluk();
}

/** Bölmeli dolapta her bölüm için raf / çekmece seçimi. */
function bolumIcerikCiz() {
  const m = seciliModul();
  const kap = $('#bolum-icerik');
  kap.innerHTML = '';
  if (!m) return;
  const b = bolumler(m);
  if (b.length < 2) return;
  b.forEach((ic, i) => {
    const l = document.createElement('label');
    l.textContent = `${i + 1}. bölüm`;
    const s = document.createElement('select');
    s.add(new Option('Raf + kapak', 'raf'));
    if (m.tip === 'alt') s.add(new Option('Çekmeceler', 'cekmece'));
    s.value = ic;
    s.addEventListener('change', () => {
      m.bolumler = bolumler(m);
      m.bolumler[i] = s.value;
      gorunurluk();
      sonra();
    });
    l.appendChild(s);
    kap.appendChild(l);
  });
}

function gorunurluk() {
  const m = seciliModul();
  if (!m) return;
  const kt = kapakTuru(m);
  const govdeli = !makineMi(m);
  const L = proje.mekan?.tip === 'L';
  const bt = m.tip === 'boy' ? m.boyTur || 'normal' : null;
  const bol = bolumler(m);
  const davlumbaz = m.tip === 'ust' && m.ustTur === 'davlumbaz';
  const goster = {
    L,
    koseOlabilir: L && (m.tip === 'alt' || m.tip === 'ust') && govdeli,
    ust: m.tip === 'ust',
    davlumbaz,
    boyNormal: bt === 'normal',
    boyFirin: bt === 'firin',
    boyBuz: bt === 'buzdolabi',
    boyUstRaf: bt === 'normal' || bt === 'firin',
    bolmeli: bolmeliOlabilir(m) && !m.kose,
    bolmeVar: bol.length > 1,
    alt: m.tip === 'alt',
    govdeli,
    renkli: govdeli || m.altTur === 'bulasik',
    tek: govdeli && kt === 'tek',
    cekmece: govdeli && (kt === 'cekmece' || bol.includes('cekmece')) && m.altTur !== 'firin',
    raf: govdeli && kt !== 'cekmece' && !['evye', 'firin'].includes(m.altTur) && bt !== 'buzdolabi' && !davlumbaz,
    kapakli: govdeli && (kt === 'tek' || kt === 'cift') && m.altTur !== 'firin',
    boy: m.tip === 'boy',
  };
  if (m.tip === 'alt' && m.altTur === 'firin') goster.govdeli = false;
  for (const el of $$('#modul-duzen [data-goster]')) el.hidden = !goster[el.dataset.goster];
  for (const o of $$('#modul-duzen option[data-sadece]')) o.disabled = o.dataset.sadece !== m.tip;
}

for (const el of $$('[data-m]')) {
  const olay = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(el.type === 'checkbox' ? 'change' : olay, () => {
    const m = seciliModul();
    if (!m) return;
    const k = el.dataset.m;
    if (el.type === 'checkbox') {
      m[k] = el.checked;
    } else if (el.type === 'number') {
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
    if (k === 'bolme' || k === 'kose' || k === 'kapak') bolumIcerikCiz();
    gorunurluk();
    sonra();
  });
}

for (const b of $$('[data-ekle]')) {
  b.addEventListener('click', () => {
    const [tip, tur] = b.dataset.ekle.split(':');
    const turler = { alt: ALT_TURLERI, ust: UST_TURLERI, boy: BOY_TURLERI }[tip];
    const m = modul(tip, tur ? turler[tur].ozel : {});
    // L mutfakta yeni modül seçili modülün duvarına eklenir.
    const sec = seciliModul();
    if (sec && proje.mekan?.tip === 'L') m.duvar = sec.duvar || 'A';
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
  if (sel.dataset.bos) sel.add(new Option(sel.dataset.bos, ''));
  for (const { grup, renkler } of renkGruplari()) {
    const og = document.createElement('optgroup');
    og.label = grup;
    for (const r of renkler) og.appendChild(new Option(renkAdi(r.id), r.id));
    sel.appendChild(og);
  }
}

// ------------------------------------------------------------ renk kartelası

let kartelaHedef = 'hepsi';
function kartelaCiz() {
  const kap = $('#kartela');
  kap.innerHTML = '';
  const m = seciliModul();
  const secili = kartelaHedef === 'govde' ? proje.malzeme.govde.renk
    : kartelaHedef === 'modul' && m ? (m.kapakRenk || proje.malzeme.kapak.renk)
    : proje.malzeme.kapak.renk;
  const kullanilan = new Set(proje.moduller.map((x) => x.kapakRenk || proje.malzeme.kapak.renk));
  for (const { grup, renkler } of renkGruplari()) {
    const bolum = document.createElement('div');
    bolum.innerHTML = `<h3>${kac(grup)}</h3><div class="satir"></div>`;
    const satir = bolum.querySelector('.satir');
    for (const r of renkler) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'renk-kart' + (r.id === secili ? ' secili' : '') + (kullanilan.has(r.id) ? ' kullanimda' : '');
      b.title = renkAdi(r.id);
      b.innerHTML = `<span class="ornek" style="background:${renkCss(r.id)}"></span>` +
        `<span class="ad">${kac(r.ad)}</span><span class="kod">${kac(r.kod || (r.yuzey === 'parlak' ? 'parlak' : 'mat'))}</span>`;
      b.addEventListener('click', () => renkUygula(r.id));
      satir.appendChild(b);
    }
    kap.appendChild(bolum);
  }
}

function renkUygula(id) {
  if (kartelaHedef === 'govde') proje.malzeme.govde.renk = id;
  else if (kartelaHedef === 'modul') {
    const m = seciliModul();
    if (!m) return;
    m.kapakRenk = id === proje.malzeme.kapak.renk ? '' : id;
  } else {
    // Tüm kapaklar: projenin rengi olur, modüllere özel renkler silinir.
    proje.malzeme.kapak.renk = id;
    for (const m of proje.moduller) m.kapakRenk = '';
  }
  ayarlariDoldur();
  formuDoldur();
  hesapla();
}

for (const b of $$('[data-hedef]')) {
  b.addEventListener('click', () => {
    kartelaHedef = b.dataset.hedef;
    for (const x of $$('[data-hedef]')) x.classList.toggle('active', x === b);
    kartelaCiz();
  });
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
  const levhalar = Object.values(plan).map((x) => {
    const ad = x.anahtar !== x.malzeme ? `kapak (${renkBul(x.renk).ad})` : MALZEME_ADI[x.malzeme].toLowerCase();
    const a = x.levhalar.filter((l) => l.artik).length;
    return `${ad} ${x.levhalar.length - a}${a ? ` + ${a} artık` : ''}`;
  }).join(' · ');
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
  kutu.innerHTML = '';
  if (u.length) {
    const ul = document.createElement('ul');
    for (const x of u) {
      const li = document.createElement('li');
      li.textContent = x;
      const t = (cozum.tasmalar || []).find((q) => q.metin === x);
      if (t) {
        const m = proje.moduller.find((q) => q.id === t.id);
        const dugme = (yazi, is) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'duzelt';
          b.textContent = yazi;
          b.addEventListener('click', is);
          li.appendChild(b);
        };
        // Sığacak en büyük standart ölçü; yoksa kalan yerin kendisi.
        if (t.koseGenislik) {
          dugme(`Genişliği ${t.koseGenislik} mm yap`, () => { m.w = t.koseGenislik; formuDoldur(); hesapla(); });
        } else {
          const std = [1200, 1000, 900, 800, 600, 500, 450, 400, 300].find((w) => w <= t.yer);
          const yeni = std ?? (t.yer >= 150 ? Math.floor(t.yer / 10) * 10 : 0);
          if (yeni) dugme(`Sığdır: ${yeni} mm'ye daralt`, () => { m.w = yeni; formuDoldur(); hesapla(); });
          if (proje.mekan?.tip === 'L' && (m.duvar || 'A') === 'A') dugme('B · sol duvara taşı', () => { m.duvar = 'B'; formuDoldur(); hesapla(); });
        }
        dugme('Kaldır', () => {
          proje.moduller = proje.moduller.filter((q) => q.id !== m.id);
          if (durum.modulId === m.id) durum.modulId = proje.moduller[0]?.id ?? null;
          formuDoldur();
          hesapla();
        });
      }
      ul.appendChild(li);
    }
    kutu.appendChild(ul);
  }

  const n = cozum.notlar || [];
  const nk = $('#notlar');
  nk.hidden = !n.length;
  nk.querySelector('summary').textContent = `Mekân notları (${n.length})`;
  const ul = nk.querySelector('ul');
  ul.innerHTML = '';
  const bos = cozum.bosluklar || [];
  for (const x of n) {
    const li = document.createElement('li');
    li.textContent = x;
    const b = bos.find((q) => x.startsWith(`${q.duvar} duvarı`) && x.includes(`${q.a}–${q.b}`));
    if (b && b.L >= 20) {
      const o = boslukDoldur(b.L, STANDART[b.sira === 'ust' ? 'ust' : 'alt']);
      const ne = [...o.genislikler.map((w) => w / 10), ...(o.dolgu ? [`dolgu ${o.dolgu} mm`] : [])].join(' + ');
      if (ne) {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'doldur';
        d.textContent = `Doldur: ${ne}`;
        d.addEventListener('click', () => boslugaDoldur(b));
        li.appendChild(d);
      }
    }
    ul.appendChild(li);
  }
}

// ------------------------------------------------------------ mekân ve engeller

const ENGEL_ALAN = {
  kolon: [['x', 'Konum'], ['w', 'Genişlik'], ['d', 'Derinlik']],
  pencere: [['x', 'Konum'], ['w', 'Genişlik'], ['y', 'Denizlik'], ['h', 'Yükseklik']],
  kapi: [['x', 'Konum'], ['w', 'Genişlik'], ['h', 'Yükseklik']],
  tesisat: [['x', 'Konum'], ['y', 'Yerden'], ['w', 'Genişlik'], ['h', 'Yükseklik']],
};

function mekanCiz() {
  const L = proje.mekan.tip === 'L';
  for (const el of $$('[data-mekan="L"]')) el.hidden = !L;
  const kap = $('#engel-listesi');
  // Yazılan alan odağını kaybetmesin: yalnız liste değiştiyse yeniden kur.
  const imza = proje.mekan.engeller.map((e) => `${e.id}|${e.tip}`).join(',') + `|${L}`;
  if (kap.dataset.imza === imza) return;
  kap.dataset.imza = imza;
  kap.innerHTML = '';
  if (!proje.mekan.engeller.length) {
    kap.innerHTML = '<p class="hint">Engel yok. Kolon, pencere ya da kapı varsa ekleyin.</p>';
    return;
  }
  proje.mekan.engeller.forEach((e, i) => {
    const d = document.createElement('div');
    d.className = 'engel';
    d.dataset.id = e.id;
    let html = `<div class="engel-bas"><span>${i + 1}. ${ENGEL_TURLERI[e.tip].ad}</span><button type="button" class="ghost tehlike" data-sil>Sil</button></div>`;
    if (L) html += `<label>Duvar<select data-e="duvar"><option value="A">A · arka</option><option value="B">B · sol</option></select></label>`;
    for (const [k, ad] of ENGEL_ALAN[e.tip]) html += `<label>${ad} <input type="number" data-e="${k}" min="0" step="1"></label>`;
    if (e.tip === 'kolon') {
      html += `<label class="kolon-mod">Önüne gelen dolap<select data-e="yerlesim">
        <option value="atla">Atlasın (kolonun yanından devam)</option>
        <option value="kert">Kertilsin (kolonun etrafından oyulur)</option>
        <option value="onune">Önüne geçsin (derinlik kısalır)</option></select></label>`;
    }
    d.innerHTML = html;
    for (const el of d.querySelectorAll('[data-e]')) {
      const k = el.dataset.e;
      if (el.type === 'checkbox') el.checked = !!e[k];
      else if (k === 'yerlesim') el.value = kolonModu(e);
      else el.value = k === 'h' && e[k] > 5000 ? '' : e[k];
      if (k === 'h' && e.tip === 'kolon') el.placeholder = 'tavana kadar';
    }
    kap.appendChild(d);
  });
}

$('#engel-listesi').addEventListener('input', engelDegisti);
$('#engel-listesi').addEventListener('change', engelDegisti);
function engelDegisti(ev) {
  const el = ev.target.closest('[data-e]');
  if (!el) return;
  const e = proje.mekan.engeller.find((x) => x.id === el.closest('.engel').dataset.id);
  if (!e) return;
  const k = el.dataset.e;
  if (el.type === 'checkbox') e[k] = el.checked;
  else if (el.type === 'number') {
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) return;
    e[k] = v;
  } else e[k] = el.value;
  sonra();
}
$('#engel-listesi').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sil]');
  if (!b) return;
  const id = b.closest('.engel').dataset.id;
  proje.mekan.engeller = proje.mekan.engeller.filter((x) => x.id !== id);
  hesapla();
});
for (const b of $$('[data-engel]')) {
  b.addEventListener('click', () => {
    // Yeni engel duvarın sonuna konur: mevcut dizilimi bozmasın, kullanıcı konumu yazar.
    const e = engel(b.dataset.engel);
    e.x = Math.max(0, proje.mekan.duvarA - e.w);
    proje.mekan.engeller.push(e);
    hesapla();
  });
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
      (s.camli ? '<span class="cam-etiket">camlı</span>' : '') +
      (s.malzeme === 'kapak' && s.renk ? `<br><span class="malz"><i class="renk-nokta" style="background:${renkBul(s.renk).hex}"></i>${kac(renkAdi(s.renk))}</span>` : '') +
      `</td><td>${s.adet}</td><td>${sayi(s.boy)}</td><td>${sayi(s.en)}</td><td>${s.kalinlik}</td>` +
      `<td>${s.boyBant}/${s.enBant}</td></tr>`;
  }
  t.innerHTML = html + '</tbody>';

  const cam = camListesi(cozum.parcalar, proje);
  $('#cam-kutu').hidden = !cam.length;
  $('#cam-tablo').innerHTML = '<thead><tr><th>Ne</th><th>Adet</th><th>Boy</th><th>En</th><th>m²</th></tr></thead><tbody>' +
    cam.map((s) => `<tr><td class="ad">${kac(s.tur)}<br><span class="malz">${s.nolar.join(' ')}</span></td><td>${s.adet}</td>` +
      `<td>${sayi(s.boy)}</td><td>${sayi(s.en)}</td><td>${sayi(s.m2)}</td></tr>`).join('') + '</tbody>';
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
    b.textContent = `${x.anahtar !== x.malzeme ? renkAdi(x.renk) : MALZEME_ADI[x.malzeme]} · ${x.levhalar.length} levha DXF`;
    b.addEventListener('click', () => {
      indir(`${dosyaAdi()}_${dosyaParcasi(x)}_tum_levhalar.dxf`, levhalarDxf(x.levhalar, dxfSecenek()), 'application/dxf');
    });
    dug.appendChild(b);
  }
  const sel = $('#levha-malzeme');
  sel.innerHTML = '';
  for (const x of Object.values(plan)) {
    const ad = x.malzeme === 'kapak' && x.renk ? `Kapak · ${renkAdi(x.renk)}` : MALZEME_ADI[x.malzeme];
    sel.add(new Option(`${ad} (${x.kalinlik} mm)`, x.anahtar));
  }
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
  if (lv) indir(`${dosyaAdi()}_${dosyaParcasi(plan[durum.levhaMalzeme])}_levha${durum.levhaNo + 1}.dxf`, levhaDxf(lv, dxfSecenek()), 'application/dxf');
});
$('#levha-gcode').addEventListener('click', () => {
  const x = plan[durum.levhaMalzeme];
  if (!x) return;
  const post = POSTLAR[cncAyar().post] || POSTLAR.ncstudio;
  indir(`${dosyaAdi()}_${dosyaParcasi(x)}_levha${durum.levhaNo + 1}.${post.uzanti}`, levhaGcodeUret(durum.levhaMalzeme, durum.levhaNo).metin, 'text/plain');
});
$('#levha-yazdir').addEventListener('click', () => {
  // Bütün levhalar: çizim + (ebatlamada) kesim sırası, her levha ayrı sayfa.
  const tuval = document.createElement('canvas');
  tuval.style.width = '1600px';
  tuval.style.height = '1100px';
  document.body.appendChild(tuval);
  let html = '';
  for (const x of Object.values(plan)) {
    x.levhalar.forEach((lv, i) => {
      levhaCiz(tuval, lv, { baslik: `${proje.ad} · ${x.ad} · levha ${i + 1}/${x.levhalar.length} · ${lv.w}×${lv.h}${lv.artik ? ' (artık)' : ''}` });
      html += `<div style="break-after: page"><img src="${tuval.toDataURL('image/png')}" style="width:100%">` +
        (lv.kesimler ? `<ol style="columns:2;font:9pt Helvetica,Arial">${lv.kesimler.map((k) => `<li>${kac(k.metin)}</li>`).join('')}</ol>` : '') + '</div>';
    });
  }
  tuval.remove();
  yazdir(html);
});
$('#view-levha').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const k = levhaKutulari.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  if (!k) return;
  if (k.no === durum.parcaNo) parcaSec(k.no, true);   // ikinci dokunuş: çizimi aç
  else parcaSec(k.no, false);
});

// ------------------------------------------------------------ teknik çizim ve etiket

$('#cizim-duvar').addEventListener('change', gorunumCiz);
$('#cizim-svg').addEventListener('click', () => {
  const d = $('#cizim-duvar').value;
  indir(`${dosyaAdi()}_${d}_duvari.svg`, cepheSvg(cozum, proje, d), 'image/svg+xml');
});
$('#cizim-yazdir').addEventListener('click', () => {
  const duvarlar = proje.mekan.tip === 'L' ? ['A', 'B'] : ['A'];
  yazdir(duvarlar.map((d) => `<div style="break-after: page">${cepheSvg(cozum, proje, d)}</div>`).join(''));
});
$('#etiket-yazdir').addEventListener('click', () => yazdir(etiketlerHtml(cozum, proje), 'portrait'));

/** Yalnız verilen içeriği yazdırır (sayfanın geri kalanı gizlenir). */
function yazdir(html, yon = 'landscape') {
  const b = $('#baski');
  b.innerHTML = `<style>@page { size: A4 ${yon}; margin: 10mm; }</style>` + html;
  document.body.classList.add('baski-acik');
  const bitir = () => { document.body.classList.remove('baski-acik'); b.innerHTML = ''; };
  window.addEventListener('afterprint', bitir, { once: true });
  try { window.print(); } catch { bitir(); }
  setTimeout(() => { if (!matchMedia('print').matches) bitir(); }, 1500);
}

// ------------------------------------------------------------ hırdavat & maliyet

function hirdavatTablosu() {
  const h = hirdavatListesi(cozum, proje);
  $('#hirdavat-tablo').innerHTML = '<thead><tr><th>Hırdavat</th><th>Adet</th><th>Tutar</th></tr></thead><tbody>' +
    h.map((x) => `<tr><td>${kac(x.ad)}</td><td>${x.adet}</td><td>${para(x.tutar)}</td></tr>`).join('') +
    `</tbody><tfoot><tr><td>Toplam</td><td></td><td>${para(h.reduce((a, x) => a + x.tutar, 0))}</td></tr></tfoot>`;
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
  $('#view-cizim').classList.toggle('active', ad === 'cizim');
  $('#ctl-3d').hidden = ad !== '3d';
  $('#ctl-levha').hidden = ad !== 'levha';
  $('#ctl-parca').hidden = ad !== 'parca';
  $('#ctl-cizim').hidden = ad !== 'cizim';
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
      baslik: lv ? `${x.ad} · ${lv.w}×${lv.h}${lv.artik ? ' (artık)' : ''} · %${Math.round(lv.doluluk * 100)} dolu · ${lv.yerlesim.length} parça` : '',
    });
    const ks = $('#kesim-sirasi');
    ks.hidden = !lv?.kesimler;
    ks.innerHTML = lv?.kesimler ? lv.kesimler.map((k) => `<li class="a${k.asama}">${kac(k.metin)}</li>`).join('') : '';
    $('#levha-gcode').hidden = proje.levha.yontem === 'ebatlama';
  } else if (durum.gorunum === 'cizim') {
    const sel = $('#cizim-duvar');
    const L = proje.mekan.tip === 'L';
    sel.hidden = !L;
    if (!L) sel.value = 'A';
    $('#view-cizim').innerHTML = cepheSvg(cozum, proje, sel.value);
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

/** Levha grubu için dosya adı parçası: govde, arkalik, kapak, kapak_antrasit … */
function dosyaParcasi(x) {
  if (x.anahtar === x.malzeme) return x.malzeme;
  return 'kapak_' + sade(renkBul(x.renk).ad);
}

function sade(s) {
  return String(s).toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c])
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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

cncAyar();
ayarlariDoldur();
formuDoldur();
katalogCiz();
hesapla();
olustur3d($('#view-3d'), { secince: modulSec }).then((x) => {
  uc = x;
  uc.guncelle(cozum, proje, durum.modulId);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('../sw.js', { scope: '../' }).then((r) => r.update()).catch(() => {});
}
