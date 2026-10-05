// YAPAY ZEKÂ İLE FOTOĞRAFTAN DERİNLİK.
//
// Parlaklık derinlik değildir: yüz fotoğrafında saç koyu, gölgeler koyu,
// ışık alan yanak parlak çıkar; lamel paneli bundan yüz değil leke kesiyordu.
// Burada tek bir fotoğraftan GÖRELİ derinliği tahmin eden bir sinir ağı
// kullanılır: Depth Anything V2 Small (Apache-2.0). Tarayıcıda, cihazda
// çalışır — fotoğraf hiçbir yere gönderilmez.
//
// Model depoda durur (models/), ağırlıkları 8 bit saklanmıştır: 99 MB'lık
// model 25,6 MB'a indi, çıktısı float sürümden ortalama %0,3 ayrışıyor.
// Çalıştırıcı onnxruntime-web (MIT), vendor/ort altında. İkisi de ilk
// kullanımda bir kez iner, servis çalışanı onları kalıcı önbellekte tutar.
//
// Ölçüm (taranmış insan başı, gerçek derinlik haritasıyla, ölçek+kaydırma
// uydurulmuş ortalama hata, derinlik aralığına oranla):
//   önden  — parlaklık %13,3   yapay zekâ %9,3
//   30° yan— parlaklık %16,3   yapay zekâ %8,6

// Yollar bu dosyaya göredir (js/ altında).
const MODEL_YOL = '../models/derinlik-v2-kucuk-w8.onnx';
export const MODEL_BOYUT = 25599660;
const ORT_URL = '../vendor/ort/ort.wasm.min.mjs';
const BOY = 518;                       // modelin sabit giriş ölçüsü
const ORT_MEAN = [0.485, 0.456, 0.406];
const ORT_STD = [0.229, 0.224, 0.225];

/**
 * RGBA görüntüyü modelin girişine çevirir: 518×518, kanal başına
 * normalize, [1, 3, 518, 518] sırası. Çift doğrusal örnekleme.
 */
export function onIsle(rgba, w, h) {
  const out = new Float32Array(3 * BOY * BOY);
  const plane = BOY * BOY;
  for (let y = 0; y < BOY; y++) {
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / BOY - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < BOY; x++) {
      const sx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / BOY - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const i00 = (y0 * w + x0) * 4, i01 = (y0 * w + x1) * 4;
      const i10 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const v = (rgba[i00 + c] * (1 - fx) + rgba[i01 + c] * fx) * (1 - fy) +
                  (rgba[i10 + c] * (1 - fx) + rgba[i11 + c] * fx) * fy;
        out[c * plane + y * BOY + x] = (v / 255 - ORT_MEAN[c]) / ORT_STD[c];
      }
    }
  }
  return out;
}

function yuzdelik(sirali, p) {
  return sirali[Math.min(sirali.length - 1, Math.max(0, Math.round(p * (sirali.length - 1))))];
}

/** Otsu eşiği (0..1 aralığında değerler için, 256 kutu). */
function otsu(data) {
  const hist = new Float64Array(256);
  for (const v of data) hist[Math.min(255, Math.max(0, Math.round(v * 255)))]++;
  const n = data.length;
  let toplam = 0;
  for (let i = 0; i < 256; i++) toplam += i * hist[i];
  // İki küme arasında boş bir aralık varsa o aralığın her eşiği aynı
  // ayrımı verir; ilkini almak eşiği zemin kümesinin hemen üstüne koyar ve
  // yumuşak geçiş zeminin tepesini konuya katar. Aralığın ortası alınır.
  let wB = 0, sumB = 0, enIyi = 0, alt = 0, ust = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (toplam - sumB) / wF;
    const ara = wB * wF * (mB - mF) ** 2;
    if (ara > enIyi * (1 + 1e-9)) { enIyi = ara; alt = ust = i; }
    else if (ara >= enIyi * (1 - 1e-9)) ust = i;
  }
  return (alt + ust + 1) / 2 / 255;
}

/**
 * Modelin 518×518 çıktısını (göreli ters derinlik: büyük = yakın) panel
 * ızgarasına çevirir: cols×rows, 0..1, yakın = 1.
 *
 * arkaPlan: true ise konu zeminden ayrılır (Otsu), zemin 0'a indirilir,
 * konu [taban, 1] aralığına yayılır. Portrede duvar/oda da bir derinlik
 * taşır; o kalırsa panelin yarısı anlamsız eğimle dolar, yüz sığlaşır.
 * Geçiş yumuşaktır, kenarda uçurum değil kısa bir rampa olur.
 */
export function sonIsle(cikti, cols, rows, opts = {}) {
  const { arkaPlan = true, taban = 0.18, gecis = 0.04, vurgu = 1.6 } = opts;
  const n = BOY * BOY;
  const sirali = Float32Array.from(cikti.subarray ? cikti.subarray(0, n) : cikti.slice(0, n)).sort();
  // Üst sınır kırpılmaz (yalnız tek tük aykırı piksel atılır): en yakın
  // %0,5'i kırpmak portrede tam BURUN UCU demekti — 1341 piksel 1'e
  // yapışıyor, burun düz kesilmiş gibi çıkıyordu.
  const lo = yuzdelik(sirali, 0.01), hi = yuzdelik(sirali, 0.9998);
  const ara = hi - lo || 1;
  const norm = new Float32Array(n);
  for (let i = 0; i < n; i++) norm[i] = Math.min(1, Math.max(0, (cikti[i] - lo) / ara));

  if (arkaPlan) {
    const t = otsu(norm);
    for (let i = 0; i < n; i++) {
      const v = norm[i];
      const m = Math.min(1, Math.max(0, (v - (t - gecis)) / (2 * gecis)));
      // Konu içinde vurgu eğrisi: yapay zekâ yüzü kafa yuvarlağı üstünde sığ
      // bir kabartma olarak verir (yanak 0,8, burun ucu 1,07); doğrusal
      // kalırsa yüz düz bir maske gibi durur. s^vurgu öndeki biçimleri
      // (burun, dudak, çene) açar, kafanın genel kabarıklığını sıkıştırır.
      const sKonu = Math.min(1, Math.max(0, (v - t) / (1 - t || 1)));
      const konu = taban + (1 - taban) * Math.pow(sKonu, vurgu);
      norm[i] = m * m * (3 - 2 * m) * konu;   // yumuşak eşik
    }
  }

  // 518×518 → cols×rows (alan ortalaması yerine çift doğrusal; ızgara zaten
  // modelden kaba, sonradan yumuşatma filtresi de uygulanıyor).
  const data = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const sy = Math.min(BOY - 1, Math.max(0, ((y + 0.5) * BOY) / rows - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(BOY - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < cols; x++) {
      const sx = Math.min(BOY - 1, Math.max(0, ((x + 0.5) * BOY) / cols - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(BOY - 1, x0 + 1), fx = sx - x0;
      data[y * cols + x] =
        (norm[y0 * BOY + x0] * (1 - fx) + norm[y0 * BOY + x1] * fx) * (1 - fy) +
        (norm[y1 * BOY + x0] * (1 - fx) + norm[y1 * BOY + x1] * fx) * fy;
    }
  }
  return { w: cols, h: rows, data };
}

// ---------------------------------------------------------- çalıştırıcı

let ortP = null;
let oturumP = null;

async function ortYukle() {
  if (!ortP) {
    ortP = import(ORT_URL).then((ort) => {
      ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
      // GitHub Pages çapraz köken yalıtımı vermez; iş parçacığı yoksa tek çekirdek.
      ort.env.wasm.numThreads = globalThis.crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      return ort;
    });
  }
  return ortP;
}

/** Modeli indirir (ilerleme bildirerek) ve oturumu kurar. Bir kez yapılır. */
async function oturumKur(onProgress) {
  if (oturumP) return oturumP;
  oturumP = (async () => {
    const ort = await ortYukle();
    const res = await fetch(new URL(MODEL_YOL, import.meta.url));
    if (!res.ok) throw new Error(`Derinlik modeli indirilemedi (${res.status}).`);
    const toplam = Number(res.headers.get('content-length')) || MODEL_BOYUT;
    let buf;
    if (res.body && onProgress) {
      const okuyucu = res.body.getReader();
      const parcalar = [];
      let gelen = 0;
      for (;;) {
        const { done, value } = await okuyucu.read();
        if (done) break;
        parcalar.push(value);
        gelen += value.length;
        onProgress({ asama: 'indirme', oran: Math.min(1, gelen / toplam) });
      }
      buf = new Uint8Array(gelen);
      let k = 0;
      for (const p of parcalar) { buf.set(p, k); k += p.length; }
    } else {
      buf = new Uint8Array(await res.arrayBuffer());
    }
    onProgress?.({ asama: 'kurulum', oran: 1 });
    return ort.InferenceSession.create(buf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  })();
  try {
    return await oturumP;
  } catch (e) {
    oturumP = null;   // bir dahaki denemede yeniden indir
    throw e;
  }
}

/**
 * Fotoğraftan derinlik ızgarası.
 * @param {ImageData} img
 * @param {number} cols, rows  çıktı ızgarası
 * @param {{onProgress?, arkaPlan?}} opts
 */
export async function derinlikTahmin(img, cols, rows, opts = {}) {
  const oturum = await oturumKur(opts.onProgress);
  const ort = await ortYukle();
  opts.onProgress?.({ asama: 'hesap', oran: 0 });
  // Ekran bir kare çizebilsin diye hesaptan önce bir tur bekle.
  await new Promise((r) => setTimeout(r, 30));
  const giris = new ort.Tensor('float32', onIsle(img.data, img.width, img.height), [1, 3, BOY, BOY]);
  const sonuc = await oturum.run({ [oturum.inputNames[0]]: giris });
  const cikti = sonuc[oturum.outputNames[0]].data;
  return sonIsle(cikti, cols, rows, { arkaPlan: opts.arkaPlan !== false });
}
