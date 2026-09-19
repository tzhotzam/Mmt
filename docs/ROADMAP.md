# Yol haritası

Şu an çalışan sürüm (v1) iki üretim modu, levha yerleşimi ve DXF/SVG çıktısı
veriyor. Sıradaki adımlar, fayda/emek sırasına göre:

## Yakın vadeli

**1. Gerçek poligon ofseti (kerf telafisi)**
Şu anki `offsetRing` köşe açıortayı yöntemini kullanıyor; organik konturlarda
iyi, keskin iç köşelerde büyük ofsetlerde kendini kesebiliyor. Clipper2'nin
WASM sürümü (`clipper2-wasm`) tam çözüm — kendi kesişimlerini temizler,
delikleri doğru yönetir.

**2. Köprü / tırnak (tab) desteği**
Parça kesilirken kopup fırlamasın diye konturda 4–6 mm'lik kesilmeyen
köprüler. Kontur uzunluğuna göre otomatik dağıtım + elle konum ekleme.

**3. G-code çıkışı**
DXF çoğu atölye için yeterli ama doğrudan G-code (Grbl/Mach3/LinuxCNC)
üretmek küçük atölyeler için akışı kısaltır. Katman derinliği, dalma hızı,
çoklu paso, helis dalma parametreleri gerekir.

**4. ZIP olarak toplu indirme**
Birden fazla levha şu an tek dosyada alt alta kaydırılarak veriliyor. Levha
başına ayrı dosya + `JSZip` ile tek indirme daha temiz olur.

## Orta vadeli

**5. Kafes (waffle / eggcrate) modu**
Birbirini dik kesen X ve Y çıtaları, yarım geçmeli. Lamel modundan çok daha
sağlam bir gövde verir ve büyük panellerde (>1,5 m) gerekli olur.

**6. Renk katmanı / çok malzeme**
Katman modunda her seviyeye farklı malzeme atayıp (ceviz / meşe / boyalı MDF)
önizlemede gerçek renkleriyle göstermek.

**7. Akıllı yerleşim (nesting)**
Şu anki raf algoritması basit ve öngörülebilir. Gerçek şekil bazlı yerleşim
(no-fit polygon veya basit bir "bottom-left fill") lamel modunda %15–25
malzeme tasarrufu sağlar — lamel profilleri iç içe geçebiliyor.

**8. Maliyet hesabı**
Levha fiyatı, işçilik dakika ücreti, fire oranı girildiğinde parça maliyeti.

## Uzak vadeli

**9. Vektör görsel (SVG) girişi**
Logo veya çizim yüklenip doğrudan kontur olarak kullanılması — rasterleştirme
kaybı olmaz.

**10. Doku/desen kütüphanesi**
Parametrik dalga, Voronoi, topografya, moiré gibi hazır üreteçler; görsel
yüklemeye gerek kalmadan desen üretme.

**11. Montaj animasyonu**
3B önizlemede parçaların sırayla yerine oturduğu animasyon — müşteriye
sunumda işe yarar.

## Bilinen sınırlar

- `offsetRing` büyük ofset değerlerinde kendini kesebilir (bkz. madde 1).
- Marching squares eyer noktalarını merkez ortalamasıyla çözer; çok gürültülü
  görsellerde topoloji beklenenden farklı çıkabilir. Yumuşatma bunu giderir.
- 3B önizleme three.js'i CDN'den yükler; çevrimdışıyken devre dışı kalır
  (üretim ve dışa aktarma çalışmaya devam eder).
- Yerleşimde parçalar yalnızca 0° veya 90° döndürülür.
