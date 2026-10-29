# Ultra-Water — Forge su yüzeyleri için kaynak ve entegrasyon incelemesi

Tarih: 29 Ekim 2026 · Durum: kaynak incelemesi ve öneri; entegrasyon yapılmadı.

**Karar önerisi:** Ultra-Water'dan Forge'da yararlanılabilir. Yakın vadede mevcut Lake/River sistemine köpük malzemesi, derinlikle doğrulanan kırılma ve ortam/planar yansıma birleşimi uyarlanmalı. FFT simülasyonu ve kamerayı izleyen geniş su yüzeyi, Water Body planındaki **W4 Ocean** için ayrı prototip olarak değerlendirilmeli. Mevcut Lake/River sistemi bütünüyle değiştirilmemeli.

Bu yön, [WaterPro araştırmasının](WATERPRO_VIDEO_VISUAL_RESEARCH_2026-10-29.md) V0–V2 öncelikleriyle uyumludur. Ultra-Water, bu önerilerin bir kısmı için incelenebilir kaynak kodu sağlar; görsel ve performans kabulü sağlamaz.

## 1. İncelenen kaynak ve doğrulama sınırı

| Alan | Kayıt |
| --- | --- |
| Kaynak depo | [Humpalumps/Ultra-Water](https://github.com/Humpalumps/Ultra-Water) |
| Sabit kaynak sürümü | [`ce9248fa20afbdf63fd4c11709f68d7368aca0a0`](https://github.com/Humpalumps/Ultra-Water/tree/ce9248fa20afbdf63fd4c11709f68d7368aca0a0) |
| Kullanıcının indirdiği kopya | `C:\Users\emret\Downloads\Ultra-Water-master` |
| Yerel kaynak doğrulaması | 31 dosyanın tamamı, sabit sürümün Git blob kimlikleriyle eşleşti; eksik, farklı veya ek dosya yok |
| Karşılaştırma yöntemi | Dosya yolları ve içerikleri; CRLF → LF normalizasyonundan sonra Git blob SHA-1 hesabı. Bağımlılık kurulumu yapılmadı |
| Forge karşılaştırması | Mevcut çalışma ağacındaki Lake/River kaynakları, Water Body planı ve ilgili raporlar; yalnız HEAD ile sınırlı değil |

İnceleme statiktir. Ultra-Water kurulmadı, çalıştırılmadı; tarayıcıda görsel karşılaştırma veya GPU/CPU ölçümü yapılmadı. README'nin performans değerleri aşağıda **yazarın raporu** olarak ayrılır. Algoritmanın kodda bulunması, Forge'da sorunsuz çalıştığının veya hedef görüntüyü sağladığının kanıtı değildir.

İndirilen kopyayı incelemek için başka dosya veya ücretli paket gerekmiyor. Demo daha sonra bağımsız klasöründe çalıştırılabilir; Forge'a bağımlılık kurmak veya demo dosyalarını taşımak bu raporun kapsamında değildir.

## 2. Lisans ve dağıtım

Ultra-Water **MIT** lisanslıdır. Lisans metni kullanma, değiştirme, birleştirme, dağıtma ve satma izni verir; kopyalarda veya yazılımın önemli bölümlerinde telif ve izin bildirimlerinin bulunmasını ister. Kod aktarılırsa `Copyright (c) 2026 Humpalumps` ve ilgili lisans metni dağıtımda korunmalıdır. [LICENSE](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/LICENSE).

[THIRD_PARTY_NOTICES.md](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/THIRD_PARTY_NOTICES.md), three.js, Dave Hoskins ve Hillaire atmosfer uygulamasından uyarlanan bölümleri belirtir. Alınan kodun kapsadığı bildirimler de korunmalıdır. Atmosfer dosyasındaki Epic Games bildirimi, bu deponun Unreal Engine'e teknik olarak bağımlı olduğu anlamına gelmez.

Önceki WaterPro raporundaki ücretli dokuları kopyalamama sınırı sürer. Ultra-Water'ın kendi prosedürel köpük üreticisi, ayrı lisans kaydıyla değerlendirilebilen bir kaynak seçeneğidir. Burada kod veya üretilmiş texture Forge'a aktarılmadı.

## 3. Mimari: Forge ile ortaklıklar ve ayrımlar

Her iki proje Three.js/WebGLRenderer kullanır. Ultra-Water'ın su shader'ları GLSL3, simülasyonu float/half-float render target ve çoklu renk çıktıları kullanır. Bu nedenle WebGPU geçişi zorunlu değildir; gerekli GPU formatları ve sınırları yine cihazda doğrulanmalıdır.

Ultra-Water, bağımsız bir demo uygulaması olarak düzenlenmiştir. `package.json` özel paket olarak işaretlidir; yayımlanmış bir su kütüphanesi gibi tanımlanmış giriş noktası bulunmaz. `main.js`, simülasyon, ada, atmosfer, gölgeler, su altı ve post-process akışını birlikte kurar. Kaynak uyarlamak mümkündür; tek bir import ile Forge'a takılacak hazır adaptör yoktur.

| Konu | Ultra-Water kaynak durumu | Forge için sonuç |
| --- | --- | --- |
| Bağımlılıklar | `three ^0.186.1`, `vite ^8.3.5` | Forge `three 0.184.0`, `vite ^7.0.0` kullanıyor. API/shader uyumluluğu denenmeli; toplu sürüm yükseltmesi ilk adım olmamalı |
| Su kotu | Yüzey, reflection ve kıyı hesabında ortalama deniz seviyesi sıfıra göre kurulmuş | Farklı kotlardaki Lake ve eğimli River için gövde bazlı dönüşüm/sorgu gerekir |
| Kıyı verisi | `islandHeight` fonksiyonundan başlangıçta 1.800 m alan için 512² harita üretiliyor | Çok tile'lı terrain, canlı Sculpt değişimi ve Lake bağlantılı dolumuna doğrudan karşılık değil |
| Yüzey geometrisi | Kamerayı izleyen polar grid; kamera yüksekliğine göre ölçek ve yoğunluk değişiyor | Ocean ufku için aday; Lake'in gerçek kıyıya kırpılmış geometrisinin yerine doğrudan geçmemeli |
| Render akışı | Opaque HDR → su → gerekirse su altı → özel post-process; ayrıca yansıma/simülasyon geçişleri | Forge snapshot, CSM, AO/DoF ve post-process düzenine adaptör gerekir |
| Nesne fiziği | Demo kendi hücre bazlı yüzdürme ve hareket hesabını yapıyor | Forge Rapier entegrasyonu yerine doğrudan taşınmamalı; su sorgusu ve kuvvet uygulaması ayrılmalı |

Kaynaklar: [paket](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/package.json), [kurulum ve render döngüsü](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/main.js), [yüzey](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/OceanSurface.js), [kıyı haritası](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/shoreMap.js), [yüzdürme](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/scene/floaters.js).

## 4. Yakın vadede uyarlanabilecek parçalar

### 4.1. Köpük malzemesi — ilk aday

`bakeTextures.js`, başlangıçta 512² döşenebilir, mipmap'li bir RGBA doku üretir. R kanalı parçalı köpük örüntüsünü, G kabarıklık yüksekliğini, BA yüzey eğimini taşır. Birkaç ölçekte hücresel desen kullanılır. `OceanSurface.js`, yoğunluğa göre örüntüyü aşındırır; köpük normalini, gölgelenmesini ve ince/yoğun köpük rengini ayırır. Ayrı bir köpük görsel dosyası indirmek gerekmez.

Forge'da [ortak köpük deseni](../../engine/render-three/waterFoam.ts), [Lake çizimi](../../engine/render-three/lakeWater.ts) ve otomatik geometri köpüğü zaten vardır. Öneri, **nerede köpük bulunduğunu belirleyen maskeleri koruyup köpüğün malzemesini geliştirmektir**. Lake/River Calculate/Recalculate/Cancel/Clear akışı ve kaydedilmiş binary maske kullanılmaya devam eder. Taş başına manuel kaynak yerleştirme geri getirilmez.

İlk deneme ortak bir texture paylaşmalı; gövde başına aynı doku yeniden üretilmemeli. Üretim zamanı, sampler sayısı, mip/uzak görünüm, kalite geçişinde kaynak ömrü ve gölgede/gecede parlaklık ayrıca kontrol edilmeli. GPU'da üretilen texture'ın sahibi render target ile birlikte tutulmalı; mevcut yardımcı fonksiyonun yalnız texture döndürmesi Forge'un bırakma sözleşmesi için yeterli kabul edilmemeli.

Kaynak: [köpük üreticisi](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/bakeTextures.js), [köpük sunumu, satır 500–556](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/OceanSurface.js#L500).

### 4.2. Derinlikle doğrulanan kırılma — ikinci aday

Ultra-Water, sahne derinliği ile su yüzeyi arasındaki kalınlığa göre normal yönünde ekran UV'sini kaydırır. Kaydırılmış örneğin depth'i suyun önündeki nesneye denk geliyorsa, kaydırmayı yumuşakça azaltır. Böylece kaya/karakter siluetinin suya çekilmesine karşı bir koruma sağlar. Bu, ekran uzayında bir yaklaşımdır; ekran dışında kalan görüntüyü üretemez.

Forge Lake, [mevcut shader'da](../../engine/render-three/lakeWater.ts) snapshot rengini kaydırılmamış `screenUv` ile okur; [renk/depth altyapısı](../../engine/render-three/waterSceneSnapshot.ts) başlangıç fırsatıdır. Yeni bir sahne render'ı açmadan, sınırlı UV kaydırma ve depth doğrulama prototipi değerlendirilebilir.

Kopyalanan formül tek başına yeterli değildir: ekran sınırı, gerçek su maskesi, çoklu gövde, sığ kıyı, ince nesneler ve snapshot olmayan direct/MSAA yolları korunmalıdır. Etki sıfırken mevcut görüntüye dönülmeli. Lake sonucu doğrulandıktan sonra River bağlantısı ayrıca ele alınmalı.

Kaynak: [kırılma, satır 412–425](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/OceanSurface.js#L412).

### 4.3. Ortam ve planar yansıma birleşimi

Ultra-Water gökyüzü küpünü temel yansıma olarak örnekler; planar hedefin alpha'sıyla sahne yansımasını bunun üzerine birleştirir. Roughness'a göre mip seviyesi seçer. Forge'da planar kapalıyken Lake yansımasının sürekliliği için yararlı bir örnektir.

Forge'un [ortam/probe altyapısı](../../engine/render-three/waterEnvironment.ts) ve mevcut reflection paylaşımı kullanılmalı. Demo atmosferini, tone mapping'ini veya tüm reflection sınıfını almak bu katkının ön koşulu değildir. Çift güneş/yansıma katkısı, renk uzayı ve enerji dengesi aynı referans ışığında kontrol edilmelidir.

Kaynak: [yansıma, satır 447–461](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/OceanSurface.js#L447).

## 5. Sonraki kapsamlar ve hazır olmayan çözümler

| Alan | Kaynakta bulunan | Kullanım kararı / sınır |
| --- | --- | --- |
| FFT Ocean | Dört 256² kademe; 600 / 85 / 12 / 2,1 m ölçekleri; spektral rüzgâr/dalga ve Jacobian köpüğü | W4 için ayrı prototip. Küçük Lake ve eğimli River'a topluca uygulanmamalı |
| Kıyıya gelen dalgalar | Derinliğe bağlı seyahat zamanı, yayılma yönü ve sığlaşma alanı; kıyıda kırılan dalga sunumu | Dinamik terrain, farklı su kotu ve gövde maskeleri için yeni veri hazırlığı gerekir |
| Kalıcı köpük | FFT'de önceki turbulence/Jacobian değeri tutuluyor; kıyı desenleri iki faz arasında karıştırılarak sürükleniyor | WaterPro raporundaki V3 genel köpük taşınım alanının tamamı değil; River akışı ve otomatik engel kaynaklarına bağlanmış hazır çözücü yok |
| Caustics | Dalga eğiminden üç derinliğe ışın kırıp alan oranı ile render target'lara ışık dağıtımı | Mevcut Forge caustics'i üzerine eklenmemeli. İleride ayrı alternatif olarak karşılaştırılmalı; ek geçiş ve bellek maliyeti var |
| Su altı | Yüzeyin alttan görünümü, su çizgisi, sis ve ışık huzmeleri | V5 içinde kamera geçişi ve gövde aidiyetiyle birlikte planlanmalı |
| GPU su sorgusu | Ortak yüzey GLSL'iyle noktalar örnekleniyor; asenkron GPU readback kullanılıyor | Demo yorumuna göre 1–3 kare gecikme var. Forge'un sabit fizik adımı ve hassas teker temas sorgusunun doğrudan karşılığı değil |
| Yüzdürme | Hücre başına kaldırma/sürükleme ve kıyıya temas | Rapier kuvvet/torque adaptörü ve geçerli su gövdesi sorgusu gerekir |
| Sürekli hareket izi | Düşüşte halka ve sıçrama var | README hareketli nesne arkasındaki wake'in henüz bulunmadığını açıkça belirtiyor |

Kıyı alanındaki küçük kara parçalarını dalga cephesi üretiminden çıkarma yaklaşımı (`ISLET = 64`), Forge'un ada/kuru alan doğruluğunu gevşetme gerekçesi değildir. Bu yardımcı dalga yayılım alanına ait bir tercihtir; gerçek su kapsamından ayrı tutulmalıdır. `bakeShoreMap` senkron CPU hesabıdır; düzenlenebilir dünyaya taşınırsa iptal, dilimleme ve revision/invalidation sözleşmeleri eklenmelidir.

`OceanSim`, `OceanSurface` ve `WaterQuery` sınıflarında bütün kaynakları kapsayan bir `dispose()` yaşam döngüsü bulunmuyor. Kalite değişimi, level travel, iptal ve geç tamamlanan readback'ler için Forge'un sahiplik ve kaynak bırakma kuralları ayrıca uygulanmalıdır. Bu statik gözlem, demoda ölçülmüş bellek sızıntısı iddiası değildir.

Kaynaklar: [FFT](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/OceanSim.js), [kıyı alanı](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/shoreMap.js), [caustics](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/Caustics.js), [su altı](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/UnderwaterPass.js), [GPU sorgusu](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/src/water/WaterQuery.js), [eksik özellikler](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/README.md#not-in-yet).

## 6. Performans değerlendirmesi

### Kaynaktan hesaplanabilen maliyet

`OceanSim.update()` normal karede 1 spektrum evrimi + 16 IFFT aşaması + 4 çıktı birleştirmesi olmak üzere **21 GPU çizimi** yapar. Spektrum kirliyse başlatma çizimi eklenir. Bu sayı mip üretimi, su yüzeyi, yansıma, caustics, sorgu veya post-process maliyetlerini içermez; 21 sahne capture'ı anlamına gelmez.

Kaynakta ayrılan FFT texture'larının teorik veri toplamı yaklaşık **22,67 MiB**'dır: başlangıç spektrumu 4 MiB, iki çift çıktılı çalışma atlası 8 MiB, dört kademenin iki geçmiş/çıktı çifti ve mipleri yaklaşık 10,67 MiB. Bu bir **statik format/boyut hesabıdır**; gerçek GPU tahsisi veya ölçülmüş tepe değildir. Kıyı, caustics, köpük, HDR/MSAA, reflection, geometri ve sürücü payı dahil değildir. Her Lake için ayrı tam FFT kurmak mevcut bütçeye kendiliğinden sığmaz.

### Yazarın raporladığı sonuç

README, RTX 3060 / Chrome / ANGLE D3D11 / 4× MSAA / 1954×1692 koşulunda sahneye göre yaklaşık **3,30–4,80 ms/kare**, su altı için 4,71 ms bildirir. Bunlar demoya ait toplam kare ölçümleridir; Forge'a eklenecek etkinin fark maliyeti değildir. Yazar, sonraki tepe köpüğü yükseltmesinin temiz biçimde yeniden ölçülmediğini ve eski benchmark'ın daha düşük sonuç verdiğini de belirtir. Bu sayılar incelemede yeniden üretilmedi. [Performans kaydı](https://github.com/Humpalumps/Ultra-Water/blob/ce9248fa20afbdf63fd4c11709f68d7368aca0a0/README.md#performance).

### Forge'daki güncel sınır

Water Body planının en yeni [dilimlenmiş hazırlık kaydı](LAKE_COOPERATIVE_PREPARATION_2026-10-29.md), sekiz Lake / 4 km / RTX 3060 / 1080p koşusunda warm rebuild p95 **363,6 ms**, en uzun görev **19,628 ms** ve >50 ms görev **0** bildiriyor. Geometri çekirdeğinde maksimum 7,3 ms'lik aykırı dilimler nedeniyle genel ≤4 ms kabulü hâlâ açık. Bu mevcut raporun sonucudur; bu incelemede yeni ölçüm yapılmadı.

[Önceki Lake performans raporu](LAKE_PERFORMANCE_2026-10-29.md) ve [F4 raporu](WATER_RIVER_EFFECTS_F4_2026-10-29.md) farklı kaynak/sahne kapsamlarını ölçer. Bunlar Ultra-Water'ın toplam FPS tablosuyla doğrudan karşılaştırılamaz veya yeni efekt bütçesi olarak toplanamaz. Karar için aynı Forge sahnesinde efekt açık/kapalı AB/BA GPU farkı gerekir.

## 7. Önerilen uygulama sırası ve kabul

Bu tablo uygulama önerisidir; işlerin tamamlandığı veya uygulamaya geçildiği anlamına gelmez.

| Sıra | WaterPro / Water Body bağlantısı | Sınırlı iş | Çıkış ölçütü |
| --- | --- | --- | --- |
| 1 | V0 | Authored sahneden ayrı referans fixture; sabit kamera, pozlama, güneş, açık taban ve doğal kaya | Aynı koşulda önce/sonra karşılaştırması; Lake ve eğimli River |
| 2 | V1 | Ultra-Water köpük dokusu/malzeme yaklaşımını ortak yardımcıya uyarlama; mevcut otomatik maskeleri koruma | Yakın/uzak ve gölge/gece onayı; kaya teması sabit; mip/sampler/kaynak bütçesi |
| 3 | V1 | Mevcut ortam/probe ile planar fallback denemesi | Planar off/on sürekliliği; çift katkı ve pozlama sapması yok |
| 4 | V2 | Lake snapshot üzerinde depth kontrollü sınırlı kırılma; ardından ayrı River değerlendirmesi | Kıyı, ön nesne ve ekran kenarında halo yok; direct/MSAA fallback korunuyor |
| 5 | V3–V4 | İhtiyaca göre kalıcı köpük alanı veya rüzgârlı Lake profili | Taşınım/geçmiş ayrı kanıtlanıyor; CPU sorgusu ve yardımcı render geçişleri uyumlu |
| 6 | W4 Ocean / V5 | FFT ve geniş yüzey prototipi; su altı/yüzdürme gerekiyorsa ayrı kapsam | Dünya/kot/LOD entegrasyonu, donanım bütçesi ve görsel kabul |

İlk uygulama **V0–V2** ile sınırlı tutulmalı. Üretimde kullanılacak yardımcı kod engine katmanında genel olmalı; demo adası, OrbitControls, GUI, atmosfer ve kendi fizik döngüsü birlikte taşınmamalı.

Uygulama sırasında doğrulama:

- TypeScript değişirse `npx.cmd tsc --noEmit`; engine/runtime değişikliklerinde uygun `npm.cmd run test:engine` ve `npm.cmd run build:verify` kapıları.
- Playwright ile yakın eğik kıyı, ada, kaya, eğimli River, çok gövde, uzak yüzey ve konsol; hareketli köpük için zamansal gözlem. Sabit screenshot hareket kabulünün yerine geçmez.
- Yeni kalıcı alan varsa ortak runtime/save allowlist'i, `tools/saveValidator.ts`, Save/Reload/Play ve undo/redo. Texture sunumunu değiştirmek bu sözleşmeyi kendiliğinden tamamlamaz.
- Kalite on/off, iptal ve level travel sonrası kaynak sayıları/byte'lar; paylaşılan köpük dokusu, eski işler ve geç readback sonuçlarının ömrü.
- Aynı gerçek GPU'da p50/p95 fark maliyeti, draw/capture, CPU dilimleri ve transient bellek. İlk köpük/kırılma denemesi için FFT altyapısı zorunlu olmamalı.

## 8. Yerel kanıt kimlikleri ve çalışma kapsamı

Aşağıdaki SHA-256 değerleri indirilmiş dosyaların ham byte içeriklerinden hesaplandı. Sürüm eşleşmesi kontrolü ayrıca tüm 31 dosyada LF-normalize Git blob hesabıyla yapıldı.

| Dosya | SHA-256 |
| --- | --- |
| `LICENSE` | `a7ae787156c7424b41ab82cb77d72448560c69de725c1da8458305fa1a195450` |
| `package.json` | `09287b969143ae1a39b0ca62e6b12d79a77bf74cef3ca3f871b43b8c225c9089` |
| `src/water/bakeTextures.js` | `73c80456536adea30eab2ea57719aea5d779c8dd0953a33da2ca86aa60240b7a` |
| `src/water/OceanSim.js` | `46ff48715fa986dcf34dc92e05d33d1a2b171cd4ef853e3fbe4a1349696ab5b8` |
| `src/water/OceanSurface.js` | `086d14f0d0bdb395e1addfcb7da8499a4d8a70e1990d04a0fbbaf25c8216058e` |

Bağlantılı yerel kaynaklar: [Water Body ana planı](../planned/WORLD_TERRAIN_WATER_BODY_PLAN.md), [WaterPro görsel araştırması](WATERPRO_VIDEO_VISUAL_RESEARCH_2026-10-29.md), [Lake doğal yüzeyi](LAKE_NATURAL_SURFACE_2026-10-28.md), [Lake kalite profilleri](LAKE_QUALITY_2026-10-29.md), [River efektleri/F4](WATER_RIVER_EFFECTS_F4_2026-10-29.md), [Lake dilimlenmiş hazırlığı](LAKE_COOPERATIVE_PREPARATION_2026-10-29.md).

Bu çalışmanın çıktısı bu rapordur. Engine/editor kodu, bağımlılıklar, indirilen kaynak, authored sahneler, terrain verisi ve ana plan değiştirilmedi. Test, build veya browser kabulü çalıştırılmadı; dokümanın yerel bağlantıları ve kaynak kimlikleri kontrol edildi.
