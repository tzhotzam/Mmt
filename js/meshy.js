// MESHY — yazıdan ya da fotoğraftan tam 3B model (api.meshy.ai).
//
// Yapay zekâ derinliği (depth.js) fotoğraftan KABARTMA çıkarır: önü var,
// arkası düz. Dilim / Heykel ve Poligonal Kabuk serbest duran, her yanı olan
// bir model ister. Meshy bunu üretir; model bitince program onu doğrudan
// yükler.
//
// API anahtarı yalnızca kullanıcının cihazında (localStorage) durur, koda ve
// ayar dosyasına girmez: site herkese açık, anahtar kodda olsaydı herkes
// kullanıcının kredisini harcayabilirdi.
//
// CNC için yalnız BİÇİM gerekir: yazıdan üretimde yalnız "önizleme" görevi
// (dokusuz ağ) çalıştırılır, dokulama (refine) yapılmaz; fotoğraftan
// üretimde doku kapalıdır. İkisi de kredi tasarrufu.

const TABAN = 'https://api.meshy.ai';
const ANAHTAR = 'meshy-api-key';
const ARALIK = 5000;               // durum sorgulama aralığı (ms)
const ZAMAN_ASIMI = 15 * 60000;    // bir görev en çok 15 dk beklenir

export function anahtarOku() {
  try { return localStorage.getItem(ANAHTAR) || ''; } catch { return ''; }
}
export function anahtarYaz(k) {
  try {
    if (k) localStorage.setItem(ANAHTAR, k.trim());
    else localStorage.removeItem(ANAHTAR);
    return true;
  } catch { return false; }
}

class MeshyHatasi extends Error {}

async function istek(yol, { anahtar, method = 'GET', govde, fetchFn = fetch } = {}) {
  let res;
  try {
    res = await fetchFn(TABAN + yol, {
      method,
      headers: {
        Authorization: `Bearer ${anahtar}`,
        ...(govde ? { 'Content-Type': 'application/json' } : {}),
      },
      body: govde ? JSON.stringify(govde) : undefined,
    });
  } catch {
    // Ağ hatası ya da tarayıcının CORS engeli: ikisi de buraya düşer.
    throw new MeshyHatasi(
      'Meshy\'ye bağlanılamadı. İnternet bağlantısını kontrol edin. Bağlantı varsa ' +
      'tarayıcı Meshy\'ye doğrudan bağlanmaya izin vermiyor olabilir (CORS); o durumda ' +
      'modeli meshy.ai sitesinden OBJ olarak indirip "3B model" ile yükleyin.'
    );
  }
  let veri = null;
  try { veri = await res.json(); } catch { /* gövde JSON değil */ }
  if (!res.ok) {
    const mesaj = veri?.message || veri?.error || `HTTP ${res.status}`;
    if (res.status === 401) throw new MeshyHatasi('Meshy API anahtarı geçersiz. API Console\'dan anahtarı kontrol edin.');
    if (res.status === 402) throw new MeshyHatasi('Meshy krediniz yetersiz. Planınızı ya da kredinizi kontrol edin.');
    if (res.status === 429) throw new MeshyHatasi('Meshy çok fazla istek dedi — birkaç dakika sonra tekrar deneyin.');
    throw new MeshyHatasi(`Meshy hatası: ${mesaj}`);
  }
  return veri;
}

/**
 * Görevi başlatır, bitene dek sorgular, OBJ dosyasını indirir.
 * @returns {Promise<{buf: ArrayBuffer, ad: string, gorev: object}>}
 */
async function calistir(baslat, yolKalibi, { anahtar, onProgress, fetchFn = fetch, bekle = (ms) => new Promise((r) => setTimeout(r, ms)), sinyal } = {}) {
  if (!anahtar) throw new MeshyHatasi('Önce Meshy API anahtarını girin.');
  const ilk = await istek(baslat.yol, { anahtar, method: 'POST', govde: baslat.govde, fetchFn });
  const id = ilk?.result;
  if (!id) throw new MeshyHatasi('Meshy görev numarası vermedi.');
  onProgress?.({ asama: 'sirada', oran: 0, id });

  const t0 = Date.now();
  let gorev;
  for (;;) {
    if (sinyal?.iptal) throw new MeshyHatasi('İptal edildi.');
    await bekle(ARALIK);
    gorev = await istek(yolKalibi.replace('{id}', id), { anahtar, fetchFn });
    const durum = gorev?.status;
    onProgress?.({ asama: durum === 'PENDING' ? 'sirada' : 'uretim', oran: (gorev?.progress || 0) / 100, id });
    if (durum === 'SUCCEEDED') break;
    if (durum === 'FAILED' || durum === 'CANCELED' || durum === 'EXPIRED') {
      throw new MeshyHatasi(`Meshy görevi tamamlanamadı: ${gorev?.task_error?.message || durum}`);
    }
    if (Date.now() - t0 > ZAMAN_ASIMI) throw new MeshyHatasi('Meshy 15 dakikada bitiremedi; daha sonra meshy.ai\'den bakın.');
  }

  const url = gorev?.model_urls?.obj;
  if (!url) throw new MeshyHatasi('Meshy OBJ dosyası vermedi.');
  onProgress?.({ asama: 'indirme', oran: 1, id });
  let res;
  try {
    res = await fetchFn(url);
  } catch {
    throw new MeshyHatasi('Model hazır ama indirilemedi (tarayıcı engeli). meshy.ai\'den OBJ olarak indirip yükleyin.');
  }
  if (!res.ok) throw new MeshyHatasi(`Model indirilemedi (HTTP ${res.status}).`);
  return { buf: await res.arrayBuffer(), ad: `meshy_${id}.obj`, gorev };
}

/** Yazıdan 3B (yalnız önizleme: dokusuz ağ). */
export async function yazidanModel(metin, { sanat = 'realistic', ...o } = {}) {
  if (!metin?.trim()) throw new MeshyHatasi('Ne üretileceğini yazın.');
  return calistir({
    yol: '/openapi/v2/text-to-3d',
    govde: {
      mode: 'preview',
      prompt: metin.trim().slice(0, 600),
      art_style: sanat,
      should_remesh: true,
      topology: 'triangle',
      target_polycount: 60000,
    },
  }, '/openapi/v2/text-to-3d/{id}', o);
}

/** Fotoğraftan 3B (doku kapalı). `veriUrl`: data:image/...;base64,... */
export async function gorseldenModel(veriUrl, o = {}) {
  if (!veriUrl) throw new MeshyHatasi('Önce bir fotoğraf yükleyin.');
  return calistir({
    yol: '/openapi/v1/image-to-3d',
    govde: {
      image_url: veriUrl,
      should_texture: false,
      enable_pbr: false,
      should_remesh: true,
      topology: 'triangle',
      target_polycount: 60000,
    },
  }, '/openapi/v1/image-to-3d/{id}', o);
}

export { MeshyHatasi };
