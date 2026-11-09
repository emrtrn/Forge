# Ocean — ortak optik ve ışık bağlantısı

Durum: O4'ün ilk ara teslimi. [Ana plan](../planned/OCEAN_DEVELOPMENT_PLAN.md)
ve [native entegrasyon](OCEAN_EDITOR_RUNTIME_INTEGRATION.md) üzerine devam eder.

## Davranış

Ocean'ın sabit güneş yönü, sabit gökyüzü rengi ve bağımsız mesafe sisi kaldırıldı.
Yüzey mevcut `waterEnvironment` üzerinden sahnenin prefilter ortam haritasını,
yakındaki reflection probe'u, canlı directional ışığını ve ortak GGX güneş
parıltısını kullanır. CSM/ordinary directional gölgeleri aynı receiver yolundan
okunur. Ambient/Hemisphere ışıkları ve renderer sisi de sahneden gelir.
Ortam/ışık yokken su kendiliğinden aydınlanmaz. Editör ve runtime aynı probe
sağlayıcısını ortak Ocean controller'a verir; Ocean bu kaynakları sahiplenmez.

Post-process yolunda mevcut `WaterSceneSnapshot` renk/depth kopyası paylaşılır;
yeni bir sahne render'ı veya ayrı Ocean capture hedefi açılmaz. Görünen su
kolonu soğurulmayı belirler. Renk kanallarına göre sönüm, sığdan derine scatter
ve Fresnel birlikte hesaplanır; dip görüntüsü ikinci kez alpha ile karışmaz.
Kırılma en fazla 10 piksel kayar. Aday uç ve orta noktanın ekran içinde,
opaque geometrinin su altında ve kesişimin bağlı deniz kapsamında olması
gerekir. Kuru ada, su üstü foreground ve sky adayları reddedilir.
Doğrudan canvas, MSAA veya uyumsuz kamera yolunda sahne kopyası okunmaz;
terrain derinliği ve doğru alpha bileşimi kullanılır.

AO ve DoF yardımcı çizimleri aynı clipmap vertex shader'ını, FFT dokularını ve
bağlı deniz maskesini kullanır. Kuru ada/kapalı basin yardımcı hedefte de su
olmaz. Normal çıktısı view-space, depth çıktısı RGBA packed depth'tir.
Bu çizimler FFT saatini veya ana kamera grid anchor'ını ilerletmez.
Yüzey yalnız kendi coverage, grid ve materyallerini bırakır; FFT, ortam,
probe ve snapshot dokularının sahipliği mevcut owner'larında kalır.

## Doğrulama

- İki yeni engine kontrolü: canlı ışık/karanlık/probe bağları; yardımcı çizim,
  hata sırasında render state/visibility restorasyonu ve ödünç kaynak sahipliği.
- Ocean tarayıcı fixture'ı ortak Forge pozlama ölçeği, HDR composer, ortam ve
  gerçek directional gölge ile çalışır. Snapshot/direct fallback, aydınlık ve
  ışıksız su radyansı, normal/depth shader çizimleri, sabit FFT saati ve tekrar
  oluşturma kaynak sayıları denetlenir. Browser/console shader hataları izlenir.

| Kontrol | Sonuç |
|---|---|
| `npx tsc --noEmit` | Başarılı |
| `npm run build:verify` | Başarılı; 2.583 engine kontrolü, import/type/build/dist/world-data kapıları |
| `npm run check:assets` | Başarılı; 0 hata, baseline içindeki 6 bilinen uyarı |
| `ocean-reference.spec.ts` | Başarılı; 1 test, 1,3 dakika; console/shader hatası yok |
| `ocean-editor.spec.ts` | Başarılı; 1 test, 4,0 dakika; gerçek Save/Reload/Play, console/shader hatası yok |

Chromium `/usr/bin/chromium` ve SwiftShader ile çalıştırıldı. Bunlar hedef
donanım GPU performans ölçümü veya Water Pro görsel kabulü değildir.
İlk referans görüntüsündeki aşırı parlaklık fixture'ın Forge standart pozlama
ölçeğini atlamasından kaynaklanıyordu; ortak `postProcessToneMappingExposure`
kullanıldı. Motorun global pozlaması ve ışık ayarları değiştirilmedi.

Görüntüler: [kıyı](images/ocean-optics/coast.png),
[açık deniz](images/ocean-optics/open-sea.png),
[doğrudan çizim fallback'i](images/ocean-optics/direct-fallback.png).

Ek asset kapısında önceden var olan altı World Builder cover dosyası yeni uyarı
üretiyordu. `engine/worldbuilder/randomWorld.ts` içindeki `COVERS` kataloğunun
bu altı dosyayı doğrudan kullandığı doğrulandı. Yalnız bu yollar reviewed warning
baseline'a alındı; artık çözülmüş `SaveLoadMenu.ui.json` kaydı kaldırıldı.
Manifest taraması, yeni uyarı kapısı ve runtime davranışı değiştirilmedi.

CI'daki mevcut optional JSON/SPA fallback sorunu da ayrı ve küçük bir
[içerik yükleme düzeltmesiyle](CONTENT_JSON_ACCEPT_FIX.md) ele alındı.
Eksik optional sidecar'ların doğrulanmış HTTP 404 network-console satırları
native smoke'ta sınıflandırılır; uygulama/shader hataları filtrelenmez.

## Açık işler

O4 tamamlanmış değildir. Sıradaki parça ortak planar reflection registry'ye
katılım ve aynı kamera ile environment/planar karşılaştırmasıdır. SSR kararı,
Ocean caustics, tropikal/fırtınalı/ay ışıklı profiller ve hedef donanımda GPU
bütçesi/görsel kabulü açık. Üç bağımsız köpük katmanı O5'te; su altı, buoyancy,
wake ve masking sonraki aşamalardadır. İlk crest köpüğü nihai görsel kabul
olarak değerlendirilmez. Mevcut tek Ocean ve 262.144 terrain hücresi sınırı sürer.
Sonlu ve sığ native terrain'in görünür dip sınırının offshore ile görsel
sürekliliği de henüz kabul edilmiş değildir; native smoke görüntüsü kullanıcı
akışını kanıtlar, nihai okyanus sahnesini temsil etmez.
