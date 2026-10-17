// KAYITLI AYARLAR — telefonda dosya taşımadan ayar saklamak için.
//
// iPhone'da "Ayarları yükle" ile JSON seçmek zahmetli (dosya Dosyalar'a
// kaydedilmeli, seçici bazen göstermiyor). Kullanıcının beğendiği ayar
// burada adıyla saklanır ve tek dokunuşla geri gelir. Saklama yalnız bu
// cihazda (localStorage); dosyaya aktarma için "Ayarları kaydet (JSON)"
// duruyor.
//
// HAZIR listesi programla gelir. Görsel dahil değildir: ayar uygulanır,
// logo kullanıcının kendi dosyasından yüklenir.

const ANAHTAR = 'cnc-panel-ayarlarim';

export const HAZIR = [
  {
    ad: 'ŞAPCI — lamel 200×81 cm, 18 mm, yazı dalgaya yedirilmiş',
    not: 'Önce sadece yazı olan ŞAPCI logosunu "Görsel seç" ile yükleyin.',
    data: {
      "mode": "ribs",
      "invert": true,
      "depthMode": "luma",
      "patternSeed": 0.42,
      "fields": {
        "p-brushSize": "120",
        "p-brushAmount": "0.12",
        "p-brushHardness": "0.3",
        "p-faceDetail": "1",
        "p-pattern": "akis",
        "p-patMix": "0.6",
        "p-subjectMode": "yedir",
        "p-subjectPad": "0.1",
        "p-patScale": "0.16",
        "p-patAngle": "0.1",
        "p-patDetail": "0.5",
        "p-seedText": "",
        "p-patternCode": "AKIS.16.10.50.6Y222O",
        "p-viewAxis": "auto",
        "p-autoBlur": true,
        "p-blur": "8",
        "p-sharpen": "0.6",
        "p-contrast": "0",
        "p-brightness": "0",
        "p-gamma": "1",
        "p-facetCells": "0",
        "p-facetFlat": false,
        "p-inflate": "0",
        "p-roundness": "0.7",
        "p-reliefDetail": "0.25",
        "p-panelW": "2000",
        "p-panelH": "815",
        "p-lockAspect": true,
        "p-thickness": "18",
        "p-gap": "4",
        "p-maxDepth": "100",
        "p-baseDepth": "40",
        "p-orientation": "vertical",
        "p-joint": "gecme",
        "p-railCount": "2",
        "p-railHeight": "60",
        "p-stripWidth": "80",
        "p-fit": "0.2",
        "p-dogbone": false,
        "p-filletRadius": "0",
        "p-sculptSize": "1200",
        "p-sliceSizeAxis": "max",
        "p-sliceUpAxis": "z",
        "p-sliceAxis": "z",
        "p-sliceGap": "0",
        "p-sliceMinArea": "300",
        "p-sliceReliefDepth": "0",
        "p-sliceBoard": true,
        "p-support": "oto",
        "p-sliceRailCount": "0",
        "p-railEngage": "0",
        "p-rodShape": "yuvarlak",
        "p-rodDiameter": "10",
        "p-rodCount": "0",
        "p-targetSize": "600",
        "p-targetFaces": "300",
        "p-targetParts": "0",
        "p-joinMethod": "percin",
        "p-maxLeafSize": "0",
        "p-unfold": true,
        "p-remesh": "oto",
        "p-reliefCells": "14",
        "p-reliefDepth": "60",
        "p-upAxis": "z",
        "p-sizeAxis": "max",
        "p-angleTol": "1",
        "p-facetMinArea": "40",
        "p-thicknessComp": true,
        "p-tabWidth": "15",
        "p-rivetDiameter": "4",
        "p-rivetPitch": "80",
        "p-reliefHoles": true,
        "p-maxFacetsPerPatch": "24",
        "p-bridgeMode": "oto",
        "p-bridgeWidth": "25",
        "p-autoLimit": "250",
        "p-dashCut": "30",
        "p-dashGap": "8",
        "p-layerCount": "8",
        "p-minArea": "400",
        "p-withBase": true,
        "p-guideEngrave": true,
        "p-sheetPreset": "2100x2800",
        "p-sheetW": "2100",
        "p-sheetH": "2800",
        "p-margin": "10",
        "p-spacing": "6",
        "p-toolDiameter": "6",
        "p-offset": "0",
        "p-feedRate": "3000",
        "p-allowRotate": true,
        "p-autoOrient": true
      }
    },
  },
];

export function ayarlarimOku() {
  try {
    const v = JSON.parse(localStorage.getItem(ANAHTAR) || '[]');
    return Array.isArray(v) ? v.filter((a) => a && a.ad && a.data) : [];
  } catch { return []; }
}

export function ayarKaydet(ad, data) {
  const liste = ayarlarimOku().filter((a) => a.ad !== ad);
  liste.push({ ad, data, tarih: new Date().toISOString().slice(0, 10) });
  try { localStorage.setItem(ANAHTAR, JSON.stringify(liste)); return true; } catch { return false; }
}

export function ayarSil(ad) {
  const liste = ayarlarimOku().filter((a) => a.ad !== ad);
  try { localStorage.setItem(ANAHTAR, JSON.stringify(liste)); return true; } catch { return false; }
}
