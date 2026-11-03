# Puddle — Faz 4–5 son görünüm ve çamurlu yoğunluk

3 Kasım 2026. Kullanıcı, rüzgar dalgaları ve derinlikle artan çamurlu görünüm
için görsel kabul verdi; ardından toplu teknik kontroller ve main'e push istedi.
Bu belge [ilk Faz 4 raporundaki](PUDDLE_WIND_RIPPLES_2026-11-03.md) tarihsel
görünüm/ölçümlerden sonraki son davranışı kaydeder.

## Son davranış

- World Environment yönü, etkin gücü ve gust değerleri Puddle'a aktarılır.
  Foliage gerektirmez; editör önizlemesi ve runtime aynı çözümleyiciyi kullanır.
  Runtime animasyonu simülasyon zamanını izler.
- İnce kavisli sırtlar, düzensiz ve yumuşak esinti grupları halinde belirip
  kaybolur. Aralarında sakin bölgeler vardır. Mevcut su normal map'i küçük
  ayrıntıyı sağlar; sırtlar Puddle seed'ine göre sabitlenir. Su geometrisi,
  kıyı, deforme yatak ve tekerlek temas sorguları hareket etmez.
- Wind Ripples bölümünde Enabled, Normal Strength, World Scale, Speed Response
  ve Wind Influence bulunur. Wind Influence varsayılanı 1.6, aralığı 0–4'tür;
  0 rüzgar katkısını kapatır. Son hız tepkisi önceki sürümden artırıldı.
  Wheel Ripples aynı normal hesabına bağımsız katılır.
- Planar distorsiyon dünya eğimini yansıma kamerasıyla projekte eder. Planar
  görüntü toplam aydınlatma yerine dolaylı yansıma radiance'ına karıştırılır;
  su IOR'u 1.333'tür. Fiziksel Fresnel bir kez uygulanır. Doğrudan speküler
  katkı 0.2 ile azaltıldı; aktif esinti bölgesinde roughness en az 0.36'ya
  yumuşakça yaklaşır. Kullanıcı bu görünümü kabul etti.
- Su tamamen opak değildir. Gerçek yatak derinliğiyle optik yoğunluk artar:
  `alpha = (1 - exp(-depth * mudDensity * opacity / 0.82)) * edgeCoverage`.
  Sığ taban kısmen görünür, derin taban giderek örtülür. Derinlikle çamur
  rengine geçilir; kıyıda 6 mm'lik depth coverage geçişi kullanılır.
- Muddy Water bölümünde Mud Density (varsayılan 12, aralık 0–80) ve Mud Color
  (varsayılan `#695039`) bulunur. Opacity optik yoğunluğu ölçekler; 0 yüzeyi
  gizler. Mevcut kayıtların açıkça yazılmış renk/opacity ayarları ezilmez.
- Taslak ve kalıcı gövde aynı kontrolleri kullanır. Ortak read/save validator
  yeni alanları sonlu sayı/aralık ve renk denetimiyle korur. Yalnız ayarlar
  kaydedilir; dalga geçmişi, rüzgar çözümü veya animasyon fazı yazılmaz.

## Teknik kabul

`npx.cmd tsc --noEmit` ve tam `npm.cmd run build:verify` geçti. Son kontroller,
görsel onaydan sonra tek toplu teslim koşusunda çalıştırıldı. Tam paket import
sınırları, smoke/content/UI türleri, builder doğrulamaları, üretim derlemesi,
**2396 engine kontrolü** (yavaş paket dahil), strict dist ve world-data
kontrollerini içerir. Yeni çamur alanlarının gerçek read/save round-trip,
geçersiz değer reddi ve eski sparse kayıtların korunması ayrıca sınandı.

Playwright Chromium: **5 test geçti** (1.9 dakika). Gerçek Rapier tekerlekleri,
canlı yatak/film ayrımı, Puddle taslak/oluşturma/undo/lock/hide/delete,
Wind Influence ve çamur ayarlarının Save/Reload/Play korunması, planar
Environment/Medium/High davranışı, yansımalı avlu ve mevcut prototip kontrolü
kapsandı. Shader/JavaScript konsol hatası ve WebGL hatası yok.

Bağımsız GPU optik probu, aynı gerçek Puddle shader'ını 16×16 hedefte çalıştırdı:
2 cm / 12 cm / 40 cm derinliklerin alpha tanı kanalı **54 / 195 / 253** oldu.
12 cm'de yoğunluk 24'e çıkarılınca **241** oldu. Yoğunluk 0, Opacity 0 ve
sıfır derinlik sonuçları **0**; geometri aynı kaldı. Bu değerler 8 bit optik
örtücülük tanısıdır, sahne rengi veya donanım performans ölçümü değildir.

Kanıtlar: [son esintili görünüm](evidence/puddle-wind/final-breeze.png),
[üst açı](evidence/puddle-wind/final-overhead.png),
[editör/taslak/Play ve optik ölçümler](evidence/puddle-wind/final-measurements.json).

## Teslim sınırı

Kullanıcının görsel kabulü kaydedildi. Hedef donanımda çok Puddle/araç için
eşlenik CPU/GPU ve tepe bellek kabulü genel W3 kapsamında açık kalır.
Yağmur, hidrolik akış, refraction target ve yeni collider eklenmedi.

Commit kapsamı Puddle kodu, ilgili testler, plan ve rapor/kanıtlardır. Mevcut
terrain/level, foliage, manifest ve fracture authored değişiklikleri kapsam
dışında korunur. Yeni save alanları için dar Codex Security diff incelemesi
önerisi geçerlidir; bu oturumda ayrıca onaylanmış güvenlik taraması yoktur.
