# Performans Teşhis Aracı Planı (`?debug`)

> Oluşturma: 2026-08-28 (ThreeAges backport devamı)
> Durum: **F0–F6 tamam — plan kapandı** (2026-08-29). Kalan tek açık madde
> editör kabuğunda GPU taraması (F5 altında, gerekçesiyle).
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
| Takılma sayaçları, piksel, graf gezinme, gölge envanteri | ✔ | ✔ | F0 ✅ |
| Kare bölgeleri + grup ağacı + tam muhasebe | ✔ | ✔ | F1 ✅ |
| Panelde buton / tablo modalı / panoya kopyala | ✔ | ✔ | F2 ✅ |
| CPU kare dökümü | ✔ | ✔ | F3 ✅ |
| Zaman ölçeği + duraklatma | ✔ | ✔ | F4 ✅ |
| GPU A/B taraması | ✔ | ✔ | F5 ✅ |
| Makine tanığı (dataset) + kalite matrisi koşusu | ✔ | ✔ | F6 ✅ |

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

- [x] **Takılma sayaçları**: `>33ms / >50ms / >100ms`. `spikeCounts()` zaten
      vardı, overlay okumuyordu; artık `getFrameSpikeCounts()` → `formatFrameSpikes`.
      Üç eşik ayrı tutuldu, toplanmadı: dört düşen kare ile tek bir 100 ms donma
      toplamda aynı sayıyı verir, bulgu olarak farklı şeylerdir.
- [x] **Çizim tamponu**: `formatDrawingBuffer` — CSS boyut × **effective** pixel
      ratio (`renderer.getPixelRatio()`, `devicePixelRatio` değil: ekranın
      sunduğu değil, gerçekten çizilen) + toplam piksel.
- [x] **Sahne grafiği maliyeti**: `buildSceneCostSnapshot` görünür ağacı bir kez
      gezip düğüm + mesh sayar. Overlay'in kendi 500 ms temposunda örnekleniyor,
      kare başına değil.
- [x] **Gölge caster envanteri**: aynı gezinmeden çıkıyor; mesh + üçgen,
      `InstancedMesh.count` çarpanı dahil (bir orman tek düğüm ama binlerce
      çizim). Kovalar **veriden**: `tagSceneSource()` ile sahneyi kuran taraf
      etiketliyor (`static-mesh`, `landscape`, `foliage`, `spline`,
      `blocking-volume`, `reflection-plane`, `reflective-surface`,
      `river-water`, `character`, `actor`, `light`, `debug`), etiketsiz nesne
      üst düzey sahne çocuğunun adına/tipine düşüyor. Motorda sabit kategori
      tablosu yok; kuyruk `other`'a toplanıyor.
- [x] **Ses voice bütçesi**: `AudioSubsystem` bunu hiç ölçmüyordu —
      `AudioEventDirector` motorda duruyor ama runtime'a bağlı değil. Bu yüzden
      bütçe muhasebesi subsystem'in kendisine kondu: `maxVoices`
      (`DEFAULT_MAX_VOICES = 64`), bus başına aktif/tepe, ve tavan dolduğunda
      **red** (`budgetRefusals`) — reddedilen çağrı sessizce ölen değil, durmuş
      okunan bir handle alıyor. `voiceStats()` → `AudioCommands` →
      `formatAudioBudget`. Ölçen yoksa satır sıfır değil cümle yazıyor.

**Bitiş şartı:** ✅ `?debug` overlay'i beş satırı da gösteriyor; her biri saf bir
`formatX` + `tests/engine/perfReadout.test.ts` altında birim testli (12 yeni
check); traversal yalnız overlay'in yarım saniyelik temposunda, hiçbiri kare
döngüsünde değil. Çizim tamponu ve sahne maliyeti editör kabuğunda (`SceneApp`)
da var: "bu kare piksele mi içeriğe mi ödüyor?" sorusu yazarken de soruluyor.

### F1 — Kare bölgeleri ve tam muhasebe

F3'ün ön koşulu. §1.1 ve §1.2 bulgularını kapatır.

- [x] `engine/perf/frameRegions.ts`: bölge kaydı (`id`, `parent`, `debugOnly`) +
      `buildFrameRegionRows` muhasebesi. Kayıt **veri**: `SubsystemRegistry`
      kendini `engine` diye, kabuk kendi fazlarını, fork kendi bölgesini bildirir.
      `frame` id'si rezerve — `declare` ile bildirilmeye çalışılırsa **atar**,
      çünkü paydanın satır olması bu modülün var oluş sebebi olan tek hata.
- [x] Grup farkındalığı profiler'a kondu (planın izin verdiği iki yoldan biri):
      `declareRegion` + `recordFrame`, ve `SubsystemTiming` artık `parent` +
      `debugOnly` taşıyor. Böylece `buildFrameRegionRows` yalnız snapshot'ı alıp
      saf çalışıyor — kabuk overlay'e kayıt geçirmiyor.
- [x] `endFrame()` `SubsystemRegistry.update` içinden çıktı; kareyi artık döngü
      sahibi kapatıyor (`engineApp.endProfileFrame()`), üstelik overlay
      callback'inden **önce**: readout anlattığı karenin parçası değil.
- [x] **Sınıflandırıcı gözden geçirildi.** `totalAverageMs` artık yalnız **kök**
      bölgeleri topluyor (grup zaten çocuklarını içerdiği için toplasaydı aynı
      milisaniyeyi iki kez sayar, CPU payı 1.0'ı aşardı). Eşikler (0.6 / 0.35)
      **bilerek yerinde bırakıldı**: değişen şey girdinin doğruluğuydu, eşiğin
      anlamı değil — karenin %60'ı CPU'daysa o kare eskiden de CPU-bound'du,
      sadece ölçülmediği için `gpu` okunuyordu. Veri olmadan eşik oynatmak tahmin
      olurdu. Ayrıca `debugOnlyAverageMs` ayrı tutuldu: teşhisin kendi maliyeti
      verdiği hükmü kendi başına `cpu`ya çeviremiyor (test bunu kilitliyor).
- [x] Kabuk bölgeleri: `spawn`, `quality`, `capabilities`, `gameMode`,
      `gameModules`, `ui`, `audioListener`, `environment`, `foliage`,
      `materials`, `render` (CPU gönderim maliyeti), ve `debugWires`
      (`debugOnly`). `frame` payda olarak `recordFrame` ile, kendi penceresinde.
- [x] `perfMark`/`perfRegion`/`perfElapsed`: kapalıyken tek property okuması
      (`engineApp.profiling`) + `0` dönüşü — saat yok, closure yok, ayırma yok.
      Döngü bu yüzden koşulsuz işaretli; ikinci bir debug kopyası yok.

**Bitiş şartı:** ✅ `?debug` timing bloğu top-3 yerine kare hesabını gösteriyor —
başlıkta karenin ms'i ve **ölçülen yüzdesi**, altında bölgeler pahalıdan ucuza,
grupların çocukları girintili, `~` artık satırları (`engine (other)`,
`unmeasured`) ve `*` teşhis-maliyeti işaretiyle. Üst düzey satırların toplamı
kareye **eşit**. 1099 check + `build:verify` + `verify:dist --strict` +
`verify:imports` yeşil.

### F2 — Panel kabuğu ve tablo modalı

- [x] `src/scene/debugPanel.ts`: kontrol şeridi readout'un **üstünde**. Panel
      ayrı bir kardeş eklemek yerine mevcut `#debug-stats` elementini
      **devralıyor** — o element hem runtime hem editör CSS'ini (viewport host'a
      taşınma dahil) zaten taşıyor; devralmak hepsini bozmadan korudu, readout
      içeride kendi `<pre>`'sini aldı. Kalıcı bir kontrol için (F4 hız seçici)
      ayrı bir `control-slot` boşken bile rezerve.
- [x] `src/scene/debugTableModal.ts`: ortalanmış, kapanabilir, **donmuş** tablo +
      panoya kopyala (pano reddedilirse ölçüm kaybolmuyor, konsola yazılıyor).
      Satır arkasında pay çubuğu — pahalı satır tek sayı okunmadan bulunuyor.
- [x] `engine/perf/debugTableView.ts`: `DebugTableView` + `debugTableToText`.
      Modal aptal bir hücre çizici; her sayı, birim ve uyarı ölçümü yapan
      tablodan geliyor. `debugTableToText` hem pano metni hem de tablonun
      tarayıcısız test edilebilmesinin yolu.
- [x] Dinamik import: `main.ts` artık `await import("@/scene/debugPanel")`.
      Yan etkisi hoş — `debugStats` de oyun paketinden çıktı: build çıktısında
      ayrı bir `debugPanel-*.js` (16.2 kB) chunk'ı var, `index-*.js` küçüldü.
- [x] Editör: Show > Stats artık `attachDebugPanel` çağırıyor; tek bayrak tüm
      paneli yönetiyor (yoksa kapalı bir readout'un üstünde boşta duran butonlar
      kalırdı).
- [x] CSS `.forge-debug-*` ön ekiyle `src/style.css` içinde.
- [x] **Buton yer tutucu değil:** F1'in verisi hazır olduğu için ilk aksiyon
      gerçek — "Frame cost" canlı kare hesabını dondurup tabloya döküyor.
      Yalnız profil tutan kabukta gösteriliyor (editör kabuğu profil tutmuyor,
      orada buton hiç yok): boş tablo açan bir buton, okuyucuya aracın bozuk
      olduğunu öğretir.

**Bitiş şartı:** ✅ `?debug` panelinde tıklanabilir kontrol şeridi var, tablo
modalı açılıp kapanıyor, kopyala butonu metni panoya yazıyor; oyun paketi
büyümedi — tersine, panel ayrı chunk'a taşındığı için küçüldü. Tarayıcı tarafı
(gerçek tıklama + pano) F6'daki smoke spec'ine bırakıldı; saf taraf 1102 check
içinde.

### F3 — Kare maliyeti (CPU) dökümü

ThreeAges'ten en doğrudan taşınan parça (`rtsFrameCapture.ts`, 230 satır, saf).

- [x] `engine/perf/frameCapture.ts`: `buildFrameCapture` + `frameCaptureTableView`
      + `formatFrameCaptureText`. §2.1 ve §2.2 ilkeleri burada yaşıyor: satırlar
      kareyi bölüyor (toplamları **kareye eşit**), ve her satır yakalanan karenin
      ms'inin yanında pencere ortalaması + pencere tepesi taşıyor.
- [x] **Satır şekli F1'inkinden bilinçli olarak farklı.** F1 canlı okunan bir
      ağaç: grup kendi satırını korur, çocuklar altına girintilenir. F3 tek
      karenin düz sıralaması: ayrıştırılan grup **çocuklarıyla değiştirilir**,
      artığı ayrı satır olur — böylece satırlar maliyete göre sıralanıp yine de
      kareye toplanır. Grubu da çocuklarını da listelemek 8 ms'i iki kez sayar ve
      tablodaki her yüzdeyi sessizce bozardı. (Planın "aynı modal, ayrı satır
      şekli" kuralı tam olarak bu.)
- [x] **Çalışmayan bölge sıfır değil "—".** Profiler artık kare içi birikimi
      ayrı tutuyor (`currentFrame`, `endFrame` temizliyor), bir bölge o karede
      hiç girilmediyse `frameMs: null` — pencere sütunları yine dolu, yani
      "pahalı sandığım şey bu karede hiç çalışmamış" tabloda görünüyor.
      Bir karede iki kez girilen bölge o kare için **toplanıyor**.
- [x] Panel butonu bir sonraki kareyi silahlandırıyor; yakalama karenin son işi,
      kendi toplamı kaydedildikten **sonra**, `endFrame`'den önce. Modalın açtığı
      birkaç yüz DOM düğümü anlattığı karenin dışına düşüyor.
- [x] Modal başlığı bağlamı taşıyor: toplam / ort / tepe ms, pencere kare sayısı,
      sahne saati, ve zaman ölçeği — `FrameCaptureContext` alanları F4 için
      şimdiden yerinde (`timeScale`, `paused`), varsayılan durumda tek kelime
      yazmıyor.
- [x] `tests/engine/frameCapture.test.ts`: 10 check — artık aritmetiği, grup
      çıkarması, çalışmayan bölge, paydasız kenar durumu, metin çıktısı,
      `endFrame` temizliği.
- [x] Paket disiplini: yakalama aritmetiği **oyun paketinde değil**. Kabuk ham
      örnekleri + yalnız kendisinin bildiği bağlamı veriyor, tabloyu silahlandıran
      taraf (`debugPanel`) kuruyor. `index-*.js` 643.9 → 640.6 kB.

**Duraklatma notu:** F3 duraklatmasız sevk edildi (tablo zaten donmuş). F4
geldiğinde yakalama duraklatmayı **sahiplenmedi**, çünkü gerek kalmadı: hız
seçici panelde ayrı bir kontrol, okuyucu isterse önce duraklatıp sonra yakalıyor,
ve yakalama hangi koşulda alındığını tablonun başlığında yazıyor (`paused` /
`4x`). Duraklatmayı yakalamaya bağlamak, duraklatmak istemeyen bir okuyucuya
duraklatma dayatırdı.

**Bitiş şartı:** ✅ `?debug` → "Frame cost" → satırları toplamı kareye eşit olan,
panoya kopyalanabilir bir tablo. 1110 check + `build:verify` + `verify:dist
--strict` + `verify:imports` yeşil.

### F4 — Zaman ölçeği ve duraklatma

En çok yeni iş, en çok mimari karar (§1.3). Ve teşhisten bağımsız değeri en
yüksek olan faz: PIE'si olmayan Forge'da "Play sekmesinde hızlandır/duraklat"
tek başına kazanç.

- [x] `engine/core/timeControl.ts`: `timeScale` + **tutulan** duraklatma.
      Duraklatma bir bayrak değil bir **sahip kümesi**: menü, ara sahne ve teşhis
      aynı anda tutabilir, herkes yalnız kendi tutuşunu bırakır. Bayrak olsaydı
      "son bırakan kazanır" olurdu — teşhis panelinin oyuncunun menüsünü sessizce
      açması tam olarak böyle olur.
- [x] Döngüde tek uygulama noktası, **üç ayrı delta** ile:
      `rawDeltaMs` (ekranın yaptığı — yalnız `frameMetrics`),
      `deltaMs` (gerçek geçen süre, kırpılmış — adaptif kalite, startup
      kalibrasyonu, ve **bakış/girdi**), `simulationMs` (ölçekli, duraklatmada
      tam olarak 0 — motor, capabilities, Game Mode, game modules, environment,
      post-process). Kamera kararı bilinçli: `beforeEngineUpdate` yalnız kontrol
      rotasyonunu güncelliyor, gerçek zamanda kalıyor, böylece **duraklatılmış
      sahnede etrafa bakılabiliyor** — teşhis duraklatmasının başlıca faydası.
- [x] Mutlak saatle çalışan malzeme animasyonları için ayrı bir
      `simulationClockMs` — yoksa kayan bir malzeme duran sahnede kaymaya devam
      ederdi.
- [x] Duraklatmada **render devam ediyor** (F5'in ihtiyacı bu); yalnız
      post-process'in dt'si duruyor.
- [x] `src/scene/debugSpeedControl.ts`: Pause + 1x/2x/4x/8x, panelin rezerve
      kontrol yuvasında. Canlı durumdan boyanıyor — başkası duraklatmışsa buton
      "bu duraklatmayı ben kaldıramam" diye sararıyor, işe yaramayan bir Resume
      sunmuyor.
- [x] Alt-adım modeli **taşınmadı**: `timeScale` çarpanı. Sabit adımlı döngü
      gerektiğinde ayrı bir karar.

**Bitiş şartı:** ✅ `?debug` panelinden hız değiştirilebiliyor ve
duraklatılabiliyor; `frameMetrics` hâlâ ham delta ölçüyor (test 4x'te ve
duraklatmada takılmanın hâlâ sayıldığını kilitliyor); duraklatılmış sahne
çiziliyor; `tests/engine/timeControl.test.ts` sahiplik ve ölçek matematiğini
kapsıyor. 1115 check + `build:verify` + `verify:dist --strict` +
`verify:imports` yeşil.

### F5 — GPU dökümü (A/B taraması)

Forge'da ThreeAges'tekinden **daha temiz** çıkması beklenen faz: orada kategoriler
oyun kavramları (birimler/yapılar/kervanlar), burada seviye içeriği zaten
kategorili — [LevelRuntime.ts:26](../../src/scene/LevelRuntime.ts#L26): landscapes,
foliage, river waters, splines, blocking volumes, static mesh'ler, actor
instances, post-process.

- [x] `engine/perf/gpuSweep.ts` + `gpuSweepRunner.ts`, ikisi de saf.
      **Bracketli taban** birebir taşındı: her adım kendi öncesi ve sonrası
      tabanının ortasıyla karşılaştırılıyor, bracket kendi tasarrufu kadar
      oynadıysa satır sayı değil `uncertain`. Testte kayan bir taban (6→12 ms)
      ile doğrulandı: tek tabana göre ters işaretli çıkacak satırlar bracket'la
      sıfıra iniyor.
- [x] **Kategori planı veriden türetiliyor** — ve planın öngördüğünden daha
      temiz bir kaynaktan: `LevelRuntime` adımlarından değil, F0'da eklenen
      `forgeSceneSource` etiketlerinden. Yani gölge envanterinin kovaları ile
      tarama satırları **aynı** veriden geliyor; bir fork içerik türünü
      etiketleyince hem envanterde hem taramada satır kazanıyor, motorda sabit
      kategori tablosu yok. Kuyruk `other`'a birleşiyor (adım başına ~20 kare,
      etiketsiz sahne mesh başına kova üretebilirdi).
- [x] Gölge adımı `shadowMap.enabled` değil **`autoUpdate` dondurması** —
      gerekçesi kodda: `enabled` gölge örnekleyen her materyali yeniden derletir
      ve o derleme ölçülen karenin içine düşüp gölgenin maliyeti sanılır.
      Ayrıca post-process adımı (pipeline'ı atlayıp düz çizim).
- [x] Duraklatma F4'ten geliyor; tarama **kendi** tutma sahibini alıyor
      (`gpu-sweep`), bitişte yalnız onu bırakıyor — oyuncunun duraklatması
      varsa olduğu gibi kalıyor.
- [x] `tests/engine/gpuSweep.test.ts`: 12 check — bracket ortalaması, gürültü
      tabanı, drift/`uncertain` kararı, sıralama, disjoint sayımı ve
      zamanlayıcı programı (geç gelen örnek, aç kalan adım, iptal, eksik taban).
- [x] Editör overlay'leri (`gizmo`, seçim konturu, fırça imleçleri, spline ve
      çarpışma yardımcıları) `editor-overlay` olarak etiketlendi — editörün
      gölge envanteri ve graf satırı bunları artık tek, dürüst bir kova olarak
      raporluyor.
- [ ] **Açık kalan:** editör kabuğunda taramanın kendisi yok. `SceneApp`'in GPU
      zamanlayıcısı hiç yok (`enableProfiling` de yok), dolayısıyla orada
      ölçülecek bir şey yok — etiketleme yerinde, eksik olan zamanlayıcı +
      koşum bağlantısı. Ayrı bir iş olarak bırakıldı.

**Bitiş şartı:** ✅ `?debug` → "GPU sweep" → kategorileri sırayla kapatıp tasarruf
tablosu üreten, sınırlarını kendi notlarında yazan bir koşum; zamanlayıcısı
olmayan tarayıcıda sıfır değil açıklama gösteriyor. 1127 check + `build:verify`
+ `verify:dist --strict` + `verify:imports` yeşil. (Editör tarafı yukarıdaki
açık madde.)

### F6 — Makine tanığı ve kalite matrisi

- [x] `engine/perf/perfWitness.ts` + canvas'ta `data-forge-perf`, 0.5 sn
      temposunda ve `debugOnly` bölge olarak işaretli. Ölçülmeyen GPU `null`,
      sıfır değil. Fork alanları `setPerfWitnessExtra` ile ekleniyor ve şablonun
      alanlarını **asla** gölgeleyemiyor — yoksa `quality` her fork'ta başka bir
      şey demek olurdu ve tanık karşılaştırılamazdı.
      Harness tarafı zaten hazırdı: `browserPerfHarness.mjs` bu attribute'u
      okuyordu ama şablon hiç yazmıyordu; eksik olan tam olarak bu uçtu.
- [x] `npm run perf:quality` (`tools/quality-matrix-report.mjs`): Low / Medium /
      High / Adaptive, aynı sunucu, aynı build, aynı süre, arka arkaya. Profil
      sayfa yüklenmeden **localStorage'a** ekiliyor (runtime'a debug amaçlı bir
      URL parametresi eklemedim: oyuncunun ayarını sessizce ezen bir bayrak
      er geç ürüne sızar), ve rapor istenen profili değil **koşan** profili
      yazıyor. Kendi portu 4175.
      **Kamera turu yok ve bu bilinçli:** şablonun kamera-yolu kavramı yok, her
      fork'unki farklı olurdu; satırlar "seviye başladığı gibi, dokunulmadan"
      koşuyor, rapor da bunu söylüyor.
- [x] `tests/smoke/debug-panel.spec.ts` (port 5273): panel + readout satırları,
      tanık JSON'u, kare dökümü → tablo → panoya kopyala → kapat, ve teşhis
      duraklatması (duraklatılmışken karelerin çizilmeye devam ettiği dahil).

**Bitiş şartı:** ✅ `npm run perf:quality` dört satırlık karşılaştırılabilir bir
rapor üretiyor (ekilen profilin gerçekten koştuğu JSON'da doğrulandı); smoke
suite paneli sürüyor ve geçiyor.

**Smoke'un bulduğu iki gerçek kusur** — birim testlerin ulaşamayacağı, tam da bu
spec'in var olma sebebi:

1. **Pointer lock panele erişimi tamamen kapatıyordu.** Kilitli imleçte her
   pointer olayı, imleç nerede olursa olsun canvas'a gidiyor; yani oynanış
   sırasında panelin hiçbir butonuna tıklanamıyor. Tarayıcının kendi çıkışı
   (Esc) bunu çözüyor ve spec de kullanıcı gibi Esc'e basıyor — ama bu ancak
   (2) düzeltildikten sonra işe yarıyor.
2. **Panel oyun UI ekranlarının altında kalıyordu.** Esc kilidi bırakıyor ve
   aynı tuş oyunun menü ekranını açıyor; tam ekran o katman paneli örtüyordu.
   Yani imleci geri aldığınız an panel kayboluyordu. `z-index` verildi (panel
   45, modal 46): menü bir teşhis yüzeyini gizleyemez.
   Ayrıca readout 1584 px'e kadar uzayıp ekranın iki katına taşıyordu; panel
   artık viewport'a sınırlı ve readout kendi içinde kayıyor.

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

- **2026-08-29 — F6 tamam, plan kapandı.** Tanık için altyapının yarısı zaten
  buradaydı (`browserPerfHarness` attribute'u okuyordu, şablon yazmıyordu),
  kalite matrisi de mevcut harness'in üstüne bir döngü oldu. Asıl değer
  smoke'tan geldi: panel, birim testlerin hepsi yeşilken **kullanılamaz**
  durumdaydı — pointer lock butonlara erişimi kapatıyordu, ve kilidi bırakan
  Esc tuşu oyunun menü ekranını açıp paneli örtüyordu. İkisi de yalnız gerçek
  bir tarayıcıda görülebilecek kusurlardı ve ikisi de düzeltildi (§F6).
  Planın "kabuk aptal, çekirdek saf" ilkesinin bedeli bu: saf taraf tastamam
  doğruyken kabuk hiç çalışmıyor olabilir, ve bunu ancak sürülen bir tarayıcı
  söyler.
## 8. İlerleme günlüğü

- **2026-08-29 — F5 tamam (editör tarafı hariç).** Planın beklediği gibi
  Forge'da ThreeAges'tekinden temiz çıktı, ama beklenen sebepten değil:
  kategoriler `LevelRuntime` adımlarından değil F0'ın `forgeSceneSource`
  etiketlerinden türedi. Bu daha iyi bir kaynak — gölge envanteri ile tarama
  artık **aynı** veriyi kullanıyor, yani iki tablo aynı içerik kavramından
  bahsettiğinde aynı adı yazıyor, ve fork tek bir etiketle ikisini birden
  kazanıyor. Ayrıca `GpuFrameTimer` zaten tag + disjoint sayacı taşıyordu
  (Forge burada ThreeAges'in önündeydi), koşum için ek altyapı gerekmedi.
  Editör kabuğunda tarama yok ve bu bilinçli: `SceneApp`'in GPU zamanlayıcısı
  hiç yok, dolayısıyla eklenecek olan ölçüm değil ölçüm altyapısıydı.
- **2026-08-29 — F4 tamam.** Planın §1.3'te işaret ettiği boşluk kapandı:
  Forge'un motorunda artık pause/timeScale var, ve teşhisten bağımsız değeri
  gerçekten en yüksek faz buydu. İki karar planın bıraktığı boşluğu doldurdu.
  (1) Kamera/bakış **gerçek zamanda** kaldı: `beforeEngineUpdate` yalnız
  kontrol rotasyonunu güncelliyor, dolayısıyla duraklatılmış sahnede etrafa
  bakmak mümkün ve dünya yine de kıpırdamıyor. (2) Mutlak saatle çalışan
  malzeme animasyonları delta almıyordu; ölçekli bir `simulationClockMs`
  eklendi, yoksa duran sahnede kaymaya devam ederlerdi — döngüde "tek
  uygulama noktası"nın tek satır olmadığı yer burasıydı.
- **2026-08-29 — F3 tamam.** Planın ThreeAges'ten devraldığı desende bir
  varsayım Forge'da tutmuyordu: orada her bölge her kare kaydediliyor, burada
  kaydedilmiyor (Game Mode oturumu yoksa `gameMode` bölgesi hiç girilmez).
  Pencerenin `lastMs`'ini kare değeri saymak, çalışmayan bir bölgeye bir
  önceki karenin sayısını yazardı. Bu yüzden profiler'a kare-içi birikim
  eklendi ve çalışmayan bölge `null` — §2.3'ün (yokluk ≠ sıfır) tablodaki
  karşılığı. F2'nin geçici tablosu kaldırıldı; yakalama onu her bakımdan
  kapsıyor (aynı satırlar + geldiği kare).
- **2026-08-29 — F2 tamam.** Planın öngörmediği tek karar: panel yeni bir
  element eklemek yerine `#debug-stats`'ı devraldı. Sebebi editörde ortaya
  çıktı — o element id'siyle viewport host'a taşınıyor ve kendi CSS'ini
  taşıyor; kardeş bir panel eklemek ikisini de kopyalamak demekti. Ayrıca
  ilk aksiyon boş bir yer tutucu olarak değil, F1'in verisiyle gerçek bir
  tablo olarak geldi; F3 bunu tek kare yakalamasıyla değiştirecek.
- **2026-08-29 — F1 tamam.** §1.1 ve §1.2 kapandı. Uygulamada iki karar
  planın bıraktığı boşluğu doldurdu. (1) Grup farkındalığı profiler'a kondu,
  capture'a değil: böylece muhasebe (`buildFrameRegionRows`) yalnız snapshot
  alan saf bir fonksiyon oldu ve kabuk overlay'e ikinci bir nesne geçirmiyor.
  (2) Planda olmayan bir şey çıktı: `debugOnly` yalnız *işaretlemek* için
  yetmiyordu — sınıflandırıcı aynı `totalAverageMs`'i okuduğu için, overlay'in
  kendi maliyeti kareyi CPU eşiğinin üstüne itip **teşhisin oyunu değil
  kendini teşhis etmesine** yol açabiliyordu. Bu yüzden teşhis maliyeti
  `debugOnlyAverageMs` olarak ayrıldı; §2.5 ilkesi artık yalnız bir işaret
  değil, hükmü koruyan bir sınır. Eşikler veri olmadan oynatılmadı.
- **2026-08-29 — F0 tamam.** Beş readout satırı, saf formatter + 12 birim test.
  İki şey planın beklediğinden farklı çıktı. (1) Gölge kovaları için Forge'da
  hazır bir içerik taksonomisi yoktu; kova adı **veri** yapıldı
  (`tagSceneSource` + üst düzey ada düşen yedek), böylece bir fork kendi içerik
  türünü readout'u düzenlemeden kovalıyor. (2) Ses bütçesi hiç ölçülmüyordu:
  `AudioEventDirector` motorda test edilmiş hâlde duruyor ama hiçbir tüketicisi
  yok, dolayısıyla okunacak sayaç da yoktu. Bütçe `AudioSubsystem`'e kondu —
  yani planın "sayaçlar zaten burada" varsayımı ses için geçerli değildi.
  Bu, F0'ı bir okuma katmanı olmaktan çıkarıp küçük bir motor eklemesi yaptı.
  Kapı yeşil: `tsc` + 1089 check + `build:verify` + `verify:dist --strict` +
  `verify:imports`.
- **2026-08-28** — Plan yazıldı. Forge tarafında ölçülen üç bulgu planın şeklini
  belirledi: profiler'ın kare sınırı karenin sonu değil (§1.1), profiler'da grup
  kavramı yok (§1.2), runtime'da zaman kontrolü hiç yok (§1.3). Kod yazılmadı.
