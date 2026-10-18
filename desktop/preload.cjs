// Sayfaya iki şey açılır: masaüstünden gelen dosyayı dinlemek ve Meshy
// dosyasını ana sürece indirtmek.
// Sayfa Node'a ya da dosya sistemine erişemez (contextIsolation + sandbox).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('masaustu', {
  /** `cb({ ad, tur, adres })` — içerik `adres`ten (app://) okunur. Kayıt olunca bekleyen dosyalar gelir. */
  dosyaAcilinca(cb) {
    ipcRenderer.on('dosya-ac', (_e, d) => cb(d));
    ipcRenderer.send('sayfa-hazir');
  },
  /**
   * Meshy dosyasını ana süreç indirir (CORS engeli yok). `ad` verilirse bir
   * kopyası İndirilenler\Meshy'ye kaydedilir. → { status, tur, veri }
   */
  indir(url, ad) {
    return ipcRenderer.invoke('indir', url, ad);
  },
});
