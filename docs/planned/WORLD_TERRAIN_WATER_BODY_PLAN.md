# World Terrain — Yol, Nehir ve Water Body Çalışma Planı

## Güncel uygulama — Islak kıyı zemini — 2026-10-28

Kullanıcı ıslak zemin bandının uygulanmasını istedi. İlk kapsam Lake'e bağlı
terrain sunumudur: gerçek kıyı ve ada segmentlerinden kara tarafına mesafe
maskesi; renk koyulaştırma ve roughness azaltma. Paint ağırlıkları, yükseklik,
physical material, araç tutunması veya batması değiştirilmez. Efekt geçicidir;
Lake gizlenir/silinir veya ayar kapanırsa kalkar. Islanma/kuruma simülasyonu yok.

Lake Details → **Wet Shore**: Enabled, Width (m), Strength. Eski kayıtlarda
kapalı; varsayılan genişlik 1 m ve şiddet 0,65. Bandın 0,35 m'den yüksek
zemine taşması engellenir; su çizgisinde keskin ton farkı bırakmamak için suyun
8 cm altından başlayarak karaya yumuşak geçer. Genişlik azami yatay mesafedir;
dik yamaçta yükseklik sınırı gerçek bandı daraltır. River ve mesh taşlar bu
ilk dilime dahil değildir.

Yeni terrain fragment sampler'ı gerçek sampler/CSM/water bütçesine eklendi;
sınır gevşetilmedi. Maske en çok 1024² R8/göl, en çok 8 gövde; shader'a ortak
R8 array olarak yüklenir. Ayrı draw/capture yok. Üretim yeniden build sırasında
senkrondur; büyük dünya CPU/GPU performans kabulü açık. Genişlik/alan çözünürlük
sınırını aşarsa açık over-budget tanısı mevcut kaynak ayarını korur.

Kaynak ömrü, terrain referansı/görünürlük, eski varsayılanlar, kaynak shader
sampler sayımı, UI/undo/kayıt ve terrain hash korunumu test edilir.
[Uygulama kaydı](../reports/LAKE_WET_SHORE_2026-10-28.md).

## Güncel uygulama — Yumuşak Lake kıyı geçişi — 2026-10-28

Kullanıcı, keskin su/zemin çizgisi için önerilen geçişin plana eklenmesini ve
uygulanmasını istedi. İlk adım gerçek su geometrisini koruyarak su rengi,
örtücülük, yansıma, küçük normal dalgaları ve köpüğü kıyıda birlikte söndürür.
Köpük tek başına kenarı örtmek için kullanılmaz; sürekli beyaz çizgiye dönüşmez.

Geçiş, kaynak terrain derinliği ile varsa görünür dip derinliğinin küçük olanına
bağlıdır. Böylece kamera snapshot'ının kıyıdan farklı derinlik vermesi kuru kenarı
opaklaştırmaz. Dünya sabit, düşük genlikli ve yavaş noise geçiş kalınlığını
çeşitlendirir; vertex/kıyı konumu değiştirilmez ve karaya su taşınmaz.
`Shore Blend Depth (m)` geçişin düşey derinliğidir; sığ eğimde yatay bant geniş,
dik kıyıda dardır. Her eğimde aynı metre yatay bandı veya dik duvarın arkasına
su uzatılması vaat edilmez. 0 değeri karşılaştırma/eski görünüm için kapatır.

Snapshot yolunda son su/köpük ışığı gerçek dip rengine karışır; yalnız alpha'yı
azaltmak yeterli değildir. Direct/MSAA fallback'te aynı etki straight-alpha
örtücülüğüne uygulanır. Kıyıda normal/parlaklık sönmesi aynı katsayıyı kullanır.
Yeni capture, mesafe dokusu veya draw eklenmez. Terrain boyası değiştirilmez;
ıslak zemin bandı sonraki ayrı dilimdir.

Kabul: köpük açık/kapalı, snapshot/direct, yakın/genel kamera; sığ ve dik kıyı,
ada/kuru/ayrı çukur ve derin bölgenin korunması; hareketli görüntüde titreme,
Save/Reload/Play, shader/GL hataları, TypeScript ve tam build:verify. Donanım
GPU kabulü açık kalır. İlk köpük ve bu geçiş kodu henüz main'e gönderilmedi.
[Uygulama kaydı](../reports/LAKE_SHORE_TRANSITION_2026-10-28.md).

## Güncel kullanıcı isteği — Göl yüzeyi ve tekerlek dalgaları — 2026-10-28

Köpük çalışmasına ek kapsam: son TV fotoğrafındaki gibi, küçük ve birbirine
karışan dalgacıkları olan doğal göl yüzeyi; sığ kıyıda dip görünürlüğü, açıya
bağlı yansıma ve parçalı ışık parlamaları. Fotoğraftaki büyük düzenli/renkli
çizgiler TV-kamera moiré'si olabilir; birebir dalga deseni veya renk hedefi
sayılmaz. Tek fotoğraf dalganın hareketini/yönünü kanıtlamaz. Göl yüzeyi,
nehir akışını zorunlu kılmadan bu görsel karakteri sağlayabilmelidir.

**Araç etkileşimi:** Tekerlek geçerli göl yüzeyine girdiğinde suya temas yerinden
başlayan, teker hareketiyle güçlenen ve dışarı yayılarak sönen dalgalar oluşmalı.
İlerleme, dönüş ve patinaj etkisi ayırt edilmeli; duran teker sürekli enerji
üretmemeli. Dalga yalnız tekerin terrain'e/mud'a bastığı anda değil, teker hacmi
su yüzeyini kestiğinde de üretilebilmeli. Kuru zemin, taş üstü, havadaki ve su
yüzeyinin tamamen altındaki teker için sahte yüzey teması oluşturulmamalı.

Mud'daki mevcut teker batması, terrain deformasyonu ve su dalgası birlikte
referanstır; **gölün kendisi terrain'i batırmaz veya oymaz**. Zemin mud ise
mevcut batma sürer; sert zeminde yeni çamur deformasyonu eklenmez. Dalga
sunumu yüzdürme, su direnci, yüzme veya hacim/akış fiziği teslimi değildir.

Kaynak incelemesi: `terrainWaterState.ts` ve `terrainWater.ts` dünya sabit,
sınırlı impulse/ripple, hareket/patinaj enerjisi, cooldown ve sönme içeriyor.
`terrainDeformationModule.ts` temasları mud/deformation yolundan topluyor.
Bu olay/enerji ilkeleri yeniden kullanılmalı; mud maskesi veya deform alanı
Lake'e doğrudan bağlanmamalı. Lake için bağımsız su seviyesi/bağlı yüzey
sorgusu ve teker–su kesişimi gerekir.

**Önerilen ilave sıra:** L1 doğal yüzey görsel ayarı → L2 bağımsız teker–Lake
temasları ve sınırlı ripple sunumu → L3 köpük/caustics/yansıma ile ortak kabul.
Detaylar ve test matrisi
[köpük ve yüzey araştırmasının ilave bölümünde](../reports/WATER_CONTACT_FOAM_RESEARCH_2026-10-28.md#göl-yüzeyi-ve-tekerlek-etkileşimi--ilave-kapsam).
Bu kullanıcı isteği dokümana kaydedildi; L1–L3 kod uygulaması henüz başlamadı.
Köpük F1 ilk uygulaması aşağıdaki güncel kayıttadır.

## Güncel ek — Caustics görünürlüğü ve köpük araştırması — 2026-10-28

### Caustics görünürlük düzeltmesi (teslim edildi)

`f5a6c77d` ile `main`e gönderildi. Prosedürel desenin bir tekrarındaki hücre
sayısı eksen başına 6'dan 2'ye indirildi; mevcut metre ayarında ışık ağı yaklaşık
üç kat genişledi. Mipmap filtresi, şiddet, derinlik sönmesi ve su geçirgenliği
korundu; yeni capture/sampler/draw eklenmedi. Mevcut caustics açık göllerin
görünümü değişir; sahne verisi migrasyonu gerekmez.

SwiftShader fixture'ında genel görünümün açık/kapalı luminans farkı standart
sapması **2,081 → 3,190** (yaklaşık %53 artış), yakın kıyı **5,370** ölçüldü.
Yeni kontrast testi eski deseni reddediyor; yeni desenle animasyon, gece,
ada/kuru kıyı/ayrı çukur, CSM, UI toggle/undo, Save/Reload ve runtime geçti.
`build:verify` 1.960 engine kontrolüyle geçti. Bu sayılar farklı kaynak
sürümlerindeki tarihsel test adetleriyle doğrudan karşılaştırılmaz.

GPU pilotu `FORGE_CAUSTICS_GPU_PILOT=1` ile isteğe bağlıdır; bu teslimde donanım
GPU zamanı ölçülmedi. **Önceki 3,72 ms bulgusu ve 1 ms hedefinin açık durumu
korunur; görünürlük düzeltmesi performans kabulünü kapatmaz.** Ayrıntılar:
[Lake caustics görünürlük raporu](../reports/LAKE_CAUSTICS_VISIBILITY_2026-10-28.md).

### F1 ilk uygulaması — Lake kıyı köpüğü — 2026-10-28

Kullanıcı planın main'e push edilmesini ve çalışmanın başlamasını istedi;
belgeler `01b3f559` ile yayımlandı. İlk kod dilimi Lake kıyı/ada köpüğüdür:
opt-in ortak görünüm alanları, Shore Foam Details, metre ölçekli gerçek kıyı
mesafe dokusu ve parçalı hareketli shader. Eski Lake kayıtlarında kapalıdır.
River görünümü/verisi değiştirilmedi. Mevcut güneş/CSM gölge alıcısı köpüğe
bağlandı; kompozisyon dip/yansıma üzerinde yüzey katmanı olarak yapılır.

Maske eksen başına en çok 1024 texel ve bandın genişliğinde dört texel;
1 MiB/göl üst sınırı. Dar bant/büyük alan birlikte sınırı aşarsa `over-budget`
tanısı ve yüzey reddi; hesap alanını küçültmek veya bandı genişletmek gerekir.
Ek capture/draw yok; maske yeniden üretimde oluşturulup dispose edilir.
Bu synchronous CPU üretiminin büyük dünya/ana thread ve donanım GPU kabulü açık.

F1 ilk kodu yerel çalışma ağacındadır; taş proxy'leri, River gerçek temas
ortaklaşması, akış izleri ve L1–L3 araç/yüzey çalışmaları henüz uygulanmadı.
Doğrulama/teslim kaydı:
[Lake kıyı köpüğü ilk dilim](../reports/LAKE_SHORE_FOAM_2026-10-28.md).

### Göl/nehir kıyısı ve taş çevresi köpüğü (araştırma/öneri)

Kullanıcı, göl ve nehirde kıyıya değen yüzeylerde ve taşların etrafında kırık,
hareketli köpük istiyor. Dört TV fotoğrafı yerleşim/yoğunluk referansıdır;
parlama, moiré, çizgiler ve mutlak beyazlık hedef kabul edilmez. Burada “göl ve
nehir” kapsamı esas alınır; ışık gölgesi köpük kaynağı değildir, köpüğün
aydınlatmasını etkiler.

Mevcut River kıyı/rapid/point-stamp köpüğü yeniden kullanılabilir; Lake'te köpük
yoktur. Nehir şeridinin kenarı gerçek kıyı veya taş mesafesi değildir. Tek başına
kamera depth farkı da kalıcı taş çevresi halkası sağlamaz. Öneri: ortak köpük
shader'ı + dünya koordinatında kıyı/engel temas maskesi + nehirde akış yönlü
izler; mevcut depth snapshot yalnız destekleyici temas bilgisi olur.

Kaynak incelemesi, seçenekler, sınırlamalar, aşamalar ve kabul matrisi:
[Kıyı ve taş çevresi köpük araştırması](../reports/WATER_CONTACT_FOAM_RESEARCH_2026-10-28.md).
**Bu araştırma kaydı tam uygulama teslimi değildir.** F1 ilk dilimi yukarıdadır; F2–F4 raporda önerilmiştir;
uygulama, sahne/taş yerleştirme, yeni fizik veya donanım performans kabulü yoktur.

## Güncel ek — Küçük taşlı kum ve caustics — 2026-10-27

Kullanıcı araştırma önerisini onayladı ve dokümana eklenmesinin ardından
uygulamanın başlamasını istedi. **İlk teslim:** boyanabilir ortak göl/nehir dip
materyali, terrain katmanlarında normal map desteği ve Lake caustics. River
caustics entegrasyonu sonraki dilimdir. Bu ek W2 göl yatağı oyma aracını geri
getirmez. Mevcut authored terrain/sahne verisi bu teslimin kapsamı dışındadır.

**Güncel durum:** C1/C2/C3/C5 ilk teslim işlevleri ve tarayıcı kabulü tamamlandı.
C4 River caustics ve GPU performans bütçesi açık. Son donanım pilotunda ek GPU
p95 yaklaşık 3,72 ms; 1 ms hedefi karşılanmadı. Ayrıntılar ve kullanım:
[sığ su zemini / caustics raporu](../reports/SHALLOW_WATER_BED_CAUSTICS_2026-10-27.md).

Caustics, hareketli su yüzeyinde kırılıp yoğunlaşan güneş ışığının dipte
oluşturduğu ağ desenidir. Dip materyali ile su efektinin sorumlulukları ayrıdır:
kum/taş katmanı kuru kıyıda da kullanılabilir, ışık deseni yalnız geçerli suyun
altında ve güneş alan dipte görünür. Materyal boyamak su veya fizik oluşturmaz.

### Görsel hedef ve kaynaklar

- Açık bej/gri kum, seyrek yuvarlanmış küçük taşlar, hafif kum dalgaları.
  Başlangıç taş ölçeği yaklaşık 0,5–3 cm; sahnede görsel olarak ayarlanır.
- Renk + OpenGL normal + roughness haritaları; 1K–2K başlangıç çözünürlüğü.
  Işık/desen renk dokusuna gömülmez. Ayrı taş mesh'leri ilk teslim dışındadır.
- CC0 PBR adayları: [Gravelly Sand](https://polyhaven.com/a/gravelly_sand),
  [Sandy Gravel](https://polyhaven.com/a/sandy_gravel),
  [Ganges River Pebbles](https://polyhaven.com/a/ganges_river_pebbles).
  [Poly Haven lisansı](https://polyhaven.com/license). İndirilen kaynak,
  lisans ve materyal kimlikleri uygulama kaydında tutulur.
- Projedeki `DevelopmentContent/Textures/LightMasks/*/water_caustics_*.png`
  desenlerinin manifest lisansı Unknown olduğundan bunlar teslim varlığı olarak
  kullanılmaz; özgün prosedürel desen veya kaynağı doğrulanmış doku kullanılır.
- Araştırma: [Epic Light Functions](https://dev.epicgames.com/documentation/unreal-engine/using-light-functions-in-unreal-engine?lang=en-US),
  [NVIDIA Rendering Water Caustics](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-2-rendering-water-caustics).

### Uygulama sırası

- [x] **C1 — Dip materyali:** `M_Shallow_Water_Bed`; renk, normal ve roughness.
  Landscape materyal seçicisinden kullanılabilir, var olan katmanlarla karışır;
  aynı asset Lake/River için kullanılabilir. Kaynak sahneye otomatik boyama yok.
- [x] **C2 — Terrain normal desteği:** loader, editor/runtime binding, lineer
  normal doku dizisi, ağırlıklı yüzey-normal karışımı, kaynakların dispose'u.
  Normal içermeyen materyallerin görünümü korunur. Doku birimi hesabı, CSM ve
  mevcut deform/ıslak iz çizimi beraber doğrulanır; yeni normal array'in bellek
  maliyeti ayrıca raporlanır.
- [x] **C3 — Lake caustics:** dünya koordinatına bağlı, farklı ölçek/yönlerde
  hareket eden ve bükülen ışık ağı. Geçerli bağlı göl geometrisinden maske;
  bounds veya yalnız su kotu kullanılmaz. Ada, kuru kıyı ve bağlantısız çukur
  ışıldamaz. Derinlikte sönme, güneş/gölge etkisi ve kıyıda yumuşak geçiş.
  Terrain'in mevcut çiziminde uygulanır; her kare CPU geometri üretimi veya
  ek sahne capture hedeflenmez. Maskeler bounded'dır ve yaşam döngüsünde silinir.
- [ ] **C4 — River:** aynı çekirdek; yerel nehir yüzey yüksekliği ve akış yönü.
  Eğimli nehirlerde tek dünya su kotu varsayılmaz. Lake teslimine dahil değildir.
- [x] **C5 — Kontroller/kabul:** Lake Details'ta aç/kapat, şiddet, metre cinsinden
  desen boyutu, hız ve derinlikte sönme. Eski kayıtlarda efekt kapalı; ortak
  runtime/save allowlist, undo/redo, Save/Reload/Play ve editör/runtime eşleşmesi.
- [ ] **GPU bütçesi / büyük dünya:** 1 ms ek GPU hedefi, tam ekran runtime ve
  büyük dünya kabulü kapanmadı; ölçüm sınırı aşağıdaki son kabul kaydındadır.

### Kabul ve QA envanteri

İzole fixture: iki tile sınırı, ada, ayrı çukur, kuru kıyı, sığ/derin bölge;
güneşli ve gölgeli dip. Normal haritası açık/kapalı ile taş kabartısı, farklı
paint ağırlıkları, eksik normal asset ve normal içermeyen katman denenir.
Caustics açık/kapalı ve iki sabit zaman örneğiyle animasyon, kamera hareketinde
dünya sabitliği, seam sürekliliği, derinlik sönmesi, gece/gölge ve gizle/sil/rebuild
sonrasında eski maskenin kalmaması kontrol edilir. Sculpt/undo yenilenmesi,
başarısız tile okuması ve Save/Reload/Play ayrı kabul maddeleridir.

`npx.cmd tsc --noEmit`, engine regresyonları ve `npm.cmd run build:verify`;
repo Playwright testleriyle gerçek WebGL derlemesi ve görüntü incelemesi.
Gerçek GPU'da aynı kamera/ışıkta açık/kapalı p95 maliyeti, draw/capture sayıları
ve bellek kaydedilir; ölçülmeyen performans tamamlandı sayılmaz. Save/load alan
değişiklikleri için Codex Security diff scan önerilir, ayrıca onay verilmeden
çalıştırılmaz. Bu planın onayı scan onayı olarak yorumlanmaz.

### Son uygulama ve kabul — 2026-10-27

- `M_Shallow_Water_Bed`, 2,4 m sabit dünya ölçeği ve lineer terrain normal map
  desteği teslim edildi. Kaynak haritaların MD5'leri orijinallerle eşleşiyor.
- Son caustics sürümü, özgün periyodik ışık/warp verisini maske dokusunun B/A
  kanallarında tutar; RG kaynak üçgen bayrakları level-0 `texelFetch` ile okunur.
  Desen mipmap ile filtrelenir; ek sampler/capture/çizim geçişi eklenmez.
  Yalnız etkin caustics gölü sayısına ait shader alanları derlenir.
- İlk teslim `npm.cmd run build:verify` **çıkış 0**: TypeScript, 2.009 engine kontrolü,
  smoke/content/UI tipleri, production build, strict dist ve world-data geçti.
  Kanıt: `.dev-server/caustics-final-gate.log`. Ek engine/smoke tip kontrolü de
  geçti: `caustics-final-qa-types.log`; önceki geçici test engeli artık yoktur.
- Git yayını öncesinde `origin/main` üzerindeki World Terrain taşıma/yeniden
  örnekleme güncellemeleri çakışmasız birleştirildi. Birleşim sonrası
  `npx.cmd tsc --noEmit` ve tam `build:verify` **çıkış 0**, **2.016 engine
  kontrolü** ile tekrar geçti: `.dev-server/caustics-merge-gate.log`.
- Chrome/D3D11/RTX 3060: Lake caustics normal/animasyon/gece, kuru kıyı/ada/ayrı
  çukur, dört CSM kademesi, UI/undo, gerçek Save/Reload ve runtime kabulü geçti.
  Altı Lake sculpt/uzak tile Retry, River UI/Retry ve wet-mud regresyonu geçti.
  Son sığ kıyı yakın planı dahil görsel tur da geçti; konsol/GL hatası yoktu.
  Kanıtlar: `.dev-server/caustics-gpu-bounded-results/`,
  `caustics-regression-results/`, `caustics-final-visual-results/` ve ilgili loglar.
- **Performans açık:** beş warm-up + 300 çift örnek, 704×752 editor canvas,
  doğrudan renderer pilotu. RTX 3060/D3D11 baseline p95 0,229 ms, caustics açık
  p95 3,941 ms, çift farkının p95'i **3,719 ms**, ek draw **0**. 1 ms hedefi
  sağlanmadı; tam ekran runtime/çok gövdeli büyük dünya/heap kabulü değildir.
  `.dev-server/caustics-gpu-bounded-results/` altındaki `caustics.json` ölçüm
  kaydıdır. Önceki SwiftShader/yarım/zaman aşımı koşuları bu kabul yerine sayılmaz.
- Testler yalnız izole smoke projelerine yazdı. 69 authored dosyanın başlangıç
  snapshot'ına göre çalışma sırasında beş dosya dışarıdan değişmiş görüldü;
  temiz/hash-eşit authored sahne iddiası yoktur. Bu değişiklikler korunur ve
  kaynak sahnelerin görsel kabulü olarak fixture sonuçları gösterilmez.
- Kullanım, kalıcı yakın plan ve kaynak bütçesi
  [teslim raporundadır](../reports/SHALLOW_WATER_BED_CAUSTICS_2026-10-27.md).
  C4 sonraki iştir. Security scan yapılmadı.

### Önceki uygulama/devir kaydı (tarihsel)

**2026-10-27 — Kullanıcı isteğiyle ara verildi.** Diğer oturumlar bittikten sonra
devam edilecek. İlk teslim kodu diskte; nihai kabul tamamlanmış sayılmaz.

- C1: `M_Shallow_Water_Bed` ve üç Poly Haven CC0 haritası manifest'e eklendi.
  Kaynak/lisans/MD5 kaydı `starter-content/Textures/SHALLOW_WATER_BED_SOURCE.md`.
  `terrainMetersPerRepeat: 2.4` runtime normalizer ve save validator'da korunur.
- C2: editor/runtime normal map yükleme, lineer normal array, ağırlıklı normal
  karışımı ve dispose bağlantıları uygulandı. Eksik normalde renk katmanı kalır.
- C3: `terrainCaustics.ts` gölün bağlı kaynak üçgenlerini RG8 doku dizisinde
  tutar; ada/ayrı çukur, terrain referansı, gizleme ve silme ele alınır. Özgün
  prosedürel desen, güneş doğrultusunda projeksiyon, kıyı/derinlik sönmesi vardır.
  Kademeli güneş gölgesi include'u korunur; ışık hook'u onunla birlikte çalışır.
- C5: Lake Details'a caustics aç/kapat, şiddet, metre ölçeği, hız, sönme ve
  mevcut su görünümü için Absorption Distance alanı eklendi. Eski kayıtlarda
  caustics kapalıdır. Genel Lake edit/undo/save yolu kullanılır.
- Kullanıcı sahnesine katman ekleme/boyama yapılmadı. River caustics (C4)
  uygulanmadı; yeni dip materyali iki su türünün altında da kullanılabilir.

**Doğrulama sınırı:** İlk odaklı 25 engine kontrolü geçti. Ardından 2.007
  kontrol içeren tam engine koşusu ve production build geçti; bunlar sonraki
  güneş-gölgesi hook düzeltmesinin nihai gate'i değildir. Son hook ile dört
  odaklı caustics kontrolü (gerçek terrain/CSM patch birleşimi dahil) geçti:
  `.dev-server/caustics-shadow-regression.log`. Son yeni engine/smoke dosyaları,
  `.dev-server/caustics-qa.tsconfig.json` ile tip denetiminden geçti. Bu özel
  konfigürasyon yalnız diğer oturumun `tests/smoke/__perf-probe.spec.ts`
  dosyasını dışarıda bırakır; tam gate yerine geçmez.

Tam `build:verify`, diğer oturumun `__perf-probe.spec.ts:46` dosyasındaki dört
TypeScript hatasında durdu (`.dev-server/caustics-build-verify.log`); dosyaya
dokunulmadı. İlk browser koşularında efekt/animasyon/normal farkı ve gece
sönmesi, UI toggle/undo ve gerçek kayıt alanları geçti. Runtime test yardımcısı
canvas referansı düzeltildi. Sonraki reload, yerel HTTP isteklerinin sırayla
13–16 saniye sürmesi nedeniyle 60 saniyelik hazır olma sınırına takıldı; kayıtlı
JSON doğruydu. Bu koşular tam browser kabulü sayılmaz.

Son koşu: `.dev-server/caustics-acceptance.log` ve
`.dev-server/caustics-acceptance-results/`. Gölün gerçek hazırlanmasını daha
uzun bekleyen, gölgeleri açık test kullanıcı ara isteğinde durduruldu; nihai
başarı iddiası yoktur. Önceki görüntüler `caustics-browser-results/` ve
`caustics-browser-final-results/` altındadır; caustics açık/kapalı/hareket ve
yakın dip görüntüleri incelenmek üzere saklandı. SwiftShader GPU timer
sunmadığından gerçek donanım GPU kabulü **açık**; CPU/IO yavaşlıkları GPU maliyeti
olarak yorumlanmaz. İlgili loglar `.dev-server/caustics-*` altındadır.

**Devam sırası:** Eşzamanlı Git farkını koruyarak yeniden incele → son kaynakla
yeni Lake caustics Playwright senaryosunu tamamla, runtime ve gölge/ada/kuru kıyı
görüntülerini incele → tam `tsc` / engine / `build:verify` → mevcut Lake sculpt,
uzak tile Retry ve River/wet-mud regresyonları → mümkünse gerçek GPU A/B ölçümü.
Kaynak henüz finalize edilmedi; commit/push ve Security scan yapılmadı.

Uygulama başlangıcında önceden değişmiş
`SceneApp.ts`, `collisionView.ts`, `terrainHeightfieldPhysics.test.ts`,
`editorUi.css`, `debug.log` ve `output/` korundu. Çalışma sırasında diğer
oturumlardan gelen LandscapeTest cell/tile ve test değişiklikleri de korunur.

Tarih: 2026-10-25  
Durum: 8A0–8A5 ve W1 Lake işlevleri tamamlandı. **2026-10-26 güncel kullanıcı kararı:** Göl yatağı çizme/oyma aracı editörden kaldırıldı; göl, Sculpt ile hazırlanmış çukura tıklanarak eklenir. §14 önceki W2 çalışmasının tarihsel kaydıdır; editör akışı için geçerli değildir. W1 kanıtları §13'te; donanım GPU, browser tepe bellek/ana thread ve büyük dünya performans kabulü açık. Puddle/Ocean uygulanmadı. Commit/push yok.
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

**Öneri durumu:** §1–10 ilk görüşmenin tarihsel çerçevesidir; 8A0–8A5 sonuçları
§11'de, güncel W0-Lake/W1 önerisi §12'dedir. Aşağıdaki Water Body mimarisi, araç davranışları ve geliştirme
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

Güncel W2 kararları ve uygulama sırası §14'tedir.

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

- [x] **W0 — Tasarım onayı:** §12 kullanıcı tarafından onaylandı (2026-10-26).
- [x] **W1 — Lake / mevcut çukur işlevleri:** Sınırlı çalışma alanı, su seviyesi,
  bağlantılı alan, gerçek kıyı, kesin derinlik, seçim/düzenleme, undo/redo ve
  Save/Reload/Play uygulandı. İşlevsel kabul §13; GPU performans kabulü ayrı açık.
- [ ] **W2 — Yatak oluşturma:** Derinlik profili, kıyı geçişi, önizleme ve tek
  undo komutuyla çok tile'a uygulama; isteğe bağlı kıyı boyası. Onaylı tasarım ve kabul kaydı §14.
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
- [ ] **W2 kabulü:** Yatak uygulaması yalnız hedef alana etki eder, seam kopyaları eşittir ve
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

İlk görüşmedeki Lake soruları §12'de yanıtlandı ve kullanıcı tarafından
onaylandı. W1'in uygulaması ve kabul sınırı §13'tedir. Yatak bake/modifier
kararı W2'ye, eski araziyi kaldırma sürümü/geçiş süresi §4'e aittir.

**Devam noktası:** Lake'in gerçek donanım GPU/büyük dünya performans kabulü
açıktır. W2 ayrı kullanıcı onayı gerektirir; W1 arazi yatağı oluşturmaz.

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
- İlk motor API'sinde `coordinateSpace: "world"` zorunludur. 8A1 sırasında
  `WorldTerrainDef.splines` alanı merkez-yerel bırakıldı; o dilimde diskteki
  anlamı değiştirilmedi. Dönüşüm kopya üretir, kendiliğinden kaydetmez.
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
- [x] **8A2 / veri:** Dünya spline şeması ve açık migrasyon; runtime/save ortak
  validator, 1×1 uyumluluk, save/reload; mevcut referansların korunması.
- [x] **8A3 / yol editörü:** Draw/Edit, kontrol noktası gizmo'su, terrain'e
  bağlama, tile yükleme/sabitleme, tek undo komutu ve kirli kayıt bağlantısı.
- [x] **8A4 / yol çıktısı:** Dünya spline mesh'i, terrain normal hizalaması,
  çarpışma ve tarayıcıda iki tile'ı geçen yol kabulü.
- [x] **8A5 / nehir:** Dünya koordinatlı nehir yatağı/yüzeyi, kesin derinlik,
  akış, sculpt sonrası güncelleme ve eksik tile davranışı; tarayıcı kabulü.
- [x] **W0-Lake onayı:** §12 kullanıcı tarafından onaylandı (2026-10-26).
- [x] **W1 işlevleri:** Mevcut çukuru dolduran Lake aracı uygulandı; bağımsız
  fixture, engine ve tarayıcı kanıtları §13'te.
- [ ] **W1 donanım GPU / büyük dünya kabulü:** SwiftShader timer sağlamıyor;
  gerçek donanım ve geometri streaming kabulü yapılmış sayılmaz.

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

**8A1 sonundaki devam noktası:** 8A2 veri geçişi; sonucu aşağıda kayıtlıdır.

### 11.4. 8A2 veri sözleşmesi — 2026-10-25

- Terrain tanımı schema 1 içinde yeni editör save snapshot'larındaki her spline
  `coordinateSpace: "world"` taşır. İşaretsiz mevcut spline merkez-yereldir.
  Başka bir koordinat işareti runtime/save ortak normalizer tarafından
  reddedilir; işaret sessizce düşürülmez. Karışık diziler açık geçiş için okunur.
- Okuma kaynak tanımı veya dosyaları değiştirmez. Açık, saf kopya migrasyonu
  ve her iki terrain save snapshot'ı yerel veriyi dünya koordinatına taşır;
  zaten dünya verisi tekrar ötelenmez. Eski Forge sürümleri yeni işareti
  desteklemeyebilir; yeni kayıtlar bu koordinat sözleşmesini bilen sürümle açılmalıdır.
- 1×1 uyumluluk köprüsü işaretli spline'ı terrain tanımının merkezine göre
  yerel kopyaya çevirir. Mevcut editör, yol mesh'i ve River Water bu yerel
  görünümü kullanmayı sürdürür. Actor taşınıp kaydedildiğinde yeni dünya
  konumları actor ile birlikte taşınır; kimlikler ve river referansları korunur.
- Snapshot ilk await'ten önce alınır. Kayıt sırasında yapılan spline
  düzenlemesi, eski snapshot'ı veya yeni düzenlemenin kirli revizyonunu
  değiştirmez. İşaretsiz canlı çok-tile tanım, yeniden okunana kadar yerel
  kalabilir; her snapshot kendi kopyasını yalnız bir kez dönüştürür.
- `/__save-terrain` yeni alanı runtime ile aynı normalizer üzerinden doğrular;
  endpoint yetkileri/yol kuralları değişmez. Kullanıcı onayı olmadan Security
  scan başlatılmaz. Tarayıcı kabulü mevcut 1×1 nehirli migrasyon Save/Reload/Play
  akışıyla, çok-tile veri kabulü loader ve gerçek save session kontrolleriyle yapılır.

### 11.5. 8A2 sonucu ve doğrulama — 2026-10-25

- `terrainSplineData.ts`: ortak runtime/save koordinat allowlist'i, açık ve
  tekrar uygulanabilir kopya migrasyonu, 1×1 yerel görünüm adaptörü. 8A1
  dönüşüm API'leri `terrainSplines.ts` üzerinden yeniden export edilir.
- `captureTerrainSnapshot` ve `captureWorldTerrainSave` dünya koordinatlı
  tanım üretir. 1×1 okuma köprüsü hem eski işaretsiz hem yeni dünya verisini
  mevcut editör/runtime yoluna uyarlar; terrain/river referansları değişmez.
- **8 yeni engine regresyonu** geçti: marker allowlist/ret, karışık veri
  migrasyonu ve tekrar uygulama, tekrar kayıt/actor taşıma, fractional origin
  sabit noktası, ondalıklı Y datumunun yuvarlama artığı, çok-tile eager/streaming
  reload, gerçek save session sırasında yeni düzenleme ve salt okuma yolu.
- Tarayıcı ilk çalışmada `0.15 → 0.15000000000000002` yerel dönüşüm farkını
  yakaladı. Köprü yalnız milimetre grid'i yakınındaki hesaplama artığını
  temizleyecek şekilde düzeltildi; gerçek fractional-origin farkı korunur.
  Test eşitliği gevşetilmedi ve örnek engine regresyonuna eklendi.
- Son kodla `npx.cmd tsc --noEmit`, yeni engine test dosyasının ayrı TypeScript
  kontrolü ve tam `npm.cmd run build:verify` geçti: **1.925 engine kontrolü**,
  üretim derlemesi, import/tip/fixture/release, strict dist ve world-data dahil.
- Chromium, izole smoke projesi, port **5274**: genişletilmiş
  `terrain-migration.spec.ts` **2/2 geçti** (1,4 dakika). Gerçek endpoint
  dünya işaretini korudu, bilinmeyen frame'i dosyayı değiştirmeden reddetti;
  nehirli eski veri Save → Reload → tekrar Save → Play akışı, spline/river
  kimlikleri, dünya konumları ve konsol hatasız açılış doğrulandı.
- `test-results/terrain-migration-legacy-t-e5df1-water-IDs-reloads-and-plays-chromium/`
  içindeki editor/runtime görüntüleri incelendi. Editörde yol görünüyor;
  runtime görüntüsü debug grid'li başlangıç açısından alınmış olduğundan nehir
  görünümü, uzak yol, çok-tile mesh/çarpışma veya performans kabulü sayılmaz.
- Kaynak sahneler, legacy dosyalar ve terrain tile'ları değiştirilmedi.
  Commit/push ve Codex Security taraması yapılmadı. Bu save/load değişikliği
  için kullanıcı onayıyla Codex Security diff incelemesi önerilir.

**Sonraki adım: 8A3.** Çok-tile spline Draw/Edit ve gizmo; terrain bağlantısı,
gerekli tile'ların yüklenip sabitlenmesi, tek undo komutu ve kirli kayıt
entegrasyonu. Çok-tile spline engeli bu dilimde kaldırılmadı; yol mesh/çarpışma
8A4, nehir yüzeyi ve akışı 8A5 olarak açık kalır.

### 11.6. 8A3 uygulama kapsamı — 2026-10-25

- Mevcut Landscape Mode → Splines Draw/Edit, kontrol noktası/segment/loop,
  smooth ve width/falloff araçları aynı editör kaynağı üzerinden çok tile'a açılır.
  1×1 yerel veri görünümü korunur; çok-tile kontrol noktaları dünya koordinatındadır.
- Çizim önce coarse isabetin gerekli tile'larını yükler, sonra kesin terrain
  yüksekliğini örnekler. Snap to Terrain aynı kesin veriyle, ayrı undo komutudur.
  Gizmo dünya noktasını düzenler; terrain actor'ünün taşıma kilidi korunur.
- Apply Deform/Paint, spline koridoru + seam komşularını yükleyip işlem boyunca
  tutar. Tüm patch'ler hazır olmadan canlı veriye yazılmaz. Yazılan tile'lar
  session/undo tarafından sabitlenir, renderer ve kirli kayıt güncellenir.
  Yükleme başarısızlığı veya bekleme sırasında spline/level değişimi yarım bake
  üretmez. 8A1'in tek işlem için 1.048.576 kapsayıcı vertex sınırı korunur.
- Çok-tile spline metadata komutları yalnız tanımı kirletir. Eski çok-tile
  merkez-yerel spline'lar editörün bellek kopyasında dünya koordinatına çevrilir;
  dosya okuma sırasında yazılmaz. Mevcut 8A2 snapshot/kayıt yolu kullanılır.
- Çok-tile yol mesh ve River Water araçları bu dilimde sunulmaz; 8A4/8A5.
  Tarayıcı QA: seam üzerinden çizim, Details ve gizmo, snap, lock, bake,
  undo/redo, save/reload, eksik tile ret/retry ve 1×1 regresyonu.

### 11.7. 8A3 devir noktası — 2026-10-26

Kullanıcı, eşzamanlı diğer oturum ve uzun doğrulama süresi nedeniyle çalışmayı
uygun noktada sonlandırıp bu oturumun değişikliklerini commit + push etmeyi istedi.
8A3 kutusu tarayıcı kabulü tamamlanana kadar açık tutulur.

**Hazır kod:** Çok-tile Draw/Edit, dünya koordinatlı nokta/gizmo, Snap to Terrain,
segment/smooth/width/falloff/loop komutları; metadata için tanım revizyonu;
koridor ve seam tile'larının talep edilmesi, bake boyunca tutulması ve değişen
tile'ların undo için sabitlenmesi; tek komutlu deform/boya patch uygulaması.
İş sınırı tile yüklemeden önce denetlenir; kapalı efektler tile talep etmez.
Terrain actor'ünün taşıma/rotasyon kilidi korunur. Yol mesh'i ve River Water
çok-tile araçları 8A4/8A5 olarak uygulanmadı.

**Doğrulama sınırı:**

- Önceki tamamlanmış tam `build:verify`: **1.933 engine kontrolü** dahil geçti.
  Bu, o anda diğer oturumun değişikliklerini de içeren çalışma ağacına aittir;
  son tarayıcı fixture düzenlemesinden sonra tam kapı yeniden çalıştırılmadı.
- Spline çekirdeği, veri geçişi ve editör yükleme/pin/undo testleri geçti.
  8A3 için dört yeni engine kontrolü eklendi; yeni engine dosyası ayrıca
  TypeScript ile denetlendi. Smoke fixture izolasyonunun 5 kontrolü geçti.
- Eski 1×1 spline bake tarayıcı regresyonu geçti. İlk çok-tile koşuda çizim,
  gerçek gizmo sürükleme, snap, lock, iki tile deform/boya ve byte eşitliğiyle
  undo/redo adımları geçti; reload sonrasında mevcut spline'ı seçme adımı testte
  eksikti ve düzeltildi. Ayrı ilk streaming ret/retry koşusu geçti.
- Son toplu tarayıcı kabulü **geçmiş sayılmadı**. Eski çok-tile kapsamlı test,
  20 sn Save yanıtı sınırında durdu. Sonraki hedefli koşuda Save meşgul beklemesi
  ve `networkidle` süre aşımı görüldü; iz kaydında ilgisiz Content Browser
  `/__project-dir/assets` isteği uzun süre açık kaldı. Kök neden ve bütün
  etkileşimler son kodla uçtan uca kabul edilmiş değildir.
- Yeni smoke dosyası üç bağımsız senaryoya bölündü: Draw/gizmo/snap/reload;
  seam bake/undo/redo/reload; eksik uzak tile ret/retry. Yalnız kullanılmayan
  Content Browser assets dizin listesi küçük fixture ile yanıtlanır; terrain
  dosyaları ve Save/Reload endpoint'leri gerçektir. `networkidle` yerine somut
  kontrol hazır olma beklentisi kullanılır. Son koşu kullanıcı isteğiyle
  durduruldu; **3/3 geçti** denmez.
- Test sunucusunda HMR kapatıldı; açık sayfanın başka oturumdaki kaynak
  değişiklikleriyle kendiliğinden yenilenmesi önlendi. Manuel reload çalışır.
  Son koşular ayrı port ve `.dev-server/spline-editor-*-results` çıktılarıyla
  yürütüldü. Bunlar performans kabulü değildir.

**Devam:** Önce `terrain-spline-editor.spec.ts` içindeki üç senaryoyu düşük
eşzamanlı yükte tamamla ve görüntüleri incele; gerekiyorsa bekleyen kayıt sorununun
kök nedenini araştır. Sonra 8A3'ü kapat ve 8A4 yol mesh/çarpışmasına geç.
Diğer oturumun terrain/water, renderer, fizik, kaynak sahne ve tile değişiklikleri
bu oturumun commit kapsamına alınmaz. Codex Security taraması çalıştırılmadı.

### 11.8. 8A3 kabulünün tamamlanması ve 8A4 uygulaması — 2026-10-26

Kullanıcı 8A3'ün tamamlanmasını ve ardından 8A4'e devam edilmesini onayladı.

**8A3 teşhisi:** Son iz kaydında uzak tile ret/retry ve bake başarılıydı;
bekleme Save'in tanım yayımlama adımındaydı. Gerçek `/__save-terrain`, listelenen
bütün tile dosyalarını sırayla okuyup doğrular. 144 tile'lı eski fixture'da bu
iş, önceki adımlarla birlikte 240 saniyelik test sınırını aştı. Doğrulama
gevşetilmedi ve endpoint taklit edilmedi. Fixture, gerçek 36-tile streaming
eşiğini aşan 12×4 / 48 tile'a indirildi; aynı uzak koridor, 503 ret/retry ve
gerçek Save/Reload korunuyor. Üç 8A3 senaryosu ayrı koşularda geçti.
Toplu koşu ayrıca test yardımcısının önceki autosave yanıtını manuel Save'in
yanıtı sanabildiğini gösterdi: dosya yazıları sürerken 10 saniyelik durum
beklentisi doluyordu. Yardımcı artık gerçek yanıtla birlikte manuel Save
düğmesinin yeniden etkinleşmesini, yani kendi kuyruklu işleminin tamamlanmasını
bekler. Sabit gecikme veya sahte kayıt yanıtı eklenmedi.

Sonraki koşuda bu doğru bekleme, gerçek bir kuyruk büyümesini de görünür kıldı:
uzun Save sırasında her düzenleme yeni bir autosave ekliyordu; iz kaydında
aynı layout/prune çiftinin art arda yazılması manuel Save'i 120 saniyeden fazla
bekletti. `EditorSaveSession` artık aynı canlı layout için henüz snapshot'ı
başlamamış talepleri tek işlemde birleştirir. Çalışan snapshot korunur;
sonraki düzenlemeler en fazla bir bekleyen, en güncel snapshot'ta toplanır.
Snapshot başladıktan sonraki düzenleme yeni bir sonraki kayıt ister. Ortak
başarı/uyarı/hata sonucu paylaşılır; level nesnesi değişince talepler
birleştirilmez. Doğrulama ve dosya sırası değişmez. Üç ek engine regresyonu
49 düzenleme + manuel Save'i, ortak hatadan sonra retry'ı ve level değişimini
kapsar. Bu kayıt akışı değişikliği için Codex Security diff incelemesi önerilir;
kullanıcı scan onayı olmadan tarama çalıştırılmadı.

**8A4 kodu:**

- `terrainSplineMeshes.ts`, işaretli dünya spline'larını terrain merkezi
  çevresindeki yerel üretim koordinatlarına çevirir. Büyük dünya konumu,
  Float32 geometriye gömülmez; actor transform'u yalnız bir kez uygulanır.
- Rigid instance ve kaynaklı deforme yol zincirleri ortak üreticiyi kullanır.
  World Terrain hizalaması kesin `terrainFaceNormalAt` sorgusuna bağlıdır.
  Gerekli normal tile'ları koridorla sınırlı, terrain başına en fazla dört eşzamanlı okumayla
  hazırlanır. Bu geçici okumalar terrain streaming aktivasyonunu, collider
  halkasını, undo pin'lerini veya kirli kayıt revizyonlarını değiştirmez.
  Eksik dosya/hole için düz normal uydurulmaz.
- Çok-tile Details'ta mesh seçimi, enable, spacing, yaw, bank, fit, normal
  hizalaması, deform ve collision kontrolleri açıldı. Mesh seçilmeden ilgili
  kontroller kapalıdır; None mesh verisini kaldırır. Boş asset kimliğinin
  autosave'de 400 üretmesi ve Fit off→on değerinin takılı kalması düzeltildi.
  Undo/redo ve mevcut kayıt şeması kullanılır; validator gevşetilmedi.
- Editör, geç tamamlanan eski async üretimleri actor/build kimliğiyle eler;
  terrain patch/undo/redo sonrasında normal hizalamasını yeniler. Ayrılan
  deforme geometri serbest bırakılır; ortak kaynak GLTF geometri/materyalleri
  editör yeniden üretiminde dispose edilmez.
- Runtime, legacy ve World Terrain kaynaklarını actor ile birlikte taşır;
  karışık sahnede sıkıştırılmış veri dizisinin yanlış actor indeksini
  kullanması giderildi. Yol collider'ı çizim geometrisinden üretilir ve World
  Terrain tanımının merkezinde yerleşir. Actor/asset/segment collision
  kapatmaları korunur. Segment collision değişikliği görsel zinciri,
  ortak uç çerçevesini veya UV fazını bölmez; yalnız çarpışma üçgenlerini süzer.

**Kabul sınırı:** Bu dilim yol geometri/collider streaming'i veya büyük dünya
performans kabulü sağlamaz. Yol çıktısı runtime açılışında hazırlanır; geçici
normal verisi yalnız üretim sırasında tutulur. Tanım Save'i bütün tile
dosyalarını doğrulamayı sürdürür; büyük terrain'lerdeki disk maliyeti bu
dilimde optimize edilmedi. Mevcut Landscape'i genişletme
aracı spline migrasyonunu hâlâ engeller; bunun uyarısı yeni mesh desteğiyle
çelişmeyecek şekilde düzeltildi. Çok-tile River Water, nehir yatağı/yüzeyi/akışı
8A5 olarak; Lake/Puddle/Ocean sonraki W dilimleri olarak açık kalır.

**Doğrulama:** Dört yeni engine regresyonu; büyük origin, seam kaynağı, normal
hizalaması, eksik tile/hole, geçici okuma, rigid/deform collision filtreleri,
collision değişirken aynı görsel geometri/UV ve gerçek Rapier/render yüzey
eşleşmesini kapsar. Ayrı 8A4 Chromium koşusunda mesh kontrolleri, None/undo,
lock/unlock, Save/Reload ve runtime yüzey eşleşmesi geçti. Ana TypeScript,
smoke tip kontrolü ve yeni engine dosyasının ayrı TypeScript kontrolü geçti.
Son kayıt kuyruğu düzeltmesiyle tam `build:verify` **1.946 engine kontrolü**,
üretim derlemesi, strict dist ve world-data dahil geçti. Bu kapı, diğer
oturumun mevcut değişikliklerini de içeren paylaşılan çalışma ağacına aittir.
`terrain-spline-editor.spec.ts` son kodla tek worker'da **4/4 geçti (9,9 dakika)**:
üç 8A3 senaryosu ve karışık legacy/World Terrain sahneli 8A4 akışı. Önceki
başarısız koşular kabul olarak sayılmaz. Editör/rigid yol ve 1440×900,
1100×720 runtime görüntüleri incelendi; dikiş kopması, çift konum ofseti veya
beklenmeyen tarayıcı hatası görülmedi. Runtime'da sınırın iki yanındaki dört
probe'da çizim ve Rapier yüzeyi arasındaki en büyük fark yaklaşık 0,0000011 m
oldu; test toleransı 0,01 m'dir. Bu görüntü/uyum kabulü performans kabulü değildir.

Kanıtlar: `.dev-server/spline-completed.log`,
`.dev-server/spline-completed-results/`,
`.dev-server/spline-final-build-verify.log`. Eski tek-tile bake ve asfalt zincir
regresyonları da son kayıt koduyla **2/2 geçti (2,2 dakika)**; kanıtlar
`.dev-server/spline-legacy-final.log` ve `.dev-server/spline-legacy-final-results/`
içindedir. Kaynak sahne/tile dosyaları değiştirilmedi; diğer oturumun
terrain/water çalışmasına müdahale edilmedi. Bu oturumda commit/push yapılmadı.

**Devam noktası: 8A5.** Dünya koordinatlı nehir yatağı/yüzeyi, kesin derinlik ve
akış; sculpt sonrası güncelleme ve eksik tile davranışı. Göl aracına geçmeden
önce W0-Lake kararları ayrıca kesinleştirilecektir.

### 11.9. 8A5 nehir aktarımı ve kabulü — 2026-10-26

- Mevcut çalışma ağacı `8a10d198` ile main'e commit/push edildi. Bundan sonraki
  değişiklikler 8A5 nehir aktarımına aittir.
- Yeni çok-tile nehirler `coordinateSpace: "world"` taşır. `surfaceLevel` ve
  köpük noktaları mutlak dünya koordinatıdır; işaretsiz eski verinin yerel anlamı
  korunur. Save validator alanı açıkça kabul eder; bilinmeyen işaret reddedilir.
- Nehir yatağı mevcut 8A3 deform/boya patch ve tek undo yolu ile düzenlenir.
  Su yüzeyi mevcut yatay yükseklik kontrolünü, spline genişliğini, akış ve
  segment profillerini kullanır; hidrolojik akış çözümü eklenmez.
- Ribbon üretimi terrain merkezine yakın yerel koordinatta yapılır. Derinlik
  kesin üçgen yüksekliğinden hesaplanır. Gerekli koridor tile'ları geçici okunur;
  streaming aktivasyonu, collider, undo pin ve kirli kayıt durumu değişmez.
  Tanımlı tile'ın okunamaması tüm su gövdesini reddeder; gerçek deliklerde
  üçgen üretilmez. Sculpt ve undo/redo bitiminde derinlik yeniden üretilir.
- Tarayıcı kabulü oluşturma, yatak bake/sculpt ve undo, dünya köpük noktası,
  akış/yansıma kontrolleri, Save/Reload, editör/runtime eşleşmesi ve uzaktaki
  tile için 503/retry davranışını kapsar. Büyük dünya performansı ve
  su geometri streaming'i bu dilimin kabulü değildir.

**Doğrulama:**

- Beş yeni engine regresyonu: büyük origin'de yüzey/derinlik/akış/köpük,
  koridor okumaları ve başarısızlık/retry, gerçek delik kırpması, iki tile'da
  yatak bake ve tam undo/redo, koordinat işareti ve eski yerel veri uyumluluğu.
- Son tam `build:verify` **1.951 engine kontrolü**, TypeScript, smoke/content/UI
  tip kontrolleri, üretim build'i, strict dist ve world-data dahil geçti.
  Son UI açıklaması düzeltmesinden sonra ana ve smoke TypeScript tekrar geçti.
  Yeni engine dosyası ayrıca TypeScript ile denetlendi.
- Chromium'da ana nehir UI/sculpt/foam/Save/Reload/runtime senaryosu **1/1
  geçti (2,3 dakika)**. Son kaynakla streaming 503/retry **1/1 geçti (53,5 sn)**;
  geçici nehir okumaları resident tile sayısını değiştirmedi ve tile kaydetmedi.
- Tek-tile bake/paint/undo, terrain endpoint doğrulaması ve eski yol/nehir
  kimliklerini koruyan migrasyon/reload/Play regresyonları **3/3 geçti (2,5 dk)**.
- Editör ve 1440×900 / 1100×720 runtime görüntüleri incelendi. Tile sınırında
  kopma veya çift konum ofseti görülmedi. Editör ve runtime vertex konumları,
  derinlik/akış verileri ve köpük dünya konumları birebir eşleşti. Ana senaryoda
  beklenmeyen konsol hatası yoktu; 503 fixture'ında yalnız kasıtlı HTTP hatası vardı.

Kanıtlar: `.dev-server/river-8a5-final-build.log`,
`.dev-server/river-8a5-author.log` ve `river-8a5-author-results/`,
`.dev-server/river-8a5-stream-final.log` ve `river-8a5-stream-final-results/`,
`.dev-server/river-8a5-legacy.log` ve `river-8a5-legacy-results/`.
Sandbox soket engeli, yanlış test düğmesi seçicisi ve ilk sayfanın kısa navigasyon
süresiyle duran önceki koşular kabul olarak sayılmadı. Son koşular gerçek
Save/Reload endpoint'leri ve izole smoke projesiyle yapıldı.

Kaynak sahne/tile dosyaları değiştirilmedi. Başlangıçtaki tüm değişiklikler
`8a10d198` ile push edildi; yeni 8A5 değişiklikleri çalışma ağacında bırakıldı.
Kayıt/veri okuma değişiklikleri için Codex Security diff incelemesi önerildi;
kullanıcı scan onayı olmadan çalıştırılmadı.

**Güncel devir notu (2026-10-26):** Bu bölümdeki çalışma ağacı/commit anlatımı
8A5 oturumunun tarihsel kaydıdır. Bu tasarım turunda Git çalışma ağacı temiz,
HEAD `af599269 feat(terrain): complete multi-tile river water support` olarak
doğrulandı. Yukarıdaki test sonuçları önceki kabul kaydıdır; bu turda yeniden
çalıştırılmadı. Güncel devam noktası §12'deki W0-Lake önerisinin onayıdır.

## 12. W0-Lake tasarım önerisi ve W1 uygulama planı — 2026-10-26

**Durum: kullanıcı onaylı tasarım (2026-10-26).** Bu bölüm W0 kaynak incelemesi
ve tasarım turunun kaydıdır. Sonraki kullanıcı onayıyla W1 uygulanmıştır; güncel
sonuç §13'tedir. Buradaki bütçe değerleri tasarım hedefleridir; ölçülen değerler
§13'te ayrıca yazılır. Büyük dünya/geometri streaming kabulü açık kalır.

### 12.1. W1 kapsamı ve oluşturma akışı

1. World Terrain seçiliyken **Lake → Mevcut çukuru doldur** açılır. Kesin terrain
   isabetine tıklamak başlangıç XZ'sini seçer. Global harita/approximate ray hit
   yeterli değildir; gerekirse hedef tile okunur, sonra kesin isabet tekrarlanır.
2. Başlangıçta seed çevresinde 64 × 64 m önerilen, terrain grid'ine dışa doğru
   hizalanmış bir XZ dikdörtgeni gösterilir. Dört kenar tutamacı ve sayısal
   genişlik/uzunluk ile alan değiştirilir; dünya dışına otomatik büyüme yoktur.
   **Bu dikdörtgen hesap sınırıdır; kıyı veya su tutan duvar değildir.** W1'de
   kapalı spline çizimi ve keyfî polygon sınır düzenlemesi yoktur.
3. `surfaceLevel` mutlak dünya Y'dir. İlk öneri seed zemini + 0,5 m, alanın
   taşma eşiği biliniyorsa güvenli üst sınırla kısıtlanır. Uygun seviye yoksa
   yaratma tamamlanmaz; kullanıcı seviyeyi/alanı/seed'i düzenler.
4. Önizleme yalnız seed'e bağlı su altı bölgesini çıkarır. Kuru adalar ve kuru
   sırtla ayrılan diğer çukurlar korunur. Seviye bir iç eşiği aşarsa artık
   gerçekten bağlanan ikinci çukur aynı bileşene katılır; ilk sınırı dondurmayız.
5. Geçerli önizleme **Oluştur** ile tek undo komutuna dönüşür. Esc taslağı
   iptal eder. Terrain'e hiçbir yükseklik, boya veya spline patch'i yazılmaz.

W1'de seçim, adlandırma, gizleme/kilitleme, seed'i yeniden seçme, alan/seviye ve
görünüm düzenleme, silme, undo/redo, Save/Reload ve editör/Play eşleşmesi vardır.
Genel translate/rotate/scale gizmo'su yerine bu anlamlı kontroller kullanılır;
terrain taşınırsa mutlak seed/alan/seviye kendiliğinden taşınmaz, tekrar doğrulanır.
Yatak oyma, otomatik kıyı boyama ve ıslak toprak W2'ye kalır. Akış/hacim
simülasyonu, yüzdürme, yüzme ve collider bu dilimde yoktur.

### 12.2. Kalıcı veri sözleşmesi

Öneri: `RoomLayout.waterBodies?: LayoutWaterBody[]`; W1 yalnız `kind: "lake"`
kabul eder. İlerideki River/Puddle/Ocean union üyeleri henüz validator'a eklenmez.
Örnek tam alanlar aşağıdadır; bu bir şema önerisidir, mevcut API değildir:

```ts
type LayoutLakeWaterBody = {
  schema: 1;
  id: string;
  kind: "lake";
  mode: "fillExisting";
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  terrainRef: string; // layout.landscapes içindeki World Terrain aktörünün id'si
  coordinateSpace: "world";
  seed: [number, number]; // dünya XZ; seed Y terrain'den yeniden hesaplanır
  bounds: { min: [number, number]; max: [number, number] }; // dünya XZ, grid hizalı
  surfaceLevel: number; // dünya Y; origin[1] yalnız yükseklik dönüşümünde kullanılır
  appearance?: {
    deepColor?: string;
    shallowColor?: string;
    opacity?: number;
    bedVisibility?: number;
    absorptionDistance?: number;
    normalTexture?: string; // manifest texture id, dosya yolu değil
    normalScale?: number;
    rippleSpeed?: number;
    reflectionMode?: "off" | "sharedPlanar";
    reflectionGroup?: string;
    reflectionQuality?: "low" | "medium" | "high";
    reflectionStrength?: number;
  };
};
```

- `terrainRef` dosya yolu veya tile id'si değildir; mevcut World Terrain aktörüne
  bağlanır. W1 eski `.landscape.json` yüzeyinde çalışmaz; 1×1 World Terrain de
  aynı çekirdeği kullanmalı, köprüdeki canlı sculpt verisinin önceliği korunmalıdır.
- Kimlik benzersiz ve kalıcıdır. Enum/şema işaretleri zorunlu; NaN/Infinity,
  ters/boş alan, sınır dışında seed, bütçeyi aşan örnek/tile sayısı reddedilir.
  Seed alanın kesin içinde olmalıdır. Dünya koordinatları save sırasında
  üç ondalığa yuvarlanmaz; grid hizası terrain referansı çözüldükten sonra
  doğrulanır. Seviye için nehrin ±10.000 sınırı körlemesine kopyalanmaz;
  sonlu dünya Y doğrulanır; terrain datumuyla kullanılabilir seviye ayrıca
  hesaplanır. Kuru/açık havza bir hesap durumudur, sonlu kaynak parametrelerini
  kaydetmeyi engelleyen şema hatası değildir; sessiz seviye clamp'i yapılmaz.
- Yalnız kaynak parametreler kaydedilir. Mesh, kıyı döngüleri, doluluk maskesi,
  derinlik, taşma eşiği, tile snapshot'ı ve hata durumu türetilmiş veridir.
  `bounds` çalışma alanının tamamıdır; suyun hesaplanan AABB'siyle değiştirilmez.
- Görünüm varsayılanları merkezi resolver'da; renk/opaklık/soğurulma/texture ve
  yansıma için mevcut nehir kuralları yeniden kullanılır. W1 ripple varsayılanı
  0,15; yansıma `off`, düşey dalga genliği **0** ve kıyı köpüğü kapalıdır.
  Ripple yalnız normal/görünüm animasyonudur, su seviyesi veya akış değildir.
- `waterBodies` level dosyasında persistent kalır, World Partition cell'lerine
  bölünmez. Yeni dizinin save snapshot, export/clone, partition split/merge,
  runtime read ve strict build içerik yollarında korunması ayrıca doğrulanır.
- `engine/scene/layout.ts`, `layoutValidation.ts` ve `tools/saveValidator.ts`
  aynı yeni sözleşmeyi tanımalıdır. Runtime ve save için ortak Lake doğrulayıcısı
  tercih edilir; save allowlist'e eklenmeyen alan teslim edilmiş sayılmaz.
  Eksik terrain referansı editörde onarılabilir hata olarak görünür, runtime'da
  gövde atlanır; sahte terrain/mesh üretilmez. Geçersiz şema yüklemede reddedilir.
- Mevcut `riverWaters`, `landscapeRef`, `splineRef`, koordinat işareti ve eski
  yerel veri olduğu gibi korunur. W1 sessiz River migrasyonu yapmaz. Ortak
  görünüm resolver'ı River için adaptörle kullanılabilir; veri birleşimi W5'tir.

### 12.3. Geometri: terrain üçgenlerinde bağlantılı dolum

**Öneri: raster hücre merkezi flood-fill veya marching squares yerine terrain'in
kendi parçalı doğrusal üçgenlerini su düzlemiyle kırp.** `terrainHeightQuery.ts`
ve collider hücreleri `a,c,b` / `b,c,d` üçgenlerine, yani `b–c` diyagonaline
ayrılır. Bilinear yükseklik kullanmak saddle hücrelerinde farklı kıyı/bağlantı
üretir; nehir ribbon'ını büyütmek de ada ve kapalı çukur problemini çözmez.

1. Grid hizalı alanın hücreleri ve ortak kenarları deterministik sırayla
   listelenir. Yükseklik `origin[1] + tile.heights[index]` olarak dünya Y'ye
   çevrilir; hesaplar terrain'e yakın yerel frame'de Float64 ile yapılır.
2. Her terrain üçgeni `h < surfaceLevel` yarı uzayında kırpılır. Kenar kesişimi
   `t = (L - h0) / (h1 - h0)` ile bulunur. Tamamen ıslak üçgen kalır, kısmi
   üçgen üçgen/dörtgen verir, kuru ve sıfır alanlı parçalar elenir.
3. Seed'in düştüğü kesin üçgendeki ıslak parçadan BFS yapılır. Yalnız ortak
   kenarda **pozitif uzunlukta su altı açıklığı** bulunan parçalar komşudur;
   yalnız köşe teması su bağlantısı değildir. Seed tam kenardaysa aynı kuralla
   bağlı adaylar deterministik seçilir. Kuru seed en yakın çukura atlatılmaz.
4. Ulaşılan kırpılmış parçalar su Y'sine izdüşürülür ve convex fan ile
   üçgenlenir. Her su üçgeni tek bir kaynak terrain üçgeninin içinde kalır.
   Böylece vertex derinliğinin interpolasyonu üçgen içindeki her noktada
   `d = max(0, L - terrainHeightAt(x,z))` verir; arada bilinear yaklaşım yoktur.
   Kesinlik, tam çözünürlüklü kayıtlı heightfield yüzeyine göredir; kamera LOD'u
   veya global harita doğruluk kaynağı değildir.
5. Karşılıklı iç kenarlar kaldırılır; kalan gerçek kesişim kenarları dış kıyı
   ve ada iç kıyısı döngülerini oluşturur. Mesh'i bu halkalardan yeniden
   triangulate etmek gerekmez; delikler zaten doluma alınmamıştır. Düz plato
   ve aynı yükseklikte köşe temasında dallanan konturlar ayrık halkalara ayrılır.
6. Global grid vertex/kenar kimlikleri kesişim cache anahtarıdır. Aynı kenar
   kesişimi bir kez hesaplanır; tile chunk'ları aynı değeri kullanır. Tile
   sınırı kıyı sayılmaz, çift yüzey ve iç köpük oluşturulmaz. Çelişen seam
   kopyaları toleransı aşıyorsa tanısal hata verilir, suyla gizlenmez.
7. GPU Float32 konumları alan merkezine yakın yerel frame'de tutulur, Object3D
   dünya konumuyla yerleştirilir. UV XZ metre cinsindedir; tile sınırında normal
   animasyonu sıfırlanmaz. XZ dalga deplasmanı yapılmaz, düşey genlik W1'de 0'dır;
   geometriyle çıkan kıyıdan karaya taşma ve dalga altında negatif derinlik yoktur.

Başlangıç tolerans önerisi: yerel hesapta `epsilonY = 1e-5 m`,
`epsilonXZ = max(1e-7 m, spacing × 1e-7)`; tam seviye eşitliğinde kuru/kapalı
taraf seçilir. Kırpma gerçek `h-L` işaretini ve gerçek kenar yüksekliklerini
kullanır; epsilon bandındaki vertex'i başka tarafa sınıflandırıp aralık dışı
kesişim üretilmez. Sıfıra yakın parça/kenar bağlantısı korumacı olarak elenir;
bu tanımlı sayısal belirsizlik bandıdır. Epsilon su düzlemini veya terrain
yüksekliğini değiştirmez; rastgele ek toleranslar kullanılmaz.
Kaydın u16 nicemlemesi ayrı bir hata kaynağıdır (§12.9); kıyı toleransı olarak
bir heightmap basamağına kadar yayılmaz.

### 12.4. Alan kenarı, eksik tile ve taşma sözleşmesi

| Durum | W1 davranışı |
| --- | --- |
| Tanımlı ama resident olmayan tile | Gerekli alan için geçici oku/doğrula; bitene kadar `loading`. Sıfır/global-map yüksekliğiyle doldurma yok. |
| Tanımlı tile'da 404/503/decode hatası | Gövdenin tamamı `missing-data`; kısmi göl çizilmez. Sorunlu key ve yeniden dene gösterilir. Başarılı retry aynı parametrelerle yeniden hesaplar. |
| Tanımda bulunmayan gerçek tile deliği | Veri yokluğu ile karıştırılmaz; delik üzerinden bağlantı/yüzey üretilmez. Seed deliğe düşerse geçersiz; su bileşeni delik kenarına ulaşıyorsa `open-boundary`, yüzey yayımlanmaz. Ayrı kuru bölgede kalan delik geçerli gölü engellemez. |
| Dünya dışı çalışma alanı | Commit öncesi reddedilir; sessiz crop yapılmaz. Dünya dışına açılan ıslak bileşen kapalı göl değildir. |
| Bağlı su alan kenarına ulaşıyor | `open-boundary`; kesilen kenar kırmızı önizleme/uyarıyla gösterilir. Oluştur devre dışı; alan büyüt veya seviyeyi düşür. Runtime'da yüzey yok. |
| Seed kuru / seviye tabanın altında | `dry-seed`; su yok. Seed'in başka çukura taşınması önerilebilir, otomatik yapılmaz. |
| Bütçe aşılıyor | `over-budget`; gerekli örnek/tile/byte sayısı ve sınır gösterilir; otomatik kaba örneklemeye veya tüm dünyayı yüklemeye geçilmez. |

**Taşma eşiği:** W1'in ölçtüğü `escapeLevel`, seed'den çalışma alanının dış
kenarına veya gerçek terrain deliğine ulaşan yollar arasındaki en düşük
`max(h)` değeridir. Kaynak üçgen komşuluklarında minimax/Dijkstra ile, ortak
kenarın en düşük geçiş yüksekliği ve sınır çıkışları üzerinden hesaplanır.
Seed yüksekliği başlangıç maliyetine dahildir. Yalnız kenar/köşe eşitliğinde
geçit açık sayılmaz; `L >= escapeLevel - epsilonY` tehlike bandında gövde
korumacı biçimde geçersizdir. İç çukurlar arası eşik geçilirse yeni bağlantı
gösterilir; bu tek başına dışarı taşma değildir.

Bu **sınırlı alanın kaçış eşiğidir**; alan dışındaki terrain bilinmeden fiziksel
havzanın nihai taşma seviyesi iddia edilmez. Bir kuru kapalı çevre alan içinde
bulunursa elde edilen eşik bu kapanmanın ilk açılma seviyesini verir. UI'da
"Alan dışına açılma seviyesi" ve mevcut seviyeye kalan fark gösterilir.
Eşiği aşınca su kendiliğinden kısılmaz, alan büyütülmez, akış simüle edilmez.

### 12.5. Nehirden paylaşılacak parçalar ve ayrılacak sorumluluklar

| Bugünkü kaynak | W1'de kullanım / sınır |
| --- | --- |
| `engine/terrain/terrainRiverWater.ts::prepareTerrainRiverWaterSource` | Alan tile listesini üretme dışında geçici okuma/doğrulama yaklaşımı ortaklaştırılır. Mevcut kod koridor seçer, en çok 4 paralel okuma yapar ve canlı tile'a öncelik verir; immutable snapshot ve iptal bütçesi ayrıca eklenmelidir. |
| `terrainHeightQuery.ts`, `terrainTypes.ts`, `terrainLoader.ts` | Kesin üçgen/datum/seam kuralları, tile sınırları ve binary validator; coarse/global yükseklik kıyı için kullanılmaz. |
| `engine/scene/riverWater.ts` | Renk, opaklık, soğurulma, texture ve yansıma varsayımları ortak küçük görünüm resolver'ına alınabilir; River'ın eski varsayılanları değişmez. |
| `engine/render-three/riverWater.ts` | Normal/renk/soğurulma shader parçaları kullanılabilir. Ribbon geometri, spline UV, `shoreDistance`, rapid/segment/foam stamp mantığı Lake'e taşınmaz; yeni Lake mesh/material adaptörü gerekir. |
| `engine/render-three/planarReflectionSource.ts` | Yaşam döngüsü ve capture paylaşımı; aynı dünya düzlemi/grup/kaliteyi gerçekten kullanan gövdeler tek kaynağı paylaşabilir. Yuvarlanmış key tek başına farklı düzlemleri birleştirmemeli. Varsayılan kapalı. |
| `SceneApp.buildRiverWaters`, `RuntimeSceneApp.buildRuntimeRiverWaters` | Ortak Lake çekirdeğine ayrı editör/runtime bağlantıları gerekir. Nehirdeki tüm gövdeleri silip yeniden kurma yerine Lake başına revision ve atomik sonuç yayımlama tasarlanır. |
| `terrainEdit.ts`, mevcut sculpt undo komutları | Dirty rect ve işlem tamamlanma sinyalleri Lake invalidation'ına bağlanır. W1 Lake kendisi terrain patch üretmez. |

Önerilen yeni saf çekirdek `engine/terrain/terrainLakeWater.ts`; veri resolver'ı
`engine/scene/waterBody.ts`, çizim adaptörü `engine/render-three/lakeWater.ts`.
İsimler öneridir. Shared planar açılacaksa River ve Lake'in ayrı rebuild'leri
aynı kaynağı birbirinin altından dispose etmemelidir: uygulama düzeyinde
ref-count/consumer sahiplikli registry gerekir; salt sınıf yeniden kullanımı
iki gövde türü arasında capture paylaşımı sağlamaz.
Sorumluluklar: parametre doğrulama → bounded snapshot →
bağlı bölge/kıyı/derinlik/tanı → mesh buffer'ları; UI, fetch ve Three.js saf
geometri çekirdeğine girmemelidir. Tüm su sistemini baştan yazmak W1 bağımlılığı
değildir. River/Lake birleşimi ve üst üste su yüzeyini birleştirme W5'e kalır;
editörde kesişen gövdeler uyarılır, birleşmiş su diye sunulmaz.

### 12.6. Tile okuma, güncelleme ve asenkron tutarlılık

- Gerekli küme çalışma alanına değen tanımlı tile'lar ve seam sahipliği için
  gereken sınır kopyalarıdır. Tanımdaki key'ler dışında dosya yolu üretilmez;
  tüm dünya eager yüklenmez. İlk sürüm bu sınırlı kümeyi baştan okur; yalnız
  BFS'nin rastladığını okumak, eşik hesabını eksik bırakmamalıdır.
- Öncelik canlı edit/sculpt tile'ıdır; 1×1 köprüdeki canlı yükseklik dahil.
  Çekirdek başlamadan gereken yükseklik alt bölgeleri kopyalanır. Eksik tile
  validated binary olarak geçici okunur, ağırlık/ham dosya yalnız decode ömrünce
  tutulur. Disk okuması canlı tile'ın üzerine yazmaz; resident/collider/GPU slot,
  undo pin, dirty/save listesi ve global harita değişmez.
- Bir build en fazla 4 paralel fetch kullanır; tüm Lake build'leri için de
  toplam 4 read ve tek CPU geometri işi önerilir. Aynı tile okuması paylaşılır.
  Gövde/alan/level değişince, silinince veya proje kapanınca AbortController ve
  generation token ile eski işler iptal edilir; iptal edilemeyen sonuç atılır.
- Parametre ve terrain yükseklik revision'ı sonuçla eşleşmeden yayımlama yoktur.
  Resident tile'ı diskten beklerken sculpt değişirse eski snapshot yayımlanmaz.
  Parametre değişince geometri/eşik; height dirty rect alanla kesişince **bütün
  alanın bağlantısı** yeniden hesaplanır: tek dar geçit tüm topolojiyi değiştirebilir.
  Paint-only değişiklik geometriyi değiştirmez; yalnız ilgili görünüm yenilenir.
- Seviye/alan/seed sürüklemesi 150 ms debounce ile birleştirilir; bırakmada son
  iş zorlanır. Sculpt'ta dab başına tüm göl kurmak yerine vuruş sonunda tek iş
  planlanır. Düzenleme sırasında önceki mesh `updating/stale` olarak yalnız
  editör taslak görünümünde tutulabilir; başarısız sonuçta gizlenir. Runtime
  geçersiz/eski yüzeyi geçerli su olarak göstermez. Yalnız son revision atomik
  değiştirilir, eski GPU kaynakları dispose edilir.
- Terrain verisi değişmiyorsa minimax/topoloji ara verisi seviye değişimleri
  arasında cache'lenebilir; seed/alan/height revision değişince düşer. Uzak
  kamera için bağımsız su LOD/streaming W1'de yoktur. Geçerli sınırlı gövde
  runtime'da bir kez oluşturulur; kamera hareketi exact tile'ları resident yapmaz.

### 12.7. Seçim, undo/redo ve kayıt davranışı

- Outliner'da ayrı Lake satırı ve Details; seed ve çalışma alanı editör
  yardımcılarıyla görünür. Nehir `raycast = () => {}` kullandığı için Lake seçimi
  ayrıca tasarlanır: editör su proxy'si + `waterBodyId`, runtime picking kapalı.
  Oluşturma/sculpt ray'i suyu atlayıp terrain'e gider. Geçersiz veya kuru Lake
  Outliner/seed proxy'si üzerinden yine seçilebilir. Locked kontrolleri kapatır.
- Oluştur/sil/seed değişimi birer undo; sürükleme ve slider etkileşimi başına
  before/after kaynak parametreleriyle tek undo. Cache/mesh undo içine konmaz.
  Undo/redo aynı invalidation yolunu çağırır; kimlik değişmez.
- Sculpt kendi mevcut undo komutudur. Sculpt undo/redo bitince etkilenen Lake
  yeniden hesaplanır; ek bir Lake undo adımı oluşmaz. Gölde seviye değiştirmek
  terrain undo geçmişine veya tile dirty listesine dokunmaz.
- Yeni gövde ancak geçerli önizlemeyle oluşturulur. Mevcut gövde sonradan kuru,
  açık sınırlı veya veri hatalı hâle gelebilir: kaynak parametreler ve Outliner
  satırı korunur, yüzey gizlenir. Bu geçerli kaynak veri Save ile saklanabilir;
  `invalid` tanısı kaynak JSON'a yazılmaz. Reload tekrar hesaplar ve aynı
  sorunu bildirir. Bozuk şema kaydı ile hesap sonucu geçersiz havza ayrıdır.
- Save hesap mesh'ini beklemek zorunda değildir; son kaynak parametreleri ve
  terrain snapshot'ı mevcut save sırasıyla korunur. Reload aynı terrain'den
  yeniden üretir. Salt Lake oluşturma/düzenleme/silme terrain tile'larını
  kaydetmez. Sculpt varsa yalnız zaten kirlenen terrain kayıtları yazılır.

### 12.8. Önerilen performans ve kaynak bütçesi

Referans: orta seviye masaüstü, Chromium, 1440 × 900, 60 Hz; donanım/driver,
renderer ayarları ve terrain spacing ölçüm kaydında yazılacak. Aşağıdakiler
**ölçülmemiş ilk hedeflerdir**; W1.4'te doğrulanır veya gerekçeli revize edilir.

| Kalem | W1 hedefi / üst sınır |
| --- | --- |
| Varsayılan alan | 64 × 64 m hedef, grid'e dışa hizalı; spacing 1 m ise seed hizasına göre 4.096–4.225 hücre |
| Tek Lake çalışma alanı | En çok 65.536 hücre; 131.072 kaynak üçgeni, en çok 262.144 çıktı üçgeni; seyrek temsil adına örnek atlanmaz |
| Tile ve geçici IO | Alan + seam kopyaları dahil en çok 16 tanımlı tile; toplam 4 eşzamanlı okuma |
| Decode ön kontrolü | Eşzamanlı decode için tahmini toplam ≤ 32 MiB; tile başına `(q+1)² × (4 + 4×ceil(layerCount/4))` decode byte'ı ve ham byte payı hesaplanır. Büyük tile tek başına aşarsa da reddedilir |
| Tek gövde geometri belleği | Typed-array CPU buffer ≤ 16 MiB, GPU ≤ 16 MiB; seam vertex paylaşımı yapılır, büyük JS number[] kopyaları tutulmaz |
| Toplam Lake bütçesi | Level başına ≤ 8 gövde ve toplam ≤ 262.144 çalışma hücresi; ek CPU transient/cache ≤ 64 MiB, GPU ≤ 32 MiB; değiştirme sırasında eski+yeni buffer da sayılır |
| Ana thread | Hesap/decode/upload işleri parçalara ayrılır; zaman dilimi ≤ 4 ms, Lake nedeniyle > 50 ms long task yok. Gerekirse worker; kesin çözünürlük düşürülmez |
| Warm rebuild | §12.9'daki 96×96 m fixture'da p95 ≤ 100 ms; üst sınırdaki alanda p95 ≤ 500 ms; debounce ve IO hariç, eşik hesabı dahil |
| Cold açılış | Aynı fixture'da yerel servisle p95 ≤ 1 s; IO/decode/geometri ayrı ölçülür. Bozuk/503 okuması süre kabulüne dahil edilmez, hata davranışı ayrıca sınanır |
| Çizim | Tile başına en fazla bir surface chunk; gövde başına ≤ 16 ek renk draw call, gölge pass'i yok; varsayılan 2×2 fixture'da ≤ 4 |
| GPU | Yansıma kapalı tek fixture Lake'inin ek GPU süresi p95 ≤ 1 ms; GPU timer varsa ölçülür, yoksa GPU kabulü açık raporlanır |
| Yansıma | Varsayılan `off`; açılırsa aynı grup/düzlem/kalitede ek capture sayısı gövde sayısıyla artmaz. Capture maliyeti ayrı raporlanır; kapalı profilin GPU kabulü açık profil için kanıt değildir |

Hücre/tile/byte/buffer sınırlarının **hepsi** sağlanmalıdır. Bellek tahmini
okuma ve allocation öncesi yapılır; toplam bütçe bitince sonraki gövde açık
`over-budget` tanısıyla bekler. Gövde sırası id ile deterministiktir. Başarısız/
iptal edilmiş iş kaynak bırakmaz. 20 rebuild/undo/reload tekrarında tutulan
tile, buffer ve reflection sayısının başlangıç düzeyine dönmesi kontrol edilir.
Bu sınırlar 4 km dünyada çok sayıda su gövdesi performans kabulü yerine geçmez.
Zaman ölçümlerinde 5 warm-up sonrasında en az 30 rebuild örneği; cold için
geçici Lake cache'i temizlenerek en az 10 örnek, kare maliyeti için sabit kamera
rotasında en az 300 kare alınır. Cache durumu ve baseline terrain maliyeti
kayıtta açıkça belirtilir; küçük 64×64 varsayılan alan ayrıca raporlanır.

### 12.9. Bağımsız test çukuru ve kabul matrisi

**Önerilen fixture (yalnız W1 onayından sonra üretilecek):** Mevcut
LandscapeTest veya kullanıcı sahnesi kullanılmaz. Engine'de deterministik veri
fabrikası, tarayıcıda izole smoke projesi kullanılır. Temel dünya 2×2 tile,
`tileQuads: 64`, `spacing: 1`, `origin: [-64, 10, -64]`; X=0 ve Z=0 sınırlarını
geçen tek çukur dört tile'a yayılır. Ek 2×1 varyant tek seam'i izole eder.

- Çalışma alanı XZ `[-48,-48]..[48,48]`, seed `[-20,-12]`; başlangıç dünya su
  Y=12. Çukur merkezindeki zemin dünya Y=10, dış kapalı sırt Y=16; merkezde
  Y=15 ada ve aynı alanda Y=10 tabanlı, Y=14 sırtla ayrılmış ikinci küçük çukur.
  İç eşik Y=14, alan dışına tek düşük geçit Y=15 olacak şekilde fixture kurulur;
  geometri fabrikası bu yükseklik/bağlantı varsayımlarını ayrıca doğrular.
- Y=12'de ada kuru ve ikinci çukur boş; Y=14,25'te bağlı ikinci çukur dolar,
  ada kalır; Y=15 eşik bandında açık sınır uyarısı gelir ve yüzey yayımlanmaz.
  Alan küçültülerek daha düşük seviyede yapay kesilme ayrıca tetiklenir.
- Bir saddle hücresinde dört farklı köşe yüksekliği, bir dar geçit ve bir
  tam eşit plato bulunur. Bir varyant origin'i `[1000000.25, 37.5, -1000000.75]`
  yapar; XZ/Y değerleri aynı farkla ötelenir. Tüm seam kopyaları aynıdır.

| Kabul | Kanıt ve beklenen sonuç |
| --- | --- |
| K1 — Yüzey/kıyı | İki sınırda kopma/çift üçgen yok; bütün temel su vertex'leri dünya Y=L. Her kıyı vertex'inde exact terrain yüksekliği L'ye yerel hesapta ≤ 1e-5 m yakın; Float32 çizim konumu/derinlik toleransı ≤ 1e-4 m |
| K2 — Bağlantı/adalar | Ada üstünde ve bağlantısız çukurda üçgen yok; köşe temasından su atlamaz; dar geçit ve iç eşik aşıldığında yalnız gerçekten bağlı alan katılır. Analitik probe'lar ve su maskesi/alanı engine'de doğrulanır |
| K3 — Kesin derinlik | Vertex, kenar ve rastgele üçgen içi probe'larda `L-terrainHeightAt` ile eşleşir. Saddle'da bilinear sonuca eşit olmadığı kontrol edilir; tile/origin/datum kayması yok |
| K4 — Seviye/sculpt | Seviye düşür/yükselt; seed kuru; adayı yükselt; bağlantı boğazını aç/kapat. Sonuç yeniden üretilir, Undo/Redo eski/yeni maskeyi ve derinliği geri getirir; uzak/paint-only değişim gereksiz geometri işi başlatmaz |
| K5 — Sınır/taşma | Alan küçültme, dünya kenarı ve gerçek delik ayrı denenir. Kesilme kenarı önizlemede görünür; eşik ve epsilon-altı/eşit/üstü davranışı deterministiktir. Dış sınır sahte kıyı olarak çizilmez |
| K6 — Eksik tile/retry | Tanımlı uzak tile için 503 ve bozuk binary tüm gövdeyi durdurur; retry düzeltir. Ayrı kuru delik gölü engellemez, ıslak delik sınırı reddeder. Okunan key ve eşzamanlılık ölçülür; resident/pin/collider/save listeleri değişmez |
| K7 — Editör işlemleri | Gerçek UI tıklamasıyla seed, alan/seviye düzenleme, Outliner/proxy seçimi, gizle/kilitle/sil, Esc, oluştur ve sil undo/redo. Her sürükleme tek komut; asenkron eski sonuç yeni ayarı geri alamaz |
| K8 — Save/Reload/Play | Gerçek endpoint ile Save → Reload → Play; id/parametreler korunur, aynı kayıtlı tile verisinde maskeler/kıyı/derinlik editör ve runtime'da eşleşir. Partition açık/kapalı, export/clone, 1×1 World Terrain ve mevcut River regresyonu kapsanır |
| K9 — Salt su işlemi | Lake işleminden önce/sonra terrain def/tile byte hash'leri, spline'lar ve dirty durumu aynı; yalnız level kaydı değişir. Sculpt durumunda mevcut terrain save/undo kapsamı dışına yazılmaz |
| K10 — Asenkron/maliyet | Yavaş IO sırasında seviye değiştir/sil/proje kapat; snapshot sırasında sculpt; stale sonuç yayımlanmaz. 20 tekrar sonrası leak yok; §12.8 sınırları ve cold/warm p95 kaydedilir; büyük-dünya varyantında alan dışı tile okunmaz |
| K11 — Görsel kabul | Playwright ile yakın eğik kıyı, üstten ada/ayrı çukur, iki seam ve uzaktan çekim; sığ taban/soğurulma, ripple, reflection off/on; 1440×900 ve 1100×720 screenshot'ları incelenir. Kasıtlı IO hatası dışında konsol hatası yok |

Save/Reload karşılaştırması aynı **kaydedilmiş** terrain verisi üzerinde yapılır.
Sculpt sonrası f32 canlı verinin u16 kaydı yarım nicemleme basamağı kadar
yükseklik değiştirebilir; eşik çevresinde topoloji bu nedenle değişebilir.
Bu, Lake koordinatlarının yuvarlanmasına bağlanmaz. Hassas eşik fixture'ları
f32 formatında tutulur; u16 için beklenen yükseklik hatası ve eşik değişimi
ayrı kontrol edilir. Görsel kabul, sayısal topoloji kabulünün yerini tutmaz.

### 12.10. Onay sonrası sıralı uygulama dilimleri

1. **W1.1 — Sözleşme ve fixture:** Lake tipi/resolver, ortak runtime/save
   doğrulayıcısı, bounded alan kontrolleri ve bağımsız 2×2/2×1 çukur fabrikası.
   Önce save round-trip, referans/enum ve read-budget regresyonları.
2. **W1.2 — Bounded snapshot:** Canlı 1×1/çok-tile önceliği, geçici tile
   okuma, seam sahipliği, byte/eşzamanlılık sınırları, revision/iptal. Eksik
   tile/hole/retry ve streaming yan etkisizliği kanıtlanır.
3. **W1.3 — Saf geometri:** Üçgen kırpma, seed BFS, kıyı halkaları, exact
   derinlik ve minimax kaçış eşiği. Saddle/plato/dar geçit/büyük origin testleri;
   açık sınırda yalnız tanı önizlemesi. Terrain yazımı yok.
4. **W1.4 — Çizim ve erken performans kapısı:** Lake render adaptörü ve ortak
   görünüm parçaları, düz yüzey/normal animasyonu, chunk dispose ve editör/Play
   çekirdek eşleşmesi. Varsayılan ve maksimum alanda cold/warm, heap/buffer,
   GPU/draw ölçümü. Bütçe tutmazsa önce scheduling/typed-array/worker ele alınır;
   kıyı doğruluğu düşürülmez. Sonuç kaydı olmadan bütçe kabulü işaretlenmez.
5. **W1.5 — Editör akışı:** Tıklayarak oluşturma, sınır tutamaçları, dünya
   Y/seed/appearance Details, proxy/Outliner seçimi ve açık hata/Retry. Tek işlem
   undo/redo ve Esc; UI yeniden render yolu mevcut Details düzenini korur.
6. **W1.6 — Sculpt ve kalıcılık:** Dirty rect → tam bağlı alan invalidation'ı,
   stroke/undo/redo yenilemesi; snapshot/export/partition/save/reload/Play.
   Runtime invalid gövdeyi güvenli biçimde atlar; editör kaynağı onarılabilir tutar.
7. **W1.7 — Kabul ve devir:** K1–K11 engine ve tarayıcı kanıtları, performans
   tablosu, görüntü incelemesi ve veri hash kontrolü. TypeScript sonrasında
   `npx.cmd tsc --noEmit`; motor/runtime için `npm.cmd run test:engine` ve
   `npm.cmd run build:verify`; browser için Playwright ek katmanı. W1 kabulü
   sonrasında W2 ayrı kapsam/onaydır; mevcut sahneye göl yerleştirmek de bu
   bağımsız fixture kabulünden ayrı kullanıcı işidir.

Save/load allowlist ve tile okuma sınırları değişeceği için uygulama sonunda
**Codex Security diff scan** önerilir. AGENTS.md gereği kullanıcı başlatmadan
veya onaylamadan scan çalıştırılmaz; bu tasarım turunda çalıştırılmadı.

### 12.11. Onaya sunulan kararlar ve kalan belirsizlikler

| Karar | Öneri / kalan sınır |
| --- | --- |
| İlk giriş yöntemi | Seed + grid hizalı dikdörtgen; spline/polygon aracı W1'e eklenmesin |
| Açık sınır | Hatalı yüzey yerine tanılı önizleme ve oluşturmayı engelleme; mevcut aktör kaynakları onarılabilir kalsın |
| Kıyı/doğruluk | Terrain üçgeni kırpma + kenar bağlantısı; en düşük detay veya raster yaklaşım kullanılmasın |
| Taşma | Sınırlı alanın minimax kaçış seviyesi; alan dışındaki fiziksel havza ve akış simülasyonu iddia edilmesin |
| Görünüm | Düz geometrik yüzey, hareketli normal, exact derinlik rengi/soğurulma; köpük/ıslaklık/düşey dalga ilk kabulü büyütmesin; yansıma varsayılan kapalı |
| Şema/geçiş | Yeni `waterBodies` yalnız Lake kabul etsin; River JSON değişmesin, görünüm parçaları ortaklaşsın |
| İlk sahne | Mevcut sahne yerine izole 2×2 fixture; 2×1 varyant ve 1×1 regresyon eklensin |
| Bütçe | §12.8 sınırlarıyla başla; donanım ve gerçek p95 değerleri W1.4'te ölçülene kadar performans kabulü açık |
| Yatak | W2'de ayrıca bake + tek undo yaklaşımı değerlendirilsin; W1 terrain düzenlemesin |

Kullanıcı bu W1 kapsamını onayladı; uygulama sonucu §13'tedir. Ölçüme bağlı noktalar:
ana thread dilimlemenin yeterliliği/worker gereği, referans donanımdaki GPU
zamanı ve üst sınırdaki gerçek bellek maliyeti. Sınırlar yetmiyorsa sessiz kapsam
büyütme yerine ölçüm ve yeni öneri kaydedilir. Büyük dünya su/yol streaming'i,
Ocean/Puddle ve eski terrain emekliliği ayrı iş olarak açık kalır.

## 13. W1 Lake uygulaması ve kabul kaydı — 2026-10-26

### 13.1. Teslim edilen davranış

- World Terrain Details içinde **Lake → Choose Lake seed**; kesin arazi
  isabetinden önizleme, dünya Y su seviyesi, başlangıç XZ'sini tekrar seçme,
  grid hizalı dikdörtgen çalışma alanı, dört kenar tutamacı ve sayısal alan
  düzenleme. Oluştur yalnız geçerli önizlemede etkin; Esc taslağı iptal eder.
- Terrain'in `b–c` diyagonalindeki kaynak üçgenleri kırpılır; yalnız seed'e
  bağlı su altı parçaları alınır. Ada/ayrı çukur korunur; bir iç eşik geçilip
  bölge gerçekten bağlanınca doluma katılır. Derinlik kaynak üçgen üzerinde
  doğrusaldır; dünya datumundan ve GPU LOD/global haritadan bağımsız hesaplanır.
- Alan sınırı/delik üzerinden kaçış için minimax eşik ve kesilen kenar
  önizlemesi; kuru seed, eksik tile, geçersiz sınır ve bütçe aşımı için açık
  tanı/Retry. Geçersiz gövde runtime'da yüzey oluşturmaz; kaynak verisi editörde
  düzeltilebilsin diye korunur. Su seviyesine sessiz clamp uygulanmaz.
- Ayrı Lake Outliner/Details, su yüzeyi/seed proxy seçimi, ad, gizle/kilitle,
  silme, sınır/seed/seviye ve görünüm düzenleme; tek işlem undo/redo. Sculpt
  vuruşu ve undo/redo sonrasında kesişen alanın bağlantısı/derinliği yenilenir.
  Paint-only ve tüm su alanlarının dışındaki height patch'i Lake üretmez.
- `waterBodies` persistent level dizisi; ortak runtime/save allowlist ve
  tam JSON koordinat hassasiyeti. Save/Reload/Play aynı çekirdeği kullanır.
  Yeni şema eski `riverWaters`/spline kimliklerini değiştirmez.
- Düz su yüzeyi, derinlik rengi/soğurulma, hareketli normal, varsayılan kapalı
  planar yansıma. Ortak lease registry River/Lake kaynaklarının birbirini
  dispose etmesini önler; aynı kesin dünya düzlemi/grup/kalite paylaşılır.
- Terrain'e yükseklik/boya/spline veya collider yazılmaz. Lake okuması canlı
  edit verisine öncelik verir; geçici disk tile'larını resident/pin/dirty/save
  listelerine eklemez. Dört paralel okuma ve sıralı geometri işi, generation ve
  abort ile eski sonuçların yayımlanmasını engeller.

Ana kaynaklar: `engine/scene/waterBody.ts`, `engine/terrain/terrainLakeWater.ts`,
`engine/render-three/lakeWater.ts`, `waterReflectionRegistry.ts`,
`src/scene/lakeWaterController.ts`; editör/runtime ve ortak validator bağlantıları.

### 13.2. Doğrulama

- Son tam `npm.cmd run build:verify`: **1.962 engine kontrolü**, TypeScript,
  smoke/content/UI test tipleri, production build, strict dist ve world-data
  geçti. Yeni Lake test dosyası ayrıca TypeScript ile denetlendi.
- **11 Lake engine regresyonu:** şema/save/partition, iki tile sınırında
  ada/bağlılık/derinlik/eşik, geçici okuma ve retry, delikler, büyük origin ve
  immutable snapshot, sculpt undo/redo, gerçek kıyı, bozuk veri, iptal edilmiş
  iş ve 20 yaşam döngüsü tekrarı, yansıma lease'leri, saddle/eşit plato, 2×1 seam.
  Tek hücre genişliğinde önizleme kenar kimlikleri de saddle regresyonundadır.
- **Üç Lake Chromium senaryosu:** oluştur/iptal, alan/seviye, kilit,
  açık sınırda yüzey reddi, undo, gerçek Save/Reload/Play ve terrain hash'lerinin
  değişmemesi; kenar tutamacı/seed ve seam sculpt undo/redo; uzak tile 503/Retry.
  Streaming karşılaştırması kameranın tüm hedef tile'ları yüklemesinden sonra
  alınır; geçici Lake okumaları resident key kümesini ve tile save listesini
  değiştirmez.
- Son odaklı sculpt koşusu, değişiklik üretmeyen flatten ve çalışma alanı
  dışındaki height patch'inin hazır Lake sonucunu koruduğunu da doğruladı:
  `lake-w1-sculpt-final.log` ve `lake-w1-sculpt-final-results/`.
- 1440×900 ve 1100×720 runtime ile editör görüntüleri incelendi; ada ve ayrı
  çukur, gerçek kıyı ve iki seam sürekliliği görüldü. QA kamerasının far clip'i
  bütün çukuru kapsayacak şekilde ayarlandı; bu test-only ayardır, oyun
  kamerasına/level verisine değişiklik değildir.
- GPU pilotu **atlandı**: headless Chromium `ANGLE/SwiftShader` kullanıyor ve
  `EXT_disjoint_timer_query_webgl2` sunmuyor. Atlanan senaryo GPU performans
  kabulü olarak sayılmaz; gerçek donanımda ≤1 ms hedefi açık kalır.
- Mevcut River UI/sculpt/foam/yansıma/Save/Reload/Play regresyonu geçti;
  ayrı son koşuda uzak tile 503/Retry de geçti. Kamera streaming'i tamamlanma
  tanığı ortaklaştırıldı; autosave'in değiştirebildiği geçici hata metni yerine
  gerçek 503 cevabı ve su gövdesinin oluşmaması kontrol edilir.

Kanıtlar: `.dev-server/lake-w1-final-build.log`, `lake-w1-engine.log`,
`lake-w1-host.log`, `lake-w1-host-results/` (görüntüler, kaynak/runtime hash,
streaming key kümeleri ve GPU yokluğu kaydı). İlk sandbox soket engeli,
Save bitmeden sayfa değiştiren ilk test, kamera dışındaki tutamaca tıklayan
test ve kamera yüklemesi sürerken alınan resident karşılaştırmaları kabul
sayılmadı. Testler yalnız izole smoke projesine yazdı; mevcut sahneler korunur.
Nehir kanıtları `lake-w1-river.log`, `lake-w1-river-results/` (ana senaryo),
`lake-w1-river-stream.log` ve `lake-w1-river-stream-results/` (503/Retry).

### 13.3. CPU pilotu ve kalan performans sınırı

Tekrarlanabilir komut: `node tools/bench-lake-water.mjs`; rapor
`.dev-server/lake-w1-perf-final.json`. Windows, Intel i5-11400F; 5 warm-up + 30 warm,
10 cache'siz binary decode örneği. Bu **Node CPU/decode** pilotudur; HTTP cold
boot, browser ana thread p95 veya GPU süresi değildir. Değerler cooperative
yield beklemeleri dahil geçen süreyi ölçer.

| Alan | Hücre | Çıktı üçgeni | Saklanan buffer | Warm p95 | Binary decode + üretim p95 |
| --- | --- | --- | --- | --- | --- |
| 96×96 m kabul çukuru | 9.216 | 4.318 | 110.296 byte | 29,5 ms | 16,9 ms |
| Üst sınırdaki çukur | 65.536 | 73.726 | 1.790.896 byte | 343,4 ms | 373,1 ms |

Hücre/tile/okuma/decode ve saklanan geometri buffer sınırları ön kontrolde
denetlenir. Geometri işi yaklaşık 3 ms hedefli dilimler arasında yield eder;
worker eklenmedi. Toplam browser heap/transient tepe ölçümü ve her dilimin
≤4 ms olduğuna dair donanım profil kaydı henüz kabul edilmedi. Bir Lake'teki
parametre değişiminde bounded gövde listesi sıralı yeniden değerlendirilir;
gövdeler arası cache/yalnız değişen gövdeyi yenileme ileride optimize edilebilir.
Kıyı için halka triangulation yerine kaynak üçgen parçaları çizilir; çizgi
segmentleri gerçek dış/ada kıyısını taşır. Geometri LOD/streaming eklenmedi.

W2 yatak oyma, otomatik kıyı boyası/ıslaklık, köpük ve düşey dalga, River/Lake
yüzeylerini birleştirme, Puddle/Ocean ve fizik/hacim simülasyonu bu dilimde yoktur.
Save/load değişiklikleri için kullanıcı onayıyla Codex Security diff scan önerisi
geçerlidir; scan çalıştırılmadı. Commit/push yapılmadı.

## 14. W2 — Kapalı spline ile göl yatağı — 2026-10-26

### 14.1. Onay ve davranış

Plan, kullanıcı tarafından “Implement the proposed plan” ile uygulamaya açıldı.
Başlangıç `4d00aeaf` (`main`, yerel `origin/main` ile aynı), temiz çalışma ağacı.
Bu çalışma commit/push veya mevcut kullanıcı sahnelerine içerik yazmayı kapsamaz.

- W2 yalnız terrain'i alçaltır. `maxDepth` oyma profilinin hedef maksimumudur;
  zaten daha derin zemin doldurulmaz. Gerçek derinlik ayrıca gösterilir.
- Kapalı sınır + ayarlar Lake üzerinde kalıcı bir **bake tarifi** olarak saklanır.
  Runtime/Reload veya tarif düzenleme otomatik terrain yazmaz. Açık
  **Araziye uygula** bir undo/redo komutudur. Yeni Lake'te aktör oluşturma da
  bu komuta dahildir; mevcut Lake'te seed/bounds değişikliği aynı komuta katılır.
- Aktörü silmek, yeniden konumlandırmak, su seviyesini veya tarifi değiştirmek
  eski yatağı geri getirmez. Daha sığ rebake dolgu yapmaz. Geri dönüş bake'in
  Undo komutudur; Undo geçmişi yeniden yüklemede kalıcı değildir.
- Modifier katmanı, otomatik eski yatak restorasyonu, ada dışlama halkaları,
  Puddle/Ocean ve fizik/hacim simülasyonu bu kapsamda yoktur. Spline'ın bütün
  içi oyma adayıdır; mevcut adalar korunacakmış gibi gösterilmez.
- Kıyı boyası isteğe bağlı, varsayılan kapalı; mevcut layer seçilir, yeni layer
  oluşturulmaz. Geçersiz layer uygulamayı durdurur.
- Kodlama aralığını aşan aday yükseklikler reddedilir: W2 aralığı büyütüp tüm
  dünyanın tile dosyalarını yeniden kodlatmaz. Tile/global/definition kayıt
  altyapısı korunur; yeni disk transaction sistemi eklenmez.

### 14.2. Veri, profil, W1 ilişkisi

`LayoutLakeWaterBody` ve ortak runtime/save allowlist'e optional `bed` eklenir:
ordered world-XZ `points`, `smooth`, `smoothness`, `maxDepth`,
`shoreSlopeDegrees`, `transitionWidth`, optional `shorePaint:{layerId,strength}`.
Su seviyesi mevcut `surfaceLevel` alanıdır. `mode:"fillExisting"`, şema 1 ve
eski W1 kayıtları korunur; runtime `bed` tarifini otomatik çalıştırmaz.

Sınır örtük kapalı, tek basit halkadır. 3–256 nokta; duplicate/zero-area,
kesişim ve üst üste kenarlar reddedilir. Mevcut Catmull-Rom sampler'ının sekiz
alt parçası preview ve bake'te aynıdır (en çok 2.048 parça). Varsayılan düz;
derinlik 3 m, kıyı eğimi 30 derece, geçiş `max(4 m,2*spacing)`; eğim 1–80,
smoothness 0–1. Dünya koordinatları JSON hassasiyetiyle saklanır.

`L` dünya su seviyesi, `D` derinlik, `m=tan(eğim)`, `W` geçiş genişliği:

- İçeride sınıra uzaklık `s`: `target=L-min(D,m*s)`.
- Dışarıda uzaklık `r<W`: `t=r/W`, `S=3*t²-2*t³`,
  `target=L+m*r/(1-S)`. `r>=W` etkilenmez.
- Her iki durumda `newY=min(originalY,target)`. Bu mutlak zarf tekrar bake'te
  kümülatif oyma üretmez. Dünya Y, patch'e yazılırken `origin[1]` ile çevrilir.
  Dar sınırda D'ye ulaşılamaması ayrı uyarıdır; grid çözünürlüğü düşürülmez.

Spline oyma şeklidir; **W1 bounds hesap sınırıdır**, spline su maskesi/duvarı
değildir. Yeni taslak alanı spline AABB + dış geçiş + iki hücre payıyla grid'e
dışa hizalanır. Mevcut daha geniş alan korunur; Fit/enlarge açık işlemdir.
Eksik kontrol payı, dünya dışı veya bütçe aşımı sessiz crop ile çözülmez.

Seed içeride ve aday zeminde ıslaksa kalır; aksi hâlde en derin uygun terrain
üçgen merkezinden deterministik önerilir. Aday üzerinde mevcut W1 üçgen
kırpma/BFS/minimax/kıyı/derinlik hesabı çalışır. Açık sınır, kuru seed veya
spline içi suyun çözünürlük nedeniyle bağlantısız parçalara ayrılması bake'i
engeller. Diğer bağlantısız mevcut çukurlar W1 kurallarıyla dolmaz.

Kıyı boyası aday W1'in gerçek kıyısına uzaklıktan, W2 etki alanıyla sınırlı
olarak çıkarılır; bant genişliği W'dir. Ağırlık hedefi byte cinsinden
`max(current,round(255*strength*(1-S(distance/W))))`; diğer layer'lar kalan
byte'ı oransal ve deterministik paylaşır. Toplam 255, tekrar bake idempotent.

### 14.3. Snapshot, atomiklik ve bütçe

Ön kontrol → canlı veriyi dondur → bounded geçici tile okuma → yükseklik
staging → aday W1 → isteğe bağlı boya → patch → revision doğrula → tek yayın.
Preview, terrain dirty/pin/save/global-map/collider listelerini değiştirmez.
Eksik tile'lar özel staging'dedir; streaming `demand()` önizlemede kullanılmaz.
Ancak başarılı bake'te gerekli yeni tile'lar edit dünyasına alınır. Değişen
tile'lar mevcut session/undo pin düzeninde kalır; Save veya Undo pin kaldırmaz.

Etki alanına değen gerçek terrain deliği işlemin tamamını reddeder; salt kuru
kontrol bölgesindeki delik için W1 kuralı geçerlidir. 404/503/decode/seam,
geçersiz bounds/range ve bütçe hataları canlı yazımdan önce sonuçlanır.
Source, definition, yükseklik ve boya snapshot'ı son kez doğrulanır; eski iş
generation/AbortController ile yayımlanmaz. Commit sırasında await yoktur.
Undo/redo kayıtlı before/after yükseklik ve boya patch'lerini kullanır.
Height değişimi tüm ilgili W1 bağlı alanını yeniler; paint-only topolojiyi
değiştirmez. Yol/nehir/foliage/global-map mevcut terrain yenileme yolundadır.

| Kaynak | İlk W2 sınırı / ölçülecek hedef |
| --- | --- |
| Alan/tile | W1: <=65.536 hücre, seam dahil <=16 tile; toplam Lake alanı <=262.144 |
| IO/decode | W1/W2 arasında toplam <=4 okuma; ham pay dahil decode <=32 MiB |
| Undo | Tek bake before+after <=16 MiB |
| Ek CPU | Staging, W1 transient, preview, undo ve ek tutulan tile'lar <=64 MiB |
| Birikim | W2 undo/pin session rezervasyonları sonraki işlemde de sayılır; geçmiş sessizce budanmaz; sınırda save/reload önerilir |
| Ön kontrol | Tam tile snapshot/candidate/patch üst tahmini + hücre başına 360 byte W1/preview transient payı; allocation/IO öncesi |
| Scheduling | 150 ms debounce, iptal/revision; yaklaşık 3 ms çalışma dilimleri |
| Zaman hedefi | 96x96 m warm p95 <=200 ms; 65.536 hücre <=1 s; debounce/IO hariç |
| Browser hedefi | Ana thread dilimleri <=4 ms; W2 nedeniyle >50 ms long task yok; ölçüm olmadan kabul kapanmaz |

Save, mevcut tile → global → terrain tanımı → level sırasındadır. Başarısız
HTTP kayıt dirty veriyi bırakır, Retry/Save tekrar edilebilir. Bellekte atomik
bake, birden çok dosyanın crash-atomic disk kaydı garantisi değildir.

### 14.4. Bağımsız kabul alanı ve uygulama sırası

Fixture: 2x2 tile, q=64, spacing=1, origin=[-64,10,-64], başlangıç dünya
Y=16, L=14; yaklaşık 56x48 m sınır X=0/Z=0 seam'lerini geçer; D=3,
eğim=30, W=4; alan [-48,-48]..[48,48], Ground/Shore layer'ları. Engine
fabrikası ve izole smoke projesi kullanılır, kullanıcı sahneleri kullanılmaz.
Ek 2x1, 1x1, büyük-origin, u16/f32 ve uzak streaming varyantları kapsanır.

Sıra: W2.1 tip/allowlist/fixture → W2.2 saf bounded profil/patch ve erken CPU
kapısı → W2.3 aday W1 ve yazmadan overlay → W2.4 açık tek undo bake/pin →
W2.5 isteğe bağlı boya ve Save/Reload/Play → W2.6 engine/browser/ölçüm kabulü.

Kabul: preview hash/dirty/pin değişmez; dört tile seam'inde yükseklik/boya
birebir eşit; dış örnekler değişmez; deep-ground korunur; ikinci bake no-op;
tek Undo tüm terrain/boyayı ve yeni aktörü geri alır; silme/taşıma terrain'i
geri almaz; eksik tile/hole/bounds/range/budget/stale sonuç kısmi yazmaz;
f32 kesin ve u16 nicemleme sınırları ayrı; gerçek Save/Reload/Play'de kayıtlı
terrain üzerinde aynı W1 kıyı/maske/derinlik. W1 Lake ve nehir regresyonları
korunur. Playwright'ta yakın eğik/üstten iki-seam ve 1440x900/1100x720 görseller
incelenir; konsol, iptal, hata/Retry ve yaşam döngüsü ayrıca denetlenir.

### 14.5. Uygulama ve doğrulama kaydı

**Kullanıcı isteğiyle masaüstüne devirde durduruldu; W2 tamamlanmadı.**

- Diskte kalan: kalıcı tarif/validator, saf oyma profili, bounded tile staging,
  aday W1 değerlendirmesi, boya/undo patch üretimi, ortak dört-okuma sınırı,
  bağımsız fixture, engine testleri ve CPU pilot aracı.
- Oturum içinde tam `build:verify` 1.969 kontrolle geçti
  (`.dev-server/lake-w2-build.log`). Bu, son disk durumunun tam kabulü değildir;
  sonrasında patch ön doğrulaması ve eşzamanlı başka değişiklikler var.
- Son çekirdek devir koşusu `.dev-server/lake-w2-handoff-engine.log`, son
  TypeScript devir koşusu `.dev-server/lake-w2-handoff-types.log` dosyasındadır.
- İlk UI entegrasyonunda iki W2 browser akışı geçti; uzak 503/Retry akışı
  kabul edilmedi: önce testler arası autosave yarışı, sonraki koşuda streaming
  tamamlanma beklemesi. `lake-w2-host.log`/`lake-w2-host-results/` kısmi kanıttır.
- Devir sırasında `SceneApp`/Lake editör akışı başka düzenlemelerle değişti;
  W2'nin `lakeBedOverlay.ts` ve `lakeBedDetails.ts` dosyaları artık yok. W2 UI
  henüz bağlı değildir; browser senaryoları yeniden entegrasyon sonrasında
  güncellenip etkinleştirilmelidir. Başarılı W2 kabulü olarak sayılmaz.
- Görsel incelemede yeni taslakta kamera layer 31 açılmadığı için preview'nin
  görünmediği bulundu. Entegrasyonda W2 overlay varken de bu layer açılmalı;
  görünür geometri ve screenshot tanığı eklenmelidir.
- `.dev-server/lake-w2-perf.json`: ilk Node pilotu 96x96 alan p95 ~216 ms,
  boyalı ~1.631 ms, üst sınır ~9.083 ms; hedefler karşılanmadı. Browser/build
  işleriyle çakışan bu pilot izole tekrarlanmalı; kıyıya mesafe sorgusu için
  uzamsal indeks eklenmelidir. Browser ana-thread veya GPU kabulü değildir.
- §13 donanım GPU, browser heap/ana thread ve büyük dünya kabulü açık kalır.
  Çalışma ağacındaki diğer plan/LandscapeTest/EditorUi değişiklikleri geri
  alınmadı. Bu oturum kullanıcı sahnesine yazmadı; commit/push yok.

**Devam sırası:** Git farkını yeniden incele → eşzamanlı Lake düzenlemelerini
koruyarak W2 UI/preview/bake'i bağla → kamera görünürlüğünü düzelt → testlere
ayrı level yolu ve bitmiş Save tanığı sağla → uzak tile hata/Retry kabulü →
paint mesafe indeksleme ve izole CPU/browser ölçümü → tam gate + W1/River.

Save/load allowlist için kullanıcı onayıyla Codex Security diff scan önerilir;
scan çalıştırılmadı.
