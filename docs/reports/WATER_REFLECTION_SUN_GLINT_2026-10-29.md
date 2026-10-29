# Lake / River — ortam yansıması ve güneş parıltısı

29 Ekim 2026. [Su gelişim planındaki V1c](../planned/WATER_SYSTEM_DEVELOPMENT_PLAN.md#v1c--ortam--planar-yansıma-sürekliliği)
ve ortak güneş parıltısının uygulaması. **Son Lake görünümü kullanıcı tarafından kabul edildi; teknik doğrulama açık.**

Değişiklikler sonradan `c5d1b4a1` ile commit edildi. Kullanıcı bildirimine göre
bu commit başka oturumun push'u ile origin'e de gönderildi. İlk teslimin
aşağıdaki commit/push yapılmadı kaydı teslim anına aittir.

Başka oturumdan gelen `renderer.getClearAlpha is not a function` bildirimi,
renderer taklidindeki eksik clear color/alpha metotlarına işaret etti. Ana
ağaçta mock ve eski kalite beklentileri eşzamanlı olarak düzeltildi; burada bu
değişiklikler korunuyor. Ayrıca görünürlük gizleme `try` içine taşındı.
Sonraki Lake commit'i öncesinde yerel `build:verify` ve 2.131 engine kontrolü
geçti; önceki clear-alpha hatası bu koşuda tekrarlanmadı. Uzak CI durumu
ayrıca izlenir. Lake browser sonuçları V2a raporundadır.

Kullanıcı, paralel bant/güneş diski düzeltmesinden sonra paylaştığı son Lake
görüntüsü için “şuan çok daha iyi, görsel kabul tamam” dedi. Bu kabul o göl
görünümünü kapsar; River veya bütün grafik ayarlarının kabulü olarak kullanılmaz.

Kullanıcı çalışma sırasında “çalışma yap ve kontrol etmem için bana haber ver,
kontrolleri sen yapma” talimatını verdi. Bu nedenle TypeScript, engine testi,
build, Playwright, ekran görüntüsü ve GPU ölçümü çalıştırılmadı. Aşağıdaki
davranışların teknik/performance doğrulaması yapılmadı; son Lake görünümünün
kullanıcı kabulü yukarıda ayrıca kaydedildi. Yeni test/fixture de eklenmedi.

## Yansıma

- `lakeWater.ts`, mevcut PMREM ortamını temel yansıma olarak kullanır.
  Planar'ın geçersiz koordinatlarında veya capture yokken ortam yolu kalır.
- `planarReflectionSource.ts`, mevcut paylaşılan hedefe sahneyi saydam siyah
  arka planla çizer. Capture sırasında değiştirilen scene background ve renderer
  clear color/alpha değerleri `finally` ile geri yüklenir. Yeni capture veya
  render target eklenmedi.
- Gaussian filtre artık RGB ile birlikte alpha kapsamını da filtreler.
  Planar geometri bu kapsamla ortamın üzerine birleşir; hedef kenarında ortam
  katkısına yumuşak geçiş vardır. Ortam yokken kısmi kapsamın dip rengini iki
  kez karartmaması için renk/kapsam ayrılır.
- Lake `reflectionMode: off` veya sıfır strength ile ortam/planar katkısı
  kapalıdır. `sharedPlanar` + `low`, yalnız mevcut ortamı kullanır. Global
  grafik profili planar'ı kapattığında `qualityLake` geçici görünümü `low`
  yapar; kaydedilmiş tercihi değiştirmez. Ortam haritası yoksa gökyüzü
  yansıması üretilemez.
- River'ın mevcut ortam/probe yansıması korunur; roughness filtrelemesi ve
  roughness'a bağlı Fresnel eklenir. River için yeni planar capture yoktur.
- Lake'te ortam haritası kullanılır; bu teslim Lake'e yeni yerel probe
  sağlayıcısı bağlamaz. Ortak yardımcıdaki mevcut probe desteği River'da sürer.

## Güneş

- `waterSunGlint.ts`, Lake/River için ortak GGX hesabı içerir. Authored
  roughness GGX alpha'ya çevrilir; sonlu güneş izi için alt sınır uygulanır.
- Lake'in mevcut normal türevli roughness filtresi ortak yardımcıyı kullanır;
  River da normal türevleriyle filtrelenir. River'da türev hesapları dry-bed
  discard öncesindedir.
- Dünya koordinatında iki piksel ölçeği ve yumuşak zaman geçişiyle sınırlı
  parıltı modülasyonu uygulanır. Uzakta piksel izi büyüdükçe modülasyon sürekli
  GGX izine döner. Düşük detayda küçük parıltı kapalı, sürekli güneş izi açıktır.
- Güneşin gölge görünürlüğü ve mevcut ışık rengi kullanılır; ufkun altındaki
  güneş ve suyun alttan görünümü için katkı bastırılır. Köpüğün mevcut yüzey
  bileşimi korunur. Su gövdesi ışığında ikinci bir specular leke yerine diffuse
  katkı kullanılır.
- Yeni kalıcı alan, kontrol veya simülasyon geçmişi eklenmedi. Mevcut
  roughness, surface strength, ripple/flow speed ve reflection ayarları kullanılır.

## Kaynak

### Kullanıcı görüntülerinden sonra yapılan düzeltme

Kullanıcının paylaştığı eğik ve üstten görüntülerde uzun paralel ışık bantları
ve su üzerinde köşeli bir güneş diski görüldü. Kodda iki kaynak bulundu:
Lake mikro normalindeki sabit yönlü sinüsler ve Sky Atmosphere mesh'inin,
`scene.background` temizlense de planar hedefe çizilmeye devam etmesi.

- `lakeSurface.ts`: üç doğrusal sinüs mikro-normal bileşeni kaldırıldı.
  Yerine iki eksende değişen, farklı ölçek/yönlerde noise gradyanları ve UV
  bükülmesi kullanıldı. Geometrik dalga, CPU su sorgusu ve kıyı geometrisi
  değiştirilmedi.
- `skyAtmosphere.ts`: canlı Sky'ın güneş yönü ve atmosferik sönümden sonraki
  lineer disk parlaklığı geçici metadata olarak suya sağlanır. Bu hesap,
  kurulu three.js Sky shader'ının katsayılarını kullanır; gerçek gökyüzünü,
  authored ışıkları veya pozlamayı değiştirmez.
- `planarReflectionSource.ts`: işaretlenen atmosfer mesh'i capture boyunca
  gizlenir ve görünürlüğü geri yüklenir. Böylece güneş düşük çözünürlüklü
  planar hedefe tekrar rasterize edilmez. Ayrı Cloud Layer korunur.
- `reflection.ts`: mevcut PMREM'e yakalanan güneş yönü metadata olarak eklenir.
  Texture içeriği veya diğer PBR malzemelerin ortam örneklemesi değişmez.
- `waterEnvironment.ts`: yalnız işaretli Forge gökyüzü ortamının yansımasında,
  eski güneş yönündeki aşırı parlak texel bölgesi yakın gökyüzü örnekleriyle
  bastırılır. Bu sınırlı yaklaşım kesin bir güneş/atmosfer ayrıştırması değildir;
  yeni sampler veya texture üretmez, koşullu olarak iki ek ortam örneği okur.
- `waterSunGlint.ts`: canlı atmosfer verisi varsa sonlu, yumuşak kenarlı bir
  güneş çekirdeği ile geniş GGX izi arasında yaklaşık enerji paylaşımı yapılır.
  Pürüzlülük çekirdeği genişletip zayıflatır; HDR katkı mevcut bloom'dan önce
  yazılır. Canlı atmosfer yoksa directional-light GGX yolu kullanılır. Global
  bloom, pozlama ve gökyüzünün kendi görüntüsü değiştirilmez.

Bu düzeltme de kullanıcı isteğiyle TypeScript/test/build/tarayıcı koşusu
yapılmadan teslim edildi. Sonrasında Lake görünümü için kullanıcı kabulü
alındı; hareket, GPU maliyeti ve bütün bloom ayarları için genel kabul değildir.
Kalan elle kontroller için editörü tam yenileyip aynı açılarda
bloom açık/kapalı bakılmalı; ardından güneş yönü ve roughness değiştirilip
önceki ayarlarına geri dönülmelidir.

Ultra-Water `ce9248fa20afbdf63fd4c11709f68d7368aca0a0`,
`src/water/OceanSurface.js`: ortam/planar kapsam birleşimi, roughness-aware
Fresnel, GGX güneş ve piksel ölçeğine bağlı parıltı yaklaşımı.

Forge uyarlaması FFT eğim varyansı veya Poisson sayım döngülerini taşımaz;
mevcut normal filtreleri ve sınırlı hash modülasyonu kullanır. Demo atmosferi,
post-process ve bağımlılıkları alınmadı. MIT/Humpalumps bildirimleri
`public/licenses/ultra-water.txt` içinde güncellendi.

## Kullanıcının elle bakacağı noktalar

1. Editörü yenile. Gölde Reflection Mode açıkken Reflection Quality'yi
   Low / Medium / High arasında değiştir. Low ortam yansımasını; Medium/High
   buna eklenen sahne yansımasını göstermelidir. Ortam haritası bulunan bir
   sahne kullan.
2. Reflection Mode Off ve sıfır Reflection Strength durumlarına bak; sonra
   eski ayarına dön. Bu ayarlar ortam/planar yansımayı kapatır, bağımsız
   güneş ışığı hesabını kapatmaz.
3. Göle ve nehre güneş yönüne doğru eğik açıdan bak; kamerayı yaklaştırıp
   uzaklaştır. Güneş izinin dağılımını, küçük parıltıları ve uzaktaki kararlılığı
   değerlendir. Göl Surface Roughness ayarını değiştirip geri al.
4. Kaya/ağaç gölgesinde, güneş kapalı/gecede, köpüklü bölgede ve kıyıda bak.
   Planar kenarında kararma, yapay parlama veya beyaz bant olup olmadığını
   bildir. Grafik kalitesini düşürüp eski düzeyine geri getir.

Kullanıcı sahneleri, terrain, ışıklar ve kayıtlı görünüm ayarları bu teslimde
düzenlenmedi. Eşzamanlı Recast/navigation çalışmasına dokunulmadı. Commit/push
yapılmadı. V0, V1a, V2, V4 dalga hareketi ve P0 kabulü bu teslimle kapanmaz;
yeni shader maliyeti, etkin sampler bütçesi ve görsel sonuç henüz doğrulanmadı.
