// PANEL FOTOĞRAFI — internetten bulunan "parametrik lamel panel" görselinden
// aynı paneli çıkarmak.
//
// Böyle bir görsel yüz fotoğrafı değil, ZATEN YAPILMIŞ bir panelin
// fotoğrafıdır. Yapay zekâ derinliği yüzü doğru görür, ama olduğu gibi
// kullanılınca üç şey onu yutuyordu (5 örnek görselde ölçüldü):
//
//  1. Zemin ayırma yanlış şeyi seçer: kameraya en yakın olan yer, saksı,
//     raftır; panel ve yüz "arka plan" sayılıp silinir.
//  2. Yandan çekimde duvarın kendisi soldan sağa derinleşir; bu eğim
//     derinlik aralığının çoğunu yer, yüz sığ bir ayrıntıda kalır.
//  3. Oda (duvar, zemin, çerçeve) da panele dönüşür.
//
// Paneli odadan ayıran şey lamel çizgileridir: ince, tek yönlü, sık tekrar
// eden bir doku. Burada (a) bu dokunun olduğu bölge bulunur, (b) bölgenin
// dört kenarına doğru uydurulup perspektif düzeltilir — yandan çekilmiş
// panel dikdörtgene açılır, (c) derinlikten panelin arka düzlemi çıkarılır
// ve (d) kalan lamel izi lamel adımı kadar yumuşatmayla silinir.

/** Analizde uzun kenar en çok bu kadar piksel (lamel adımı ~5 px kalsın). */
const ANALIZ = 1024;

// ------------------------------------------------------------ yardımcılar

/** Tek yönde kutu bulanıklığı (kenarlar kırpılır). yatay: x boyunca. */
function kutu(src, w, h, r, yatay) {
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  if (yatay) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        out[o + x] = s / n;
        s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / n;
        s += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
      }
    }
  }
  return out;
}

const kutu2 = (src, w, h, r) => kutu(kutu(src, w, h, r, true), w, h, r, false);

function yuzdelik(dizi, p) {
  const s = Float32Array.from(dizi).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

/** RGBA → gri (0..1), uzun kenarı en çok `enCok` piksel (alan ortalaması). */
export function griKucult(rgba, w, h, enCok = ANALIZ) {
  const k = Math.max(1, Math.max(w, h) / enCok);
  const gw = Math.max(1, Math.round(w / k)), gh = Math.max(1, Math.round(h / k));
  const g = new Float32Array(gw * gh);
  const say = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor(x / k));
      const i = (y * w + x) * 4;
      g[gy * gw + gx] += (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
      say[gy * gw + gx]++;
    }
  }
  for (let i = 0; i < g.length; i++) g[i] /= say[i] || 1;
  return { g, w: gw, h: gh, k };
}

// ------------------------------------------------------------ çizgi dokusu

/**
 * Lamel çizgisi haritası. Lamel ve aradaki boşluk, lamele dik yönde ince bir
 * dalga, lamel boyunca neredeyse sabit bir değer verir. Bant geçiren süzgeç
 * (iki kutu bulanıklığının farkı) her iki yönde ayrı uygulanır; yönlülük
 * oranı yüksek ve enerjisi belirgin olan pikseller çizgili sayılır.
 *
 * Dönüş: { maske (0/1), yon: 'vertical' | 'horizontal' }.
 * 'vertical' = dik lameller (çizgiler dikey, doku x boyunca değişir).
 */
export function seritHaritasi(g, w, h) {
  // Tek, ince ölçek. Kalın ölçek (10-20 px) denendi: yandan görülen kalın
  // lameli yakalamadı, ama çerçeve kenarı ve gölge gibi TEK düz kenarı çizgi
  // sanıp maskeyi panelin dışına taşırdı.
  const bant = (yatay) => {
    const a = kutu(g, w, h, 1, yatay), b = kutu(g, w, h, 4, yatay);
    const e = new Float32Array(w * h);
    for (let i = 0; i < e.length; i++) e[i] = (a[i] - b[i]) ** 2;
    return kutu2(e, w, h, 8);
  };
  const ex = bant(true), ey = bant(false);
  const sonuc = (e1, e2) => {
    const esik = 0.2 * yuzdelik(e1, 0.95);
    const m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = e1[i] > esik && e1[i] > 2.2 * e2[i] ? 1 : 0;
    return m;
  };
  const mx = sonuc(ex, ey), my = sonuc(ey, ex);
  let sx = 0, sy = 0;
  for (let i = 0; i < mx.length; i++) { sx += mx[i]; sy += my[i]; }
  const dik = sx >= sy;
  return { maske: dik ? mx : my, yon: dik ? 'vertical' : 'horizontal' };
}

/** İkili maskeye kapama (genişlet + daralt), kare pencere. */
function kapa(m, w, h, r) {
  const f = Float32Array.from(m);
  const gen = kutu2(f, w, h, r);
  const g2 = new Float32Array(w * h);
  for (let i = 0; i < g2.length; i++) g2[i] = gen[i] > 1e-6 ? 1 : 0;
  const dar = kutu2(g2, w, h, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = dar[i] > 0.999 ? 1 : 0;
  return out;
}

/** En büyük 4-bağlı bileşen. */
function enBuyukBilesen(m, w, h) {
  const etiket = new Int32Array(w * h);
  const yigin = new Int32Array(w * h);
  let enIyi = 0, enIyiBoy = 0, no = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || etiket[s]) continue;
    no++;
    let ust = 0, boy = 0;
    yigin[ust++] = s; etiket[s] = no;
    while (ust) {
      const i = yigin[--ust]; boy++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && m[i - 1] && !etiket[i - 1]) { etiket[i - 1] = no; yigin[ust++] = i - 1; }
      if (x < w - 1 && m[i + 1] && !etiket[i + 1]) { etiket[i + 1] = no; yigin[ust++] = i + 1; }
      if (y > 0 && m[i - w] && !etiket[i - w]) { etiket[i - w] = no; yigin[ust++] = i - w; }
      if (y < h - 1 && m[i + w] && !etiket[i + w]) { etiket[i + w] = no; yigin[ust++] = i + w; }
    }
    if (boy > enIyiBoy) { enIyiBoy = boy; enIyi = no; }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = etiket[i] === enIyi ? 1 : 0;
  return { maske: out, alan: enIyiBoy };
}

// ------------------------------------------------------------ dört kenar

/**
 * v = a·t + b doğrusunu sağlam uydurur: en küçük kareler, sonra en kötü
 * %25 atılıp yeniden (iki tur). Yüzün panel kenarından taşan kısmı (yandan
 * çekimde burun/dudak) kenar doğrusunu çekmesin diye.
 */
export function dogruUydur(ts, vs) {
  let idx = ts.map((_, i) => i);
  let a = 0, b = 0;
  for (let tur = 0; tur < 3; tur++) {
    let st = 0, sv = 0, stt = 0, stv = 0;
    for (const i of idx) { st += ts[i]; sv += vs[i]; stt += ts[i] * ts[i]; stv += ts[i] * vs[i]; }
    const n = idx.length;
    const d = n * stt - st * st;
    a = Math.abs(d) < 1e-9 ? 0 : (n * stv - st * sv) / d;
    b = (sv - a * st) / n;
    if (tur === 2) break;
    idx = idx
      .map((i) => [i, Math.abs(vs[i] - (a * ts[i] + b))])
      .sort((p, q) => p[1] - q[1])
      .slice(0, Math.max(2, Math.ceil(idx.length * 0.75)))
      .map((p) => p[0]);
  }
  return { a, b };
}

/**
 * Maskenin dört kenarına doğru uydurur, köşeleri döndürür:
 * [sol üst, sağ üst, sağ alt, sol alt], her biri [x, y].
 * Seyrek satır/sütunlar (uçlardaki kırpıntı) hesaba girmez.
 */
export function dortgenBul(m, w, h) {
  const satir = [], sutun = [];
  const satirSay = new Int32Array(h), sutunSay = new Int32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { satirSay[y]++; sutunSay[x]++; }
  let enSatir = 0, enSutun = 0;
  for (const v of satirSay) enSatir = Math.max(enSatir, v);
  for (const v of sutunSay) enSutun = Math.max(enSutun, v);
  for (let y = 0; y < h; y++) {
    if (satirSay[y] < enSatir * 0.3) continue;
    let sol = -1, sag = -1;
    for (let x = 0; x < w; x++) if (m[y * w + x]) { if (sol < 0) sol = x; sag = x; }
    satir.push([y, sol, sag]);
  }
  for (let x = 0; x < w; x++) {
    if (sutunSay[x] < enSutun * 0.3) continue;
    let ust = -1, alt = -1;
    for (let y = 0; y < h; y++) if (m[y * w + x]) { if (ust < 0) ust = y; alt = y; }
    sutun.push([x, ust, alt]);
  }
  if (satir.length < 4 || sutun.length < 4) return null;
  const sol = dogruUydur(satir.map((r) => r[0]), satir.map((r) => r[1]));      // x = a·y + b
  const sag = dogruUydur(satir.map((r) => r[0]), satir.map((r) => r[2] + 1));
  const ust = dogruUydur(sutun.map((c) => c[0]), sutun.map((c) => c[1]));      // y = a·x + b
  const alt = dogruUydur(sutun.map((c) => c[0]), sutun.map((c) => c[2] + 1));
  // x = aD·y + bD ile y = aY·x + bY'nin kesişimi.
  const kes = (D, Y) => {
    const x = (D.a * Y.b + D.b) / (1 - D.a * Y.a);
    return [x, Y.a * x + Y.b];
  };
  return [kes(sol, ust), kes(sag, ust), kes(sag, alt), kes(sol, alt)];
}

// ------------------------------------------------------------ perspektif

/** 4 nokta eşlemesinden izdüşüm matrisi (3×3, h33 = 1): hedef → kaynak. */
export function izdusum(hedef, kaynak) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = hedef[i], [x, y] = kaynak[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); B.push(y);
  }
  // Gauss eleme, kısmi pivotlama.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  return [...B.map((b, i) => b / A[i][i]), 1];
}

/** Kaynak RGBA'dan dörtgeni gw×gh dikdörtgene açar (çift doğrusal). */
export function dortgenAc(rgba, w, h, dortgen, gw, gh) {
  const H = izdusum([[0, 0], [gw, 0], [gw, gh], [0, gh]], dortgen);
  const out = new Uint8ClampedArray(gw * gh * 4);
  for (let v = 0; v < gh; v++) {
    for (let u = 0; u < gw; u++) {
      const uu = u + 0.5, vv = v + 0.5;
      const z = H[6] * uu + H[7] * vv + 1;
      const x = Math.min(w - 1, Math.max(0, (H[0] * uu + H[1] * vv + H[2]) / z - 0.5));
      const y = Math.min(h - 1, Math.max(0, (H[3] * uu + H[4] * vv + H[5]) / z - 0.5));
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = x - x0, fy = y - y0;
      const o = (v * gw + u) * 4;
      for (let c = 0; c < 4; c++) {
        out[o + c] =
          (rgba[(y0 * w + x0) * 4 + c] * (1 - fx) + rgba[(y0 * w + x1) * 4 + c] * fx) * (1 - fy) +
          (rgba[(y1 * w + x0) * 4 + c] * (1 - fx) + rgba[(y1 * w + x1) * 4 + c] * fx) * fy;
      }
    }
  }
  return { data: out, width: gw, height: gh };
}

// ------------------------------------------------------------ lamel adımı

/**
 * Lamel adımı (piksel): çizgilere dik yönde bant geçiren sinyalin öz
 * ilişkisinde ilk belirgin tepe. Bulunamazsa 0.
 */
export function seritAdimi(g, w, h, yon = 'vertical') {
  const yatay = yon === 'vertical';
  const a = kutu(g, w, h, 1, yatay), b = kutu(g, w, h, 6, yatay);
  const s = new Float32Array(w * h);
  for (let i = 0; i < s.length; i++) s[i] = a[i] - b[i];
  const boy = yatay ? w : h, adet = yatay ? h : w;
  const enCok = Math.min(60, Math.floor(boy / 4));
  const ak = new Float64Array(enCok + 1);
  for (let j = 0; j < adet; j++) {
    for (let lag = 0; lag <= enCok; lag++) {
      let t = 0;
      for (let i = 0; i + lag < boy; i++) {
        t += yatay ? s[j * w + i] * s[j * w + i + lag] : s[i * w + j] * s[(i + lag) * w + j];
      }
      ak[lag] += t;
    }
  }
  if (ak[0] <= 0) return 0;
  for (let lag = 1; lag <= enCok; lag++) ak[lag] /= ak[0];
  // İlk çukurdan sonraki ilk belirgin tepe.
  let lag = 1;
  while (lag < enCok && ak[lag + 1] < ak[lag]) lag++;
  for (let l = Math.max(2, lag); l < enCok; l++) {
    if (ak[l] > ak[l - 1] && ak[l] >= ak[l + 1] && ak[l] > 0.1) return l;
  }
  return 0;
}

// ------------------------------------------------------------ ana işlem

/**
 * Görselde lamel paneli var mı? Varsa paneli düzeltilmiş (dikdörtgen)
 * olarak döndürür, yoksa null.
 *
 * Dönüş: { img: {data,width,height}, dortgen (kaynak px), yon, adim (düzeltilmiş
 * görselde px), lamel (yaklaşık lamel sayısı), kaplama, maske (analiz ölçüsünde) }.
 */
export function panelFotoBul(img, { enKucukKaplama = 0.12 } = {}) {
  const { g, w, h, k } = griKucult(img.data, img.width, img.height);
  const { maske: ham, yon } = seritHaritasi(g, w, h);
  const kapali = kapa(ham, w, h, Math.max(3, Math.round(Math.max(w, h) / 80)));
  const { maske, alan } = enBuyukBilesen(kapali, w, h);
  const kaplama = alan / (w * h);
  const sonuc = { yon, kaplama, maske, mw: w, mh: h, img: null };
  if (kaplama < enKucukKaplama) return { ...sonuc, neden: 'kaplama' };
  const d = dortgenBul(maske, w, h);
  if (!d) return { ...sonuc, neden: 'dortgen' };
  const dortgen = d.map(([x, y]) => [
    Math.min(img.width, Math.max(0, x * k)), Math.min(img.height, Math.max(0, y * k)),
  ]);
  const uz = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const en = (uz(dortgen[0], dortgen[1]) + uz(dortgen[3], dortgen[2])) / 2;
  const boy = (uz(dortgen[0], dortgen[3]) + uz(dortgen[1], dortgen[2])) / 2;
  if (en < 32 || boy < 32) return { ...sonuc, dortgen, neden: 'kucuk' };
  const gw = Math.round(en), gh = Math.round(boy);
  const duz = dortgenAc(img.data, img.width, img.height, dortgen, gw, gh);
  const dg = griKucult(duz.data, gw, gh);
  const adimAnaliz = seritAdimi(dg.g, dg.w, dg.h, yon);
  // Gerçek lamel paneli: belirgin bir tekrar adımı olmalı. Çizgili gömlek ya
  // da ahşap damarı çoğu zaman tek yönlü ama düzenli tekrar etmez.
  if (!adimAnaliz) return { ...sonuc, dortgen, neden: 'adim' };
  const adim = adimAnaliz * dg.k;
  return {
    ...sonuc, img: duz, dortgen, adim,
    lamel: Math.round((yon === 'vertical' ? gw : gh) / adim),
  };
}

/**
 * Panel fotoğrafının derinliğini (zemin ayırmasız yapay zekâ çıktısı, 0..1)
 * panele çevirir: arka düzlem çıkarılır, aralık yeniden yayılır, lamel izi
 * silinir. `adimHucre`: lamel adımı ızgara hücresi cinsinden.
 */
export function panelDerinligi(data, w, h, { adimHucre = 0, yon = 'vertical' } = {}) {
  // Arka düzlem: en küçük kareler düzlemi, sonra yalnız düzlemin ARKASINDA
  // kalan yarıyla yeniden — öne çıkan yüz düzlemi kendine çekmesin.
  let secili = null;
  let p = [0, 0, 0];
  const artik = new Float32Array(w * h);
  for (let tur = 0; tur < 5; tur++) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], V = [0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (secili && !secili[i]) continue;
        const r = [1, x / w, y / h];
        for (let a = 0; a < 3; a++) { V[a] += r[a] * data[i]; for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]; }
      }
    }
    p = coz3(M, V) || p;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      artik[y * w + x] = data[y * w + x] - (p[0] + p[1] * x / w + p[2] * y / h);
    }
    const sinir = yuzdelik(artik, 0.5);
    secili = new Uint8Array(w * h);
    for (let i = 0; i < artik.length; i++) secili[i] = artik[i] <= sinir ? 1 : 0;
  }
  const out = Float32Array.from(artik);
  const lo = yuzdelik(out, 0.02), hi = yuzdelik(out, 0.998);
  const ara = hi - lo || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, (out[i] - lo) / ara));
  // Lamel izi: lamele dik yönde bir adım genişliğinde ortalama.
  const r = Math.floor(adimHucre / 2);
  return r >= 1 ? kutu(out, w, h, r, yon === 'vertical') : out;
}

function coz3(M, V) {
  const A = M.map((r, i) => [...r, V[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}
