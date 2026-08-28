# Performans Teşhis Aracı Planı (`?debug`)

> Oluşturma: 2026-08-28 (ThreeAges backport devamı)
> Durum: **Planlandı, başlanmadı.** Faz sırası F0 → F6.
> Kaynak: ThreeAges `src/game/rts/debug/*` + `RtsApp.ts` teşhis katmanı.

Forge'un `?debug` overlay'i bugün **okunan** bir şey; ThreeAges'inki
**kullanılan** bir şey. Bu plan aradaki farkı kapatır ve farkı Forge'a
oyun-bağımsız biçimde, şablonun standardı olarak koyar.

## 0. Bu plan neden var

ThreeAges'te bir RTS maçı yavaşladığında sorulan soru hep aynıydı: *çok mu
çiziyoruz, çok mu düşünüyoruz?* Draw call sayısı bunu ayıramaz. Oradaki teşhis
katmanı bu soruyu cevaplamak için büyüdü ve iki gerçek araç üretti — kareyi
sistemlere bölen bir CPU dökümü, ve içerik kategorilerini tek tek kapatarak
ölçen bir GPU taraması.

Kritik nokta: **taşınacak olan ölçüm altyapısı değil.** İki repoda
`engine/perf/*` dosyalarının tamamı (`adaptiveQuality`, `bottleneckClassifier`,
`distanceUpdateRate`, `frameMetrics`, `gpuTimer`, `hardwareHints`, `perfBudget`,
`qualityProfiles`) **birebir aynı** — diff temiz. `engine/core/subsystemProfiler`
de öyle. Yani sayaçlar zaten burada. Eksik olan, o sayaçları **okunabilir ve
etkileşimli** kılan katman: aritmetik, tablo, buton ve zaman kontrolü.

Bir yerde Forge zaten önde: `formatGpuFrameStats` satırı
[debugStats.ts:116](../../src/scene/debugStats.ts#L116) Forge'da var, ThreeAges'te
yok (orada RTS paneli kendi gpu satırını yazıyor). Backport tek yönlü değil.

## 1. Ölçülen durum (Forge, 2026-08-28)

Bugün `?debug` tek bir metin bloğu üretiyor: [debugStats.ts](../../src/scene/debugStats.ts)
→ `#debug-stats`, editörde Show > Stats ile açılıp kapanıyor
([EditorUi.ts:913](../../src/editor/EditorUi.ts#L913)). İçeriği zaten geniş —
fps/draw/tris, frame metrics, GPU kare, bottleneck, adaptif kalite, top-3
subsystem timing, bellek, bütçe, VFX, game mode, AI, AI nav, spline, UI, script
mesajları.

Buna rağmen kareyi ayrıştıramıyor. İki yapısal sebep var ve ikisi de ölçüldü.

### 1.1 Bulgu: profiler'ın kare sınırı karenin sonu değil

`profiler.endFrame()` [SubsystemRegistry.ts:72](../../engine/core/SubsystemRegistry.ts#L72)
içinde, yani **subsystem bloğu biter bitmez** çağrılıyor. Oysa
[RuntimeSceneApp](../../src/scene/RuntimeSceneApp.ts#L1270) döngüsünde
`engineApp.update()` sonrası daha çok iş var ve hiçbiri ölçülmüyor:

```
spawnCoordinator · startupCalibration · adaptiveQuality · killZ ·
capabilities.update · gameModeSession.update · gameModules.update ·
updateUiStore · projectWorldWidgets · audioListener · colliderDebugWires ·
environment.update · foliage culling · material animations · render
```

Bugün bir kare dökümü alınsa tablonun büyük kısmı "ölçülmeyen" satırı olurdu —
ki bu tam olarak ThreeAges aritmetiğinin görünür kılmak için var olduğu şey.
Render'ın CPU tarafı bile bir bölge değil.

### 1.2 Bulgu: profiler'da grup kavramı yok

`SubsystemProfiler` düz bir id→süre haritası. "ai, simülasyonun içindedir"
diyemez, dolayısıyla bir grubun çocuklarını çıkarıp **artığını** raporlayamaz.
Kare dökümünün güvenilirliği tam olarak bu çıkarmaya dayanıyor.

### 1.3 Bulgu: Forge runtime'ında zaman kontrolü hiç yok

`timeScale` grep'i yalnız animasyon mixer'ında geçiyor
([tpsCharacterGameMode.ts:339](../../src/game/gameModes/tpsCharacterGameMode.ts#L339)).
Motor tarafında pause/resume ya da hız çarpanı yok; `deltaMs` rAF'tan gelip
100 ms'e kırpılıyor, o kadar. ThreeAges'in 1X/2X/4X/8X'i ise **dt çarpanı değil**,
kare başına N sabit simülasyon alt-adımı — Forge'da sabit adımlı bir simülasyon
döngüsü olmadığı için birebir taşınmaz.

### 1.4 Boşluk tablosu

| Yetenek | ThreeAges | Forge | Faz |
| --- | --- | --- | --- |
| Ölçüm altyapısı (`engine/perf/*`, profiler) | ✔ | ✔ (aynı) | — |
| Metin readout | ✔ | ✔ (daha geniş) | — |
| Takılma sayaçları, piksel, graf gezinme, gölge envanteri | ✔ | ✘ | F0 |
| Kare bölgeleri + grup ağacı + tam muhasebe | ✔ | ✘ | F1 |
| Panelde buton / tablo modalı / panoya kopyala | ✔ | ✘ | F2 |
| CPU kare dökümü | ✔ | ✘ | F3 |
| Zaman ölçeği + duraklatma | ✔ | ✘ | F4 |
| GPU A/B taraması | ✔ | ✘ | F5 |
| Makine tanığı (dataset) + kalite matrisi koşusu | ✔ | ✘ | F6 |

## 2. Taşınan ilkeler

Bunlar ThreeAges'te acıyla öğrenilmiş kurallar; kodun kendisinden daha değerli
oldukları için önce yazılıyorlar.

1. **Her milisaniye hesapta.** Ölçülen bölgeler kareye asla eşit gelmez. Artık
   satır olur (grup başına `… (diğer)`, kare için `ölçülmeyen`). Karenin %60'ını
   anlatıp %40'ı hakkında susan bir tablo, insanı yanlış şeyi optimize etmeye
   yollar.
2. **Yakalanan kare kendi penceresiyle yan yana gösterilir.** Tek kare gürültüdür
   (GC, shader derlemesi, seyrek bir cadence tick'i). Her satır o karenin ms'i +
   pencere ortalaması + pencere tepesi taşır; "bu kare tipik miydi?" tabloda
   cevaplanır, tahmin edilmez.
3. **Yokluk sıfırla karıştırılmaz.** Zamanlayıcısı olmayan tarayıcı "yok" yazar,
   `0.0 ms` yazmaz. Yüklenmemiş bir tablo ile boş bir tablo aynı görünmemeli.
4. **GPU tarama satırları tasarruftur, maliyet değil.** Toplamları kareye eşit
   değildir ve olmamalıdır; tablo bu sınırı kendi notlarında söyler.
5. **Teşhisin kendi maliyeti de ölçülür ve işaretlenir.** ThreeAges'te `tanı`
   bölgesi "yalnızca debug rotasında" diye yıldızlı; oyun sürümünün ödemediği
   maliyet tabloda böyle görünür.
6. **Çekirdek saf, kabuk aptal.** Aritmetik ve metin DOM'suz modüllerde, birim
   testli; panel/modal yalnız hazır hücreleri çizer. ThreeAges'te bunun karşılığı
   `tools/engine-tests.ts` içinde tarayıcısız çalışan bir test kümesidir.
7. **Şablon jenerik kalır.** Bölge adları, sweep kategorileri ve sahne sayımları
   projeden gelir; motor yalnız kaydı ve aritmetiği bilir. ThreeAges'in Türkçe
   sabit id tablosu (`PERF_REGION_PARENTS`) Forge'a **veri olarak** taşınmaz.

## 3. Katman yerleşimi

```
engine/perf/debugTableView.ts   tablo şekli (saf tip)
engine/perf/frameRegions.ts     bölge kaydı: id, parent, debugOnly (saf)
engine/perf/frameCapture.ts     CPU dökümü aritmetiği + tablo + metin (saf)
engine/perf/gpuSweep.ts         A/B tasarruf aritmetiği + tablo (saf)
engine/perf/gpuSweepRunner.ts   tarama zamanlayıcısı (saf)
engine/core/timeControl.ts      pause/resume + timeScale (saf)

src/scene/debugPanel.ts         kontrol şeridi + readout kabuğu (DOM)
src/scene/debugTableModal.ts    donmuş tablo + panoya kopyala (DOM)
src/scene/debugStats.ts         mevcut metin readout (F0'da genişler)

proje/oyun                      bölge kaydı ve sweep kategorisi sağlar
```

Üç sınır kuralı:

- **Panel `src/editor/` altına konulamaz.** `?debug` runtime rotasında da
  çalışıyor; editör `?editor` dinamik importunun arkasında kalmak zorunda
  (CLAUDE.md). Doğru yer `src/scene/`, `debugStats.ts` ile yan yana.
- **Ama oyun paketine de girmemeli.** `debugStats` bugün oyun paketinde; panel +
  modal + sweep bunu büyütür. Bu yüzden yeni kabuk `?debug` arkasında **dinamik
  import** edilir (`await import("./debugPanel")`), tıpkı editörün `?editor`
  arkasında olması gibi. `verify:dist --strict` ve `verify:imports` bunu
  doğrular.
- **`engine/` hiçbir şeyi import etmez** (verify:imports: engine → editor/game/src
  yasak). Saf modüller bu yüzden `engine/perf/` altına konabiliyor.

## 4. Fazlar

### F0 — Ucuz readout satırları (bağımsız, panel gerektirmez)

Mevcut `#debug-stats` metnine ThreeAges'in en çok işe yarayan beş satırını
ekler. Hiçbiri yeni altyapı istemiyor.

- [ ] **Takılma sayaçları**: `>33ms / >50ms / >100ms`. `spikeCounts()` zaten var
      ([frameMetrics.ts:173](../../engine/perf/frameMetrics.ts#L173)), overlay
      okumuyor.
- [ ] **Çizim tamponu**: CSS boyut × effective pixel ratio + toplam piksel.
      "Bu kare fill-rate'e mi takılı?" sorusunun tek girdisi; başka hiçbir satır
      söylemiyor.
- [ ] **Sahne grafiği maliyeti**: `traverseVisible` ile düğüm + mesh sayısı.
      Az draw call yanında devasa düğüm sayısı = kare **gezilmekten** pahalı,
      gönderilmekten değil; batch'lemek dokunmaz. Snapshot temposunda örneklenir
      (kare başına değil — yoksa açıklamaya çalıştığı maliyetin parçası olur).
- [ ] **Gölge caster envanteri**: mesh + üçgen, kategori kovalarına ayrılmış,
      `InstancedMesh.count` çarpanı dahil. Kovalar Forge'da jenerik olmalı
      (ThreeAges'teki `actors/mapArt/other` yerine sahne kaynağına göre).
- [ ] **Ses voice bütçesi**: aktif/limit, tepe, bütçe ve olay redleri, bus başına.
      Yaklaşılmayan bütçe kullanılmayan headroom'dur; her çatışmada dolan bütçe
      oyuncunun ne duyacağına sessizce karar veriyordur.

**Bitiş şartı:** `?debug` overlay'i bu beş satırı gösteriyor; her biri için
`formatX` saf fonksiyonu ve `tests/engine/` altında birim testi var; profiler
kapalıyken hiçbiri ek maliyet üretmiyor.

### F1 — Kare bölgeleri ve tam muhasebe

F3'ün ön koşulu. §1.1 ve §1.2 bulgularını kapatır.

- [ ] `engine/perf/frameRegions.ts`: bölge kaydı — `id`, `parent`, `debugOnly`.
      Kayıt **veri**, sabit tablo değil; subsystem'ler ve kabuk kendi bölgelerini
      bildirir.
- [ ] `SubsystemProfiler`'a grup farkındalığı (ya da kaydın profiler dışında
      tutulup capture'da birleştirilmesi — hangisinin daha az sızdırdığı
      uygulamada kararlaştırılır, ikisi de kabul edilebilir).
- [ ] `endFrame()` çağrısı `SubsystemRegistry.update` içinden **karenin gerçek
      sonuna** taşınır. Bu bir davranış değişikliğidir: adaptif kalitenin
      bottleneck sınıflandırıcısı da bu profiler'ı okuyor
      ([RuntimeSceneApp.ts:1124](../../src/scene/RuntimeSceneApp.ts#L1124)), yani
      pencere içeriği genişleyecek. Sınıflandırıcının eşikleri gözden geçirilmeli.
- [ ] Kabuk bölgeleri işaretlenir: `render` (CPU gönderim maliyeti, GPU değil),
      `ui`, `environment`, `gameMode`, `gameModules`, `capabilities`, ve tamamı
      için `frame` (payda; asla satır değil).
- [ ] `perfMark/perfMeasure` eşdeğeri: profiler kapalıyken **tek property
      okuması** maliyetinde olmalı (ThreeAges deseni: `perfMark()` kapalıyken `0`
      döner).

**Bitiş şartı:** `?debug` açıkken subsystem timing bloğu bugünkü top-3 yerine
gruplanmış bölgeleri gösteriyor; `frame` bölgesi karenin tamamını kapsıyor;
`test:engine` yeşil ve bottleneck sınıflandırıcısının testleri yeni pencereyle
geçiyor.

### F2 — Panel kabuğu ve tablo modalı

- [ ] `src/scene/debugPanel.ts`: `#debug-stats` üstünde kontrol şeridi + altında
      readout. Kontrol yuvası **readout'un üstünde**, çünkü satır sayısı büyüdükçe
      buton yer değiştirmemeli.
- [ ] `src/scene/debugTableModal.ts`: ortalanmış, kapanabilir, **donmuş** tablo +
      panoya kopyala. Donmuş olması şart — canlı bir tablo okunurken ölçülüyor
      olur, ve duraklatılmış bir sahnede her simülasyon satırı sıfır okunur.
- [ ] `engine/perf/debugTableView.ts`: iki tablo (CPU dökümü ve GPU taraması)
      aynı modalı paylaşır ama **satır şekli paylaşmaz**; modal yalnız hazır
      hücreleri çizer. Bu, birinin aritmetiğini diğerinin sessizce miras almasını
      engelleyen şeydir.
- [ ] Dinamik import: panel yalnız `?debug` varken yüklenir; `verify:dist --strict`
      temiz kalır.
- [ ] Editör: Show > Stats bugün overlay'i gizliyor
      ([EditorUi.ts:913](../../src/editor/EditorUi.ts#L913)); aynı bayrak paneli de
      yönetmeli.
- [ ] CSS `.forge-debug-*` ön ekiyle; ThreeAges'in `.rts-debug-*` kuralları
      (29 adet) buraya uyarlanır.

**Bitiş şartı:** `?debug` panelinde tıklanabilir bir kontrol şeridi var, boş bir
tablo modalı açılıp kapanıyor, kopyala butonu metni panoya yazıyor; oyun paketi
büyümüyor.

### F3 — Kare maliyeti (CPU) dökümü

ThreeAges'ten en doğrudan taşınan parça (`rtsFrameCapture.ts`, 230 satır, saf).

- [ ] `engine/perf/frameCapture.ts`: `buildFrameCapture` + `frameCaptureTableView`
      + `formatFrameCaptureText`. §2.1 ve §2.2 ilkeleri burada yaşıyor.
- [ ] Panel butonu: bir sonraki kareyi silahlandırır; yakalama karenin **son
      işi**dir (açtığı modal, anlattığı karenin parçası olmamalı).
- [ ] Modal başlığı bağlamı taşır: toplam/ort/tepe ms, pencere kare sayısı,
      zaman ölçeği (F4 geldiğinde), sahne saati.
- [ ] `tests/engine/frameCapture.test.ts`: artık aritmetiği, grup çıkarması,
      sıfır-toplam kenar durumu, metin çıktısı.

**Duraklatma notu:** ThreeAges tabloyu okurken maçı duraklatır. Forge'da
duraklatma F4'le geliyor; F3 onsuz da sevk edilebilir — tablo zaten donmuş,
arkada sahne dönmeye devam eder. F4 gelince yakalama duraklatmayı sahiplenir ve
kapanışta sahneyi bulduğu hâlde bırakır.

**Bitiş şartı:** `?debug` → "Kare maliyeti" → satırları toplamı kareye eşit olan,
panoya kopyalanabilir bir tablo.

### F4 — Zaman ölçeği ve duraklatma

En çok yeni iş, en çok mimari karar (§1.3). Ve teşhisten bağımsız değeri en
yüksek olan faz: PIE'si olmayan Forge'da "Play sekmesinde hızlandır/duraklat"
tek başına kazanç.

- [ ] `engine/core/timeControl.ts`: `paused`, `timeScale`, ve "duraklatmayı ben mi
      aldım" sahipliği (teşhis duraklatması oyuncunun duraklatmasını ezmemeli).
- [ ] Döngüde tek uygulama noktası, ama **tüketiciler ayrık**: `frameMetrics` ham
      delta görmeye devam eder (takılma ölçümü zaman ölçeğinden etkilenmemeli),
      simülasyon/animasyon/fizik ölçekli deltayı alır, UI ve kamera kararı ayrıca
      verilir.
- [ ] Duraklatmada **render devam eder** — sweep'in ihtiyacı tam olarak budur.
- [ ] Debug hız seçici (1X/2X/4X/8X) panel kontrol yuvasına oturur.
- [ ] ThreeAges'in alt-adım modeli **taşınmaz**: orada 8X = kare başına 8 sabit
      simülasyon tick'i. Forge'da sabit adımlı döngü yok; `timeScale` çarpanı
      olarak başlanır, sabit adım gerektiğinde ayrı bir karar olarak ele alınır.

**Bitiş şartı:** `?debug` panelinden hız değiştirilebiliyor ve duraklatılabiliyor;
`frameMetrics` hâlâ ham delta ölçüyor; duraklatılmış sahne çiziliyor;
`tests/engine/timeControl.test.ts` sahiplik ve ölçek matematiğini kapsıyor.

### F5 — GPU dökümü (A/B taraması)

Forge'da ThreeAges'tekinden **daha temiz** çıkması beklenen faz: orada kategoriler
oyun kavramları (birimler/yapılar/kervanlar), burada seviye içeriği zaten
kategorili — [LevelRuntime.ts:26](../../src/scene/LevelRuntime.ts#L26): landscapes,
foliage, river waters, splines, blocking volumes, static mesh'ler, actor
instances, post-process.

- [ ] `engine/perf/gpuSweep.ts` (323 satır, saf) + `gpuSweepRunner.ts` (204, saf).
      **Bracketli taban zorunlu**: her adım kendi öncesi ve sonrası tabanıyla
      karşılaştırılır. Sebebi kayıtta kalsın — duraklatılmış, ucuz bir sahne
      GPU'nun güç durumunu düşürür; tek bir baştaki tabana göre ölçülürse drift
      "kapatınca 7 ms *maliyet*" gibi ters işaretli satırlar üretir, ve driver'ın
      disjoint bayrağı bunu **yakalamaz** (her süre kendi başına doğru bir
      süredir — yavaşlamış bir GPU'nun süresi). Bracket'ı kendi tasarrufu kadar
      oynayan satır sayı değil `belirsiz` olarak yayınlanır.
- [ ] Kategori planı **veriden** türetilir: motor `LevelRuntime` kategorilerini
      sunar, proje kendi köklerini ekler. Gölge adımı `shadowMap.enabled` değil
      `autoUpdate` dondurmasıyla yapılır (aksi hâlde materyal yeniden derlemesi
      ölçülen karenin içine düşer ve gölgenin maliyeti sanılır).
- [ ] Editör overlay'leri (gizmo, seçim konturu, ızgara) kendi kategorisi olur —
      editörde ölçüm yapan biri bunun kaç ms olduğunu bilmeli.
- [ ] Duraklatma F4'ten gelir; tarama boyunca sahne kıpırdamamalı.
- [ ] `tests/engine/gpuSweep.test.ts`: bracket ortalaması, gürültü tabanı,
      drift/`belirsiz` kararı, disjoint sayımı, zamanlayıcı programı (geç gelen
      örnekler, aç kalan adım, iptal).

**Bitiş şartı:** `?debug` → "GPU dökümü" → kategorileri sırayla kapatıp tasarruf
tablosu üreten, sınırlarını kendi notlarında yazan bir koşum; zamanlayıcısı
olmayan tarayıcıda sıfır değil açıklama gösteriyor.

### F6 — Makine tanığı ve kalite matrisi

- [ ] Canvas dataset'ine örneklenmiş JSON perf tanığı (ThreeAges'te
      `data-rts-perf`, 0.5 sn temposunda). Tarayıcı kayıtlarıyla korelasyon ve
      smoke testleri için; **kare başına değil** örneklenmiş, yoksa gözlem
      problemin kendisi olur.
- [ ] Jenerik kalite matrisi koşusu (`perf:quality` benzeri): aynı seviye, aynı
      kamera turu, Low/Medium/High/Adaptive satırları.
      `tools/perf/browserPerfHarness.mjs` zaten burada ve `browser-perf-report`
      onu kullanıyor; eklenecek olan matris döngüsü ve rapor formatı.
- [ ] Smoke: `tests/smoke/` altında panelin açıldığını, bir kare dökümü
      alındığını ve modalın kapandığını doğrulayan bir spec (port 5273, asla 5173).

**Bitiş şartı:** `npm run perf:quality` dört satırlık karşılaştırılabilir bir
rapor üretiyor; smoke suite paneli sürüyor.

## 5. Kapsam dışı

- **RTS sunum sözlüğü**: birim/yapı/kervan/hayvan sayımı, `RtsSimulationWitness`
  içeriği (maç saati, yollar, depolar, cüzdan hareketleri, AI günlüğü). Bunlar
  oyun katmanıdır; Forge'a gelen şey witness'ın **deseni**dir, içeriği değil.
- **Türkçe sabit metinler.** ThreeAges'te panelin tüm metni, bölge id'leri ve
  tablo notları Türkçe ("ölçülmeyen", "gölge haritası", "belirsiz"). Forge şablonu
  jenerik: id'ler teknik/İngilizce, görünen metin İngilizce.
- **LOD sistemi.** ThreeAges'te de bilinçli olarak kapsam dışıydı; veri gelmeden
  karar verilmiyor.
- **In-viewport PIE.** Duraklatma (F4) bir PIE modu değil; Forge'un Play akışı
  ayrı sekmede kalıyor.

## 6. Riskler ve tuzaklar

| Risk | Karşılık |
| --- | --- |
| `endFrame()` taşınması bottleneck sınıflandırıcısının penceresini değiştirir | F1 bitiş şartına sınıflandırıcı testleri dahil; eşikler gözden geçirilir |
| Panel oyun paketini büyütür | `?debug` arkasında dinamik import + `verify:dist --strict` |
| Sweep kategorileri oyun kavramlarına kayar | Kategori planı `LevelRuntime` kategorilerinden veri olarak türetilir |
| `timeScale` yanlış tüketiciye uygulanır (takılma ölçümü bozulur) | `frameMetrics` ham delta okumaya devam eder; F4 bitiş şartı bunu doğrular |
| Duraklatma sahipliği çakışır (teşhis ↔ oyuncu) | `timeControl` sahiplik bayrağı tutar; kapanışta sahne bulunduğu hâlde bırakılır |
| Teşhisin kendi maliyeti bulguya karışır | `debugOnly` bölge işareti (§2.5) ve örneklenmiş — kare başına olmayan — anlık görüntüler |

## 7. Kaynak haritası (ThreeAges)

| ThreeAges dosyası | Satır | Forge karşılığı | Faz |
| --- | --- | --- | --- |
| `src/game/rts/debug/formatRtsPerfDebug.ts` | 221 | `debugStats.ts` genişlemesi | F0 |
| `src/game/rts/debug/rtsFrameCapture.ts` | 230 | `engine/perf/frameCapture.ts` | F3 |
| `src/game/rts/debug/rtsDebugTableView.ts` | 37 | `engine/perf/debugTableView.ts` | F2 |
| `src/game/rts/debug/rtsDebugTableModal.ts` | 150 | `src/scene/debugTableModal.ts` | F2 |
| `src/game/rts/debug/rtsDebugOverlay.ts` | 91 | `src/scene/debugPanel.ts` | F2 |
| `src/game/rts/debug/rtsGpuSweep.ts` | 323 | `engine/perf/gpuSweep.ts` | F5 |
| `src/game/rts/debug/rtsGpuSweepRunner.ts` | 204 | `engine/perf/gpuSweepRunner.ts` | F5 |
| `src/game/rts/ui/rtsGameSpeedControls.ts` | 97 | panel hız seçici | F4 |
| `src/game/rts/debug/rtsSimulationWitness.ts` | 183 | yalnız desen (içerik oyun katmanı) | F6 |
| `RtsApp.ts` teşhis wiring'i | ~350 | yeniden yazılır (`RuntimeSceneApp`) | F1–F5 |
| `tools/rts-perf-report.mjs` | — | jenerik `perf:quality` | F6 |

Saf modüller (~900 satır) doğrudan alınabilir; asıl iş `RtsApp` içinde iç içe
duran üç katmanı (aritmetik / kabuk / oyun) ayırmaktır.

## 8. İlerleme günlüğü

- **2026-08-28** — Plan yazıldı. Forge tarafında ölçülen üç bulgu planın şeklini
  belirledi: profiler'ın kare sınırı karenin sonu değil (§1.1), profiler'da grup
  kavramı yok (§1.2), runtime'da zaman kontrolü hiç yok (§1.3). Kod yazılmadı.
