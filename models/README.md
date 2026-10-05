# Derinlik modeli

`derinlik-v2-kucuk-w8.onnx` — **Depth Anything V2 Small** (Yang ve ark., 2024),
Apache License 2.0. Kaynak: https://github.com/DepthAnything/Depth-Anything-V2

ONNX dışa aktarımı: https://github.com/fabio-sim/Depth-Anything-ONNX
(sürüm v2.0.0, `depth_anything_v2_vits.onnx`, Apache-2.0).

Bu depodaki dosyada yapılan değişiklikler:

1. Yerel ONNX işlevleri açıldı (`onnx.inliner.inline_local_functions`).
2. 4096'dan büyük float32 ağırlıklar kanal başına 8 bit (uint8, sıfır noktalı)
   saklanıp `DequantizeLinear` ile yüklenirken float32'ye açılıyor. Hesap
   float32 kalır; yalnızca dosya 99 MB'tan 25,6 MB'a iner. Float sürümle çıktı
   farkı ortalama %0,3.

Giriş `[1, 3, 518, 518]` (ImageNet ortalama/sapma ile normalize RGB), çıkış
`[1, 518, 518]` göreli ters derinlik (büyük = yakın).

Not: Depth Anything V2'nin **yalnızca Small** sürümü Apache-2.0'dır; Base ve
Large sürümleri ticari olmayan lisanslıdır, bu yüzden kullanılmadı.
