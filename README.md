# Parametrik CNC Duvar Paneli

Bir görselden (veya STL modelden) duvarda **üç boyutlu görünen asimetrik panel**
tasarlar ve CNC için hazır **DXF / SVG** çıkarır.

Tamamı tarayıcıda çalışır: sunucu yok, kurulum yok, yüklediğiniz görsel
cihazınızdan hiç çıkmaz. iPhone/iPad dâhil her tarayıcıda açılır.

---

## Ne yapıyor?

Üç farklı üretim yöntemi var:

### 1. Lamel / Dalga modu
Panel, dik (veya yatay) duran ince lamellerden oluşur. Her lamelin ön kenarı
görselin o sütundaki parlaklığına göre kesilir. Lameller aralıklı dizilince
duvarda dalgalı, derinlikli bir yüzey oluşur — piyasada "parametrik dalga
panel" diye satılan iş.

- Lameller arka taraftaki **kızaklara yarım geçme** ile oturur; tutkalsız bile
  kendi kendini taşır.
- Kanal diplerine **köşe payı** açılır; freze ucunun bıraktığı et yüzünden
  geçmenin açık kalmasını engeller (aşağıda).
- Her parça gravürle numaralanır (L1, L2, … / KIZAK 1).

### 2. Katman / Rölyef modu
Görsel eş-yükselti eğrilerine bölünür, her seviye ayrı bir katman olarak
kesilir ve katmanlar üst üste yapıştırılır. Topografik harita görünümlü,
kademeli bir kabartma çıkar.

- Her katmanın üstüne, bir sonraki katmanın oturacağı sınır **gravürle**
  işaretlenir — hizalama derdi kalmaz.
- Çok küçük adacıklar otomatik elenir, takım çapına göre uyarı verilir.

### 3b. Dilim / Heykel modu (katmanlı heykel)
Kapalı bir 3B model paralel düzlemlerle kesilir; her kesit levhadan çıkar ve
parçalar bir **mile** dizilerek heykel kurulur. Piyasada "sliced sculpture",
"katmanlı heykel" diye geçen iş.

Lamel modundan farkı önemli: orada kesit tek bir yükseklik eğrisiydi (2,5B
kabartma, duvara asılır). Burada modelin **gerçek kesiti** alınır — oturan
bir figürün iki bacağı ayrı ayrı halka olarak çıkar, heykel serbest durur.

- Dilim ekseni seçilebilir: Z (yatay dilimler, üst üste), Y veya X (dikey
  dilimler). Aynı model, eksen değişince bambaşka görünür.
- Kesitte **delik** varsa (kolun altı, halka biçimli gövde) delik olarak
  kesilir, dolu geçilmez.
- **Mil yeri otomatik seçilir.** "Merkez" diye tek bir doğru nokta yoktur;
  oturan bir figürde kütle merkezi boşluğa düşebilir. Aday noktalar denenir
  ve en çok parçadan geçen seçilir. İki mil, parçaların mil etrafında
  dönmesini de engeller.
- Milin geçmediği parçalar (gövdeden kopuk adalar) **sessizce bırakılmaz**:
  sayılır, uyarı verilir, montaj kılavuzunda "bunları komşusuna yapıştır"
  diye yazar.
- Montaj kılavuzu gereken **mil boyunu** hesaplar (yığın + 80 mm bağlantı
  payı) ve boşluklu istifte ara pul gerektiğini söyler.

Ölçü örneği: 1,2 m boyunda bir figür, 18 mm malzeme, boşluksuz istif →
66 dilim. Parça sayısı hızla artar; kalınlığı artırmak ya da heykeli
küçültmek en etkili frendir.

### 3. Poligonal Kabuk modu (metal / kaynak)
Kapalı bir 3B modeli (STL) düz yüzeylerine ayırır. Her yüzey sacdan ayrı bir
parça olarak kesilir, parçalar kenarlarından **kaynakla** birleştirilir —
katlama yok, tırnak yok. Low-poly hayvan/figür heykellerinin yapım yöntemi.

**İki çıktı biçimi var:**

- **Açınım (önerilen)** — Komşu yüzeyler, düzleme serildiğinde üst üste
  binmeyecek öbekler ("yaprak") hâlinde tek parça kesilir. İç kenarlar
  kısmen kesilir, kalan **köprü**ler parçayı bir arada tutar; elle bükülür.
  Abkant gerekmez, açıyı büküm çizgisi tutar. Köprüleri kaynakla doldurup
  taşlayabilir ya da açık bırakabilirsiniz (dekoratif heykellerde yaygın).
  Üç köprü biçimi: **dağıtık** (çizgi boyunca çok sayıda kısa köprü, büküm
  ekseni sabit kalır), **tek** (ortada 2-3 cm'lik tek köprü — bükmesi kolay
  ama uzun kenarda kanatlar burulur) ve **otomatik** (kısa kenarda tek,
  uzunda dağıtık).
  Her büküm çizgisinin yanına kaç dereceye bükeceğiniz gravürlenir.
  *İkosahedron: 20 gevşek parça + 30 kaynak yerine → 1 yaprak + 19 büküm + 11 kaynak.*
- **Gevşek faset** — Her yüzey ayrı parça, tamamı kaynakla birleşir. Basit,
  ama montajda açıyı tutmak tamamen kaynakçıya kalır.

- Low-poly modellerde her görünen yüzey birden çok üçgene bölünmüştür;
  bunlar **geri birleştirilir**, böylece düz bir yüzeyin ortasından gereksiz
  kaynak çekilmez. (Küp = 12 üçgen → 6 kare parça.)
- Her parçaya kendi numarası, her kaynak dikişine ortak numara gravürlenir.
  Aynı numaralı iki kenarı karşı karşıya getirip puntalarsınız.
- **Kalınlık telafisi**: dış yüzey modellendiyse parçalar orta yüzey
  ölçüsüne çekilir — her kenar (t/2)·cot(θ/2) kadar. 100 mm dış ölçülü bir
  küp, 4 mm sacdan 96×96 plakalarla yapılır.
- Montaj kılavuzu her dikişin uzunluğunu, iç açısını ve dışbükey/içbükey
  olduğunu listeler.

---

## Nasıl kullanılır

1. **Kaynak seç** — Görsel yükleyin, telefonla fotoğraf çekin, 3B model
   (STL/OBJ) atın veya hazır desenlerden birini kullanın.

   **Hazır desenler** kodla üretilir, dosya olarak saklanmaz: Dalga, Su
   halkaları, Topografya, Kumul, Voronoi, Dağ silüeti, Moiré ve Akustik
   difüzör. Her birinin ölçek, açı ve yoğunluk ayarı var.

   **Dalga deseni tohumdan kurulur, sadece kaydırılmaz.** Katman sayısı, her
   katmanın biçimi (sinüs / üçgen / sırt / testere), açısı, frekansı, nasıl
   birleştikleri ve alan bükülmesi tohumdan türetilir — aynı ayarlarla bile
   her tohum başka bir desen verir.

   **Tohum** alanına isim, tarih, ne yazılırsa yazılsın ondan türetilir:
   aynı metin hep aynı deseni verir, bir harf değişse bile desen tamamen
   değişir. "Bu panel sizin isminizden üretildi" diyebilmek ve altı ay sonra
   aynı paneli yeniden üretebilmek için.

   **Desen kodu** (`DALGA.50.10.50.F2N1KO`) tüm ayarları tek satırda taşır.
   Kopyalayıp saklayın veya yapıştırıp aynı deseni geri getirin.

   Hazır desenler yalnızca Lamel ve Katman modlarında çalışır; Poligonal
   Kabuk kapalı bir 3B model ister ve o modda desen alanları kapanır. İnternetten hazır model
   indirip gömmek yerine bu yol seçildi: indirilebilir olmak ticari kullanım
   hakkı vermez (çoğu ücretsiz model CC-BY-NC lisanslıdır) ve üretilen
   desende lisans sorunu olmaz, dosya boyutu da sıfırdır.
2. **Kabartma yönünü kontrol edin** — Görsel yüklendiğinde otomatik seçilir:
   zemin konudan açıksa (beyaz fonda logo, silüet, ürün fotoğrafı) "koyu
   alanlar", aksi hâlde "açık alanlar" öne çıkar. Konu panele gömülüyorsa
   diğer seçeneğe dokunun.
3. **Görseli ayarlayın** — Yumuşatma (mm) gürültüyü siler, **Netlik** yerel
   kontrastı yükseltip biçimleri belirginleştirir, kontrast derinlik farkını
   açar.

   **Netlik hakkında bilinmesi gereken:** lamel modunda panelin yatay
   çözünürlüğü lamel sayısı kadardır. 900 mm panel + 18 mm malzeme + 6 mm
   boşluk = 37 lamel, yani *37 piksel genişliğinde bir ekran*. Kaç
   megapiksellik görsel yüklenirse yüklensin bu sınır değişmez. Daha net
   sonuç için sırasıyla: malzemeyi inceltin ve boşluğu daraltın (12+4 mm
   → 56 lamel), paneli büyütün, ince ayrıntının lamel BOYUNCA uzandığı bir
   yön seçin (o yönde çözünürlük çok daha yüksektir), yüksek kontrastlı bir
   görsel kullanın. Her iki yönde de ayrıntı gerekiyorsa Katman modu daha
   uygundur; orada çözünürlük her yönde eşittir. **Poligon yoğunluğu** yüzeyi
   düz üçgen fasetlere böler (low-poly görünüm); "Düz yüzeyler" her faseti
   tek yüksekliğe sabitleyip kademeli, papercraft benzeri bir yüzey verir.
4. **Ölçüleri girin** — Panel eni/boyu, malzeme kalınlığı (12 mm, 18 mm…),
   lameller arası boşluk, kabartma derinliği.
5. **Levhayı tanımlayın** — Hazır ölçülerden seçin (MDF 210×280, kontrplak
   244×122 …) veya özel ölçü girin. Program levhayı hem dik hem yatay deneyip
   az levha kullanan yerleşimi seçer. Takım çapı ve parça arası payı da burada.

   Levha ölçüsü panelin en büyük boyutunu sınırlar: 2440'lık kontrplakta
   2,6 m'lik lamel kesilemez, 210×280 MDF'de rahat sığar.
6. **İndirin** — DXF, SVG, kesim listesi (CSV) ve montaj kılavuzu (TXT).

Girdiğiniz ayarlar tarayıcıda saklanır; her açılışta yeniden girmeniz
gerekmez. "Ayarları sıfırla" varsayılanlara döndürür.

### Logolu panelde arka plan neden düz çıkar? (Desen payı)
Logo ya da ürün fotoğrafı düz bir zemin üzerinde gelir. Düz zemin = sabit
yükseklik = hiç kesilmemiş düz çıta. SAPCI logosunda **66 lamelin 17'si**
böyleydi: panel "lamel paneli" gibi değil, ortasında kabartma olan düz bir
levha gibi duruyordu.

**Desen payı** kaydırıcısı bunu çözer: hazır desen, görselin yerine geçmez,
*altına taşıyıcı dalga* olarak girer.

```
çıktı = görsel·(1−k) + desen·k
```

Zeminde görsel sabit olduğu için geriye desen kalır — panelin her yeri
dalgalanır. Konunun olduğu yerde görsel deseni yukarı iter, yani logo
dalganın üstünde kabartma olarak durur.

| desen payı | düz lamel | ortalama dalgalanma |
|---|---|---|
| 0 | 17 / 66 | 29,9 mm |
| 0,20 | 2 / 66 | 27,7 mm |
| **0,35** | **0 / 66** | 24,5 mm |
| 0,60 | 0 / 66 | 21,3 mm |

0,2–0,35 arası iyi sonuç verir: düz çıta kalmaz, logo hâlâ baskın. Payı
fazla açarsanız desen logonun önüne geçer.

Yumuşatma kararı karışıma değil **yüklenen içeriğe** göre verilir: fotoğrafta
gren vardır, altına desen eklenmesi bunu değiştirmez.

### Logo ve yazı lamel panelde çıkar mı?
Çıkar — **yeter ki panel yeterince büyük olsun.** Belirleyici olan kaynağın
türü değil, harf gövdesinin kaç lamel genişliğine düştüğüdür.

Lamel modunun yatayda çözünürlüğü lamel sayısıdır: 24 mm adımda 882 mm'lik
panel yatayda 37 "piksel" demektir. Aynı logo, aynı adım, farklı panel
genişliklerinde (üretilen planlara bakılarak):

| panel | adımdan ince değişim | sonuç |
|---|---|---|
| 882 mm | %40 | yazı parazite dönüyor |
| 1100 mm | %34 | "SAPCI" okunuyor, alt satır bulanık |
| 1300 mm | %31 | temiz |
| 1600 mm | %29 | alt satırdaki küçük punto da okunuyor |

Yani 882 mm'de olmayan iş, 1600 mm'de **18 mm lamelle bile** oluyor. Lamel
adımını küçültmek (12 mm lamel + 4 mm boşluk = 16 mm adım) aynı etkiyi daha
küçük panelde verir.

Yazılım bunu kendisi ölçer: sığmıyorsa uyarır ve **gereken panel genişliğini
söyler**. Sessizce kötü bir panel üretmez.

Yine de küçük ölçüde bir tabela gerekiyorsa **Katman / Rölyef** modu ya da
düz siluet kesimi daha temiz durur. Küçük punto hiçbir panel ölçüsünde
lamele sığmayabilir — kaynağı sadeleştirmek (alt satırı atmak) çoğu zaman
en iyi çözümdür.

Kaynak türü yalnızca **yumuşatmayı** etkiler: fotoğrafta gren vardır,
silinmesi gerekir; logo ve desende keskin kenar kasıtlıdır, dokunulmaz.

### Fotoğraflarda yumuşatma neden otomatik?
Panelin **lameller arası** çözünürlüğü lamel adımıdır (kalınlık + boşluk).
24 mm adımda 900 mm'lik panel yatayda yalnızca 37 "piksel" demektir. Lamel
**boyunca** ise çözünürlük 1,5 mm'dir. Haritada adımdan ince ayrıntı
bırakılırsa bu ayrıntı yatayda temsil edilemez ama dikeyde aynen kesilir:
komşu lameller birbirinden bağımsız zıplar, yüzey kadife/parazit gibi çıkar.
Fotoğraf greni ve JPEG dokusu tam olarak bu ölçektedir.

Bu yüzden lamel modunda fotoğraf yüklendiğinde yumuşatma **adım/3**, netlik
yarıçapı **adım/2** olarak kendiliğinden ayarlanır. Değer kaydırıcıda
görünür; "Otomatik yumuşatma"yı kapatıp elle de verebilirsiniz.

Kodla üretilen **desenlere uygulanmaz** — onlarda gren yoktur ve ince
ayrıntı kasıtlıdır.

Ölçüm (iki sentetik gürültülü fotoğraf; hakem = temiz görselin her lamelin
gerçek ayak izi üzerindeki ortalaması):

| ayar | biçim hatası | profil zıplaması |
|---|---|---|
| eski sürüm (320 ızgara) | 0,31 mm | 832 |
| 3 mm sabit | 0,41 mm | 2191 |
| **adım/3 (seçilen)** | **0,28 mm** | **929** |

### Fotoğrafta olmayan derinliği vermek
Düz bir fotoğrafta derinlik bilgisi yoktur — parlaklık, ışığın nereye
vurduğunu anlatır, neyin önde olduğunu değil. Bu yüzden fotoğraflar çoğu
zaman "çamurlu" kabartma verir. İki çözüm var:

- **Silüet şişirme** — Konu zeminden ayrılır ve her noktanın kenara uzaklığı
  yükseklik olarak kullanılır. Gövdenin ortası öne çıkar, kenarlara doğru
  iner; madalyon mantığı. Silüeti belirgin konularda (logo, hayvan, figür)
  çok iyi sonuç verir. *Yuvarlaklık* koni ile kubbe arasında geçiş yapar.
- **Derinlik çizimi** — "Çizim" sekmesinde parmakla boyarsınız: gövdenin
  ortasını yükseltir, kolu geri alırsınız. Fırça yükseltir, alçaltır veya
  yumuşatır; mavi öne çıkan, kırmızı geri giden alanı gösterir. Çizilen
  katman fotoğraftan gelen dokunun üstüne EKLENİR, onu silmez.

Gerçek derinlik gerekiyorsa telefonla tarama uygulaması (Polycam,
Scaniverse) ile model çıkarıp yükleyin — o zaman yükseklik tahmin değil
ölçümdür. **STL ve OBJ** desteklenir; biçim dosya içeriğinden anlaşılır,
uzantı yanlış olsa da okunur.

**Bakış yönü önemlidir.** Model tek yönden taranıp kabartmaya çevrilir.
Ayakta duran bir figüre tepeden bakılırsa yalnızca omuz üstü görünür ve
panel neredeyse düz çıkar. "Modele bakış yönü" varsayılan olarak
otomatiktir ve modelin **en ince olduğu ekseni** seçer — nesneler hemen
her zaman önden arkaya incedir. Sonuç beklediğiniz gibi değilse önden /
yandan / tepeden arasında elle geçiş yapın. 3B model seçicisinde `accept` filtresi
bilinçli olarak yoktur: iOS tanımadığı uzantıları soluklaştırıp
seçilemez yapıyor.

Önizlemede beş sekme var: **3B** (duvardaki hâli, parmakla döndürülür),
**Plan** (önden görünüm), **Levha** (kesim yerleşimi — dokunarak levhalar
arasında geçilir), **Kaynak** (işlenmiş yükseklik haritası), **Çizim** (derinlik boyama).

### Bilgisayara uygulama gibi kurmak
Ayrı bir program indirmeye gerek yok — site zaten kurulabilir bir uygulama
(PWA). Windows'ta Chrome veya Edge ile açın, adres çubuğunun sağındaki
**kurulum simgesine** (ekran + aşağı ok) tıklayın, ya da menüden
*Uygulamalar → Bu siteyi uygulama olarak yükle*. Sonrasında:

- Başlat menüsünde kendi simgesiyle durur, tarayıcı sekmesi olmadan açılır.
- Çevrimdışı çalışır (yalnızca 3B önizleme internet ister — three.js
  CDN'den geliyor). Ölçü girme, üretim, DXF/SVG çıkarma internetsiz çalışır.
- İndirilen DXF dosyaları doğrudan bilgisayarın indirme klasörüne düşer;
  telefondan aktarma derdi kalmaz.

Tezgâhın yanındaki bilgisayarda kullanmak için doğru yol budur. Gerçek bir
`.exe` gerekiyorsa (kurulum dosyası, dosya ilişkilendirme) Tauri ile
paketlenebilir — ama çoğu durumda gereksizdir.

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
  - `BUKUM` — büküm izi. Kesmeyin, işlemeyin; nereden büküleceğini gösterir.
  - `LEVHA` — sadece referans çerçevesi, işlemeyin.
- **Kerf telafisi**: Yazılım varsayılan olarak *nominal* konturu verir. CAM
  tarafında takım telafisi (dışa/içe ofset) uygularsanız "Ofset" alanını 0
  bırakın. CAM'iniz telafi yapmıyorsa "Ofset" alanına takım yarıçapını girin.
- **Geçme boşluğu**: Kontrplakta 0,15–0,25 mm iyi sonuç verir. MDF'de 0,1 mm
  yeterli. Nominal kalınlık ile gerçek kalınlık çoğu zaman tutmaz —
  kanalları açmadan önce levhanızı kumpasla ölçün.
- **Köşe payı (kemik / T payı)**: Dönen bir uç keskin iç köşe kesemez; kanal
  dibinde kendi yarıçapı kadar et bırakır. 6 mm'lik uçta bu 3 mm'dir ve
  geçme o kadar açık kalır. Yazılım bu köşeleri "Takım çapı" alanına göre
  otomatik açar:
  - **Kemik (dogbone)**: pay köşegen doğrultuda alınır. En az malzeme götüren
    biçim; lamellerde bu kullanılır.
  - **T payı (T-bone)**: köşenin bir yanındaki et inceyse — kızak dişleri
    gibi — kemik payı dişi iki yandan yiyip koparırdı. T payı bütün eti tek
    yönde, kalın tarafta alır. Kızaklarda genellikle bu seçilir.

  Hangisinin kullanıldığı köşe köşe, dişin genişliğine bakılarak seçilir;
  montaj kılavuzu dosyası sayıları yazar. Uç kanala hiç sığmıyorsa o köşe
  **olduğu gibi bırakılır ve uyarı verilir** — sessizce küçültmek, oturmayan
  bir geçme üretmekten kötüdür.

  Payı kapatabilirsiniz; o zaman köşeleri tezgâhta elle temizlemeniz gerekir.
  **Girdiğiniz takım çapının tezgâhtaki uçla aynı olması şart** — pay ona göre
  ölçülür.
- **Dış köşe yuvarlatma**: İşlevsel değil. Keskin dış köşeler MDF'de kıymık
  yapar ve taşımada zarar görür; 2–3 mm yuvarlatma bunu keser.
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
  facet.js            poligonal (low-poly) yüzey — kaydırılmış üçgen ağ
  patterns.js         kodla üretilen hazır desenler (8 adet, tohumlu)
  relief.js           silüet şişirme: Otsu eşik, Öklid uzaklık dönüşümü
  paint.js            elle derinlik boyama — fırça, yumuşatma, katman birleştirme
  marchingsquares.js  eş-yükselti halkaları (eyer çözümü dâhil)
  geom.js             alan, yön, sadeleştirme, ofset, delik sınıflandırma
  corners.js          köşe payı: kemik / T payı, dış köşe yuvarlatma
  modes/ribs.js       lamel + kızak üretimi
  modes/contour.js    katman üretimi
  modes/facets.js     poligonal kabuk: faset parçaları + kaynak dikişleri
  modes/slices.js     dilimli heykel: kesit parçaları + mil delikleri
  slice.js            3B modeli düzlemlerle kesme, parçaları halkaya dikme
  mesh.js             köşe kaynaklama, eş düzlem birleştirme, dihedral açı
  unfold.js           açınım: çakışmasız öbekleme, sınır izi, kertik, büküm payı
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
