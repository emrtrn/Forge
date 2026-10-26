# Codex / Claude — Forge Water System v2 başlangıç talimatı

Ek klasördeki `FORGE_WATER_SYSTEM_V2_ARASTIRMA_VE_TDD_v1.0.md` dosyasını tamamen oku. `images/` klasöründeki IMG-01–IMG-08 görsellerini ilgili bölümlerle birlikte değerlendir. Bu çalışmanın amacı önce mevcut Forge su mimarisini doğru incelemek, ardından test edilebilir aşamalarla su kalitesini artırmak. Önceden çalışan nehir kayıt/editor/runtime akışını koru.

## İstenen ilk teslimat (Faz 0)

1. Çalıştığın branch/commit ve dirty çalışma ağacı durumunu açıkça kaydet; kullanıcının değişikliklerini ezme.
2. Mevcut `RiverWater` veri şeması, renderer, shader, spline ribbon, planar reflection ve derinlik hesaplarını ilgili kod konumlarıyla doğrula.
3. Suyun editor ve Play/runtime render sırasını, transparent ordering ve color management işleyişini çiz.
4. Teknik belgede “mevcut” diye yazanları doğrula/yanlışsa düzelt; henüz uygulanmamış özellikleri sakın çalışıyor olarak bildirme.
5. IMG-01/02 sahnelerini aynı kamera ve ışıkla yeniden üretme yöntemini bul; performans baseline'ı topla.
6. Faz 1'i uygulamak için minimum dosya değişikliği ve test kapsamını öner; gerekçeli TDD + görev bölümü çıkar.

## Faz 1 izni varsa

Mevcut nehirde depth/Fresnel/shoreline prototipini mevcut save schema'yı kırmadan uygula. Shader'ın önceden var olan normal/foam/flow özelliklerini koru. Geri alınabilir küçük commit mantığıyla ilerle. TypeScript, ilgili engine testleri, Playwright smoke ve gerçek görüntü/test maliyetlerini raporla. Sonuçları `WATER_V2_IMPLEMENTATION_REVIEW.md` adıyla derle.

## Kesin sınırlar

- Kullanıcı onayı olmadan global terrain veri modelini veya renderer mimarisini toptan değiştirme.
- Motorun `WebGLRenderer` kullanımı ile WebGPU-only `WaterMesh` yaklaşımını karıştırma.
- Göl/birikinti özelliğini mevcut nehir kayıt şemasını bozarak acele ekleme.
- Kaynak fotoğraflarını orijinal Forge ekran görüntüleriymiş gibi sunma.
- Ölçmediğin performans, tamamlamadığın test veya uygulanmamış fiziği tamamlandı diye yazma.

## Raporlama

Her aşamada: ne değişti, neden, hangi test geçti/başarısız, mevcut görüntüden somut fark, GPU/CPU farkı, kaydetme uyumu, bugünkü açık riskler.
