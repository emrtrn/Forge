# Su — RDR2 tarzı nehir ve göl görünümü (tek oturum planı)

Tarih: 30 Ekim 2026 · Durum: **Uygulandı ve teknik doğrulandı** (aynı gün,
kullanıcı onayıyla); kullanıcı sahnesinde görsel kabul ve GPU ölçümü açık.
Sonuç: [WATER_RDR2_LOOK_2026-10-30.md](../reports/WATER_RDR2_LOOK_2026-10-30.md).
Uygulamada ayarlanan tek sayı: diklik eşlemesi `mix(0.02, 0.12, t)` (planda
0,06–0,30 yazıyordu; Lake'in izinli en dik dalgası ≈0,11 olduğundan daraltıldı). Ana hat:
[WATER_SYSTEM_DEVELOPMENT_PLAN.md](WATER_SYSTEM_DEVELOPMENT_PLAN.md) (R4 sonrası).

Hedef: Lake ve River'ı kullanıcının paylaştığı RDR2 referansına yaklaştırmak.
Göl sakin ve aynamsı olacak, nehir akış yönünde uzayan dokuyla okunacak. Köpük
yalnız fiziksel olarak beklenen yerlerde görünecek: rapid, engel/kaya, akış
izi ve kıyıdaki hafif dalgalanma. Bunu yeni render geçişi, köpük geçmişi
(V3) veya FFT eklemeden mevcut altyapıyla tek oturumda yapmak amaçlanıyor.

## 1. Teşhis — köpük neden caustic gibi görünüyor

Kod incelemesine dayanan bulgular (`fd783d05`):

| # | Bulgu | Kaynak | Görsel sonuç |
| --- | --- | --- | --- |
| T1 | Köpük dokusunun R kanalı (`lace`/`fine`), **Voronoi F2−F1 kenarlarından** üretiliyor (`1 - smooth(0,.22,f2-f1)`) | `tools/bake-water-foam.mjs`, `water-foam.png` | Eşiklenince yalnız hücre sınırları kalıyor: ince çokgen ağ. Terrain caustic deseni de Voronoi F2−F1 olduğu için ikisi ayırt edilemiyor |
| T2 | `waterFoamErosion` yoğunluğu bu desene eşik olarak uyguluyor; düşük/orta yoğunlukta sonuç **dolu köpük değil kenar ağı** oluyor | `waterFoamMaterial.ts` | Kıyı bandında ve tepe köpüğünde çatlak/ağ görüntüsü (görsel 2–3) |
| T3 | Tepe köpüğü, dalga yüksekliğini **kendi genliğine bölerek** normalize ediyor (`crest = h / amplitude`) | `waterCrestFoam.ts` | 4 cm'lik sakin dalga bile her tepede tam köpük üretiyor; göl yüzeyine eşit dağılmış beyaz lekeler (görsel 3). Gerçekte beyaz köpük için dalganın **dikliği** gerekir |
| T4 | Tepe köpüğü deseni izotropik value-noise lekeleri; River'da akış yönüyle uzamıyor | `waterCrestFoam.ts`, `riverWater.ts` | Nehirde akan çizgiler yerine yerinde duran benekler |
| T5 | Terrain caustics tek katman Voronoi, kazanç ×2 (`CAUSTICS_STRENGTH_GAIN`) | `terrainCaustics.ts`, `terrainCausticPattern.ts` | Sığ suda bütün dipte keskin çokgen ağ; köpükle birleşince “caustic yüzey” izlenimi güçleniyor |
| T6 | Lake kıyı köpüğü sürekli bir kontur bandı | `waterFoam.ts` (`waterFoamPatchesFiltered`) | Kıyıda beyaz çizgi. RDR2 göllerinde kıyıda köpük çizgisi yok; ıslak koyu bant ve hafif dalgalanma var |

## 2. Referanstan çıkarılan hedefler (görsel 1)

**Nehir**
- Akış yönünde uzamış dalgacıklar ve parlamalar; rapid'de daha sert (choppy), havuzlarda daha sakin yüzey.
- Beyaz su: şelale ve rapid bölgesinde yoğun, havalı köpük. Akış aşağı **uzayan şeritler** hâlinde dağılıp söner.
- Kaya çevresinde: memba tarafında beyaz yığılma, mansapta V şeklinde iz.
- Sığda berrak yeşil-turkuaz renk ve görünen taban; derinde koyu yeşil-mavi.

**Göl**
- Sakin, aynamsı yansıma. Rüzgâr lekeleri (“cat's paw”): yüzeyde pürüzlülüğü değişen geniş bölgeler, yansıma netliğini yer yer bozar.
- Kıyıda köpük çizgisi yok; ıslak bant ve yavaş “kıyıya vuran” hafif dalgalanma. Yalnız kayaya temas eden noktalarda küçük, dağınık köpük.
- Caustics yalnız çok sığ, güneşli ve berrak suda; ince ve hareketli, dipte belirgin bir ağ değil.

## 3. Kapsam ve sınırlar

Kapsam dahili: köpük dokusu, köpük/tepe/rapid shader'ları, River ribbon'a
build-time bir köpük öznitelik kanalı, Lake rüzgâr lekeleri, caustic deseni ve
ilgili testler.

Kapsam dışı: V3 köpük geçmişi (GPU ping-pong), FFT/Ocean, yeni dalga modeli
veya CPU su sorgusunun değişmesi, River planar yansıma, su altı.

Kurallar:
- **Yeni kalıcı alan yok.** Save allowlist'leri, validator ve Details aynı kalır.
  Mevcut alanların anlamı değişiyorsa (yalnız `crestFoamThreshold`, §4.3) bu
  belgede ve raporda açıkça yazılır.
- Kullanıcı sahnesi (`Terrain.level.json`, şu an commit edilmemiş değişiklik
  içeriyor) **düzenlenmez**. İyileşme mevcut kayıtlı değerlerle görünür olmalı.
- Yeni draw/capture/render target yok. Ek GPU kaynağı: aynı 512² köpük dokusunun
  içeriği değişir; River'a köşe başına +4 byte (`foamTrail`) eklenir.
- Kalite politikası (Low'da köpük/caustic kapalı vb.) değişmez.

## 4. Uygulama adımları

Sıra bağımlılığa göre. Her adım ayrı derlenebilir; geniş test koşusu §5'te bir kez yapılır.

### 4.1. Yeni köpük dokusu — Voronoi kenar ağı yerine “dolu kabarcık kümesi”

Dosya: `tools/bake-water-foam.mjs` → `engine/render-three/textures/water-foam.png` (aynı yol, aynı 512² RGBA, aynı sahiplik).

- **R (yoğunluk/aşınma alanı):** fBm ile bükülmüş (domain-warp) düşük frekanslı küme alanı × ters Worley **F1** kabarcıkları (hücre *içi* dolu, kenarı boş) × küçük gözenek kabarcıkları. Eşiklendiğinde sonuç: yüksek yoğunlukta dolu beyaz yama, azalınca delikli dantel ve en sonunda **dağınık küçük kabarcıklar**. F2−F1 kenar terimi tamamen kaldırılır.
- **G (kabarıklık):** aynı küme alanından yumuşak yükseklik; ışıklandırma için.
- **BA (gradyan):** G'nin sayısal türevi (mevcut kodlama korunur: `0.5 + g/64`).
- Döşenebilirlik korunur (periyodik hash/noise). Lisans başlığı güncellenir: Ultra-Water uyarlaması artık yalnız PNG kodlayıcı/kanal düzeni için geçerliyse bu belirtilir.
- Kabul: dokunun R kanalı farklı eşiklerde ön izlenir (scratchpad'de PNG dilimleri); hiçbir eşikte sürekli çokgen ağ oluşmamalı.

### 4.2. Ortak köpük malzemesi — yoğunluk eğrisi ve anizotropi

Dosyalar: `waterFoamMaterial.ts`, `waterFoam.ts`.

- `waterFoamDetail(world, …)` yanına **akış uzayı** varyantı: `waterFoamDetailFlow(uvAlong, uvAcross, …)`; örnekleme akış yönünde ~3× uzatılır, iki fazlı sınırlı taşıma (`riverFlowPhases`, mevcut) ile UV sonsuz kaymaz.
- `waterFoamErosion`: yeni R alanına göre yeniden ayarlanır; yoğunluk 1'e yakınken dolu, 0.3 civarında dantel, 0.1 altında seyrek kabarcık. Alpha `sqrt(density)` yerine yumuşak ince-köpük şeffaflığı (ince köpük yarı saydam görünür, RDR2'de suyun rengi altından okunur).
- `waterFoamLighting`: renk tabanı korunur; ince köpükte hafif su rengi geçişi (subsurface hissi), gece/gölge davranışı aynı kalır (güneş/ambient girdileri değişmez).
- Prosedürel fallback (`waterFoamReady == 0`) aynı karakteri koruyacak şekilde güncellenir (kenar ağı değil benek kümesi).

### 4.3. Tepe köpüğü — yükseklik değil diklik (whitecap) eşiği

Dosyalar: `waterCrestFoam.ts`, `lakeWater.ts`, `riverWater.ts` (+ `scene/waterCrestFoam.ts` yalnız yorum/doküman).

- Lake: vertex'te zaten hesaplanan `vWaveSlope` ile **diklik** `s = |∇h|`. Köpük yalnız tepe tarafında (`h > 0`) ve `s` eşiği aştığında oluşur.
- `crestFoamThreshold` (0–1, alan aynı) artık diklik eşiğine eşlenir: `sEşik = mix(0.02, 0.12, threshold)`. Varsayılan 0,35 → ≈0,055. Kullanıcının gölü (4 cm / 6 m, s ≤ 0,045) bu nedenle **beyaz leke üretmez**; kayıt düzenlenmeden görünüm düzelir. Genliğe bölme kaldırılır.
- River: tepe köpüğü dalga dikliği **ve** `rapidness` ile çarpılır; sakin akışta sıfır, rapid'de rapid köpüğüne katkı verir. Desen akış uzayında uzatılır (4.2).
- Desen: §4.1 dokusu, iki ölçek; izotropik value-noise lekeleri kaldırılır.
- Alanların kayıt sözleşmesi aynı; Details tooltip'i (Türkçe) “dalga dikliği eşiği” olarak güncellenir.

### 4.4. River beyaz suyu ve akış aşağı köpük izi

Dosyalar: `riverWater.ts` (ribbon + shader), gerekirse `riverWaves.ts`.

- **Build-time `foamTrail` özniteliği:** ribbon kurulurken her zincir boyunca `rapidness`'ı akış aşağı üstel sönümle taşı (`trail = max(rapid, trailPrev · exp(-Δs / L))`, L ≈ 25 m, akış hızıyla ölçekli). Ek CPU işi: zincir başına tek geçiş, deterministik; her kare iş yok. Mevcut ama artık kullanılmayan `foamMasks` özniteliğinin yeri kullanılabilir (bellek artışı sıfır olur; tercih edilen yol).
- **Rapid köpüğü:** yoğunluk = `smoothstep(rapidness)` → dolu beyaz su; aynı alan + `foamTrail` → akış aşağı uzayan, giderek seyrekleşen şeritler. Şeritlerin yanal dağılımı merkez hattında yoğunlaşan, düşük frekanslı yanal gürültüyle bölünür (RDR2'deki “foam line” görünümü).
- **Kaya/engel köpüğü (bake maskesi):** memba yığılması aynı kalır; mansap izi 3 örnekten akış uzayında uzatılmış V izine dönüşür (aynı 3 doku okuması, yanal genişleme `along · 0.12` korunur), yeni malzemeyle çizilir.
- **Kıyı köpüğü:** gerçek kıyı maskesiyle (contact foam) sınırlı kalır, yoğunluk düşük; kıyı boyunca akan ince kopuk şeritler.
- Rapid yüzeyi: mikro normal genliği ve roughness `rapidness` ile artar (choppy), havuzlarda azalır.

### 4.5. Lake — sakin yüzey, rüzgâr lekeleri ve kıyı dalgalanması

Dosyalar: `lakeWater.ts`, `lakeSurface.ts`.

- **Rüzgâr lekeleri:** 20–40 m ölçekli, `surfaceWaveDirection` yönünde yavaşça sürüklenen düşük frekanslı alan; mikro normal şiddetini 0,35×–1,25× ve roughness'ı ±0,08 aralığında modüle eder. Ortalama görünüm (kabul edilmiş göl) korunur; yalnız yüzeye doğal bölgesel varyasyon gelir. Yeni alan yok; şiddet `surfaceStrength`'e bağlı.
- **Kıyı:** sürekli köpük konturu yerine kıyıya doğru ilerleyen, zamanla nabız gibi gelen ince ve seyrek dalgalanma köpüğü (yoğunluk ≤ 0,62 — uygulamada testle kalibre edildi; mevcut `foamOpacity` çarpanı ile). Islak kıyı ve shore blend aynı.
- **Kaya teması:** bake maskesi korunur; yoğunluk küçük, dağınık kabarcık bandına düşer (görsel 2'deki kalın beyaz halka yerine ince, kesik temas).

### 4.6. Caustics — ağ yerine organik, hareketli ışık

Dosyalar: `terrainCaustics.ts` (shader kısmı), `terrainCausticPattern.ts`.

- İki farklı ölçek/hız/yönde örneklenen desenin **min()** birleşimi (yaygın gerçek-zamanlı caustic tekniği): sabit çokgen ağ yerine sürekli kırılan, organik ışık lekeleri. Ek maliyet: suyla örtülü terrain pikselinde 1 doku okuması.
- Desen kenarları biraz kalınlaştırılır, uzakta (mip/footprint) kontrast düşer.
- Sığlık penceresi: çok sığda (< ~10 cm) ve derinde söner; tepe ~0,3–1 m. `CAUSTICS_STRENGTH_GAIN` ve authored strength anlamı korunur; parlaklık ortalaması önceki değere yakın tutulur, yalnız şekil değişir.

### 4.7. Belgeler

- Bu planın sonuç bölümü ve `docs/reports/WATER_RDR2_LOOK_<tarih>.md` raporu: uygulandı / teknik doğrulandı / görsel kabul / performans kabul ayrı satırlar.
- `WATER_SYSTEM_DEVELOPMENT_PLAN.md` başına kısa güncelleme ve bağlantı; R4 raporuna crest eşik anlamının değiştiği notu.

## 5. Doğrulama (oturum sonunda topluca)

1. `npx tsc --noEmit`
2. `npm run test:engine` — güncellenecek/eklenecek kontroller:
   - `foamTrail`: rapid sonrası akış aşağı monoton sönüm, branş/zincir başında sıfırlanma, rapid'siz nehirde sıfır.
   - Tepe köpüğü eşik eşlemesi (saf fonksiyon olarak dışa açılır): `threshold → sEşik`; sakin varsayılan göl dalgasında sıfır.
   - Köpük dokusu bake: döşenebilirlik (kenar pikselleri eşleşir) ve R kanalında kenar-ağı ölçütü (eşiklenmiş maskede bağlı bileşenlerin hücre-ağı olmadığını gösteren basit istatistik).
3. `npm run build:verify`
4. Playwright: `water-crest-foam.spec.ts` yeni anlama göre güncellenir (sakin dalgada köpük yok, dik dalgada var, River'da rapid'e bağlı). `water-contact-foam.spec.ts`, `river-water-optics.spec.ts`, `river-caustic-flow.spec.ts`, `terrain-water*.spec.ts` yeniden koşulur. Smoke portu 5273.
5. Görsel kanıt: izole fixture'da (crest-foam sayfası) gündüz/gölge/gece, yakın/uzak, önce/sonra PNG'leri `docs/reports/evidence/water-rdr2/`. Headless canvas tuzağı nedeniyle sayfa ekran görüntüsü kullanılır.

Kullanıcının kendi sahnesindeki son görsel kabul ve gerçek GPU ölçümü
kullanıcıya kalır; rapor bunları açık olarak listeler.

## 6. Riskler ve geri dönüş

| Risk | Önlem |
| --- | --- |
| Yeni doku kabul edilmiş Lake köpük/temas görünümünü fazla değiştirir | Yoğunluk eğrisi kalibrasyonu fixture'da önce/sonra karşılaştırılır; tek dosya (PNG) ve bake aracı geri alınabilir |
| Crest eşik anlamı değişimi mevcut kayıtlarda köpüğü “kaybettirir” | Bu bilinçli: sakin dalgada beyaz leke istenmiyor. Rapor ve tooltip açıkça yazar; dik dalga ayarında köpük geri gelir |
| `foamTrail` ribbon değişikliği refraction/caustic atlas parmak izini değiştirir | Pozisyon/derinlik/indeks değişmez; yalnız kullanılmayan `foamMasks` içeriği dolar. `riverFoamSurfaceFingerprint` girdileri kontrol edilir; bake'ler geçersizleşmemeli |
| Caustic min() birleşimi parlaklığı düşürür | Ortalama parlaklık telafi katsayısı; engine testinde desen ortalaması aralık kontrolü |
| Tek oturumda kapsam taşması | Sıra 4.1→4.2→4.3→4.4→4.5→4.6; 4.6 bağımsızdır ve gerekirse ayrı commit olarak en sona kalır |

## 7. Commit planı

Kurala uygun olarak `main` üzerinde, yalnız bu işin yollarıyla (`git commit -- <yollar>`):
1. `feat(water): replace foam lace with bubble-cluster foam and flow-stretched sampling` (4.1–4.2)
2. `feat(water): steepness-based whitecaps and river whitewater trails` (4.3–4.4)
3. `feat(water): calm lake wind patches and lapping shore foam` (4.5)
4. `feat(water): organic two-layer caustics` (4.6)
5. `docs(water): RDR2 look report` (4.7) — kapılar geçtikten sonra push.
