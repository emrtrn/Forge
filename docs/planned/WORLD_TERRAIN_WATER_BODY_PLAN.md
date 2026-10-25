# World Terrain — Yol, Nehir ve Water Body Çalışma Planı

Tarih: 2026-10-25  
Durum: Ortak tasarım (8A0) ve ilk motor dilimi (8A1) tamamlandı; editör/nehir aktarımı henüz tamamlanmadı.
Ana plan: [OPEN_WORLD_PLAN.md](OPEN_WORLD_PLAN.md)

## 1. Amaç ve karar durumu

Bu belge, World Terrain üzerinde yol ve nehir desteği, eski arazi sisteminin
emekliliği ve göl/su birikintisi/deniz araçları hakkındaki konuşmayı kaydeder.
Sonraki kapsam ve uygulama kararları bu belge üzerinden takip edilecektir.

**Kullanıcının belirttiği ihtiyaçlar:**

- Yeni arazi modeli World Terrain'dir; yeni araçlar bu modeli hedeflemelidir.
- Eski arazideki spline yol ve nehir özelliklerinin yeni sistemdeki karşılığı
  ve eski sistemin tamamen kaldırılma sırası anlaşılır olmalıdır.
- Göl, su birikintisi ve deniz oluşturulabilmelidir.
- Sade bir plane yerleştirmek yeterli değildir; su araziyle temas etmeli,
  kıyısı ve derinliği araziyle ilişkili olmalıdır.
- Unreal Water aktörleri tasarım referansı olarak incelenmiştir.

**Öneri durumu:** Aşağıdaki Water Body mimarisi, araç davranışları ve geliştirme
sırası görüşme sırasında önerilmiştir. Dokümantasyon isteği, bu önerilerin
tamamının uygulanmasına verilmiş onay olarak yorumlanmamalıdır. Henüz teslim
tarihi veya uygulanacak ilk dilimin ayrıntılı kapsamı belirlenmemiştir.

## 2. İncelemede doğrulanan mevcut durum

2026-10-25 tarihli plan ve kaynak kod incelemesine göre:

| Konu | Durum |
| --- | --- |
| World Terrain | Çok tile'lı arazi, sculpt/paint, yükseklik sorgusu ve streaming altyapısı mevcut. |
| Eski CPU chunk renderer | Ana planda kaldırılmış olarak kayıtlı. |
| World Terrain'e bağlı yol spline'ları | Çok tile üzerinde düzenleme ve çizim aktarımı tamamlanmamış; editörde spline işlemi engelleniyor. |
| River Water | Eski Landscape/spline referanslarıyla çalışan mevcut su altyapısı var; World Terrain aktarımı tamamlanmamış. |
| Bağımsız Generic Spline yolları | Kullanılabilen ayrı bir yol üretim yolu; araziye bağlı yol/nehir araçlarının tüm işlevlerini karşılamıyor. |
| Lake / Puddle / Ocean | Bu belgede önerilen ortak Water Body araçları henüz uygulanmadı. |

Kaynak başlangıç noktaları:

- [World Terrain ana planı](OPEN_WORLD_PLAN.md): Faz 8 ve bağımlılıklar bölümü.
- [SceneApp](../../src/scene/SceneApp.ts): Çok tile'da spline işlemini engelleyen
  kontrol ve mevcut River Water editör bağlantıları.
- [terrainTypes.ts](../../engine/terrain/terrainTypes.ts): Eski spline verisinin
  henüz yerel koordinatlarla taşındığını belirten tanım.
- [riverWater.ts — veri ve ayarlar](../../engine/scene/riverWater.ts).
- [riverWater.ts — çizim](../../engine/render-three/riverWater.ts).
- [terrainHeightQuery.ts](../../engine/terrain/terrainHeightQuery.ts).
- [terrainEdit.ts](../../engine/terrain/terrainEdit.ts): Kirli bölgeler ve undo patch altyapısı.

Bu durum kaydı uygulama ilerledikçe güncellenmelidir; bir özelliğin planda
bulunması, tamamlandığı veya tarayıcıda kabul edildiği anlamına gelmez.

## 3. Yol ve nehir desteği ne zaman gelecek?

Ana planda **Faz 8 — Editör dünya araçları** altında şu iş tanımlı:

- Landscape spline ve River Water verisini dünya koordinatlarına taşımak.
- Spline'ı terrain'e bağlamak.
- Arazi şekillendirme ve boyamayı birden fazla tile'a uygulamak.

Kesin teslim tarihi yoktur. Ana plan, Faz 8'in **Faz 2'den sonra parça parça**
yapılabileceğini belirtir; Faz 3–7'nin tamamının bitmesini beklemek gerekmez.

Görüşmede önerilen öncelik, eski düzenleme altyapısı kaldırılmadan önce yol ve
nehir işlevlerini World Terrain'e taşımaktır. Yolun arazi yatağı, boyası, mesh'i
ve çarpışması; nehrin yatağı, su yüzeyi ve akışı ayrı kabul maddeleri olmalıdır.

## 4. Eski arazi sisteminin kaldırılması

Kesin tarih yoktur. Ana planda bağımlılıklara dayanan iki ayrı kaldırma adımı vardır.

### 4.1. Eski düzenleme köprüsünün kaldırılması

1. Spline ve River Water World Terrain'e taşınır.
2. Faz 6'nın prosedürel çim maddesinin tamamlanma durumu doğrulanır ve varsa
   kalan işler bitirilir.
3. Tek tile da çok tile ile aynı `terrainEdit.ts` / `worldTerrainActor.ts`
   düzenleme yoluna geçirilir.
4. `ForgeLandscapeData` köprüsü, ilgili adaptörler ve editördeki tek tile/çok
   tile ayrımları kaldırılır.

### 4.2. Eski dosya biçiminin emekliliği

1. Eski projeler/fork'lar için toplu dönüştürme komutu ve `--check` kontrolü hazırlanır.
2. Geçiş duyurusu/upstream notu yayımlanır ve bir geçiş süresi tanımlanır.
3. Geçiş tamamlanınca eski `.landscape.json` okuyucusu, `terrainLegacy.ts`,
   `validateLandscapeData` ve eski dosyalar kaldırılır.
4. `runtime-parity.landscape.json` gibi test referanslarının durumu ayrıca değerlendirilir.

**Açık:** Geçiş süresinin uzunluğu, hedef sürüm/tarih ve tam kaldırmanın ayrıntılı
kabul listesi belirlenmemiştir. Yol ve nehir aktarımı, bu emeklilik işinin bir
bağımlılığıdır; yeni göl aracının yapılması tek başına eski sistemi kaldırmaya yetmez.

## 5. Unreal Water referansından çıkarılanlar

Epic belgelerine göre:

- **Lake:** Kapalı spline, ortak su seviyesi ve altındaki araziyi oyma davranışı.
- **River:** Açık spline; noktalar farklı yüksekliklerde olabilir; genişlik,
  derinlik ve akış bilgisi taşır.
- **Ocean:** Kıyıyı tanımlayan spline ve uzak mesafeye uzanan su yüzeyi.
- **Arazi etkisi:** Landscape üzerinde Edit Layers açıkken su aktörü araziyi
  düzenleyebilir. Derinlik profili, kıyı eğimi ve geçiş genişliği ayarlanabilir.
- **Water Zone:** Su yüzey parçalarının üretimini ve detay seviyesini yönetir;
  uzakta daha sade deniz yüzeyi kullanılabilir.

Referanslar, 2026-10-25 tarihinde incelendi:

- [Epic — Water Body Actors](https://dev.epicgames.com/documentation/en-us/unreal-engine/water-body-actors-in-unreal-engine)
- [Epic — Water Meshing System and Surface Rendering](https://dev.epicgames.com/documentation/en-us/unreal-engine/water-meshing-system-and-surface-rendering-in-unreal-engine)

Forge için öneri, bu iş akışının World Terrain'e uygun, tarayıcı bütçesine göre
kademeli bir karşılığını geliştirmektir. Unreal ile birebir özellik eşitliği
bu görüşmede hedef veya taahhüt olarak belirlenmemiştir.

## 6. Öneri: Ortak Water Body aktörü

Gölün ve durgun suyun ortalama yüzeyi yatay kalır. Araziyle uyum sağlayanlar
**kıyı çizgisi, su derinliği ve yataktır**. Yüzeyi zeminin her eğimine yapıştırmak
yerine su seviyesinin araziyle kesişimi hesaplanmalıdır.

| Tür | Oluşturma | Araziyle ilişki |
| --- | --- | --- |
| Lake | Kapalı spline veya mevcut çukurda başlangıç noktası | Çukuru doldurma; isteğe bağlı yatak oluşturma. |
| Puddle | Küçük alan çizme/boyama veya zemine tıklama | Sığ çöküntüde su; çevresinde isteğe bağlı ıslaklık. |
| Ocean | Deniz seviyesi ve kapsama alanı | Kara/adaları dışarıda bırakan kıyı; uzak yüzey ve LOD. |
| River | Açık spline; genişlik, derinlik ve akış | Nehir yatağı; göl/deniz bağlantısı. |

Ortak veri için önerilen başlıklar: aktör kimliği, tür, terrain referansı,
dünya koordinatlarında alan/spline, su seviyesi veya nehir profili, görünüm,
dalga, yansıma ve isteğe bağlı arazi etkisi. Kesin şema uygulama öncesinde tasarlanacaktır.

### 6.1. Lake: Mevcut çukuru doldur

1. Kullanıcı çukurun içine tıklar ve çalışma alanını sınırlar.
2. Su seviyesini ayarlar.
3. Araç, sınırlar içinde başlangıç noktasına bağlı ve su seviyesinin altında
   kalan bölgeyi hesaplar. Aynı seviyedeki bağlantısız başka çukurları doldurmaz.
4. Gerçek kıyı, su seviyesi ile arazi kesişiminden çıkarılır. Yüksek bölgeler
   kara/ada olarak kalır.
5. Seviye taşma eşiğini aşarsa önizlemede gösterilir. İlk sürümde bunun gerçek
   zamanlı taşma/akış simülasyonu olduğu iddia edilmez.

İç bölgelerde keyfî bir spline kenarının suyu duvar gibi kesmemesi gerekir.
Seçilen sınır su altında kalıyorsa alanın kesildiği kullanıcıya gösterilmeli veya
yatak oluşturma yoluna yönlendirilmelidir. Bu davranışın ayrıntısı açık karardır.

### 6.2. Lake: Göl yatağı oluştur

1. Kullanıcı kapalı spline çizer.
2. Su seviyesi, maksimum derinlik, kıyı eğimi ve sahil/geçiş genişliğini ayarlar.
3. Yatak ve kıyı önizlenir.
4. İlk sürüm için öneri: **Araziye uygula**, tek undo/redo komutuyla ilgili
   tile'ların yüksekliklerini ve isteğe bağlı kıyı boyasını değiştirir.

Aktörü sonradan taşımak/silmek, uygulanmış eski yatağı kendiliğinden geri
getirmiş sayılmaz. Aktöre bağlı, tekrar düzenlenebilir ve otomatik geri alınan
arazi etkisi için ayrıca bir arazi düzenleme katmanı/modifier tasarımı gerekir.

### 6.3. Görsel temas ve derinlik

- Kıyı, düz dikdörtgen kenar yerine terrain kesişiminden üretilir.
- Derinlik, su seviyesi ile zemin yüksekliği farkından hesaplanır.
- Sığ/derin renk, taban görünürlüğü ve ışık soğurulması derinliğe bağlanır.
- Dalgalar kıyıya yaklaştıkça azaltılır; su kara üzerine taşırılmaz.
- İsteğe bağlı kıyı köpüğü ve nemli toprak bandı eklenir. Puddle için köpük
  varsayılan olarak kapalı önerilir.
- Sculpt/paint sonrasında etkilenen alanın su verisi güncellenir.

### 6.4. World Terrain ve ölçek koşulları

- Su alanı tek tile ile sınırlı olmamalı; sınırda kıyı, derinlik ve yüzey dikişi oluşmamalı.
- Eksik/yüklü olmayan tile, sıfır yükseklik veya otomatik derin su sayılmamalı.
  Kesin kıyı hesabı ve arazi uygulaması için gereken tile'lar yüklenmelidir.
- Yakın kıyı hesabı kesin terrain verisini kullanmalı; uzaktaki sadeleştirme
  ayrıca tanımlanmalıdır.
- Örneğin 1 m vertex aralıklı arazi, 20–30 cm ölçekli küçük çukurları yeterli
  ayrıntıyla temsil edemez. Küçük Puddle için yerel detay geometrisi veya
  ıslaklık malzemesi desteği ayrıca değerlendirilmelidir.
- İlk hedef World Terrain yüzeyidir. Statik mesh üstünde birikinti, mağara veya
  katlı su hacimleri bu öneriyle kendiliğinden çözülmüş olmaz.

## 7. Mevcut koddan yararlanma

Mevcut River Water'da dalga, köpük, sığ/derin renk, taban görünürlüğü, soğurulma
ve paylaşımlı düzlemsel yansıma ayarları bulunuyor. Bunlar ortak su görünümüne
taşınabilir; mevcut nehir şeridi geometrisi doğrudan bir göl çözümü sayılmamalıdır.

`terrainHeightAt` kesin dünya yüksekliği sağlar; yüklenmemiş tile'da `null`
döndürür. Su hesabı bu durumu açıkça ele almalıdır. `terrainEdit.ts` içindeki
kirli dikdörtgenler ve undo patch yapısı yatak uygulaması için başlangıçtır.

## 8. Önerilen geliştirme sırası

Bu sıra görüşme önerisidir; her dilimin kapsamı uygulama öncesinde netleştirilecektir.

- [ ] **W0 — Tasarım:** Veri şeması, alan/başlangıç noktası davranışı, kıyı
  üretimi ve mevcut River Water ile ortaklaşma sınırlarını belirle.
- [ ] **W1 — Lake / mevcut çukur:** Kapalı sınır, su seviyesi, bağlantılı alan,
  gerçek kıyı, derinliğe bağlı görünüm, seçim/düzenleme, undo/redo ve kayıt/reload.
- [ ] **W2 — Yatak oluşturma:** Derinlik profili, kıyı geçişi, önizleme ve tek
  undo komutuyla çok tile'a uygulama; isteğe bağlı kıyı boyası.
- [ ] **W3 — Puddle:** Küçük alan aracı, sığ su/ıslaklık görünümü; terrain
  çözünürlüğü sınırına göre yerel detay yaklaşımı.
- [ ] **W4 — Ocean:** Deniz seviyesi, kara/ada sınırı, yakın yüzey, uzak LOD.
- [ ] **W5 — River ortaklaşması:** World Terrain spline/nehir aktarımıyla ortak
  Water Body veri/görünüm altyapısını ve göl/deniz birleşimlerini bağla.

World Terrain yol/nehir aktarımı ana planın kendi işi olarak ayrıca ilerleyebilir.
W5'in bu listede sonda olması, mevcut River Water aktarımının W1–W4'ü beklemesi
gerektiği anlamına gelmez; ortak şema W0'da birlikte düşünülmelidir.

İlk sürüm dışında önerilen işler: yağmurla dolma/kuruma, hacim koruyan akış ve
taşma simülasyonu, yüzdürme, yüzme, araçların su davranışı ve su altı görünümü.
Görsel su yüzeyi, bu oyun/fizik davranışlarını otomatik sağlamaz.

## 9. İlk uygulama için kabul ve doğrulama taslağı

- [ ] İki tile sınırını geçen gölde yüzey ve kıyı süreklidir.
- [ ] Ada korunur; bağlantısız çukur yanlışlıkla dolmaz; alan sınırında kesilme
  ve taşma durumu anlaşılır gösterilir.
- [ ] Su seviyesi değişince kıyı/derinlik güncellenir; kuru zeminde su görünmez.
- [ ] Eksik tile senaryosu düz/sıfır zemin varsayımına düşmez.
- [ ] Sculpt, undo/redo ve kaydet–yeniden aç akışlarında su/terrain tutarlılığı korunur.
- [ ] Yatak uygulaması yalnız hedef alana etki eder, seam kopyaları eşittir ve
  undo hem yükseklik hem boya değişikliğini geri alır.
- [ ] Tarayıcıda yakın kıyı, uzak görünüm, sığ taban ve dalga geçişi incelenir;
  konsol hataları kontrol edilir ve hedef sahnede maliyet ölçülür.

TypeScript değişikliklerinde `npx.cmd tsc --noEmit`; engine/runtime işlerinde
pratik olduğu ölçüde `npm.cmd run test:engine` ve `npm.cmd run build:verify`
çalıştırılır. Tarayıcıya dönük su/kıyı akışları ayrıca Playwright ile doğrulanır.
Veri alanları kaydetme validator'larına eklenmelidir. Save/load sınırları
değişirse uygun kapsamlı Codex Security incelemesi önerilir; kullanıcı onayı
olmadan scan başlatılmaz.

## 10. Açık kararlar ve sonraki oturum

- İlk uygulama dilimi olarak W0 + sınırlandırılmış W1 seçilecek mi?
- Lake için spline sınırı mı, başlangıç noktasıyla doldurma mı önce sunulacak;
  diğer yöntem aynı sürüme girecek mi?
- Alan sınırında suyun kesilmesi ve taşma önizlemesi nasıl davranacak?
- İlk sürümde kullanılacak kıyı üretim yöntemi ve görünüm kalitesi ne olacak?
- Yatak uygulaması bake + undo ile mi başlayacak; modifier katmanları ne zaman ele alınacak?
- İlk hedef sahne, minimum su alanı ölçeği ve performans kabul bütçesi ne olacak?
- Eski araziyi kaldırmak için hedef sürüm, geçiş süresi ve kabul listesi ne olacak?

**Devam noktası:** Bu belgeyi ve ana planın güncel Faz 8 durumunu oku; W0'da
ilk dilimin kapsamını somutlaştır. Uygulamaya başlamadan önce yeni kararları
buraya işle. Bu dokümantasyon turunda motor, editör veya sahne verisi değiştirilmedi.

## 11. Uygulama başlangıcı — 2026-10-25

Kullanıcı, W0 ortak tasarım → Faz 8 yol/nehir aktarımı → W1 ve sonraki su
araçları sırasını onayladı. Faz 8'in tüm dünya araçlarının bitmesi beklenmez.
Aktarımın ana durum kaydı `OPEN_WORLD_PLAN.md` Faz 8'dir; bu belge yeni su
araçlarının ayrıntılı alt planıdır. Yukarıdaki ilk görüşme kaydı tarihsel bağlamdır.

### 11.1. İlk dilimin tasarım kararları

- Dünya spline'ı kontrol noktaları mutlak dünya XYZ koordinatlarındadır.
  Tangent'lar yön/uzunluk vektörleridir; konum dönüşümünde ötelenmez.
  Nokta/segment/spline kimlikleri korunur; mevcut River Water referansları
  ileride aynı kimliklere bağlanabilir.
- İlk motor API'sinde `coordinateSpace: "world"` zorunludur. Mevcut
  `WorldTerrainDef.splines` alanı hâlâ merkez-yerel veridir; bu dilimde diskteki
  anlamı değiştirilmez. Dönüşüm kopya üretir, kendiliğinden kaydetmez.
  Kalıcı dünya şemasına geçiş; okuyucu, validator, 1×1 köprü, editör/runtime
  ve save/reload birlikte ele alındığında yapılacaktır.
- Yol ve nehir yatağı aynı koridor deform/boya matematiğini kullanır.
  Yükseklik dünya Y'den `origin[1]` datumuna çevrilir. Tek tile ve çok tile
  için aynı `terrainEdit` patch yolu kullanılır; tüm sınır kopyaları aynı
  sahip vertex'ten hesaplanır. Boya sekiz katmana kadar desteklenir ve RGBA8
  toplamı tam 255 olur.
- Uygulama önce patch'leri hazırlar; canlı tile'a yazmaz. Gerekli tanımlı
  tile eksikse işlem hata verir ve hiçbir yükseklik/boya/özet değişmez.
  Terrain'deki gerçek delikler atlanır, üretilmez. Editör entegrasyonu gerekli
  tile'ları yükleyip sabitleyecek, patch'leri tek undo komutuyla uygulayacak ve
  renderer/collider/kirli kayıt durumunu güncelleyecektir.
- Görünüm ortaklaşması ilk olarak River Water'ın görünüm ayarları ve kesin
  dünya yüksekliği sorgusu etrafında yapılacaktır. Göl kıyı geometrisi nehir
  şeridinden ayrı kalır; düzlemsel yansıma ve dalga/köpük yeniden kullanımı
  nehir aktarımında değerlendirilir. Bu dilimde shader veya fizik değişmez.

### 11.2. Sıralı iş dilimleri

- [x] **8A0 / W0-ortak:** Yukarıdaki koordinat, kimlik, işlem ve ortaklaşma
  sınırlarını belirle.
- [x] **8A1 / motor:** Dünya spline dönüşümü; çok tile deform/boya patch'leri;
  dikiş, eksik tile, delik, datum, yön kısıtları, undo/redo ve tile codec kontrolleri.
- [ ] **8A2 / veri:** Dünya spline şeması ve açık migrasyon; runtime/save ortak
  validator, 1×1 uyumluluk, save/reload; mevcut referansların korunması.
- [ ] **8A3 / yol editörü:** Draw/Edit, kontrol noktası gizmo'su, terrain'e
  bağlama, tile yükleme/sabitleme, tek undo komutu ve kirli kayıt bağlantısı.
- [ ] **8A4 / yol çıktısı:** Dünya spline mesh'i, terrain normal hizalaması,
  çarpışma ve tarayıcıda iki tile'ı geçen yol kabulü.
- [ ] **8A5 / nehir:** Dünya koordinatlı nehir yatağı/yüzeyi, kesin derinlik,
  akış, sculpt sonrası güncelleme ve eksik tile davranışı; tarayıcı kabulü.
- [ ] **W0-Lake + W1:** Göl şeması, başlangıç noktası/kapalı sınır davranışı,
  kıyı üretimi, hedef sahne ve ölçülmüş performans bütçesini kesinleştir;
  ardından mevcut çukuru dolduran Lake aracını uygula.

İlk dilim editör engelini kaldırmış veya yol/nehir aktarımını bitirmiş sayılmaz.
Eski köprü/dosya biçimi emekliliği, Faz 8'deki diğer bağımlılıklar ve geçiş
koşulları tamamlandıktan sonra ayrıca ele alınır.

### 11.3. 8A1 sonucu ve doğrulama — 2026-10-25

- `engine/terrain/terrainSplines.ts`: açık dünya koordinatı işareti taşıyan
  spline API'si; merkez-yerel ↔ dünya kopya dönüşümleri; ortak koridor
  örneklemesiyle deform, boya veya ikisini birden hazırlama.
- `terrainEdit.ts::createTerrainRegionPatches`: canlı veriyi değiştirmeyen
  bölgesel patch hazırlama; değişen tile dikdörtgenleri, sahip vertex'ten
  seam kopyalama ve mevcut apply/revert patch yoluyla undo/redo.
- Tek senkron işlemin kapsayıcı grid dikdörtgeni en fazla **1.048.576 vertex**
  içerir; büyük bölgeler açık hata verir. Bu bir bellek/iş sınırıdır,
  performans kabulü değildir. Büyük spline'ların bölgelere ayrılıp tek komut
  olarak birleştirilmesi ve worker/önizleme bütçesi sonraki entegrasyonda açıktır.
- `tests/engine/terrainSplines.test.ts` içindeki **11 regresyon** geçti:
  koordinat/tangent/kimlik korunumu, dört tile birleşimi, eksik tile'da
  atomiklik, delikler, koridor dışındaki eksik tile, sekiz katman boya toplamı,
  yön kısıtları/datum, mevcut smooth 1×1 davranışıyla karşılaştırma,
  undo/redo, f32 tile codec ve tanım round-trip'i, geçersiz veri/iş sınırı.
- `npx.cmd tsc --noEmit` ve yeni test dosyasının ayrı TypeScript kontrolü geçti.
  Tam `npm.cmd run build:verify` geçti: **1.916 engine kontrolü**, import,
  smoke fixture izolasyonu, content/UI tip kontrolleri, release araçları,
  üretim derlemesi, strict dist ve world-data kontrolleri dahil.
- Bu dilimde editör/runtime spline bağlantısı, kalıcı dünya spline şeması,
  kullanıcı arayüzünden save/reload ve yol/nehir çizimi uygulanmadı;
  Playwright/görsel/performance kabulü yapılmadı. Codec round-trip'i uçtan uca
  editör kaydı olarak sayılmaz. Çalışma sırasında dışarıdan değişen
  LandscapeTest terrain dosyalarına dokunulmadı; commit/push yapılmadı.

**Sonraki adım:** 8A2'de kalıcı dünya spline şemasını ortak runtime/save
validator ve 1×1 uyumlulukla taşı; sonra 8A3 editör bağlantısı. Save/load
sınırlarını değiştiren bu sonraki dilim için kapsamlı bir Security diff
incelemesi önerilir; kullanıcı onayı olmadan scan başlatılmaz.
