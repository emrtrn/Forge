# Lake ıslak kıyı zemini — 2026-10-28

Lake → **Wet Shore → Enabled**, Width (m), Strength. İlk dilim yalnız terrain
üzerindedir; River, mesh taşlar, kalıcı boya veya fiziksel ıslanma değildir.
Eski Lake kayıtlarında kapalıdır. Yeni kaynak alanları ortak runtime/save
validator'da sınırlandırılır ve mevcut edit/undo/Save/Reload yolunu kullanır.

## Görünüm ve sınır

Kıyı/ada segmentlerine dünya metre mesafesiyle yakın terrain rengi kademeli
koyulaşır ve roughness en çok 0,32'ye yaklaşır (zaten daha düşük değer korunur).
Birden çok gölün katkısı toplanmak yerine max ile birleşir. Kaynağın terrainRef'i
ve görünür üst nesneleri kontrol edilir; başka terrain boyanmaz. Debug/paint
view'da albedo karartılmaz. Geçerli Lake yoksa etki yoktur.

Bant, kara tarafındaki en fazla authored genişlikte ve su seviyesinden en çok
0,35 m yukarıda kalır. 8 cm su altından başlatılan yumuşak geçiş, tam su çizgisinde
albedo sıçramasını önler; derin dip değiştirilmez. Üst yükseklik sönmesi 0,08–0,35 m
aralığındadır. Bu sınırlı nemli temas görünümüdür; yüksek duvarı boyamaz, yağış
ve kuruma hafızası oluşturmaz. Sculpt/seviye/alan/parametre değişimleri mevcut
Lake rebuild yoluyla maskeyi yeniler.

## Kaynaklar

`terrainShoreWetness.ts` scene-owned bounded registry ve terrain shader hook'u;
`waterFoam.ts` mesafe üreticisi yeniden kullanılır, ama kara tarafını da kapsamak
için maskenin bounds'u genişletilir. Foam'un etkin olması gerekmez.

Dört texel/bant, eksen başına en çok 1024. Kaynak maskesi ≤1 MiB/göl; birleşik
1024² R8 array ≤8 MiB, sekiz kaynak CPU maskesi ≤8 MiB, birleşik CPU upload
≤8 MiB. Rebuild'de eski+yeni array GPU tepe payı ≤16 MiB; JS heap/driver geçici
kopyaları bunlara dahil değildir. Kaynak maskeleri GPU'ya ayrıca bağlanmaz.
Maske allocation ve dar bantta çözünürlük sınırı önce kontrol edilir; aşılırsa
kaynak korunup açık `over-budget` ile Lake yüzeyi reddedilir. Parametre düzelince
aynı Lake yeniden üretilebilir. Kayıp kaynak/son consumer removal maskeleri bırakır.

Terrain'e bir sampler eklenir; sabit sampler sayısı 7→8, albedo array varsa
8→9 (normal array varsa ayrıca sayılır). Mevcut CSM/deform-water/env bütçeleri bu
sayıyı kullanır; limit gevşetilmez. Ek draw, scene capture veya kare başına maske
üretimi yoktur. Çok gövdeli büyük dünya, senkron rebuild ana thread süresi ve
hedef donanım GPU p95 ölçülmedi; önceki caustics performans açıkları korunur.

## Doğrulama kapsamı

Engine: kayıt allowlist'i/invalid değerler, kaynak ömrü ve disposal,
görünürlük/terrainRef filtresi, padded mesafe bounds'u, terrain heights'ın
korunması, shader'daki gerçek sampler sayısı ve CSM ile kompozisyon.

Browser: PBR dip materyalli izole fixture, görünür ıslak bant, uzak kuru zemin ve
ayrı çukurun aynı kalması, aç/kapat/undo, Save/Reload/runtime; işlem öncesi/sonrası
terrain byte hash eşitliği. Mevcut köpük ve caustics senaryoları regresyon olarak
çalıştırılır. GPU donanım performansı iddia edilmez. Yeni save alanları için
Codex Security diff incelemesi önerilir; kullanıcı onayı olmadan çalıştırılmaz.
Kod bu oturumda henüz commit/push edilmedi.

Son yerel sonuç: `build:verify` çıkış 0, **1.963 engine kontrolü** ve üretim/
strict dist/world-data geçti. Köpük, caustics ve ıslak kıyı senaryoları birlikte
**3/3 geçti**; son PBR kum/taş fixture'ıyla ıslak kıyı tekrar **1/1 geçti**.
Ana/smoke TypeScript ve whitespace kontrolü geçti. Terrain byte hash'leri
korundu; yakın bant açık/kapalı görüntüleri incelendi. SwiftShader sonuçları
hedef ekran kartının performans kabulü değildir.
