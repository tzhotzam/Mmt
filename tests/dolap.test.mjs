// Dolap programının üretim zinciri:  node tests/dolap.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { varsayilanProje, modul, engel, HIRDAVAT, kapakTuru, ALT_TURLERI, BOY_TURLERI, UST_TURLERI, makineMi } from '../dolap/js/model.js';
import { cepheSvg, etiketlerHtml, barkodSvg, teklifHtml } from '../dolap/js/teknik.js';
import { levhaGcode, pasolar, CNC_VARSAYILAN } from '../dolap/js/gcode.js';
import { KATALOG as MODUL_KATALOG, katalogOzel, boslukDoldur } from '../dolap/js/katalog.js';
import { projeyiCoz, yerlestir, menteseSayisi, baglantiNoktalari, bantUzunlugu } from '../dolap/js/govde.js';
import { yerlestirLevha, levhaNoktasi } from '../dolap/js/yerlesim.js';
import { kesimListesi, kesimCsv, levhaPlani, hirdavatListesi, maliyet, camListesi, teklifHesapla, stokAnahtari } from '../dolap/js/kesim.js';
import { levhaDxf, levhalarDxf, delikKatmani } from '../dolap/js/dxf.js';
import { KATALOG, renkBul, renkAdi, renkCss } from '../dolap/js/renkler.js';

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

const KOK = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oku = (f) => fs.readFileSync(path.join(KOK, f), 'utf8');

/** Tek modüllü proje. */
function tekModul(tip, ozel = {}, projeOzel = {}) {
  const p = varsayilanProje();
  p.moduller = [modul(tip, ozel)];
  Object.assign(p, projeOzel);
  return p;
}
const bul = (parcalar, ad) => parcalar.find((p) => p.ad === ad);

console.log('gövde');

test('örnek mutfak uyarısız çözülüyor, her parçanın numarası tekil', () => {
  const c = projeyiCoz(varsayilanProje());
  assert.deepEqual(c.uyarilar, []);
  assert.ok(c.parcalar.length > 50);
  assert.equal(new Set(c.parcalar.map((p) => p.no)).size, c.parcalar.length);
});

test('alt dolap ölçüleri: yan, tabla, kuşak, arkalık', () => {
  const c = projeyiCoz(tekModul('alt', { w: 600, h: 720, d: 560 }));
  const P = c.parcalar;
  const t = 18, Dg = 560 - 8;
  assert.deepEqual([bul(P, 'Sol yan').boy, bul(P, 'Sol yan').en], [720, Dg]);
  assert.deepEqual([bul(P, 'Alt tabla').boy, bul(P, 'Alt tabla').en], [600 - 2 * t, Dg]);
  assert.deepEqual([bul(P, 'Ön kuşak').boy, bul(P, 'Ön kuşak').en], [600 - 2 * t, 100]);
  assert.deepEqual([bul(P, 'Arkalık').boy, bul(P, 'Arkalık').en], [600, 720]);
  assert.equal(bul(P, 'Arkalık').kalinlik, 8);
});

test('3B kutular gövdenin içinde ve birbirine girmiyor (kapak hariç)', () => {
  const c = projeyiCoz(tekModul('boy'));
  const m = c.moduller[0].m;
  const govde = c.parcalar.filter((p) => !['kapak', 'baza'].includes(p.grup));
  for (const p of govde) {
    const k = p.kutu;
    assert.ok(k.x >= 0 && k.x + k.sx <= m.w + 1e-6, `${p.ad} x taşıyor`);
    assert.ok(k.y >= 0 && k.y + k.sy <= m.h + 1e-6, `${p.ad} y taşıyor`);
    assert.ok(k.z >= 0 && k.z + k.sz <= m.d + 1e-6, `${p.ad} z taşıyor`);
  }
  for (let i = 0; i < govde.length; i++) {
    for (let j = i + 1; j < govde.length; j++) {
      const a = govde[i].kutu, b = govde[j].kutu;
      const ic = a.x < b.x + b.sx - 1e-6 && b.x < a.x + a.sx - 1e-6 &&
        a.y < b.y + b.sy - 1e-6 && b.y < a.y + a.sy - 1e-6 &&
        a.z < b.z + b.sz - 1e-6 && b.z < a.z + a.sz - 1e-6;
      assert.ok(!ic, `${govde[i].ad} ile ${govde[j].ad} çakışıyor`);
    }
  }
});

test('her delik parçanın içinde, kenara en az yarıçap kadar uzak', () => {
  for (const tip of ['alt', 'ust', 'boy']) {
    const c = projeyiCoz(tekModul(tip));
    for (const p of c.parcalar) {
      for (const d of p.delikler) {
        const r = d.cap / 2;
        assert.ok(d.x - r >= -1e-6 && d.x + r <= p.boy + 1e-6 && d.y - r >= -1e-6 && d.y + r <= p.en + 1e-6,
          `${tip} ${p.ad}: Ø${d.cap} (${d.x}, ${d.y}) parçadan taşıyor`);
      }
    }
  }
});

test('minifix: her yan cıvatasına bir kam, cıvata yatay parçanın ortasında', () => {
  const c = projeyiCoz(tekModul('alt'));
  const mf = HIRDAVAT.minifix;
  const civata = c.parcalar.flatMap((p) => p.delikler).filter((d) => d.tur === 'minifix' && d.cap === mf.civataCap);
  const kam = c.parcalar.flatMap((p) => p.delikler).filter((d) => d.tur === 'minifix' && d.cap === mf.kamCap);
  assert.equal(civata.length, kam.length);
  // Alt tabla y = 0..18 → cıvata yan parçada 9 mm yükseklikte (çizim x).
  const sol = bul(c.parcalar, 'Sol yan');
  const altta = sol.delikler.filter((d) => d.tur === 'minifix' && d.x === 9);
  assert.equal(altta.length, baglantiNoktalari(552).length);
  // Kam parça ucundan 24 mm içeride.
  const tabla = bul(c.parcalar, 'Alt tabla');
  for (const d of tabla.delikler) assert.ok(d.x === mf.kamMesafe || d.x === tabla.boy - mf.kamMesafe);
});

test('sol ve sağ yan birbirinin aynası (menteşe tarafı hariç)', () => {
  const c = projeyiCoz(tekModul('ust', { w: 800 }));   // çift kapak: iki yanda menteşe
  const sol = bul(c.parcalar, 'Sol yan'), sag = bul(c.parcalar, 'Sağ yan');
  const anahtar = (d, ayna) => `${d.tur}|${d.cap}|${d.x}|${ayna ? Math.round((sol.en - d.y) * 10) / 10 : d.y}`;
  const a = sol.delikler.map((d) => anahtar(d, false)).sort();
  const b = sag.delikler.map((d) => anahtar(d, true)).sort();
  assert.deepEqual(a, b);
  assert.notDeepEqual(sol.delikler.map((d) => d.y).sort(), sag.delikler.map((d) => d.y).sort());
});

test('menteşe: sayı yüksekliğe göre, çanak kenardan 22 mm, taban yanda önden 37 mm', () => {
  assert.equal(menteseSayisi(700), 2);
  assert.equal(menteseSayisi(1200), 3);
  assert.equal(menteseSayisi(1900), 4);
  const c = projeyiCoz(tekModul('alt', { w: 500, kapak: 'tek', mentese: 'sag' }));
  const kapak = bul(c.parcalar, 'Kapak');
  const canak = kapak.delikler.filter((d) => d.tur === 'mentese');
  assert.equal(canak.length, 2);
  for (const d of canak) assert.equal(d.y, kapak.en - HIRDAVAT.mentese.kapMerkez);
  const sag = bul(c.parcalar, 'Sağ yan'), sol = bul(c.parcalar, 'Sol yan');
  const taban = sag.delikler.filter((d) => d.tur === 'mentese');
  assert.equal(taban.length, 4);
  for (const d of taban) assert.equal(d.y, 37);     // sağ yanda y = Dg - arkadan → önden 37
  assert.equal(sol.delikler.filter((d) => d.tur === 'mentese').length, 0);
});

test('çift kapak + boşluklar genişliği tam dolduruyor', () => {
  const c = projeyiCoz(tekModul('alt', { w: 900 }));
  assert.equal(kapakTuru(c.moduller[0].m), 'cift');
  const k = c.parcalar.filter((p) => p.grup === 'kapak');
  assert.equal(k.length, 2);
  assert.equal(k[0].en + k[1].en + 2 * 3, 900);
});

test('çekmece önleri + boşluklar yüksekliği dolduruyor, kutu raya sığıyor', () => {
  const c = projeyiCoz(tekModul('alt', { w: 600, kapak: 'cekmece', cekmeceSayisi: 4 }));
  const on = c.parcalar.filter((p) => p.grup === 'cekmeceOn');
  assert.equal(on.length, 4);
  assert.ok(Math.abs(on.reduce((a, p) => a + p.en, 0) + 4 * 3 - 720) < 0.5);
  const yan = c.parcalar.filter((p) => p.grup === 'cekmeceYan');
  assert.equal(yan.length, 8);
  assert.equal(yan[0].boy, 500);
  const taban = c.parcalar.find((p) => p.grup === 'cekmeceTaban');
  assert.equal(taban.boy, 600 - 2 * 18 - 2 * 13);          // gövde içi − ray boşlukları
  assert.equal(c.parcalar.filter((p) => p.grup === 'raf').length, 0);
});

test('boy dolap: sabit raf iki bölüm, iki kat kapak', () => {
  const c = projeyiCoz(tekModul('boy', { sabitRaf: 1000, rafSayisi: 2, ustRafSayisi: 1 }));
  assert.ok(bul(c.parcalar, 'Sabit raf'));
  const raf = c.parcalar.filter((p) => p.grup === 'raf');
  assert.equal(raf.length, 3);
  for (const r of raf.filter((p) => p.ad.startsWith('Alt'))) assert.ok(r.kutu.y + 18 <= 1000);
  for (const r of raf.filter((p) => p.ad.startsWith('Üst'))) assert.ok(r.kutu.y >= 1018);
  const kap = c.parcalar.filter((p) => p.grup === 'kapak');
  assert.equal(kap.length, 2);
  assert.ok(kap.some((k) => k.ad === 'Alt kapak') && kap.some((k) => k.ad === 'Üst kapak'));
});

test('bağlantı türü: kavela ve konfirmat kenar delikleri', () => {
  for (const [tur, beklenen] of [['kavela', 'kavela'], ['vida', 'vida']]) {
    const p = tekModul('ust');
    p.baglanti = tur;
    const c = projeyiCoz(p);
    const kenar = c.parcalar.flatMap((x) => x.kenarDelik);
    assert.ok(kenar.length > 0 && kenar.every((k) => k.tur === beklenen), tur);
    assert.equal(c.parcalar.flatMap((x) => x.delikler).filter((d) => d.tur === 'minifix').length, 0);
  }
  const p = tekModul('ust');
  p.baglanti = 'minifix+kavela';
  const c = projeyiCoz(p);
  const kv = c.parcalar.flatMap((x) => x.kenarDelik).filter((k) => k.tur === 'kavela');
  assert.equal(kv.length, 2 * 2 * 2);    // 2 tabla × 2 uç × 2 bağlantı noktası
});

test('kesim ölçüsü = net − bantlı kenarlar', () => {
  const c = projeyiCoz(tekModul('alt'));
  const k = bul(c.parcalar, 'Kapak');
  assert.equal(k.kesimBoy, Math.round((k.boy - 1.6) * 10) / 10);
  assert.equal(k.kesimEn, Math.round((k.en - 1.6) * 10) / 10);
  assert.equal(k.dx, 0.8);
  const ark = bul(c.parcalar, 'Arkalık');
  assert.equal(ark.kesimBoy, ark.boy);
  assert.equal(bantUzunlugu(k), 2 * k.boy + 2 * k.en);
  const p2 = tekModul('alt');
  p2.bant.kesimdenDus = false;
  const k2 = bul(projeyiCoz(p2).parcalar, 'Kapak');
  assert.equal(k2.kesimBoy, k2.boy);
});

test('duvar dizilimi: boy dolap iki sırayı birden itiyor', () => {
  const p = varsayilanProje();
  p.mekan.engeller = [];
  p.moduller = [modul('alt', { w: 600 }), modul('ust', { w: 400 }), modul('boy', { w: 600 }), modul('alt', { w: 500 }), modul('ust', { w: 500 })];
  const k = yerlestir(p);
  assert.deepEqual(k.map((x) => x.x), [0, 0, 600, 1200, 1200]);
  assert.equal(k[1].y, p.ustAltKot);
  assert.equal(k[0].y, p.ayakYukseklik);
});

console.log('levha');

function cakismaYok(sonuc, levha) {
  for (const lv of sonuc.levhalar) {
    const y = lv.yerlesim;
    for (const a of y) {
      assert.ok(a.x >= levha.kenarPay - 1e-6 && a.y >= levha.kenarPay - 1e-6, 'kenar payına taştı');
      assert.ok(a.x + a.w <= levha.w - levha.kenarPay + 1e-6 && a.y + a.h <= levha.h - levha.kenarPay + 1e-6, 'levhadan taştı');
    }
    for (let i = 0; i < y.length; i++) {
      for (let j = i + 1; j < y.length; j++) {
        const a = y[i], b = y[j], s = levha.aralik;
        const ic = a.x < b.x + b.w + s - 1e-6 && b.x < a.x + a.w + s - 1e-6 &&
          a.y < b.y + b.h + s - 1e-6 && b.y < a.y + a.h + s - 1e-6;
        assert.ok(!ic, `${a.id} ile ${b.id} arasında ${s} mm boşluk yok`);
      }
    }
  }
}

test('MaxRects: çakışma yok, aralık korunuyor, hepsi yerleşti', () => {
  const levha = { w: 2800, h: 2070, kenarPay: 10, aralik: 10 };
  const parcalar = [];
  let tohum = 7;
  const rnd = () => ((tohum = (tohum * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) parcalar.push({ id: i, w: 80 + Math.round(rnd() * 900), h: 60 + Math.round(rnd() * 600), donebilir: true });
  const r = yerlestirLevha(parcalar, levha);
  assert.equal(r.sigmayan.length, 0);
  assert.equal(r.levhalar.reduce((a, l) => a + l.yerlesim.length, 0), 90);
  cakismaYok(r, levha);
  const alan = parcalar.reduce((a, p) => a + p.w * p.h, 0);
  const alt = Math.ceil(alan / (levha.w * levha.h));
  assert.ok(r.levhalar.length <= alt + 1, `${r.levhalar.length} levha, alt sınır ${alt}`);
});

test('damar açıkken gövde parçası dönmüyor, sığmayan raporlanıyor', () => {
  const p = varsayilanProje();
  p.levha.damar = true;
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  for (const x of Object.values(plan).filter((g) => g.malzeme !== 'arkalik')) {
    for (const lv of x.levhalar) for (const y of lv.yerlesim) assert.equal(y.dondu, false);
    cakismaYok(x, p.levha);
  }
  const r = yerlestirLevha([{ id: 'x', w: 3000, h: 100, donebilir: true }], p.levha);
  assert.equal(r.sigmayan.length, 1);
});

test('dönen parçanın delikleri yerleştiği dikdörtgenin içinde kalıyor', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  let donen = 0;
  for (const x of Object.values(plan)) {
    for (const lv of x.levhalar) {
      for (const y of lv.yerlesim) {
        if (y.dondu) donen++;
        for (const d of y.parca.delikler) {
          const [sx, sy] = levhaNoktasi(y, y.parca, d.x - y.parca.dx, d.y - y.parca.dy);
          assert.ok(sx >= y.x - 1e-6 && sx <= y.x + y.w + 1e-6 && sy >= y.y - 1e-6 && sy <= y.y + y.h + 1e-6,
            `${y.parca.no} deliği dışarıda`);
        }
      }
    }
  }
  assert.ok(donen > 0, 'örnekte hiç dönen parça yok; test anlamsız');
});

console.log('camlı kapak');

test('MDF çerçeve: pencere ve lamba çerçevede, cam ölçüsü doğru, menteşeye değmiyor', () => {
  const p = tekModul('ust', { w: 500, h: 720, kapak: 'tek', cam: 'cerceve' });
  const c = projeyiCoz(p);
  const k = bul(c.parcalar, 'Kapak');
  const { cerceve, lamba, bosluk } = p.cam;
  assert.deepEqual([k.pencere.x0, k.pencere.y0], [cerceve, cerceve]);
  assert.equal(k.pencere.x1, k.boy - cerceve);
  assert.equal(k.pencere.y1, k.en - cerceve);
  assert.equal(k.lamba.x0, cerceve - lamba);
  const cam = c.parcalar.find((q) => q.malzeme === 'cam');
  assert.equal(cam.boy, k.boy - 2 * cerceve + 2 * lamba - 2 * bosluk);
  assert.equal(cam.en, k.en - 2 * cerceve + 2 * lamba - 2 * bosluk);
  // Cam lambanın içinde, pencereden büyük.
  assert.ok(cam.boy < k.lamba.x1 - k.lamba.x0 && cam.boy > k.pencere.x1 - k.pencere.x0);
  for (const d of k.delikler) {
    const r = d.cap / 2;
    const ic = d.x + r > k.lamba.x0 && d.x - r < k.lamba.x1 && d.y + r > k.lamba.y0 && d.y - r < k.lamba.y1;
    assert.ok(!ic, `${d.tur} deliği cam lambasına giriyor`);
  }
  assert.deepEqual(c.uyarilar, []);
});

test('camlı kapak: DXF iç kontur + cep, cam ayrı listede, levhaya girmiyor', () => {
  const p = tekModul('ust', { w: 800, cam: 'cerceve' });
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  assert.ok(Object.values(plan).every((x) => x.levhalar.every((lv) => lv.yerlesim.every((y) => y.parca.malzeme !== 'cam'))));
  const lv = plan.kapak.levhalar[0];
  const dxf = levhaDxf(lv);
  const kesim = (dxf.match(/\r\nKESIM\r\n66\r\n/g) || []).length;
  assert.equal(kesim, lv.yerlesim.length + lv.yerlesim.filter((y) => y.parca.pencere).length);
  assert.ok(dxf.includes(`CEP_Z${p.cam.lambaDerinlik}`));
  const cl = camListesi(c.parcalar, p);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].adet, 2);
  assert.ok(cl[0].m2 > 0);
  assert.ok(maliyet(c, plan, p).kalemler.some((x) => x.ad === 'Cam'));
  // Pencerenin iç kenarı bant metrajına girer.
  const k = c.parcalar.find((q) => q.pencere);
  assert.ok(bantUzunlugu(k) > 2 * (k.boy + k.en));
});

test('alüminyum camlı kapak levhaya girmiyor, sipariş listesinde', () => {
  const p = tekModul('ust', { w: 600, kapak: 'tek', cam: 'aluminyum' });
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  assert.ok(!plan.kapak, 'kapak levhası açılmamalı');
  const cl = camListesi(c.parcalar, p);
  assert.equal(cl[0].malzeme, 'aluminyum');
  assert.equal(c.parcalar.filter((q) => q.malzeme === 'cam').length, 0);
});

test('boy dolapta cam yalnız üst kapaklarda', () => {
  const c = projeyiCoz(tekModul('boy', { cam: 'cerceve' }));
  assert.ok(bul(c.parcalar, 'Üst kapak').pencere);
  assert.ok(!bul(c.parcalar, 'Alt kapak').pencere);
});

console.log('alt dolap türleri');

test('evye dolabı: raf ve arkalık yok, tepsi hırdavatta', () => {
  const p = tekModul('alt', ALT_TURLERI.evye.ozel);
  const c = projeyiCoz(p);
  assert.equal(c.parcalar.filter((q) => q.grup === 'raf').length, 0);
  assert.ok(!bul(c.parcalar, 'Arkalık'));
  assert.ok(bul(c.parcalar, 'Alt tabla') && bul(c.parcalar, 'Ön kuşak'));
  assert.equal(c.parcalar.filter((q) => q.grup === 'kapak').length, 2);
  assert.ok(hirdavatListesi(c, p).some((x) => x.ad === 'Evye altı alüminyum tepsi' && x.adet === 1));
});

test('bulaşık makinesi: yalnız panel + baza, menteşesiz, ayaksız', () => {
  const p = tekModul('alt', ALT_TURLERI.bulasik.ozel);
  const c = projeyiCoz(p);
  assert.ok(makineMi(c.moduller[0].m));
  assert.deepEqual(c.parcalar.map((q) => q.ad).sort(), ['Baza', 'Bulaşık makinesi paneli']);
  const panel = bul(c.parcalar, 'Bulaşık makinesi paneli');
  assert.equal(panel.delikler.filter((d) => d.tur === 'mentese').length, 0);
  assert.equal(panel.en, 600 - p.kapakBosluk);
  assert.equal(panel.hareket.tip, 'devril');
  const h = Object.fromEntries(hirdavatListesi(c, p).map((x) => [x.ad, x.adet]));
  assert.equal(h['Dolap ayağı'], undefined);
  assert.equal(h['Menteşe (bindirme, frenli)'], undefined);
});

test('çamaşır makinesi: parça yok, dizilimde yer tutuyor, standart dışı ölçüde uyarı', () => {
  const p = varsayilanProje();
  p.moduller = [modul('alt', { w: 600 }), modul('alt', ALT_TURLERI.camasir.ozel), modul('alt', { w: 400 })];
  const c = projeyiCoz(p);
  assert.equal(c.moduller[1].parcalar.length, 0);
  assert.deepEqual(c.moduller.map((x) => x.konum.x), [0, 600, 1200]);
  assert.deepEqual(c.uyarilar, []);
  p.moduller[1].w = 550;
  assert.ok(projeyiCoz(p).uyarilar.some((u) => u.includes('makine yeri')));
});

console.log('mekân');

/** Engelsiz, tek duvarlı boş proje. */
function bosProje(ozel = {}) {
  const p = varsayilanProje();
  p.mekan = { tip: 'duz', duvarA: 4000, duvarB: 3000, tavan: 2700, engeller: [], ...ozel };
  return p;
}

test('pencere üst dolabı iter, alt dolaba dokunmaz; kolon iki sırayı da iter', () => {
  const p = bosProje({ engeller: [engel('pencere', { x: 600, w: 800 }), engel('kolon', { x: 2000, w: 300 })] });
  p.moduller = [modul('alt', { w: 600 }), modul('alt', { w: 800 }), modul('alt', { w: 600 }),
    modul('ust', { w: 600 }), modul('ust', { w: 600 }), modul('ust', { w: 600 })];
  const c = projeyiCoz(p);
  assert.deepEqual(c.moduller.map((x) => x.konum.s), [0, 600, 1400, 0, 1400, 2300]);
  // 1400+600 = 2000: kolona değiyor ama girmiyor; üst sıra 2000'den kolon yüzünden 2300'e atladı.
  assert.deepEqual(c.uyarilar, []);
  assert.ok(c.notlar.some((n) => n.includes('alt sıra') && n.includes('2300–4000')), c.notlar.join(' | '));
});

test('kolonun önüne dolap: derinlik kolon kadar kısalır, parçalar da kısa', () => {
  const p = bosProje({ engeller: [engel('kolon', { x: 300, w: 300, d: 120, onune: true })] });
  p.moduller = [modul('alt', { w: 600 })];
  const c = projeyiCoz(p);
  assert.equal(c.moduller[0].konum.s, 0);
  assert.equal(c.moduller[0].konum.dAzalt, 120);
  assert.equal(bul(c.parcalar, 'Sol yan').en, 560 - 120 - 8);
  assert.ok(c.notlar.some((n) => n.includes('kolonun önünde')));
});

test('duvardan ve tavandan taşma uyarılır, küçük boşluk dolgu önerir', () => {
  const p = bosProje({ duvarA: 1300, tavan: 2000 });
  p.moduller = [modul('alt', { w: 600 }), modul('alt', { w: 600 }), modul('boy', { w: 600 })];
  const c = projeyiCoz(p);
  assert.ok(c.uyarilar.some((u) => u.includes('taşıyor') && u.includes('500 mm')));
  assert.ok(c.uyarilar.some((u) => u.includes('tavanı')));
  const q = bosProje({ duvarA: 1300 });
  q.moduller = [modul('alt', { w: 600 }), modul('alt', { w: 600 })];
  assert.ok(projeyiCoz(q).notlar.some((n) => n.includes('100 mm') && n.includes('dolgu')));
});

test('L mutfak: B duvarı köşe dolabının önünden başlar, kör kısım B derinliğinden', () => {
  const p = bosProje({ tip: 'L' });
  p.moduller = [modul('alt', { w: 1100, kose: true }), modul('alt', { w: 600, duvar: 'B' }),
    modul('ust', { w: 900, kose: true }), modul('ust', { w: 600, duvar: 'B' })];
  const c = projeyiCoz(p);
  const [a, b, ua, ub] = c.moduller;
  assert.equal(b.konum.duvar, 'B');
  assert.equal(b.konum.s, 560 + 18);
  assert.equal(ub.konum.s, 320 + 18);
  assert.equal(b.konum.x, 0);
  assert.equal(b.konum.z, b.konum.s + 600);
  assert.ok(Math.abs(b.konum.rotY - Math.PI / 2) < 1e-9);
  assert.equal(a.konum.kor, 560 + 18 + 50);
  assert.equal(ua.konum.kor, 320 + 18 + 50);
  const kor = a.parcalar.find((q) => q.ad === 'Kör panel');
  const kapak = a.parcalar.find((q) => q.grup === 'kapak' && q.hareket);
  assert.ok(kor && kapak);
  assert.equal(kapak.hareket.mentese, 'sag');
  // Kör panel köşeye sıfır başlar: arada 3 mm, dış kenarda 1,5 mm boşluk.
  assert.ok(Math.abs(kor.kutu.sx + kapak.kutu.sx + 3 + 1.5 - 1100) < 0.6);
  // Kapak B dolabının arkasında kalan bölgeye girmiyor.
  assert.ok(kapak.kutu.x >= 560 + 18);
  assert.ok(!c.uyarilar.some((u) => u.includes('köşe')), c.uyarilar.join(' | '));
});

test('L mutfak: köşedeki düz dolap için not, düz mutfakta köşe işareti uyarı', () => {
  const p = bosProje({ tip: 'L' });
  p.moduller = [modul('alt', { w: 1000 }), modul('alt', { w: 600, duvar: 'B' })];
  assert.ok(projeyiCoz(p).notlar.some((n) => n.includes('Köşe dolabı')));
  const q = bosProje();
  q.moduller = [modul('alt', { w: 1000, kose: true })];
  assert.ok(projeyiCoz(q).uyarilar.some((u) => u.includes('köşe dolabı')));
});

console.log('bölme ve cihaz yerleri');

test('ara bölme: dikmeler, bölüm başına raf ve kapak, ölçüler toplamı tutuyor', () => {
  const p = bosProje();
  p.moduller = [modul('alt', { w: 1000, bolme: 1, rafSayisi: 1 })];
  const c = projeyiCoz(p);
  const dikme = c.parcalar.filter((q) => q.grup === 'dikme');
  assert.equal(dikme.length, 1);
  assert.equal(dikme[0].boy, 720 - 2 * 18);
  const raf = c.parcalar.filter((q) => q.grup === 'raf');
  assert.equal(raf.length, 2);
  const cw = (1000 - 3 * 18) / 2;
  for (const r of raf) assert.equal(r.boy, cw - 2);
  const kap = c.parcalar.filter((q) => q.grup === 'kapak');
  assert.equal(kap.length, 2);
  assert.ok(Math.abs(kap[0].en + kap[1].en + 3 * 2 - 1000) < 0.6);
  assert.deepEqual(kap.map((k) => k.hareket.mentese), ['sol', 'sag']);
  // Dikme alt tablaya ve iki kuşağa konfirmatla bağlı.
  const vida = c.parcalar.flatMap((q) => q.delikler).filter((d) => d.tur === 'vida');
  assert.equal(vida.length, dikme[0].kenarDelik.length);
  assert.equal(vida.length, baglantiNoktalari(552).length + 2);
  // Raf pimleri dikmede boydan geçer.
  assert.ok(dikme[0].delikler.filter((d) => d.tur === 'raf').every((d) => d.derinlik === 'gecer'));
});

test('bölmeli dolapta bir bölüm çekmece, orta kapak dikmeye menteşelenir', () => {
  const p = bosProje();
  p.moduller = [modul('alt', { w: 1200, bolme: 2, bolumler: ['raf', 'cekmece', 'raf'], cekmeceSayisi: 3 })];
  const c = projeyiCoz(p);
  assert.equal(c.parcalar.filter((q) => q.grup === 'cekmeceOn').length, 3);
  assert.equal(c.parcalar.filter((q) => q.grup === 'kapak').length, 2);
  const p3 = bosProje();
  p3.moduller = [modul('ust', { w: 1200, bolme: 2 })];
  const c3 = projeyiCoz(p3);
  const dikmeler = c3.parcalar.filter((q) => q.grup === 'dikme');
  assert.ok(dikmeler.some((d) => d.delikler.some((x) => x.tur === 'mentese')), 'orta kapağın menteşesi dikmede değil');
  for (const q of c3.parcalar) for (const d of q.delikler) {
    assert.ok(d.x >= 0 && d.x <= q.boy && d.y >= 0 && d.y <= q.en, `${q.ad} deliği dışarıda`);
  }
});

test('fırın altı: fırın rafı, alt panel, arkalık yok, ocak ve fırın cihazı', () => {
  const p = bosProje();
  p.moduller = [modul('alt', ALT_TURLERI.firin.ozel)];
  const c = projeyiCoz(p);
  assert.ok(bul(c.parcalar, 'Fırın rafı') && bul(c.parcalar, 'Fırın altı panel'));
  assert.ok(!c.parcalar.some((q) => q.grup === 'arkalik' || q.grup === 'raf'));
  assert.deepEqual(c.moduller[0].cihazlar.map((x) => x.tip).sort(), ['firin', 'ocak']);
  const raf = bul(c.parcalar, 'Fırın rafı');
  assert.equal(720 - 18 - (raf.kutu.y + 18), 600);   // fırın nişi 600
});

test('fırın kolonu: üç sabit raf, iki arkalık, nişte kapak yok', () => {
  const p = bosProje();
  p.moduller = [modul('boy', BOY_TURLERI.firin.ozel)];
  const c = projeyiCoz(p);
  assert.deepEqual(c.uyarilar, []);
  for (const ad of ['Fırın rafı', 'Fırın üstü raf', 'Mikrodalga üstü raf']) assert.ok(bul(c.parcalar, ad), ad);
  assert.equal(c.parcalar.filter((q) => q.grup === 'arkalik').length, 2);
  const kap = c.parcalar.filter((q) => q.grup === 'kapak');
  const m = c.moduller[0].m;
  for (const k of kap) {
    assert.ok(k.kutu.y + k.kutu.sy <= m.firinAlt || k.kutu.y >= m.firinAlt + 590 + 18 + 380, `${k.ad} nişi kapatıyor`);
  }
  assert.deepEqual(c.moduller[0].cihazlar.map((x) => x.tip), ['firin', 'mikrodalga']);
});

test('buzdolabı yeri: alt tabla yok, köprü dolap üstte, baza yok', () => {
  const p = bosProje();
  p.moduller = [modul('boy', BOY_TURLERI.buzdolabi.ozel)];
  const c = projeyiCoz(p);
  assert.ok(!bul(c.parcalar, 'Alt tabla') && !bul(c.parcalar, 'Baza'));
  const kt = bul(c.parcalar, 'Köprü alt tabla');
  assert.equal(kt.kutu.y, 2000 - 400);
  for (const k of c.parcalar.filter((q) => q.grup === 'kapak')) assert.ok(k.kutu.y >= 1600);
  assert.equal(c.moduller[0].cihazlar[0].tip, 'buzdolabi');
});

test('davlumbaz: kısa dolap üst kota hizalı, 0 ise parça yok', () => {
  const p = bosProje();
  p.moduller = [modul('ust', UST_TURLERI.davlumbaz.ozel)];
  const c = projeyiCoz(p);
  const yan = bul(c.parcalar, 'Sol yan');
  assert.equal(yan.boy, 360);
  assert.equal(yan.kutu.y, 720 - 360);
  p.moduller[0].kisaH = 0;
  const c0 = projeyiCoz(p);
  assert.equal(c0.parcalar.length, 0);
  assert.equal(c0.moduller[0].cihazlar[0].tip, 'davlumbaz');
});

console.log('teknik çizim');

test('cephe SVG: modül numaraları, duvar ölçüsü, engeller; etiketler her levha parçasına', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const svg = cepheSvg(c, p, 'A');
  assert.ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'));
  for (const x of c.moduller) assert.ok(svg.includes(`>M${x.no}<`), `M${x.no} yok`);
  assert.ok(svg.includes(`>${p.mekan.duvarA}<`), 'duvar ölçüsü yok');
  assert.ok(svg.includes('PENCERE') && svg.includes('BUZDOLABI') && svg.includes('FIRIN'));
  const html = etiketlerHtml(c, p);
  const levhalik = c.parcalar.filter((q) => ['govde', 'kapak', 'arkalik'].includes(q.malzeme)).length;
  assert.equal((html.match(/class="etiket"/g) || []).length, levhalik);
  // L mutfakta B duvarı da çizilir.
  p.mekan.tip = 'L';
  p.moduller.push(modul('alt', { duvar: 'B' }));
  const c2 = projeyiCoz(p);
  assert.ok(cepheSvg(c2, p, 'B').includes(`>M${c2.moduller.length}<`));
});

console.log('G-code');

/** G-code'u satır satır izleyip hareketleri çıkarır (basit yorumlayıcı). */
function gcodeIzle(metin) {
  const k = { x: null, y: null, z: null };
  const hareket = [];
  for (let satir of metin.split(/\r?\n/)) {
    satir = satir.replace(/^N\d+\s*/, '').trim();
    if (!satir || satir.startsWith('(') || satir === '%') continue;
    const g = satir.match(/^G([0123])\b/);
    const v = (h) => { const m = satir.match(new RegExp(`${h}(-?[\\d.]+)`)); return m ? parseFloat(m[1]) : null; };
    if (g) {
      const yeni = { x: v('X') ?? k.x, y: v('Y') ?? k.y, z: v('Z') ?? k.z };
      hareket.push({ g: +g[1], once: { ...k }, ...yeni, satir });
      Object.assign(k, yeni);
    }
  }
  return hareket;
}

test('G-code: güvenli başlangıç, derinlik sınırı, levha içinde, yatay hareket hep yukarıda', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  for (const x of Object.values(plan)) {
    x.levhalar.forEach((lv, i) => {
      const r = levhaGcode(lv, x.kalinlik, p.cnc, { levhaNo: i + 1 });
      const h = gcodeIzle(r.metin);
      assert.ok(h.length > 10, 'boş program');
      assert.equal(h[0].g, 0);
      assert.equal(h[0].z, CNC_VARSAYILAN.guvenliZ, 'ilk hareket güvenli Z değil');
      const enDerin = -(x.kalinlik + CNC_VARSAYILAN.tablaPay);
      const pay = CNC_VARSAYILAN.takimlar[0].cap;
      for (const m of h) {
        assert.ok(m.z >= enDerin - 1e-6, `${m.satir}: tablaya fazla giriyor`);
        if (m.x !== null) assert.ok(m.x >= -pay && m.x <= lv.w + pay, `${m.satir}: levha dışı X`);
        if (m.y !== null) assert.ok(m.y >= -pay && m.y <= lv.h + pay, `${m.satir}: levha dışı Y`);
        // Hızlı (G0) yatay hareket malzemenin içinde olamaz.
        if (m.g === 0 && (m.x !== m.once.x || m.y !== m.once.y)) assert.ok(m.z > 0, `${m.satir}: malzeme içinde hızlı hareket`);
      }
      assert.ok(/M30/.test(r.metin));
      assert.ok(!/[^\x00-\x7F]/.test(r.metin), 'ASCII dışı karakter');
      assert.ok(r.sure > 0);
    });
  }
});

test('G-code: her parça kesiliyor, takım değişimi ATC / duraklama, eksik takım uyarısı', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  const lv = plan.govde.levhalar[0];
  const r = levhaGcode(lv, 18, p.cnc);
  for (const y of lv.yerlesim) assert.ok(r.metin.includes(`(Parca ${y.parca.no})`), `${y.parca.no} kesilmiyor`);
  assert.ok(/\nM0\r?\n/.test(r.metin) && !/T\d+ M6/.test(r.metin), 'tek iş milinde M0 ile duraklamalı');
  const atc = levhaGcode(lv, 18, { ...p.cnc, atc: true, post: 'syntec' });
  assert.ok(/T1 M6/.test(atc.metin) && /^%/.test(atc.metin) && /\nN\d+ /.test(atc.metin));
  const eksik = levhaGcode(lv, 18, { ...p.cnc, takimlar: [{ no: 1, tur: 'freze', cap: 6 }] });
  assert.ok(eksik.uyarilar.some((u) => u.includes('Ø5')), 'Ø5 matkap eksik uyarısı yok');
  // Ø15 kam ve Ø35 çanak frezeyle helisel: G3 yayları var.
  assert.ok(/G3 /.test(r.metin));
  assert.deepEqual(pasolar(18.3, 9).map((v) => +v.toFixed(3)), [6.1, 12.2, 18.3]);
});

console.log('ebatlama, artık, barkod, teklif, kütüphane');

test('giyotin: şeritler levha boyunca, parçalar şeritte, çakışma yok, kesim sırası var', () => {
  const p = varsayilanProje();
  p.levha.yontem = 'ebatlama';
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  for (const x of Object.values(plan)) {
    for (const lv of x.levhalar) {
      assert.ok(lv.kesimler.some((k) => k.tip === 'serit'));
      const parcaKesim = lv.kesimler.filter((k) => k.tip === 'parca').map((k) => k.id).sort();
      assert.deepEqual(parcaKesim, lv.yerlesim.map((y) => y.id).sort());
      const y = lv.yerlesim;
      for (let i = 0; i < y.length; i++) for (let j = i + 1; j < y.length; j++) {
        const a = y[i], b = y[j];
        const ic = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
        assert.ok(!ic, `${a.id} ile ${b.id} çakışıyor`);
      }
      for (const a of y) assert.ok(a.x + a.w <= lv.w - p.levha.kenarPay + 1e-6 && a.y + a.h <= lv.h - p.levha.kenarPay + 1e-6);
    }
  }
});

test('artık stoğu tam levhadan önce kullanılır, maliyete girmez', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const once = levhaPlani(c.parcalar, p);
  const sa = stokAnahtari('arkalik', '', 8);
  const sonra = levhaPlani(c.parcalar, p, [{ id: 'x1', anahtar: sa, w: 2800, h: 2070 }]);
  assert.equal(sonra.arkalik.levhalar.filter((l) => l.artik === 'x1').length, 1);
  assert.equal(sonra.arkalik.levhalar.filter((l) => !l.artik).length, once.arkalik.levhalar.length - 1);
  assert.ok(maliyet(c, sonra, p).toplam < maliyet(c, once, p).toplam);
  // Başka malzemenin artığı kullanılmaz.
  const yanlis = levhaPlani(c.parcalar, p, [{ id: 'x2', anahtar: stokAnahtari('kapak', 'yok', 18), w: 2800, h: 2070 }]);
  assert.ok(Object.values(yanlis).every((x) => x.levhalar.every((l) => !l.artik)));
  // Kalan artık önerisi var.
  assert.ok(once.govde.levhalar.some((l) => l.kalan && l.kalan.w > 0));
});

test('barkod: Code 39, başta ve sonda *, 3 kalın çubuk / karakter', () => {
  const svg = barkodSvg('M1-01');
  assert.ok(svg.startsWith('<svg'));
  const cubuk = (svg.match(/<rect x=/g) || []).length;
  assert.equal(cubuk, ('*M1-01*'.length) * 5);
});

test('teklif: malzeme + hırdavat + işçilik, kâr ve KDV doğru; HTML toplamı taşıyor', () => {
  const p = varsayilanProje();
  p.teklif = { ...p.teklif, karOrani: 30, kdv: 20, iscilikModul: 1000, montaj: 2000 };
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  const h = teklifHesapla(c, plan, p);
  assert.equal(h.malz, maliyet(c, plan, p).toplam);
  assert.equal(h.hird, hirdavatListesi(c, p).reduce((a, x) => a + x.tutar, 0));
  assert.equal(h.iscilik, h.modulSay * 1000 + 2000);
  assert.equal(h.kar, Math.round((h.malz + h.hird + h.iscilik) * 0.3));
  assert.equal(h.toplam, h.ara + h.kdv);
  assert.ok(h.hird > 0);
  const html = teklifHtml(c, p, h, new Date(2026, 10, 19));
  assert.ok(html.includes(Math.round(h.toplam).toLocaleString('tr-TR')));
  for (const x of c.moduller) assert.ok(html.includes(`<td>M${x.no}</td>`) || !x.parcalar.length);
});

test('kütüphane ve boşluk doldurma: standart ölçüler, dolgu ≤ 150', () => {
  const alt = MODUL_KATALOG.find((g) => g.grup === 'Alt');
  const o = katalogOzel(alt.ogeler[0], 600);
  assert.equal(o.w, 600);
  assert.equal(o.ad, 'Kapaklı alt 60');
  for (const L of [450, 600, 1150, 1850, 2850, 3333]) {
    const r = boslukDoldur(L);
    const top = r.genislikler.reduce((a, w) => a + w, 0) + r.dolgu + r.kalan;
    assert.equal(top, L, `${L}: ${JSON.stringify(r)}`);
    assert.ok(r.dolgu <= 150);
  }
  assert.deepEqual(boslukDoldur(1200).genislikler, [600, 600]);
  // Dolgu modülü: tek panel, ayak yok.
  const p = varsayilanProje();
  p.mekan.engeller = [];
  p.moduller = [modul('alt', { w: 100, altTur: 'dolgu' })];
  const c = projeyiCoz(p);
  assert.deepEqual(c.parcalar.map((q) => q.ad).sort(), ['Baza', 'Dolgu paneli']);
  assert.ok(!hirdavatListesi(c, p).some((x) => x.anahtar === 'ayak'));
});

console.log('renkler');

test('katalog: kimlikler tekil, hex geçerli, eski renk adları hâlâ bulunuyor', () => {
  assert.equal(new Set(KATALOG.map((r) => r.id)).size, KATALOG.length);
  for (const r of KATALOG) assert.match(r.hex, /^#[0-9a-f]{6}$/i, r.id);
  for (const eski of ['Beyaz', 'Krem', 'Açık meşe', 'Ceviz', 'Antrasit', 'Adaçayı', 'Lacivert']) {
    assert.equal(renkBul(eski).id, eski);
  }
  assert.ok(KATALOG.some((r) => r.marka === 'Kastamonu Entegre' && r.yuzey === 'parlak'));
  assert.equal(renkAdi('Kastamonu Entegre|A339|mat'), 'A339 Yenice Meşe');
  assert.equal(renkAdi('Kastamonu Entegre|Antrasit|parlak'), 'Evogloss Antrasit (parlak)');
  assert.ok(renkCss('Kastamonu Entegre|A339|mat').includes('repeating-linear-gradient'));
  assert.equal(renkBul('yok-boyle-renk').id, 'Beyaz');
});

test('modül kapak rengi parçalara geçiyor, her renk ayrı levhaya diziliyor', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const ustId = c.moduller.find((x) => x.m.tip === 'ust').m.id;
  for (const q of c.parcalar.filter((x) => x.malzeme === 'kapak')) {
    const m = p.moduller.find((x) => x.id === q.modulId);
    assert.equal(q.renk, m.kapakRenk || p.malzeme.kapak.renk);
  }
  assert.ok(c.parcalar.some((q) => q.modulId === ustId && q.renk === 'Kastamonu Entegre|Beyaz|parlak'));
  const plan = levhaPlani(c.parcalar, p);
  const kapakGrup = Object.values(plan).filter((x) => x.malzeme === 'kapak');
  assert.equal(kapakGrup.length, 2);
  for (const g of kapakGrup) {
    for (const lv of g.levhalar) for (const y of lv.yerlesim) assert.equal(y.parca.renk, g.renk);
    assert.equal(plan[g.anahtar], g);
  }
  // Tek renkte anahtar sade 'kapak'.
  for (const m of p.moduller) m.kapakRenk = '';
  const tek = levhaPlani(projeyiCoz(p).parcalar, p);
  assert.ok(tek.kapak && Object.values(tek).filter((x) => x.malzeme === 'kapak').length === 1);
  // Maliyette iki kapak levhası da kapak fiyatından.
  const m = maliyet(c, plan, p);
  const kapakTutar = m.kalemler.filter((k) => k.ad.startsWith(p.malzeme.kapak.ad)).reduce((a, k) => a + k.tutar, 0);
  assert.equal(kapakTutar, kapakGrup.reduce((a, g) => a + g.levhalar.length, 0) * p.fiyat.kapakLevha);
});

test('kesim listesinde renk ayrı satır ve CSV sütunu', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const l = kesimListesi(c.parcalar, 'toplu').filter((s) => s.malzeme === 'kapak');
  assert.ok(new Set(l.map((s) => s.renk)).size === 2);
  const csv = kesimCsv(kesimListesi(c.parcalar), p);
  assert.ok(csv.includes(';Malzeme;Renk;'));
  assert.ok(csv.includes('Evogloss Beyaz (parlak)'));
});

console.log('çıktılar');

test('DXF: her delik bir CIRCLE, katmanlar tanımlı, dosya EOF ile bitiyor', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  const lv = plan.govde.levhalar[0];
  const dxf = levhaDxf(lv);
  const delik = lv.yerlesim.reduce((a, y) => a + y.parca.delikler.length, 0);
  assert.equal((dxf.match(/\r\nCIRCLE\r\n/g) || []).length, delik);
  assert.ok(dxf.trimEnd().endsWith('EOF'));
  for (const y of lv.yerlesim) for (const d of y.parca.delikler) {
    assert.ok(dxf.includes(`\r\nLAYER\r\n2\r\n${delikKatmani(d)}\r\n`), `${delikKatmani(d)} tabloda yok`);
  }
  assert.equal(delikKatmani({ cap: 35, derinlik: 13 }), 'DELIK_D35_Z13');
  assert.equal(delikKatmani({ cap: 5, derinlik: 'gecer' }), 'DELIK_D5_GECER');
  const hepsi = levhalarDxf(plan.govde.levhalar, { etiket: false });
  assert.ok(!hepsi.includes('ETIKET'));
  assert.equal((hepsi.match(/\r\nKESIM\r\n66\r\n/g) || []).length, plan.govde.levhalar.reduce((a, l) => a + l.yerlesim.length, 0));
});

test('kesim listesi: adetler parça sayısını tutuyor, CSV Excel uyumlu', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const levhalik = c.parcalar.filter((q) => ['govde', 'kapak', 'arkalik'].includes(q.malzeme));
  for (const mod of ['modul', 'toplu']) {
    const l = kesimListesi(c.parcalar, mod);
    assert.equal(l.reduce((a, s) => a + s.adet, 0), levhalik.length);
  }
  assert.ok(kesimListesi(c.parcalar, 'toplu').length < kesimListesi(c.parcalar, 'modul').length);
  const csv = kesimCsv(kesimListesi(c.parcalar), p);
  assert.ok(csv.startsWith('﻿No;Modül;Parça;Adet;Boy;En'));
  assert.ok(/;551,2;/.test(csv), 'ondalık virgül yok');
  const yan = kesimListesi(c.parcalar).find((s) => s.modulNo === 1 && s.ad === 'Sol + sağ yan');
  assert.equal(yan?.adet, 2);
});

test('hırdavat ve maliyet', () => {
  const p = varsayilanProje();
  const c = projeyiCoz(p);
  const plan = levhaPlani(c.parcalar, p);
  const h = Object.fromEntries(hirdavatListesi(c, p).map((x) => [x.ad, x.adet]));
  const kam = c.parcalar.flatMap((x) => x.delikler).filter((d) => d.tur === 'minifix' && d.cap === 15).length;
  assert.equal(h['Minifix (takım)'], kam);
  assert.equal(h['Menteşe (bindirme, frenli)'], c.parcalar.flatMap((x) => x.delikler).filter((d) => d.cap === 35).length);
  assert.ok(h['Çekmece rayı 500 mm (çift)'] === 3);
  const m = maliyet(c, plan, p);
  assert.ok(m.toplam > 0 && m.bantM > 0);
  assert.equal(m.toplam, m.kalemler.reduce((a, k) => a + k.tutar, 0));
});

console.log('paketleme');

test('dolap dosyaları servis çalışanında ve masaüstü paketinde', () => {
  const sw = oku('sw.js');
  const html = oku('dolap/index.html');
  for (const f of fs.readdirSync(path.join(KOK, 'dolap/js'))) {
    assert.ok(sw.includes(`./dolap/js/${f}`), `${f} sw.js listesinde yok`);
  }
  assert.ok(sw.includes('./dolap/index.html') && sw.includes('./dolap/dolap.css'));
  assert.ok(/"dolap\/\*\*"/.test(oku('package.json')), 'electron paketine dolap/ girmiyor');
  assert.ok(html.includes('"three": "../vendor/three/three.module.min.js"'));
  assert.ok(oku('index.html').includes('href="dolap/'), 'panelden dolaba bağlantı yok');
});

console.log(`\n${passed} test geçti${process.exitCode ? ' (hatalar var)' : ''}`);
