# River normal akışı, güneş parıltısı ve caustic dikişi

30 Ekim 2026. Kullanıcının yüksek Flow Speed ile belirginleşen dikey çizgileri,
güneş parıltısındaki üçgen sınırlarını ve caustic dikişini düzeltme çalışmasıdır.

Son durum: Kullanıcı değişiklikleri sahnede görüp mevcut görünümü kabul etti.
Terrain sahnesi değişiklikleri de kullanıcının açık onayıyla aynı commit paketine
dahil edilir. Gerçek GPU maliyeti ve production tarayıcı kabulü açık kalır.

## Değişiklik

- Normal UV'sindeki `time * flowSpeed * localSpeed` yerel hız farklarını bütün
  sahne ömrü boyunca büyütüyordu. İki örtüşen taşıma fazında mesafe sınırlıdır;
  sıfırlanan örnek o anda sıfır ağırlıktadır. Flow Speed çevrimin hızını değiştirir.
  Kıyı yavaşlaması ve akış yönü korunur. Mevcut otomatik köpük dağılımı değişmez.
- Türevlerle hesaplanan geometrik yüzey normali her üçgende sabitti; keskin HDR
  güneş parıltısı dalga mesh'inin köşegenlerini açığa çıkarıyordu. Artık statik UV
  türev çerçeveleri ve aynı dalga fonksiyonunun sonlu farkları ortak vertex shading
  normalini üretir. Mesh pozisyonları, indeksler ve dalga displacement'ı değişmez.
  R3 ray/üçgen kesişimi geometrik normali kullanmayı sürdürür; mikro kırılma farkı
  yumuşak shading normalinden hesaplanır.
- Caustic atlasındaki üçgen başına ortalama akış yerine üç ayrı köşe akış/yavaşlık
  kaydı saklanır. Shader barycentric interpolation yapar; ortak kenarda değerler
  eşittir. Caustic taşımada da iki fazlı sınırlı mesafe kullanılır. Lake yolu aynı
  kalır; mevcut maske, derinlik, güneş ve gölge koşulları korunur.

Yeni kayıt alanı, ayar, bağımlılık, render target veya draw eklenmedi. Kullanıcının
Terrain level/terrain/tile dosyalarındaki eşzamanlı değişikliklerine dokunulmadı.

## Maliyet ve sınırlar

Shading çerçevesi vertex başına 56 byte CPU/GPU attribute ekler (toplam 13 attribute;
WebGL2 alt sınırı 16). Geçici hazırlık ağırlıkları vertex başına 4 byte'dır. Mevcut
1.048.576 vertex mesh tavanında ek kalıcı attribute boyutu CPU ve GPU'da ayrı ayrı
56 MiB olabilir; küçük nehirlerde vertex sayısıyla doğrusal ölçeklenir. Vertex
shader'ında dört ek dalga değerlendirmesi vardır; kare başına CPU güncellemesi yoktur.

Mikro normal iki kez örneklenir: üç ek normal texture tap'i. Hareketli River caustic
deseni iki kez örneklenir ve aday yüzeyde iki ek akış texel'i okunur. Atlas üçgen
kaydı 4 yerine 6 RGBA float texel'dir; ortak 16 MiB sınırı kapasite kontrolünde de
korunur. R3 atlası ve kaynak sahipliği değişmez. Gerçek GPU süre farkı ölçülmedi.

## Doğrulama

- `npx.cmd tsc --noEmit` geçti.
- `npm.cmd run verify:smoke-fixtures` geçti.
- `npm.cmd run build:verify` geçti (build, slow engine, strict dist ve world-data dahil).
- Chromium: `river-water-optics.spec.ts` + `river-caustic-flow.spec.ts`, **24/24 geçti**.
- `npm.cmd run test:engine`: 2169 kontrol geçti. Yeni test eğri nehirde atlasın
  iki yanından ortak kenar akışlarının eşitliğini, eski üçgen ortalamasının farkını,
  shading çerçevelerinin sonlu oluşunu ve geometri verisinin değişmezliğini kapsar.
- WebGL normal regresyonu gerçek `T_Water_N.png`, Flow Speed 1/5 ve 60/3600 saniye
  ile zamanla biriken anizotropiyi; güneş regresyonu amplitude 0,1 dalga, HDR güneş
  ve bloom ile ortak kenar normal sıçramasını karşılaştırır.
  Normal anizotropisi eski **2,85–5,97** aralığından **0,96–1,10** aralığına indi.
  160 ortak kenarda normal tanı sinyalinin p95 farkı **5 → 1** oldu.
- WebGL caustic regresyonu gerçek atlas sampler'ını ve iki faz yardımcısını kullanır.
  Eğri nehirde eski ortalamanın farklı hız ürettiği 80 kenar, Flow Speed 5,
  60,37/3600,37 saniye: eski/yeni sinüzoidal UV tanı sinyali p95 piksel farkı
  **244,18 → 23,02** ve **337,68 → 23,02**. Bu değer ışık enerjisi veya GPU süresi
  değildir; kenar sürekliliğinin ölçümüdür. Gerçek terrain caustic desen shader'ı
  ayrıca derlenip çizilir; draw sayısı değişmez ve WebGL hatası yoktur.

Tarayıcı karşılaştırmalarındaki eski algoritmalar yalnız test fixture'ında bulunur;
üründe Legacy/Lake-like seçimi geri eklenmez. Otomatik kontroller yazılım WebGL
kanıtıdır. Bu koşudan sonra kullanıcı sahnedeki mevcut görünümü kabul etti;
gerçek GPU performans kabulü ayrıca değerlendirilmelidir.

## Kanıt dosyaları

- [Yüksek hız ve uzun süre normal ölçümleri](evidence/river-flow-glint-caustics/river-flow-bounded.json).
- [Ortak kenar normalleri](evidence/river-flow-glint-caustics/river-normal-edges.json).
- [HDR/bloom ölçümleri](evidence/river-flow-glint-caustics/river-hdr-sun.json),
  [önce](evidence/river-flow-glint-caustics/river-hdr-before.png),
  [sonra](evidence/river-flow-glint-caustics/river-hdr-after.png).
- [Caustic kenar sürekliliği](evidence/river-flow-glint-caustics/caustic-edges.json),
  [gerçek caustic desen çıktısı](evidence/river-flow-glint-caustics/caustic-pattern.png).

HDR ekran görüntüleri sınırlı bir fixture açısını gösterir; tek başına kullanıcının
gönderdiği Terrain kamera açısındaki parıltı kabulü sayılmaz. Normal tanı ölçümü
üçgen kenarındaki sürekliliği doğrudan kontrol eder.
