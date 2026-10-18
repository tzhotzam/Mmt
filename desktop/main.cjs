// MASAÜSTÜ (Windows) KABUĞU — aynı web uygulamasını Electron penceresinde açar.
//
// Web sürümünden üç farkı var, üçü de burada:
//
//  1. ÇOK ÇEKİRDEK. Yapay zekâ derinliği (depth.js) sayfa "crossOriginIsolated"
//     ise tüm çekirdekleri kullanır. Bunun için sunucunun COOP/COEP başlıkları
//     vermesi gerekir; GitHub Pages vermiyor, burada dosyaları biz sunduğumuz
//     için veriyoruz. Telefonda 10-30 sn süren derinlik masaüstünde kısalır.
//  2. KAYDETME. DXF/SVG indirildiğinde "Farklı kaydet" penceresi açılır, son
//     seçilen klasör hatırlanır.
//  3. DOSYA AÇMA. STL/OBJ ya da görsel, Explorer'da çift tıklanınca (veya
//     Dosya → Aç…) doğrudan programa yüklenir.
//
// Dosyalar file:// yerine kendi "app://" adresimizden sunulur: file:// altında
// ES modülleri, fetch ve WASM çalışmaz.

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..');
const ADRES = 'app://cnc/index.html';

const TURLER = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Programın açabildiği dosyalar; uzantı → File nesnesinin türü. */
const ACILIR = {
  '.stl': 'model/stl',
  '.obj': 'model/obj',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

// İkinci kez çift tıklanan dosya yeni pencere açmasın, açık olana gitsin.
if (!app.requestSingleInstanceLock()) app.quit();

let pencere = null;
let sayfaHazir = false;
const bekleyen = [];          // sayfa yüklenmeden gelen dosyalar
let sonKlasor = null;         // "Farklı kaydet"te en son seçilen klasör

function dosyaYollari(argv) {
  return argv.slice(1).filter((a) => ACILIR[path.extname(a).toLowerCase()] && fs.existsSync(a));
}

// Açılan dosyanın içeriği IPC ile gönderilmez: Electron'un mesaj sınırı
// (~128 MB) aşılınca sayfa çöküyordu (188 MB'lık Blender OBJ'si). Sayfaya
// yalnız bir adres gider, içeriği oradan app:// ile okur.
const acikDosyalar = new Map();   // numara → disk yolu
let acikSayac = 0;

function dosyaGonder(yol) {
  if (!sayfaHazir) { bekleyen.push(yol); return; }
  const no = String(++acikSayac);
  acikDosyalar.set(no, yol);
  pencere.webContents.send('dosya-ac', {
    ad: path.basename(yol),
    tur: ACILIR[path.extname(yol).toLowerCase()],
    adres: `app://cnc/__acik/${no}`,
  });
}

async function dosyaSec() {
  const r = await dialog.showOpenDialog(pencere, {
    title: 'Model veya görsel aç',
    properties: ['openFile'],
    filters: [
      { name: '3B model ve görsel', extensions: Object.keys(ACILIR).map((u) => u.slice(1)) },
      { name: 'Tüm dosyalar', extensions: ['*'] },
    ],
  });
  if (!r.canceled && r.filePaths[0]) dosyaGonder(r.filePaths[0]);
}

function menuKur() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Dosya',
      submenu: [
        { label: 'Aç…', accelerator: 'CmdOrCtrl+O', click: dosyaSec },
        { type: 'separator' },
        { label: 'Çıkış', role: 'quit' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Yenile', role: 'reload' },
        { label: 'Yakınlaştır', role: 'zoomIn' },
        { label: 'Uzaklaştır', role: 'zoomOut' },
        { label: 'Gerçek boyut', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Tam ekran', role: 'togglefullscreen' },
        { label: 'Geliştirici araçları', role: 'toggleDevTools' },
      ],
    },
  ]));
}

function pencereAc() {
  pencere = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1216',
    icon: path.join(KOK, 'assets', 'icon-512.png'),
    title: 'Parametrik CNC Duvar Paneli',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Sayfadaki bağlantılar (lisans, Meshy hesabı …) varsayılan tarayıcıda açılır.
  pencere.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  pencere.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  // Sayfa çökerse pencere boş kalıp program kapanmış gibi görünüyordu.
  pencere.webContents.on('render-process-gone', (_e, d) => {
    console.error('Sayfa çöktü:', d.reason, d.exitCode);
    if (d.reason === 'clean-exit') return;
    dialog.showMessageBoxSync(pencere, {
      type: 'error',
      title: 'Program yeniden başlatılıyor',
      message: 'Sayfa beklenmedik şekilde kapandı.',
      detail: d.reason === 'oom'
        ? 'Bellek yetmedi. Model çok büyük olabilir; daha az üçgenli bir dosya deneyin.'
        : `Neden: ${d.reason} (${d.exitCode})`,
    });
    pencere.webContents.reload();
  });
  // Yenilemede sayfa dinleyicisini baştan kurar; o ana kadar gelen dosya bekler.
  pencere.webContents.on('did-start-loading', () => { sayfaHazir = false; });

  pencere.webContents.session.on('will-download', (_e, item) => {
    const klasor = sonKlasor || app.getPath('documents');
    item.setSaveDialogOptions({ defaultPath: path.join(klasor, item.getFilename()) });
    item.once('done', (_e2, durum) => {
      if (durum === 'completed') sonKlasor = path.dirname(item.getSavePath());
    });
  });

  pencere.loadURL(ADRES);
}

app.on('second-instance', (_e, argv) => {
  if (!pencere) return;
  if (pencere.isMinimized()) pencere.restore();
  pencere.focus();
  dosyaYollari(argv).forEach(dosyaGonder);
});

// Meshy'nin dosya sunucusu CORS başlığı vermiyor; sayfanın fetch'i model ve
// görseli indiremiyor. Ana süreçte CORS yok, indirmeyi burası yapar.
ipcMain.handle('indir', async (_e, url) => {
  if (new URL(url).protocol !== 'https:') throw new Error('Yalnız https indirilir.');
  const res = await net.fetch(url);
  return {
    status: res.status,
    tur: res.headers.get('content-type') || '',
    veri: new Uint8Array(await res.arrayBuffer()),
  };
});

ipcMain.on('sayfa-hazir', () => {
  sayfaHazir = true;
  bekleyen.splice(0).forEach(dosyaGonder);
});

app.whenReady().then(async () => {
  // Eski sürümün önbellekte kalmış dosyaları (no-store'dan önce yazılmış olanlar).
  await session.defaultSession.clearCache();
  protocol.handle('app', async (istek) => {
    const acik = /^\/__acik\/(\d+)$/.exec(new URL(istek.url).pathname);
    if (acik) {
      // Bir kez okunur; sayfa okuyunca kayıt silinir.
      const disk = acikDosyalar.get(acik[1]);
      acikDosyalar.delete(acik[1]);
      if (!disk) return new Response('', { status: 404 });
      try {
        return new Response(await fs.promises.readFile(disk), {
          headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
        });
      } catch (e) {
        dialog.showErrorBox('Dosya açılamadı', `${disk}\n${e.message}`);
        return new Response('', { status: 404 });
      }
    }
    const yol = path.normalize(path.join(KOK, decodeURIComponent(new URL(istek.url).pathname)));
    // Program klasörünün dışına çıkan istek (../..) sunulmaz.
    if (yol !== KOK && !yol.startsWith(KOK + path.sep)) return new Response('', { status: 403 });
    try {
      const veri = await fs.promises.readFile(yol);
      return new Response(veri, {
        headers: {
          'Content-Type': TURLER[path.extname(yol).toLowerCase()] || 'application/octet-stream',
          // Dosyalar zaten diskte; önbellek yalnız zarar verir: güncellemeden
          // sonra yeni index.html eski main.js ile açılıyordu.
          'Cache-Control': 'no-store',
          'Cross-Origin-Opener-Policy': 'same-origin',
          // require-corp yerine credentialless: Meshy'den inen model ve
          // önizleme görselleri CORP başlığı taşımadan da yüklenebilsin.
          'Cross-Origin-Embedder-Policy': 'credentialless',
        },
      });
    } catch {
      return new Response('', { status: 404 });
    }
  });

  menuKur();
  pencereAc();
  dosyaYollari(process.argv).forEach(dosyaGonder);
});

app.on('window-all-closed', () => app.quit());
