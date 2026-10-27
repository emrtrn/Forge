# Arşivlenen planlardan kalan işler

Oluşturma: 27 Ekim 2026.

`ENGINE_TESTS_SPLIT_PLAN.md` ve `FORGE_RELIABILITY_ACTIVE_PLAN.md` arşive
taşındı (`C:\Users\emret\Documents\Forge-Archive`, bkz.
[COMPLETED_WORK_INDEX](../COMPLETED_WORK_INDEX.md)). Bu belge, o planlarda
**açık kalan veya yeniden değerlendirmeye değer** işleri tek yerde toplar.

Durum: **henüz karar verilmedi.** Hiçbir madde onaylı iş değildir; `planned/`
altındaki diğer dokümanlar incelendikten sonra en son bu belgeye dönülecek ve
her madde yapılacak / bırakılacak olarak işaretlenecek.

Kaynak notları arşivdeki dosyalarda, bölüm numaralarıyla verilmiştir.

## A. Test altyapısı (ENGINE_TESTS_SPLIT_PLAN)

### A1. Engine suite süresi ölçülmeli — öncelik: yüksek, ucuz

- Plan 28 Ağustos'ta 1.074 kontrol / 0,8 sn ölçmüştü ve "Forge'da hız problemi
  yok, Faz 1 gereksiz" demişti. 27 Ekim'de `npm run test:engine -- --timing`:
  **1.975 kontrol, bundle 1,6 sn, koşum 20,8 sn.**
- Planın Faz 1 tetikleyicisi (>1000 ms'lik tek check) kontrol edilmedi.
  `--timing` çıktısı sıralanıp en pahalı check'ler bulunmalı.
- Ağır check varsa `check(...)` → `checkSlow(...)` tek satırlık iştir; üyelik
  ölçütü süredir, önem değil.
- Not: 20,8 sn tek kalemden mi yoksa yüzlerce küçük check'ten mi geliyor
  bilinmiyor. Sonuç Faz 5 (paralel koşum) kararını da etkiler.

### A2. `tools/engine-tests.ts` bölme — öncelik: düşük/orta

- Dosya hâlâ 30.584 satır. Yalnız UI framework alanı (55 check) ayrıldı.
- Kalan alanlar: scene, editor, save-validator, audio, render, spline-landscape,
  assets, perf-physics.
- Yeni testler büyük ölçüde `tests/engine/` altında ayrı dosyalara yazılıyor;
  monolit son ölçümde yalnız ~470 satır büyüdü. Bu yüzden acil değil.
- Kural (planda): tek seferde tek alan, her taşıma ayrı commit, sonrasında
  `test:engine:slow` yeşil ve **check sayısı değişmemiş**.
- Faz 2 (ortak fixture çıkarımı) ve Faz 3 (harness'ı singleton modüle alma)
  bölmenin ön koşulu; `register*Tests(check)` deseni sayesinde zorunlu değil.

### A3. Dokümantasyon borcu

- `CLAUDE.md` "Engine test levels" maddesi artık arşivdeki plana işaret ediyor.
  Test akışı hâlâ değerli bilgi taşıyorsa filtre/timing/slow kuralı kısa bir
  kalıcı referansa (ör. `docs/architecture/`) taşınmalı.

### A4. Paralel koşum (Faz 5) — şimdilik bekleme

- Yalnız A1 sonucu "CI süresi gerçekten rahatsız ediyor" derse açılır.
  Otomatik yapılmamalı (planın kendi kuralı).

## B. Güvenilirlik (FORGE_RELIABILITY_ACTIVE_PLAN)

### B1. F01 — kayıt bütünlüğünün geniş kapsamı — öncelik: orta

Editör içi yarış ve hata sonrası retry çözüldü. Açık olanlar:

- Sunucu tarafında **geçici dosya + yeniden adlandırma** ile atomik yazma.
- Birden fazla dosyada crash/disk kesintisi kurtarma.
- Farklı sekme/istemcilerin çakışan yazmalarının koordinasyonu.
- `/__save-layout`'un layout + manifest yazması tek transaction değil.
- Raporun F01 maddesi bu kapsamıyla **tamamen kapanmış sayılmıyor.**

### B2. F08 — controller/test bakım dilimleri — öncelik: düşük

- Editör/runtime controller çıkarımları ve diğer test alanları açık
  (A2 ile örtüşür). Davranışı koruyan dar dilimler olarak yapılacağı yazılmıştı.

### B3. F09 — okuma sözleşmesinin kalan kapsamı — öncelik: ihtiyaç olursa

- Landscape, foliage, VFX ve diğer asset yükleyicileri ortak
  `ContentLoadError` katmanına taşınmadı.
- Nested feature parametreleri için eksiksiz JSON şeması yok; mevcut
  normalizer'lar enum/default davranışına güveniyor.
- Editöre özgü yeni hata diyaloğu eklenmedi.

### B4. F04–F07 — yayın hattının açık uçları — öncelik: orta

- Genel kütüphanede **813 Unknown lisans** kaydı (starter dışında).
- Uzak CI'da kritik/production browser akışları yapılandırıldı ama **hiç
  koşulmadı**; ilk uzak koşum doğrulanmalı.
- Gerçek hosting dağıtımı yapılmadı.
- Boyut bütçeleri disk baytını ölçer; FPS, GPU belleği ve ilk açılış
  transferini kapsamaz.
- Oyun kodunda hesaplanan dinamik bağımlılıklar profile elle eklenmeli.
- Starter için üretilen içeriğin lisans/attribution kayıtlarının bağımsız
  hukuki incelemesi yapılmadı (dağıtım kararı proje sahibinde).

### B5. F10 — boot hata ekranı sınırları — öncelik: düşük

- İlk HTML/entry script'in hiç inmemesi ve JavaScript'in kapalı olması
  kapsam dışı.
- WebGL **context-loss sonrası** çalışma zamanı kurtarma yapılmadı.
- Gerçek desteklenmeyen cihazda denenmedi (testler kontrollü enjeksiyon).

### B6. F11 / F12 / F14 — yaşam döngüsü, klavye, donanım kabulü

- Planda yalnızca "gerçek oyun ihtiyacına göre" diye bir başlık olarak duruyor;
  içeriği arşivdeki kaynak rapora bakılarak yeniden çıkarılmalı:
  [FORGE_KAPSAMLI_INCELEME_2026-10-21](../reports/FORGE_KAPSAMLI_INCELEME_2026-10-21.md).
- Araç planındaki 60/144 Hz kullanıcı kabulü açık.

### B7. Güvenlik incelemesi — öncelik: orta

- Kayıt endpoint'leri, validator'lar ve asset yükleme için ayrı bir güvenlik
  incelemesi **önerildi ama hiç başlatılmadı** (Codex Security taraması dahil).

### B8. Kullanıcı / görsel kabulü ve tam paket

- F01, F02, F03, F04–F07, F09, F10 için kullanıcı kabulü hiç yapılmadı.
- Tam geliştirme browser paketinin son koşumu 49/49 (15,4 dk) ve F03 anına ait;
  sonraki dilimlerde yalnız hedefli paketler (critical, production) koşuldu.
  Güncel durumun tam paketle yeniden doğrulanması gerekir.
- `check:assets` baseline kapısı: bilinen tek uyarı `SaveLoadMenu.ui.json`
  (manifest kaydı yok); elle çözülmeli ya da bilinçli bırakılmalı.

## C. Yeterlilik analizi (FORGE_YETERLILIK_ANALIZI, arşivlendi 27 Ekim 2026)

### C1. 5–17. başlıklar için `[x]/[~]` kararı verilmedi — öncelik: düşük

- Eski analiz 17 başlıklı bir denetim iskeletiydi; yalnız 1–4 doldurulmuştu
  (1–2 `[x]`, 3–4 `[~]`, son giriş 5 Temmuz). 5–17 boş şablondu: asset
  pipeline, veri şemaları/validator, rendering, fizik, UI, scripting, performans,
  build/dağıtım, test/CI, güvenlik, dokümantasyon, fork hazırlığı, yol haritası.
- 21 Ekim kapsamlı incelemesi (`docs/reports/`) bu alanlar için durum matrisi
  verdi ama başlık başlık yeterlilik kararı vermedi. Karar: matris yeterli mi,
  yoksa bazı başlıklar için ayrı karar gerekli mi?
- Eski sayılar güncel değil (RuntimeSceneApp 3,6k → 6,8k satır, EditorUi 5,8k →
  5,2k, 596 → 1.975 engine kontrolü); yeniden kullanılacaksa kanıt tazelenmeli.

### C2. `tools/create-project.mjs` scaffold'u — yalnız hatırlatma

- Hâlâ yok; `CLAUDE.md` Near-Term #4'te ayrıca izleniyor. Manuel fork çalışıyor.

## D. Offroad Detail Patch tartışması (arşivlendi 27 Ekim 2026)

- Detail Patch + Detail Paint Tool önerisi, `OFFROAD_ARAZI_DEFORMASYON_TEKNIKLERI_ARASTIRMA_v0.1.md`
  (arşivlendi) §7'de madde madde karşılaştırıldı ve reddedildi (OPEN_WORLD İlke #2 "tek arazi
  yolu"); yerine CDLOD alt-seviyeleri + katmanlı Δ seçildi ve
  `TERRAIN_DEFORMATION_PLAN.md`'ye işlendi. Ayrı iş çıkmıyor.
- Kullanıcı kabulü kalemleri (S-D1 GPU/pop ölçümü, görsel kabul) o planın
  içinde izleniyor, bu belgenin konusu değil.

## E. Offroad deformasyon araştırması — kod işi olmayan gelecek fikirleri (arşivlendi 27 Ekim 2026)

Araştırmanın onaylı kararları (kalıcılık kademeli, `sinkage()`, CDLOD alt-seviyeleri,
sanal ofset, yanal iz-tutma) `TERRAIN_DEFORMATION_PLAN.md`'ye işlendi ve uygulandı.
Plana girmemiş üç fikir kaldı; hiçbiri onaylı iş değil:

- **E1. Authored Δ + Detail Paint aracı** (rapor §5.3, A6). Yol kenarı hendeği,
  çamur çukuru gibi *tasarlanmış* ayrıntı için: yalnız boyanan 16/32 m bloklarda
  0,25–0,5 m Δ yükseklik dokusu; topoloji değişmez; |Δ| ≈ ±0,3–0,5 m (sanal ofset,
  şasiyi engellemez). Yeni kayıt yüzeyi gerektirir (6. allowlist: `saveValidator` +
  `serializationDrift` + CLAUDE.md notu; `*.terrain.json` tile listesine `detail`
  bloğu önerisi). Tetik: yol/hendek tasarım ihtiyacı çıkması. Açık karar: çamur
  yatağı `T` verisi katman başına sabit mi, boyanabilir harita mı (rapor §9 #3).
- **E2. Seyrek 16 m blok deposu** (rapor §5.4, D2). Pencereden çıkan izlerin
  MudRunner modeliyle kalıcı birikimi (128² @ 12,5 cm; ~48 KiB ham/blok;
  1 km yolda ~120 blok ≈ 6 MB ham tahmin). Plan Faz 5'in daha iddialı hali;
  önce Faz 5 (1 m kaba katman + save-game) bağlanmalı. Ölçüt: oyuncu aynı yolu
  ikinci kez sürerken izlerin orada olmasını bekledi mi (K-A). Spike S-D5: 5 km
  sürüş sonrası bellek/save boyutu.
- **E3. `setShape` ile yerel deforme collider** (rapor B3, S-D4). Yalnız sanal
  ofset (B1+B2) yetmezse. Ölçüm: 32 m @ 0,25 m ≈ 0,05 ms, 64 m ≈ 0,2 ms (Node,
  dinamik cisim yok); gövde teması ve dinamik kararlılık ölçülmedi. Katman sorunu:
  heightfield tabanın altına inemez, ışın en yüksek yüzeyi vurur.

## Son bakışta sorulacaklar

1. A1 ölçümü yapıldı mı, sonuç ne? (Faz 1 ve Faz 5 kararlarını belirler.)
2. B1 ve B7 gerçek bir risk mi, yoksa tek kullanıcılı yerel geliştirme için
   kabul edilebilir mi?
3. B4'teki uzak CI koşumu en azından bir kez yapılacak mı?
4. A2/B2 bölme işi için bir tetik (ör. iki oturumun aynı dosyada çakışması)
   tanımlanacak mı, yoksa kapatılacak mı?
