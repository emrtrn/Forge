# FORGE WORLD ENVIRONMENT — K1 GÖREV TALİMATI (WES-002 … WES-005)
## Saat, güneş, atmosfer ve editör önizlemesi

**Sürüm:** 0.2 (v0.1 "K0 / WES-001 analiz görevi"nin yerine)
**Tarih:** 27 Ekim 2026
**Kaynak tasarım:** [WES v0.3](FORGE_WORLD_ENVIRONMENT_MEVSIM_HAVA_ZAMAN_TEKNIK_TASARIM_VE_UYGULAMA_PLANI_v0.3.md)
**İş türü:** Uygulama. Claude veya Codex'e doğrudan verilebilir.
**Önkoşul:** Yok. K0 analizi WES v0.3 §3 ile kapandı (`main@f9aa05f`).

> **v0.1'den fark:** v0.1 yalnız-analiz (K0) göreviydi ve istenen rapor başlıkları WES v0.3 içinde yazıldı:
> - Yetenek matrisi: §3.1
> - Reuse planı: §4
> - Şema alternatifleri: §5.3
> - K1–K3 kırılımı: §16
> - Fixture: §16 WES-009
> - Test planı: §17
> - Açık kararlar: §18
>
> Bu talimat artık K1'in uygulanmasını tarif eder.

---

## 1. Çalışma kuralları

- `CLAUDE.md` ve `AGENTS.md` geçerlidir.
- Değişiklikler **`main`'e** commit edilip push edilir (CLAUDE.md iş kuralı).
- Her bilet ayrı commit'tir. Biletler sırayla gider; bir sonrakine geçmeden önce kapı yeşil olmalıdır.
- **Kapı:** `npx tsc --noEmit` → `npm run test:engine` → `npm run build:verify`. Editör/Play akışına dokunan biletlerde ilgili Playwright smoke'u da çalışır (port 5273, `npm run dev:smoke`).
- Yeni engine test dosyaları `register…Tests` fonksiyonu export eder ve `tools/engine-tests.ts` içinde kaydedilir; otomatik keşif yoktur. Kaydedilmeyen test sessizce çalışmaz.
- `git status`'u başta ve sonda kontrol et. Kullanıcının kirli dosyalarına dokunma.
- Kullanıcı level'larını (`LandscapeTest`, `OffroadTest`, `RuntimeParity` vb.) **değiştirme**. Fixture gerekiyorsa yeni dosya aç.
  - İstisna: `RuntimeParity` ve game-starter fixture'ına World Environment eklenmesi K1 kabulünün açık parçasıdır (WES-005). Bunu ayrı commit olarak yap ve gerekçesini commit mesajına yaz.

## 2. Onaylı kararlar — yeniden açma

1. Kademeli kapsam; manuel mevsim/hava + saat.
2. Hibrit ağaç varyantı (K2).
3. Kar önce görsel (K2–K3); fizik K6.
4. Masaüstü WebGL2.
5. WES genel Engine/Editor yeteneğidir.

v0.3'teki `[KARAR v0.3]` maddeleri mühendislik kararıdır. Kodda çelişen bir kanıt bulursan uygulamayı durdur, kanıtı ve önerini yaz.

## 3. Biletler

### WES-002 — Veri sözleşmesi ve kayıt

**Yap:**
- `engine/environment/worldEnvironment.ts`: `LayoutWorldEnvironment`, `Season`, `WeatherPreset`, varsayılanlar ve `normalizeWorldEnvironment()` (WES v0.3 §5.1–5.2). three import etme.
- `engine/scene/layout.ts`: `RoomLayout.worldEnvironment?: LayoutWorldEnvironment`. Doc yorumu diğer singleton'lar gibi olmalı.
- `tools/saveValidator.ts`: `validateWorldEnvironment`, normalizer'ı yeniden kullanır. `validateLayout`'a bağla.
- `src/editor/EditorUi.ts`: `singleton("worldEnvironment", "World Environment", "Visual Effects", …)`.
- `src/editor/panels/details/environmentDetails.ts`: `renderWorldEnvironmentDetails` (yalnız varsayılan alanlar; önizleme şeridi WES-005'te).

**Kanıt:**
- `tests/engine/worldEnvironment.test.ts`: normalize, clamp, bilinmeyen enum → varsayılan + uyarı.
- `droppedFields.test.ts` ve `serializationDrift.test.ts`'e `worldEnvironment` kapsamı.
- Actor'süz layout'un save çıktısı byte-byte aynı (ENV-00, ENV-09).

**Yapma:** render'a bağlama (WES-004).

### WES-003 — Saat, güneş yolu, preset'ler (saf)

**Yap:**
- `engine/environment/worldClock.ts`: birikmiş simülasyon süresinden kapalı form saat, 24h wrap. `dayLengthMinutes = 0` saati durdurur.
- `engine/environment/sunPath.ts`:
  - Saat + `sunPath` → güneş/ay yönü, ışık rengi/şiddeti, ambient çarpanı.
  - Alacakaranlık geçişi.
  - **Ters türetme:** mevcut Sun rotasyonu → `hour` + `azimuthDeg` + `noonElevationDeg` (actor eklenince görüntü sıçramasın).
- `engine/environment/weatherPresets.ts`: göreli çarpanlar; `clear` kimliktir (v0.3 §7.1).
- `engine/environment/environmentResolve.ts`: authored actor'ler + state → `ResolvedEnvironment`.
- `engine/environment/recapturePolicy.ts`: ≥ 3° ya da preset değişimi ve ≥ 2 s aralık; scrub sırasında yakalama yok.

**Kanıt** (aynı test dosyası):
- 24h wrap; 06/12/18 için beklenen yön vektörleri.
- Ters türetmenin gidiş-dönüş eşitliği.
- 30/60/144 Hz eşitliği.
- `clear` ve intensity 0'ın kimlik olması; yakalama eşikleri (ENV-06, ENV-14, ENV-18).

### WES-004 — Atmosfer bağı (iki kabuk, tek uygulama)

**Yap:**
- `engine/render-three/authoredEnvironment.ts`:
  - `applyEnvironment(resolved | null)`: sky güneş yönü ve turbidity, sis yoğunluğu/rengi, bulut coverage/rengi, exposure.
  - `resolveSunDirection()` override'ı; `applySunDirection` ve `applyReflection` bunu kullanır.
  - Kadans `recapturePolicy` ile.
  - `null` = bugünkü davranış.
- `src/scene/SceneApp.ts` ve `src/scene/RuntimeSceneApp.ts`: sun **three `DirectionalLight`** nesnesine yön/renk/şiddet override'ı ve ambient çarpanı. `LayoutLightActor`'e **yazma** (v0.3 §4.4). Kabuk değişikliği birkaç satır olmalı; mantık `engine/`'de kalır.

**Kanıt:**
- `tests/engine/authoredEnvironment.test.ts` (headless three): override sonrası authored actor nesneleri değişmemiş, `null` kimlik.
- `runtime-parity.spec.ts` ve `sun-cascaded-shadows.spec.ts` yeşil (ENV-00, ENV-16).

### WES-005 — Editör önizlemesi + Play modülü

**Yap:**
- Önizleme state'i editör kabuğunda tutulur, layout'a yazılmaz.
- Details'e önizleme şeridi: saat slider'ı, oynat/durdur, hız, mevsim/hava düğmeleri, örtü slider'ları (K2'ye kadar yalnız state), "Varsayılan yap" (tek `EditorHistory` adımı) ve "Sıfırla".
- WES açıkken Sun rotasyon alanlarında "WES tarafından yönetiliyor" uyarısı.
- `src/scene/capabilities/worldEnvironmentModule.ts`:
  - `onLevelLoaded` → varsayılandan state kurar.
  - `update(simDelta)` → saat ilerler.
  - Servisi `runtimeServiceKeys.ts`'e ekle; `createDefaultRuntimeModules()` listesine kaydet.
- `RuntimeParity.level.json` (ve game-starter fixture'ı) ayrı commit'te bir World Environment actor'ü alır. `runtimeParityLevel.test.ts` ve `game-starter.spec.ts` güncellenir.

**Kanıt:**
- `tests/engine/worldEnvironmentModule.test.ts`: `TimeControl` pause holder'ları saati durdurur, time scale hızlandırır.
- `tests/smoke/world-environment.spec.ts`:
  1. Actor ekle.
  2. Scrub et; layout kirli değil.
  3. Varsayılan yap; tek undo ile geri alınabilir.
  4. Kaydet ve yeniden aç; önizleme gitmiş, varsayılan kalmış.
  5. Play varsayılandan başlar.
- Bu senaryo ENV-06 ve ENV-15'i kapsar.

## 4. K1 kabul raporu

`docs/reports/WES_K1_KABUL_RAPORU.md` adıyla yaz:

- **Commit listesi ve kapı çıktıları:** test sayıları, süreler.
- **ENV-00/06/09/14/15/16/18 sonuçları.**
- **Ekran görüntüleri** (aynı kamera): WES kapalı, 07:00, 12:00, 18:30, 23:00, `cloudy`, `fog`.
- **Perf** (`?debug` / `npm run perf:browser`):
  - WES kapalı/açık farkı: frame p50/p95, GPU ms.
  - IBL yakalama süresi.
  - Tarayıcı, GPU ve çözünürlük.
- **Ölçülmeyen değerler:** "ölçülmedi" diye yaz.
- **Bulunan sapmalar:** v0.3'ten farklı yapılan her şey ve gerekçesi. v0.3 belgesini de buna göre güncelle.

## 5. Bu turda yasak

- Terrain/materyal/foliage shader değişikliği (K2).
- Yağış görseli (K3).
- Otomatik hava/takvim (K5).
- Fizik katsayısı ya da surface provider değişikliği (K6).
- Bağımlılık yükseltme, WebGPU.
- Kullanıcı level/asset'lerinin üzerine yazma.
- Git geçmişini yeniden yazma.

## 6. Sonraki adım

K1 raporu kabul edilince K2 talimatı (WES-006 … WES-009) yazılır. Talimat şu kalemlerle başlar:
- WES v0.3 §9.1 terrain bloğu, §8.1 Foliage Type varyantı, §9.2 materyal sürücüsü.
- `WesValley` fixture'ı.
- **E-023 içerik boşlukları:** kış çıplak ağaç mesh'i, çatı modeli. K2 başlamadan temin edilmeli.
