// Sayfaya yalnızca tek bir şey açılır: masaüstünden gelen dosyayı dinlemek.
// Sayfa Node'a ya da dosya sistemine erişemez (contextIsolation + sandbox).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('masaustu', {
  /** `cb({ ad, tur, veri })` — veri: Uint8Array. Kayıt olunca bekleyen dosyalar gelir. */
  dosyaAcilinca(cb) {
    ipcRenderer.on('dosya-ac', (_e, d) => cb(d));
    ipcRenderer.send('sayfa-hazir');
  },
});
