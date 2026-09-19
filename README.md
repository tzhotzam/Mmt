# Parametrik CNC Duvar Paneli

Bir görselden (veya STL modelden) duvarda **üç boyutlu görünen asimetrik panel**
tasarlar ve CNC için hazır **DXF / SVG** çıkarır.

Tamamı tarayıcıda çalışır: sunucu yok, kurulum yok, yüklediğiniz görsel
cihazınızdan hiç çıkmaz. iPhone/iPad dâhil her tarayıcıda açılır.

---

## Ne yapıyor?

İki farklı üretim yöntemi var:

### 1. Lamel / Dalga modu
Panel, dik (veya yatay) duran ince lamellerden oluşur. Her lamelin ön kenarı
görselin o sütundaki parlaklığına göre kesilir. Lameller aralıklı dizilince
duvarda dalgalı, derinlikli bir yüzey oluşur — piyasada "parametrik dalga
panel" diye satılan iş.

- Lameller arka taraftaki **kızaklara yarım geçme** ile oturur; tutkalsız bile
  kendi kendini taşır.
- Her parça gravürle numaralanır (L1, L2, … / KIZAK 1).

### 2. Katman / Rölyef modu
Görsel eş-yükselti eğrilerine bölünür, her seviye ayrı bir katman olarak
kesilir ve katmanlar üst üste yapıştırılır. Topografik harita görünümlü,
kademeli bir kabartma çıkar.

- Her katmanın üstüne, bir sonraki katmanın oturacağı sınır **gravürle**
  işaretlenir — hizalama derdi kalmaz.
- Çok küçük adacıklar otomatik elenir, takım çapına göre uyarı verilir.

---

## Nasıl kullanılır

1. **Kaynak seç** — Görsel yükleyin, telefonla fotoğraf çekin, STL atın veya
   "Örnek desen"e dokunun.
2. **Kabartma yönünü kontrol edin** — Görsel yüklendiğinde otomatik seçilir:
   zemin konudan açıksa (beyaz fonda logo, silüet, ürün fotoğrafı) "koyu
   alanlar", aksi hâlde "açık alanlar" öne çıkar. Konu panele gömülüyorsa
   diğer seçeneğe dokunun.
3. **Görseli ayarlayın** — Yumuşatma gürültüyü siler (fotoğraflarda 3–6 iyi
   sonuç verir), kontrast derinlik farkını açar.
4. **Ölçüleri girin** — Panel eni/boyu, malzeme kalınlığı (12 mm, 18 mm…),
   lameller arası boşluk, kabartma derinliği.
5. **Levhayı tanımlayın** — 2440×1220 kontrplak, takım çapı, parça arası pay.
6. **İndirin** — DXF, SVG, kesim listesi (CSV) ve montaj kılavuzu (TXT).

Önizlemede dört sekme var: **3B** (duvardaki hâli, parmakla döndürülür),
**Plan** (önden görünüm), **Levha** (kesim yerleşimi — dokunarak levhalar
arasında geçilir), **Kaynak** (işlenmiş yükseklik haritası).

### Telefona uygulama gibi kurmak
Safari'de sayfayı açın → Paylaş → **Ana Ekrana Ekle**. Tam ekran açılır ve
çevrimdışı çalışır (3B önizleme hariç — o three.js için internet ister).

---

## CNC notları

- DXF dosyaları **R12 ASCII**, birim **milimetre**. En eski CAM yazılımları
  bile sorunsuz okur.
- Katmanlar:
  - `KESIM` — malzemeyi tam kesin (kalınlık + ~1 mm dalma).
  - `GRAVUR` — 1–2 mm yüzeysel dalma: parça numaraları ve hizalama çizgileri.
  - `LEVHA` — sadece referans çerçevesi, işlemeyin.
- **Kerf telafisi**: Yazılım varsayılan olarak *nominal* konturu verir. CAM
  tarafında takım telafisi (dışa/içe ofset) uygularsanız "Ofset" alanını 0
  bırakın. CAM'iniz telafi yapmıyorsa "Ofset" alanına takım yarıçapını girin.
- **Geçme boşluğu**: Kontrplakta 0,15–0,25 mm iyi sonuç verir. MDF'de 0,1 mm
  yeterli. Nominal kalınlık ile gerçek kalınlık çoğu zaman tutmaz —
  kanalları açmadan önce levhanızı kumpasla ölçün.
- Parçalar levhada ayrı ayrı yerleştirilir, ortak kenar kullanılmaz; bu yüzden
  lameller arası boşluğun takım çapından küçük olması sorun değildir.

---

## Yayınlama

Depo herhangi bir derleme adımı istemez — düz statik dosyalar.

**GitHub Pages:** depo ayarlarında *Settings → Pages → Source: GitHub Actions*
seçin. `.github/workflows/pages.yml` bu daldaki her push'ta siteyi yayınlar.
Adres `https://<kullanıcı>.github.io/<depo>/` olur.

**Yerelde çalıştırmak** (ES modülleri `file://` üzerinden çalışmaz):

```bash
python3 -m http.server 8000
# tarayıcıda: http://localhost:8000
```

---

## Testler

```bash
node tests/pipeline.test.mjs
```

Geometri, marching squares, her iki üretim modu, levha yerleşimi (çakışma ve
taşma kontrolü dâhil), DXF/SVG yapısı ve STL okuma test edilir. Tarayıcı
gerekmez.

---

## Mimari

```
index.html            arayüz
app.css               stiller (mobil öncelikli, karanlık tema)
js/
  main.js             akış: girdi → harita → parça → önizleme → dışa aktarma
  heightmap.js        görsel → 0..1 yükseklik haritası, filtreler
  stl.js              STL okuma + tepeden z-buffer taraması
  marchingsquares.js  eş-yükselti halkaları (eyer çözümü dâhil)
  geom.js             alan, yön, sadeleştirme, ofset, delik sınıflandırma
  modes/ribs.js       lamel + kızak üretimi
  modes/contour.js    katman üretimi
  nest.js             levha yerleşimi
  cutlist.js          kesim listesi, malzeme özeti, montaj kılavuzu
  export/dxf.js       R12 DXF yazıcı
  export/svg.js       mm ölçekli SVG yazıcı
  preview2d.js        plan / levha / kaynak önizlemeleri (canvas)
  preview3d.js        three.js ile 3B önizleme
tests/                tarayıcısız doğrulama
```

Üretim modülleri tarayıcıya bağımlı değildir; Node'dan doğrudan çağrılabilir.

Sıradaki geliştirmeler için [docs/ROADMAP.md](docs/ROADMAP.md).
