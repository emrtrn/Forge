# WES K1 kabul raporu — saat, güneş, atmosfer, editör önizlemesi

**Tarih:** 30 Ekim 2026
**Kapsam:** [K1 görev talimatı v0.2](../planned/WES/FORGE_WES_K1_GOREV_TALIMATI_v0.2.md) — WES-002 … WES-005
**Kaynak tasarım:** [WES v0.3](../planned/WES/FORGE_WORLD_ENVIRONMENT_MEVSIM_HAVA_ZAMAN_TEKNIK_TASARIM_VE_UYGULAMA_PLANI_v0.3.md)
**Durum:** Kod tarafı tamam ve `main`'de. Açık kalan iki kalem var; ikisi de gerçek tarayıcı/GPU ister: **görsel kabul** (aynı kameradan çekilmiş kareler) ve **GPU perf ölçümü**. Ayrıntısı §4 ve §5'te.

---

## 1. Commit'ler

| Bilet | Commit | Ne |
|---|---|---|
| WES-002 | `41f7c2d4` | `LayoutWorldEnvironment` + `normalizeWorldEnvironment` (`engine/environment/worldEnvironment.ts`), `validateWorldEnvironment`, editörde singleton actor (Add Actor → Visual Effects, Outliner, Details varsayılanları) |
| WES-003 | `07d267a8` | `worldClock`, `sunPath` (Sun rotasyonundan ters türetme dahil), `weatherPresets`, `environmentResolve`, `recapturePolicy` |
| WES-004 | `50034492` | `AuthoredEnvironment.applyWorldEnvironment`: iki kabuğun tek render bağı |
| WES-005 | `212480b3` | Play saati (`worldEnvironmentModule`, `worldEnvironmentService`), editör önizleme şeridi, Sun rotasyonu salt okunur, `?debug` satırı |
| WES-005 | `26d4c203` | RuntimeParity + game/RTS starter fixture'larına World Environment (ayrı commit; K1 talimatı §1 istisnası) |
| — | bu rapor | Önizleme şeridi düğme düzeni + rapor + belge durumları |

## 2. Kapı çıktıları

| Kapı | Sonuç |
|---|---|
| `npx tsc --noEmit` | Her bilette temiz |
| `npm run build:verify` | Her bilette yeşil. Son koşu: **2164 check passed**; `verify:dist --strict` PASS; `verify:imports` PASS; `verify:world-data` temiz |
| WES engine testleri | 30 check: `worldEnvironment.test.ts` (18), `authoredEnvironment.test.ts` (5), `worldEnvironmentModule.test.ts` (4), drift/dropped/parity ekleri (3) |
| `world-environment.spec.ts` (yeni) | Geçti (~58 s) |
| `game-starter`, `runtime-parity` + `smoke:critical` (5 spec) | **18/18 geçti** |
| `sun-cascaded-shadows.spec.ts` | 1/2. "16 doku birimli GPU'da 4 kaskad" vakası bu makinede 3 kaskad buluyor. **WES-004 değişiklikleri geri alınınca da aynı şekilde başarısız** (stash ile denendi): önceden var olan bir sorun, WES kaynaklı değil |

## 3. ENV kabul testleri

| ID | Sonuç | Kanıt |
|---|---|---|
| **ENV-00** | ✅ | Actor'süz layout'un save çıktısı aynı kalıyor; actor yokken, gizliyken ya da state yokken binding hiçbir değere dokunmuyor; override bitince her değer geri yükleniyor (`worldEnvironment.test.ts`, `authoredEnvironment.test.ts`). Parity ve game-starter smoke'ları yeşil |
| **ENV-00b** | ✅ | Actor eklenirken saat ve güneş yolu mevcut Sun'dan türetiliyor; gidiş-dönüş 1e-9 içinde, kaydedilen (yuvarlanmış) değer 0.01° içinde. Sınır: ufkun altındaki bir Sun 1°'ye kaldırılıyor. 35°'nin altındaki bir Sun'ın şiddeti eğri yüzünden en fazla ~%0.1 düşüyor (parity Sun'ı 34.2°) |
| **ENV-06** | ✅ | 24 saat wrap, scrub, oynatma hızı, pause (`TimeControl` holder'ları saati durduruyor), editör/Play ayrımı (smoke'un 5. adımı) |
| **ENV-09** | ✅ | Maksimal actor round-trip; bilinmeyen alanlar `dropped[]`'e düşüyor; drift ve dropped-field korumaları actor'ü kapsıyor |
| **ENV-14** | ✅ | 30/60/144 Hz'de aynı saat (1e-9) |
| **ENV-15** | ✅ | Smoke: scrub + hava + mevsim önizlemesi sonrası 2.5 s boyunca **hiç save isteği yok**; "Make Default" tek undo adımı (undo/redo kayda yansıyor); yeniden açınca önizleme yerine varsayılan geliyor; Play varsayılandan başlıyor (`world env: 18:00 winter cloudy 1.00`) |
| **ENV-16** | ✅ (K1 kapsamında) | K1 shader yaması eklemiyor; `onBeforeCompile` zincirine dokunulmadı. Binding authored layout actor'lerine hiç yazmıyor (test: layout snapshot'ı değişmiyor). Runtime'da program sayısı WES açık/kapalı aynı (23) |
| **ENV-18** | ✅ | ≥ 3° ya da yeni hava/mevsim anahtarı gelince, en az 2 s arayla yeniden yakalama; scrub sırasında yakalama yok, bırakınca bir kez (`recapturePolicy` testleri). Smoke'ta scrub `scrubbing` bayrağıyla gidiyor |

## 4. Ekran görüntüleri

Önizleme şeridi (editör, 18:30): [wes-k1/preview-strip.png](wes-k1/preview-strip.png)

**Aynı kameradan istenen kareler (WES kapalı, 07:00, 12:00, 18:30, 23:00, cloudy, fog): ölçülmedi.** Headless Chromium bu makinede SwiftShader ile çiziyor ve editör viewport'u bazı karelerde siyah çıkıyor. Bu, repodaki bilinen headless sorunu. Çekilen kareler gerçek görüntüyü temsil etmediği için rapora konmadı.

Gerçek tarayıcıda yapılacak kontrol:
- RuntimeParity'yi `?editor` ile aç ve World Environment'ı seç.
- Önizleme saatini 07:00 / 12:00 / 18:30 / 23:00 yap, ardından Cloudy ve Fog düğmelerine bas.
- Plan §6.5 gereği 06:30 ve 18:30'da alçak güneşin gölge kalitesine (shadow acne, uzun gölgeler) ayrıca bak.

## 5. Performans

Ölçüm `?debug` overlay'inden alındı: RuntimeParity, Play, 15 s ısınma. Ham değerler [wes-k1/perf.json](wes-k1/perf.json) dosyasında.

- **Tarayıcı:** Chrome 149 (Playwright)
- **GPU:** SwiftShader (yazılımsal), çözünürlük 896×504
- **WES açık senaryosu:** kasıtlı olarak en kötü durum. Gün uzunluğu 1 dakika, yani güneş ~6°/s döner ve IBL her 2 s'de yeniden yakalanır.

| | WES kapalı | WES açık (1 dk gün) |
|---|---|---|
| `environment` bölgesi ort. / tepe | 0.04 / 0.40 ms | **5.85 / 27.0 ms** |
| geo / tex / program | 12 / 16 / 23 | 12 / 16 / 23 |
| draw call / üçgen | 17 / 12 403 | 17 / 12 403 |

**Yorum:**
- Yeni program, doku ya da draw call yok.
- `environment` maliyetinin neredeyse tamamı periyodik IBL yeniden yakalaması.
- SwiftShader kare süreleri (p50/p95) gerçek GPU'yu temsil etmez. **Gerçek GPU'da ölçülmedi.**
- IBL yakalama süresi tek başına ölçülmedi.
- Normal bir gün uzunluğunda (ör. 24 dk) güneş 3°'yi ~12 s'de katediyor, yani yakalama 6 kat seyrek.
- E-015 (WES'e özel GPU/FPS eşikleri) hâlâ açık. Gerçek GPU'da `perf:browser` ile WES kapalı/açık ölçümü ve yakalama süresi ölçümü gerekiyor. Gerekirse `RECAPTURE_MIN_INTERVAL_MS` / `RECAPTURE_MIN_ANGLE_DEG` ayarlanacak.

## 6. v0.3'ten sapmalar

1. **Details paneli ayrı dosyada:** `src/editor/panels/details/worldEnvironmentDetails.ts`. `environmentDetails.ts` zaten 660 satır, önizleme şeridi de kendi canlı güncellemesini taşıyor.
2. **`setWeather` geçişi:** imzada `transitionSeconds` yok, değişim anlık. Zamanlı geçiş yağışla birlikte K3'e kaldı.
3. **"Eksik environment actor'lerini ekle" düğmesi yok.** Önizleme şeridi yalnızca uyarıyı gösteriyor ("Cloudy needs a Cloud Layer …"). §12'deki doğrulama listesinin geri kalanı (Foliage Type varyantı, materyal sürücüsü) K2'nin konusu.
4. **"Değişmeyen karelerde iş yok" yerine her karede uygulama.** Override aktifken her karede çözülüp uygulanıyor; bunun nedeni, düzenleme sırasında authored değerlerin değişebilmesi. Çözümleme ve uniform yazımı ucuz. Pahalı kısım olan IBL yeniden yakalama politikaya bağlı. `WorldEnvironmentController.revision` hazır; ölçüm gerektirirse bu revizyonla atlama yapılabilir.
5. **Override tabanı değişiklik algılamayla tutuluyor.** Sun ışığı, ambient ve exposure için binding son yazdığı değeri hatırlıyor; sahibi değeri değiştirirse (ışık düzenlemesi, kalite değişimi) yeni değeri taban kabul ediyor. Böylece kabuklara geri yükleme callback'i gerekmedi. Güneş yönü hedef konumu olarak değil yön olarak izleniyor; follow-shadow ışığı ve hedefi her kare birlikte kaydırıyor.
6. **Sun rotasyonu yalnızca Details'te salt okunur.** Gizmo hâlâ döndürebiliyor; plan bunu bir UI kısıtı olarak tanımlıyor.
7. **Ekler:** `?debug`'a `world env:` satırı eklendi. `capabilityCoverage`'a kural eklendi: modülü çıkaran bir fork, "World Environment actor işlevsiz" uyarısı alıyor.
8. **Önizleme oynatma hızı:** 0.25 / 1 / 4 oyun saati / gerçek saniye.

## 7. Açık kalanlar

| Kalem | Bekleyen | Not |
|---|---|---|
| Görsel kabul kareleri | Kullanıcı, gerçek tarayıcıda | §4 |
| GPU perf + IBL yakalama süresi (E-015) | Gerçek GPU | §5 |
| `sun-cascaded-shadows` 16-unit vakası | Ayrı inceleme | WES'ten bağımsız |
| K2 başlangıcı | E-023 içerik boşlukları: kış çıplak ağaç mesh'i, çatı modeli | K2 talimatı bu rapor kabul edildikten sonra yazılacak |
