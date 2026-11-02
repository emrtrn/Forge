# WES K1 — senaryo kareleri ve ölçüm hazırlığı

**Tarih:** 2 Kasım 2026 · **Engine tabanı:** `bdba8d5`.
**Durum:** 12 senaryolu araç/yol taraması, sabit kamera kareleri ve yerel ölçüm aracı tamam. **Gerçek GPU görsel kabulü ve E-015 kapanmadı.**

## Ortam ve kanıt

Bu bulut ortamında `/dev/dri` veya NVIDIA aygıtı yok. Chromium'un hem CDP aygıt bilgisi hem gerçek WebGL context'i **ANGLE / Vulkan SwiftShader** bildiriyor. `EXT_disjoint_timer_query_webgl2` yok. [Aygıt tespiti](wes-k1/acceptance-2026-11-02/gpu-probe.json).

Varsayılan donanım önkontrolü ayrıca çalıştırıldı ve beklenen şekilde donanım yok gerekçesiyle ölçümü reddetti (exit 1): [önkontrol raporu](wes-k1/acceptance-2026-11-02/hardware-preflight.json). Yazılımsal tarama yalnız açık `WES_ALLOW_SOFTWARE=true` seçimiyle yapıldı. GPU süreleri **null**, donanım/visual/bütçe kabul alanları **false** kaldı.

## Aynı kamera, gerçek araç ve yol

Üretimdeki `ForgeRuntime`, mevcut `VehicleTest` fixture'ındaki **Reference Car + asfalt yol** ile başlatıldı. Fixture yalnız geçici `.playwright-smoke/run-wes-*` projesinde üretildi; `public/` veya kullanıcının level dosyaları değiştirilmedi. WES varsayılanları ve RuntimeParity'nin post-process ayarları bu fixture'a uygulandı.

- Chromium **154.0.8037.57**, Linux, headless; **1280×720**, DPR 1.
- **High**, adaptive kapalı; aynı kamera: konum `[0,4,16]`, hedef `[0,3.5,0]`, FOV **65°**.
- Araç park halinde, fizik açık; bulutların zaman fazı sabit. Saatli senaryolar, üretimdeki WES capability/controller ve simülasyon deltasıyla ilerler.
- Her durumda 2 s ısınma, en az 6 s örnekleme istendi. SwiftShader nedeniyle yalnız **8–10 geçerli kare aralığı/senaryo** toplandı. Yüzdelikler bu küçük örneklemin kaba yazılımsal tanısıdır.

| Senaryo | Görüntü |
|---|---|
| WES kapalı | [off-a](wes-k1/acceptance-2026-11-02/off-a.png) |
| Öğle, 12:00 | [noon-a](wes-k1/acceptance-2026-11-02/noon-a.png) |
| Sabah, 07:00 | [sunrise](wes-k1/acceptance-2026-11-02/sunrise-0700.png) |
| Alçak güneş, 06:30 | [low-sun](wes-k1/acceptance-2026-11-02/low-sun-0630.png) |
| Gün batımı, 18:30 | [sunset](wes-k1/acceptance-2026-11-02/sunset-1830.png) |
| Gece, 23:00 | [night](wes-k1/acceptance-2026-11-02/night-2300.png) |
| Bulutlu, 12:00 | [cloudy](wes-k1/acceptance-2026-11-02/cloudy.png) |
| Sisli, 12:00 | [fog](wes-k1/acceptance-2026-11-02/fog.png) |

Ek kareler: [24 dk gün](wes-k1/acceptance-2026-11-02/clock-24min.png), [1 dk gün stres durumu](wes-k1/acceptance-2026-11-02/clock-stress-1min.png), [öğle tekrarı](wes-k1/acceptance-2026-11-02/noon-b.png), [kapalı tekrarı](wes-k1/acceptance-2026-11-02/off-b.png).

**İnceleme gözlemi:** Gece araç silueti ve yol çizgileri seçiliyor, sis preset'i görüşü belirgin azaltıyor. Bu sabit yol kamerasında ay üst kenarda kısmen kalıyor; dolunayın tam yakın planı [görünür ay raporunda](WES_GORUNUR_AY.md). Bu görüntüler kullanıcı kabulü yerine geçmez; özellikle 06:30/18:30 gölge kalitesi gerçek GPU'da incelenmeli.

## Yazılımsal baz değerler — GPU performansı değildir

WES kapalı/açık karşılaştırması `off-a / noon-a / noon-b / off-b` **ABBA blokları** ile alındı. Kare aralıkları üretim render sonları arasından, okuma/screenshot zamanlaması dışında toplandı.

| Durum | Kare aralığı örneği | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Kapalı, iki blok | 20 | 645.40 ms | 692.00 ms | 693.40 ms |
| Açık / öğle, iki blok | 16 | 763.10 ms | 818.30 ms | 818.30 ms |
| Gece 23:00 | 10 | 648.00 ms | 709.50 ms | 709.50 ms |
| 1 dk gün stres durumu | 8 | 640.60 ms | 1411.10 ms | 1411.10 ms |

Statik p50 farkı +117.70 ms, p95 farkı +126.30 ms; **SwiftShader ve düşük örnek sayısı nedeniyle bunlardan gerçek GPU FPS veya WES bütçe kararı çıkarılmaz.** Güneş yönü/gölge çizimleri de değişiyor: kapalı 39 draw / 6532 üçgen, öğle 37 draw / 6424 üçgen. Bu fark yalnız WES'in saf CPU/shader maliyeti değildir. 30 Ekim RuntimeParity ölçümleri farklı sahne/ayar kullandığından doğrudan kıyaslanmaz.

IBL için 12 ayrı zorunlu recapture yapıldı: **CPU submission p50 19.90 ms, p95 50.00 ms**. Bu, CPU'nun komutları gönderirken harcadığı duvar süresidir; **IBL GPU süresi ölçülmedi**. Statik recapture varsayılan 256, çalışan saat 128 çözünürlük yolunu kullanır. Render GPU sorgusu ve IBL GPU sorgusu ayrı, iç içe geçmeyen span'lardır.

Geometri sayısı başlangıçta 15'ten 17'ye, program sayısı çalışan saat yolunda 24'ten 27'ye çıktı; doku sayısı 20 kaldı. Bu tek koşu bellek sızıntısı/plato kabulü değildir. JS heap, renderer sayıları, gerçek çizim boyutu ve ham örnekler her senaryo için [tam JSON raporunda](wes-k1/acceptance-2026-11-02/report.json). Tarayıcı hata kaydı **boş**.

## Yerel gerçek GPU çalıştırması

Forge'u güncelledikten ve bağımlılıkları kurduktan sonra, masaüstü Chrome kurulu makinede:

```bash
npm run perf:wes
```

Windows PowerShell shim sorunu varsa `npm.cmd run perf:wes`. Araç ayrı **4176** portunu kullanır, kendi geçici projesini açar ve otomatik temizler. Normal editörün 5173 portuna bağlanmaz. Sonuç yolu konsola yazılır: `builds/reports/wes-<tarih>/report.json` ve 12 PNG. Varsayılan süreler senaryo başına 5 s ısınma + 15 s ölçüm; tarama birkaç dakika sürer.

Chrome yerine Edge için PowerShell'de:

```powershell
$env:WES_CHANNEL = "msedge"
npm.cmd run perf:wes
```

İsteğe bağlı değişkenler: `WES_OUTPUT`, `WES_PORT`, `WES_WIDTH`, `WES_HEIGHT`, `WES_DURATION_MS`, `WES_WARMUP_MS`, `WES_BROWSER_EXECUTABLE`, `WES_HEADLESS`. Donanım kabulü için `WES_ALLOW_SOFTWARE` ayarlanmaz. Bu bayrak yalnız yazılımsal tanıya izin verir, hiçbir kabul alanını onaylamaz.

Ölçüm önkoşulları: tanınan donanım GPU, erişilebilir GPU timer, her senaryoda en az 30 kare ve 30 geçerli render GPU örneği, en az beş geçerli IBL GPU örneği, disjoint/hata olmaması. `measurementReady=true` yalnız bu teknik önkoşulları ifade eder. **Görsel kabul ve performans bütçesi ayrı kararlardır**, otomatik onaylanmaz.

## Doğrulama ve açık iş

- `npm run build:verify`: yeni QA sayfasının type-check'i, üretim derlemesi, motor testleri ve strict dist doğrulaması dahil geçti.
- `verify:wes-tools`: yazılımsal GPU'nun sahte timer ile dahi kabul edilmemesi, bilinmeyen GPU/eksik/disjoint verinin reddi, boş ölçümlerin null kalması ve teknik ölçümün görsel kabul sayılmaması test edildi.
- Gerçek 12 senaryolu runtime çalışması tamamlandı; yeni donanım önkontrolünün SwiftShader'ı reddetmesi ayrıca doğrulandı.
- Yeni kod yalnız QA/ölçüm aracı ve npm doğrulama bağlantılarıdır; engine/runtime davranışı değiştirilmedi. Gerçek GPU zamanlama kolu bu ortamda uçtan uca denenemedi.

**Kalan:** yerel gerçek GPU koşusu, araç/yol/gece ve alçak güneş görsel kabulü, ardından E-015 bütçesinin belirlenmesi. K1 kapanmış sayılmadı; K2 uygulaması başlatılmadı.
