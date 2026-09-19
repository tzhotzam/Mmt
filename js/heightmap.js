// Görselden yükseklik haritası (heightmap) üretimi ve filtreler.
// Izgara: { w, h, data: Float32Array } — değerler 0..1 aralığında.

export function makeGrid(w, h, fill = 0) {
  return { w, h, data: new Float32Array(w * h).fill(fill) };
}

export function cloneGrid(g) {
  return { w: g.w, h: g.h, data: Float32Array.from(g.data) };
}

/**
 * ImageData benzeri bir nesneden ({width, height, data:RGBA}) ızgara üretir.
 * Hedef çözünürlüğe kutu-ortalama (box average) ile indirger — aliasing azalır.
 */
export function gridFromImageData(img, cols, rows) {
  const out = makeGrid(cols, rows);
  const { width: iw, height: ih, data } = img;
  for (let ry = 0; ry < rows; ry++) {
    const y0 = Math.floor((ry * ih) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * ih) / rows));
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.floor((rx * iw) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * iw) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * iw + x) * 4;
          const a = data[i + 3] / 255;
          // Şeffaf pikseller "boşluk" (0) sayılır.
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          sum += lum * a;
          n++;
        }
      }
      out.data[ry * cols + rx] = n ? sum / n : 0;
    }
  }
  return out;
}

export function normalize(grid) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of grid.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range < 1e-9) return grid;
  for (let i = 0; i < grid.data.length; i++) {
    grid.data[i] = (grid.data[i] - min) / range;
  }
  return grid;
}

function boxBlurPass(grid, radius) {
  const { w, h, data } = grid;
  const tmp = new Float32Array(w * h);
  const win = radius * 2 + 1;
  // Yatay
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let i = -radius; i <= radius; i++) acc += data[y * w + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win;
      acc -= data[y * w + clamp(x - radius, 0, w - 1)];
      acc += data[y * w + clamp(x + radius + 1, 0, w - 1)];
    }
  }
  // Dikey
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -radius; i <= radius; i++) acc += tmp[clamp(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      data[y * w + x] = acc / win;
      acc -= tmp[clamp(y - radius, 0, h - 1) * w + x];
      acc += tmp[clamp(y + radius + 1, 0, h - 1) * w + x];
    }
  }
  return grid;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Filtre zinciri. Hepsi isteğe bağlıdır.
 * @param {object} g ızgara (yerinde değiştirilmez)
 * @param {object} opts
 *  - invert:   boolean  (açık bölgeler mi çıkıntı yapsın, koyu bölgeler mi)
 *  - blur:     number   piksel yarıçapı (gürültüyü ve tarama izlerini siler)
 *  - brightness: -1..1
 *  - contrast: -1..1
 *  - gamma:    >0 (1 = değişiklik yok)
 *  - sharpen:  netlik miktarı (unsharp mask), 0 = kapalı
 *  - sharpenRadius: netlik yarıçapı (ızgara örneği)
 *  - posterize: 0 = kapalı, >1 ise o kadar kademeye yuvarlar
 *  - autoNormalize: boolean
 */
export function applyFilters(g, opts = {}) {
  const grid = cloneGrid(g);
  const {
    invert = false,
    blur = 0,
    brightness = 0,
    contrast = 0,
    gamma = 1,
    posterize = 0,
    autoNormalize = true,
    sharpen = 0,          // 0 = kapalı, 0.5-1.5 arası tipik
    sharpenRadius = 3,    // ızgara örneği cinsinden
  } = opts;

  if (blur > 0) {
    const r = Math.max(1, Math.round(blur));
    boxBlurPass(grid, r);
    boxBlurPass(grid, r); // iki geçiş ≈ gauss
  }

  const c = Math.tan(((clamp(contrast, -0.99, 0.99) + 1) * Math.PI) / 4); // kontrast katsayısı
  for (let i = 0; i < grid.data.length; i++) {
    let v = grid.data[i];
    v += brightness;
    v = (v - 0.5) * c + 0.5;
    v = clamp(v, 0, 1);
    if (gamma !== 1) v = Math.pow(v, 1 / gamma);
    if (invert) v = 1 - v;
    grid.data[i] = v;
  }

  // Netlik (unsharp mask): görselin kendi bulanık kopyasından farkı geri
  // eklenir. Düşük çözünürlüklü panelde yerel kontrastı yükseltip biçimleri
  // okunur kılar — yumuşatmanın zıttı değil, tamamlayıcısıdır.
  if (sharpen > 0 && sharpenRadius >= 1) {
    const blurred = cloneGrid(grid);
    const r = Math.max(1, Math.round(sharpenRadius));
    boxBlurPass(blurred, r);
    boxBlurPass(blurred, r);
    for (let i = 0; i < grid.data.length; i++) {
      grid.data[i] = clamp(grid.data[i] + sharpen * (grid.data[i] - blurred.data[i]), 0, 1);
    }
  }

  if (autoNormalize) normalize(grid);

  if (posterize > 1) {
    const n = Math.round(posterize);
    for (let i = 0; i < grid.data.length; i++) {
      grid.data[i] = Math.round(grid.data[i] * (n - 1)) / (n - 1);
    }
  }

  return grid;
}

/**
 * Kabartmanın hangi yöne çıkması gerektiğini tahmin eder.
 *
 * Görselin kenar şeridi ortasından belirgin şekilde açıksa, konu koyu bir
 * nesne ve zemin açıktır (logo, silüet, beyaz fonda ürün fotoğrafı). Bu
 * durumda ters çevrilmezse konu panele gömülür, zemin öne çıkar.
 *
 * @returns {boolean} true ise "koyu alanlar öne çıksın" seçilmeli
 */
export function suggestInvert(grid, borderFraction = 0.12, threshold = 0.05) {
  const { w, h, data } = grid;
  if (w < 8 || h < 8) return false;
  const bx = Math.max(1, Math.round(w * borderFraction));
  const by = Math.max(1, Math.round(h * borderFraction));

  let borderSum = 0, borderN = 0, centerSum = 0, centerN = 0;
  for (let y = 0; y < h; y++) {
    const inCenterBand = y >= h * 0.25 && y < h * 0.75;
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      if (x < bx || x >= w - bx || y < by || y >= h - by) {
        borderSum += v;
        borderN++;
      } else if (inCenterBand && x >= w * 0.25 && x < w * 0.75) {
        centerSum += v;
        centerN++;
      }
    }
  }
  if (!borderN || !centerN) return false;
  return borderSum / borderN > centerSum / centerN + threshold;
}

/** u,v ∈ [0,1] normalize koordinatlarda çift doğrusal örnekleme. */
export function sampleBilinear(grid, u, v) {
  const { w, h, data } = grid;
  const x = clamp(u, 0, 1) * (w - 1);
  const y = clamp(v, 0, 1) * (h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0, fy = y - y0;
  const a = data[y0 * w + x0], b = data[y0 * w + x1];
  const cc = data[y1 * w + x0], d = data[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
}

/** Bir dikey şerit boyunca ortalama alarak örnekleme (lamel profili için). */
export function sampleBandColumn(grid, u0, u1, v, samples = 3) {
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0.5 : i / (samples - 1);
    sum += sampleBilinear(grid, u0 + (u1 - u0) * t, v);
  }
  return sum / samples;
}
