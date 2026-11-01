# Su ve yaprak arkasından görünen AO: uygulama planı

Tarih: 2026-11-01  
Durum: Kısmi uygulama teslim edildi; su ve performans/görsel kabulü açık.
Kapsam: Forge ortak editor/runtime render katmanı.

## 1. Amaç ve görülen sorun

Öndeki su yüzeyi veya yaprağın arka yüzü renk görüntüsünde görünürken, arkasındaki aracın AO kararmaları bu yüzeylerin üzerinde beliriyor. AO'nun kullandığı normal/derinlik görüntüsü ile renk görüntüsünün yüzey kapsamı uyuşmuyor.

Hedef, öndeki yüzeyin görünürlüğünü AO hesabında doğru temsil etmek; normal katı nesnelerin temas AO'sunu, suyun geçirgenliğini ve yaprakların kesilmiş siluetini korumaktır. AO şiddetini azaltmak veya AO'yu kapatmak çözüm sayılmaz.

Bu belge tek başına uzak oturumda uygulamaya başlamak için yeterli bağlamı içerir. Önceki sohbet ve ekli görsellerin uzak oturumda bulunacağı varsayılmamalıdır; bağımsız bir yeniden üretim sahnesi hazırlanmalıdır.

## 2. Doğrulanmış kod bulguları ve doğrulama sınırı

- `engine/render-three/postProcess.ts`: `ForgeGtaoPass`, Three.js `GTAOPass` normal/derinlik override'ını kullanıyor. `_overrideVisibility`, `depthWrite: false` nesneleri `compositedWaterSurface` istisnası dışında çıkarıyor.
- Kurulu Three.js sürümü `0.184.0`. `GTAOPass.normalMaterial` varsayılan `FrontSide`; nesnenin `DoubleSide`, alfa kesimi ve özel malzeme davranışı otomatik aktarılmıyor. Node üzerinde yüz yönleri doğrulandı. Bir yaprağın renk geçişi çift taraflıyken AO geçişinin yalnız ön yüzü çizmesi mümkündür.
- GTAO son renk görüntüsünü tam ekranda çarpar; blend malzemesinde derinlik testi kapalıdır. Yanlış arka yüzeyden hesaplanan AO, öndeki renk pikseline bu nedenle taşınabilir.
- `lakeWater.ts` ve `riverWater.ts`, sahne kopyası bulununca `userData.compositedWaterSurface` ayarlıyor. Her iki su türünde de bu işaret mevcut; River için eksik olduğu varsayılmamalı.
- `waterSceneSnapshot.ts:read`, `source.samples !== 0` olduğunda kopya döndürmüyor. `postProcess.ts:createFloatDepthTarget`, uzak görüş yolu için `samples: 4` oluşturuyor. Bu yolda su AO kapsamından çıkabilir.
- `lakeWater.ts:renderSceneWithLakeOverride`, yalnız dalga yüksekliği sıfırdan büyük Lake nesnelerine özel çift taraflı ve dalga yer değiştirmesini koruyan normal/derinlik malzemesi uyguluyor. Düz Lake ve River için aynı koruma varsayılamaz.
- `src/scene/SceneApp.ts` editor pipeline'ını `floatDepth` vermeden kuruyor; runtime bunu `farViewMode` ile seçiyor. Dolayısıyla kullanıcının görselini doğrudan MSAA/uzak görüş hatası diye etiketleme. Aktif yol ayrıca belirlenmeli.
- Önceki inceleme kaynak kod ve Node malzeme kontrolüyle sınırlıydı. Kullanıcının sahnesi tarayıcıda yeniden üretilmedi; kesin tetikleyici henüz görsel olarak doğrulanmadı.

## 3. Sınırlar ve çalışma ağacı

- Engine/editor kodu genel kalmalı. Araç modeline, belirli yaprağa veya LandscapeTest'e özel istisna ekleme.
- Gerçek sahne, terrain tile, model ve materyal varlıklarını çözüm için değiştirme. Testler için izole fixture kullan.
- Kullanıcı istemedikçe branch, commit, push veya deployment yapma.
- Başlangıçta `AGENTS.md` dosyalarını ve `git status --short` çıktısını oku. Var olan değişiklikleri kaydet, silme veya geri alma.
- Plan hazırlanırken şu dosyalar zaten değişmişti: `tests/builder/project-roots.test.mjs`, `tests/project/game-entry.spec.mjs`, `tools/engine-tests.ts`, `tools/saveValidator.ts`. Uzak oturumda listeyi yeniden doğrula. Özellikle test runner'ına ekleme gerekiyorsa mevcut farkları koru ve yalnız gereken satırları ekle.
- Genel `depthWrite: false` dışlamasını kaldırma: seçim decal'leri, bulutlar, parçacıklar, görünmez pick hacimleri ve ikonlar yeniden AO duvarı oluşturmamalı.
- Beauty malzemelerinde topluca `depthWrite: true` yapma. Su sıralaması, renk/derinlik kopyası ve transparan katman davranışı bozulmamalı.
- Three.js bağımlılığını yükseltme veya `node_modules` kaynaklarını kalıcı çözüm olarak değiştirme.

## 4. Uygulama adımları

### A. Yeniden üret ve tanıyı kesinleştir

1. Sabit kamera, ışık, çözünürlük ve kaliteyle izole bir browser fixture kur. Küçük bir katı nesne kümesi araçtaki temas ve boşluk AO'sunu temsil edebilir; gerçek kamyon modeli zorunlu değil.
2. Önüne çift taraflı düz bir yaprak kartı ve alfa kesimli yaprak kartı koy. Kartın önünden ve arkasından bak. Görselde kapalı piksel ile alfa deliğini ayrı kontrol et.
3. Aynı düzeni Lake ve River ile tekrarla. Düz/dalgalı Lake, su üstü/su altı, normal hedef ve uzak görüş/MSAA yollarını kapsa.
4. AO açık/kapalı renk görüntüsü, AO normal ve derinlik çıktıları al. Gerekirse yalnız test fixture'ında tanı araçları ekle. Öndeki yüzeyin AO çıktısında gerçekten kaybolduğunu doğrula.
5. Hangi malzemenin `side`, `alphaTest`, `depthWrite` değerleri ve hangi snapshot durumu sorunu tetikliyor, kaydet. Görüntüyü yalnız fiziksel su geçirgenliğinden ayır: su altındaki nesnenin doğal görünmesi hatanın kendisi değildir.

### B. Yaprak ve genel malzeme uyumunu düzelt

1. Mevcut AO geçişinde nesne/malzeme slotuna uygun normal malzemesi üretme veya geçici bağlama yaklaşımı seç. Orijinal yüz yönü, kesim dokusu/UV'si, alfa eşiği ve gerekli opaklık davranışını koru.
2. Tek bir ortak normal malzemesini körlemesine `DoubleSide` yapmak tam çözüm değildir: tek taraflı nesne davranışını ve alfa siluetini korumaz.
3. Multi-material nesnelerde slot bazında katılımı ele al; tek opak slot yüzünden blend veya görünmez slotun katı AO yüzeyine dönüşmesini engelle.
4. Instancing, foliage fade/dither, skinning/morph ve mevcut terrain displacement yollarıyla etkileşimi incele. Bu değişikliğin etkilediği özellikleri koru; kapsam dışı genel materyal sistemi yeniden yazımına girme.
5. Geçici visibility/material/override değişikliklerini hata durumunda da `try/finally` ile geri yükle. Önbelleği malzeme değişiklikleri ve `dispose` sırasında doğru yönet; her kare yeni shader/material oluşturma.

### C. Suyun AO kapsamını tutarlı yap

1. AO katılımını yalnız snapshot'ın bulunmasına bağlayan varsayımı kaldıracak sınırlı bir tasarım seç. Snapshot mevcut/yok, Lake/River ve yüz yönleri aynı sözleşmeyle ele alınmalı.
2. İlk tercih mevcut normal/derinlik geçişi içinde yüzey kapsamını düzeltmektir. Su normal/depth proxy'si kullanılacaksa geometri, yüz yönü ve Lake dalga yer değiştirmesi gerçek yüzeyle eşleşmeli.
3. Tamamen opak su ile yarı geçirgen suyu ayır. Su yüzeyini her durumda katı AO duvarı yapmak, su altındaki doğal temas AO'sunu silebilir. Geçirgen yüzeyde alttaki AO'nun su rengi/yansıması üzerine filtresiz çarpılmasını engelle; kabul edilebilir geçirgenlik davranışını görsel kanıtla göster.
4. Snapshot fallback yolunu ve reversed depth davranışını koru. MSAA'yı kapatmak veya uzak görüşü devre dışı bırakmak çözüm değildir.
5. Mevcut Lake normal/depth override'ını yeni malzeme yaklaşımıyla uyumlu tut; dalgalı suyu iki kez çizme. River geometrisini de doğru yüz yönüyle işle.
6. Gerekli fiziksel uyum mevcut geçişte sağlanamıyorsa alternatifin nedenini, ek geçiş/bellek maliyetini ve görsel ödünleşimini raporla. Ek tam sahne render'ı, yeni tam ekran geçiş veya ayrı tam çözünürlüklü hedef gerektiren kapsamı uygulamadan önce kullanıcıya somut seçenek sun. Önce bağımsız yaprak düzeltmesini ve mevcut geçişte yapılabilen işleri tamamla.

### D. Regresyon kontrolleri ve kanıt

- Davranışı doğrulayan engine testleri ekle: yüz yönü ve alfa kesimi aktarımı, multi-material ayrımı, opt-out nesneler, geçici durumun geri yüklenmesi, önbellek/dispose yaşam döngüsü. Yalnız helper dönüşünü kontrol etmek görünür sorunun çözüldüğünü kanıtlamaz.
- Browser testinde kapalı yaprak piksellerinde arkadaki nesnenin AO izi görünmemeli; yaprak deliklerinden görünen nesne normal AO'sunu korumalı.
- Opak su/yüksek soğurma durumunda gizli nesnenin konturu suya basılmamalı. Geçirgen suda AO, görünen su altı nesnesiyle uyumlu kalmalı; yansıma ve köpükte bağımsız kararma izi oluşmamalı.
- Su kıyıları, dalga tepeleri, su üstüne çıkan katı parçalar, su altından bakış ve su katmanlarının kesişiminde yeni siyah çizgi/halo olmamalı.
- Terrain, normal katı nesneler, foliage fade, editor ikonları, seçim overlay'leri ve görünmez pick hacimlerinde AO regresyonu olmamalı.
- Sabit kamera ile önce/sonra ekran görüntülerini `docs/reports/images/ao-surface-occlusion/` altında tut. Minimal fixture'ı ve çalıştırma komutunu rapora yaz.

## 5. Kabul matrisi

| Durum | Beklenen sonuç |
| --- | --- |
| DoubleSide yaprak, ön/arka yüz | Kapalı bölgede arkadaki nesnenin AO izi yok |
| Alfa kesimli yaprak, ön/arka yüz | Kesilmiş siluet korunuyor; deliklerde arka nesnenin AO'su mevcut |
| FrontSide nesne ve karışık materyal slotları | Beauty görünürlüğü ve AO kapsamı uyumlu |
| Düz/dalgalı Lake, üstten/alttan | AO yüzeyi görünür geometriyle eşleşiyor |
| River, üstten/alttan | Aynı görünürlük sözleşmesi geçerli |
| Snapshot açık/fallback, normal/uzak görüş | Yola bağlı AO sızıntısı yok; derinlik/MSAA davranışı korunuyor |
| Geçirgen/opak su, kıyı ve köpük | Doğal geçirgenlik korunuyor; suya basılmış bağımsız AO konturu yok |
| Editor/runtime ve AO kapalı | Yeni görünürlük, sıralama veya yaşam döngüsü regresyonu yok |

## 6. Performans bütçesi ve ölçüm

Tahmin: orta boyutta uygulama; yaprak düzeltmesi küçük–orta, su yollarının ortak davranışı orta karmaşıklıkta. Kesin dosya/satır sayısı ve milisaniye garantisi yoktur.

- Hedef: ek tam sahne render'ı ve yeni tam ekran AO geçişi eklememek.
- Beklenen yük: AO geçişinde daha önce atlanan yüzeylerin çizilmesi, alfa dokusu okumaları, gerekli shader varyantları. Çift taraflı yoğun foliage ve yüksek poligonlu su ayrıca ölçülmeli.
- Aynı donanım, viewport, kamera, AO parametreleri ve sabit kaliteyle önce/sonra karşılaştır. Otomatik kalite düşüşünün AO'yu kapatarak sonucu gizlemesine izin verme.
- Isınmadan sonra en az üç eşlenmiş ölçüm al: küçük yeniden üretim sahnesi, yoğun foliage, geniş su yüzeyi. Frame CPU/GPU median ve p95, draw call, triangle, program/material/texture sayısını mevcut ölçüm araçları ölçebildiği kadar kaydet.
- GPU timer yoksa CPU/FPS verisini GPU süresi diye sunma. Uzak oturumun yazılımsal GPU ölçümünü kullanıcının RTX 3060 kabulü sayma.
- Performans kabul hedefi: ölçüm gürültüsünü aşan ek maliyetin düşük kalması. İnceleme eşiği olarak GPU p95'te hem yüzde 5'i hem 0.5 ms'yi aşan artış araştırılmalı; bu değer ölçülmüş sonuç veya önceden verilmiş performans garantisi değildir.
- Kamera/sahne değişimleri ve tekrarlı aç/kapat sonrasında kaynak sayıları sürekli büyümemeli. Gereksiz yeni draw veya hedef varsa nedenini raporla.

## 7. Çalıştırılacak kontroller

Uygulama sırasında yalnız ilgili regresyonları çalıştır; son değişiklikten sonra aşağıdaki gate'i bir kez tamamla. Yeni hata veya değişiklik olmadıkça aynı tam paketi tekrar tekrar çalıştırma.

```powershell
npx.cmd tsc --noEmit
npm.cmd run test:engine
npm.cmd run build:verify
```

Seçilen Playwright spec'ini repository konfigürasyonuna göre ayrıca çalıştır; exact komutu raporla. Browser kurulamıyorsa veya GPU yoksa bağımsız kod/test işlerini tamamla, başarısız/çalıştırılamayan kontrolü açıkça belirt. TypeScript ve engine testlerinin geçmesi görsel kabul yerine geçmez.

Bu görev render doğruluğuyla sınırlı; güvenlik taraması başlatma. Dev-server endpoint, save/load veya asset ingestion değişikliğine ihtiyaç doğarsa kapsam dışı say ve uygun Codex Security incelemesini öner; kullanıcı onayı olmadan tarama yapma.

## 8. Teslim ve tamamlanma koşulu

- Kod ve odaklı regresyon fixture/testleri.
- `docs/reports/AO_SURFACE_OCCLUSION_FIX_REPORT.md`: doğrulanan tetikleyiciler, seçilen çözüm, dokunulan dosyalar, kontroller, önce/sonra görselleri, performans sonuçları ve kalan sınırlar.
- Bu planın aşamalarını tamamlandı/kısmi/engelli olarak güncelle.
- Gerçek GPU veya browser doğrulaması yoksa uygulama/test tamamlanması ile görsel/performans kabulünü ayrı belirt. Kanıtsız olarak tüm iş tamamlandı deme.
- Son `git diff` kontrolünde ilgisiz mevcut değişiklikleri koruduğunu doğrula. Commit/push yapma.

## 9. Uzak oturumu başlatma istemi

```text
Forge deposunda docs/planned/AO_SURFACE_OCCLUSION_FIX_PLAN.md dosyasını ve geçerli AGENTS.md talimatlarını oku. Plandaki su/yaprak arkasından AO sızması düzeltmesini uygulamaya başla ve tanı, kod, regresyon testleri ve rapor teslimini tamamla.

Önce git durumunu incele; mevcut kullanıcı/eşzamanlı değişikliklerini koru. Önceki sohbet veya ekran görüntülerine erişimin olduğunu varsayma. Minimal fixture ile sorunu yeniden üret, normal/derinlik çıktılarıyla gerçek tetikleyiciyi doğrula. Plandaki bulguları güncel kodda yeniden kontrol et; özellikle editor sorununu otomatik olarak uzak görüş/MSAA kaynaklı sayma.

Mevcut AO geçişinde yüz yönü, alfa kesimi ve su yüzeyi kapsamını düzelt. Lake/River, düz/dalgalı su, snapshot fallback, normal/uzak görüş ve editor/runtime davranışlarını kapsa. Genel depthWrite:false dışlamasını kaldırma, beauty malzemelerini topluca değiştirme, AO'yu azaltarak hatayı gizleme. Geçirgen suyun doğal su altı AO'sunu koru. Yeni tam sahne render'ı/tam ekran geçiş/tam çözünürlüklü hedef gerekiyorsa plandaki kapsam sınırını izle; bağımsız işleri tamamlayıp somut alternatifi sun.

İlgili regresyonları ekle; son durumda TypeScript, test:engine, build:verify ve odaklı Playwright kontrollerini çalıştır. Ölçebildiğin performansı sabit koşullarda karşılaştır; uzak GPU verisini yerel donanım kabulü diye sunma. Browser/GPU engeli varsa bağımsız işleri sürdür ve doğrulama sınırını açık yaz.

Sonuçları docs/reports/AO_SURFACE_OCCLUSION_FIX_REPORT.md içine kanıtlarla yaz ve plan durumunu güncelle. Authored sahne/terrain/model verilerine dokunma. Branch, commit, push, deployment veya onaysız güvenlik taraması yapma. Son yanıtta değişikliği, test sonuçlarını, görsel/performans kabul durumunu ve kalan işleri kısa biçimde bildir.
```


## 10. Uygulama durumu (2026-11-01)

- A — Kısmi: yaprak hatası gerçek WebGL normal/depth fixture ile yeniden üretildi; su matrisi eksik.
- B — Kısmi: slot bazlı side/alfa malzemeleri, fade aktarımı, cache/dispose ve try/finally uygulandı; keyfi özel shader ve tüm deformasyonların görsel kabulü yapılmadı.
- C — Kısmi/karar gerekli: mevcut kompozit su slotları yüz yönü aktarımından yararlanır; snapshot fallback ve geçirgen su katman ayrımı çözülmedi. Ek geçiş/hedef seçenekleri raporda; 4.C.6 gereği uygulanmadı.
- D — Kısmi: engine regresyonları, odaklı Playwright ve önce/sonra çıktılar mevcut; tam su/görsel matrisi ve yoğun foliage/geniş su GPU performansı eksik.
- Teslim: `docs/reports/AO_SURFACE_OCCLUSION_FIX_REPORT.md`. Tüm kabul matrisi tamamlandı sayılmaz.
