# `tools/engine-tests.ts` Bölme Planı

> Oluşturma: 2026-08-28 (ThreeAges backport, Katman 3.9)
> Durum: **Ölçüm aracı (Faz 0) Forge'a taşındı. Faz 1 şu an gereksiz — aşağıda
> gerekçesi. Faz 2–5 planlı, başlanmadı.**

Bu plan tek bir dosyanın (`tools/engine-tests.ts`, 30 118 satır) bölünmesini
tarif eder. Ama planın en önemli çıktısı bölme değil, **ölçümdür** — ve Forge
için ölçüm, ThreeAges'te olduğundan farklı bir sonuç veriyor.

## 0. Bu plan neden Forge'da var

Kaynağı ThreeAges'in `docs/planned/ENGINE_TESTS_SPLIT_PLAN.md` dosyası. Orada
`engine-tests.ts` 64 000 satıra ve 1327 check'e büyümüştü ve varsayılan suit
**161 saniye** sürüyordu; plan o acıyı çözmek için yazıldı. Forge fork'un
atasıdır, aynı dosya ve aynı desen buradadır, dolayısıyla aynı büyüme yolu
buraya da açıktır. Planın buraya taşınmasının sebebi budur: **acı gelmeden
önce ölçüm aracı ve bölme sırası hazır olsun.**

Taşınırken ThreeAges'in rakamları kopyalanmadı. Aşağıdaki her sayı Forge'un
kendi ağacında ölçüldü.

## 1. Ölçülen durum (Forge, 2026-08-28)

| Komut | Süre |
| --- | --- |
| `npx tsc --noEmit` | ~9 sn |
| `npm run test:engine` (filtresiz) | **bundle 0,3 sn + koşum 0,8 sn** |
| `npm run test:engine -- --filter "world mask"` | 0,3 sn |
| `npm run build:verify` | ~1 dk (çoğu `vite build`) |

- **30 118 satır**, **1074 check**.
- En yavaş check **49 ms**. En yavaş on check toplamı **~300 ms**, yani tüm
  koşumun yaklaşık üçte biri; geri kalan 1064 check yarım saniye.

### 1.1 Kritik bulgu: Forge'da hız problemi yok

ThreeAges'te dokuz check 161 saniyenin **%97,5**'ini yiyordu ve hepsi aynı
şeydi — headless hızlandırılmış tam maç simülasyonu. Forge'da öyle bir check
**yok**, çünkü öyle bir oyun yok: burada simüle edilecek maç, ekonomi ya da AI
krallık direktörü bulunmuyor. En pahalı check'ler (bir sound cue'nun bozuk
verisi, manifest'in public ağacına karşı doğrulanması, Rapier teması) onlarca
milisaniye sürüyor, saniyelerce değil.

Sonuç: **Faz 1 (`checkSlow` etiketleme) Forge'da bugün boş bir işlemdir.**
Harness'a giriş noktası eklendi ve belgelendi, ama etiketlenecek check yok ve
`test:engine` ile `test:engine:slow` bugün aynı 1074 check'i koşuyor. Bu
bilinçli: eşiği geçen ilk check yazıldığında araç yerinde olacak, ve o check'i
yazan kişi "bunu nasıl işaretlerim" diye plan okumak zorunda kalmayacak.

### 1.2 Bölmenin gerekçesi hız değil

- **Bundling 0,3 sn.** Dosyanın büyüklüğü koşum süresine katkı vermiyor.
  Bölmek tek başına bir saniye bile kazandırmaz — bu ThreeAges'te de böyleydi
  ve orada 64 000 satırda ölçüldü.
- Bölmenin gerçek getirisi: **bakım, izolasyon, paralellik ve merge.** 30 000
  satırlık tek modül kapsamı, içinde 1074 check'in ve yüzlerce top-level
  fixture'ın aynı isim alanını paylaştığı bir yerdir; iki ajanın aynı anda
  dokunduğu her seferde çakışır.

Bölme yine de yapılmalı — ama "suit yavaş" diye değil, "tek modül kapsamı
bakılamaz hâlde" diye. Ve Forge'un bir avantajı var: **bölmenin bir kısmı zaten
yapılmış.**

### 1.3 Forge'un başlangıç noktası ThreeAges'inkinden iyi

`tests/engine/` altında 19 dosya zaten ayrılmış ve `register*Tests(check)`
imzasıyla harness'ı **parametre olarak** alıyor:

```ts
registerBuildManifestParityTests(check);
await registerLevelRuntimeTests(check, checkAsync);
```

Bu, Faz 3'ün (harness'ı çıkarma) çözmesi gereken problemi — sayaçların
modül-global `let` olması — o dosyalar için **zaten çözmüş** durumda. Faz 4'ün
hedef dosyaları bu desene katılır; yeni bir mimari icat edilmesi gerekmiyor.

## 2. Faz 0 — Filtre + zamanlama (TAMAM, 2026-08-28)

İterasyon maliyetini düşüren ucuz müdahale; bölme gerektirmedi.

- `tools/run-engine-tests.mjs` artık `--filter` / `-f` / `--filter=` alıyor:
  virgülle ayrılmış, büyük-küçük harf duyarsız alt dizeler, OR'lanır. Runner
  bunu `ENGINE_TESTS_FILTER`'a yazar.
- `check` / `checkAsync` filtreye uymayan check'i **çalıştırmadan** atlar —
  filtreli koşumu ucuz yapan şey budur, çıktıyı kısaltmak değil.
- Filtreli koşum sonunda `PARTIAL: N passed, M skipped … not a green build`
  yazar. **Filtreli koşum asla yeşil build sayılmaz.**
- **Hiçbir check'e uymayan filtre exit 1** verir; yazım hatası sessiz kalmaz.
- `--timing` (veya `ENGINE_TESTS_TIMING=1`) her check'in süresini satıra ekler.
  §1'deki tablo bununla çıkarıldı.
- Runner bundle ve koşum sürelerini ayrı basar — biri dosyanın *boyutunun*,
  diğeri check'lerin maliyetidir ve bir suiti yavaşlatan yalnızca ikincisidir.
- `checkSlow` / `checkSlowAsync` harness'ta var ve belgelenmiş; üyelik ölçütü
  **süre**dir (eşik >1 sn), önem değil. Bu bir "önemsiz testler" kovası değil,
  bir "pahalı testler" kovasıdır.

Koşum modları:

| Komut | Kapsam |
| --- | --- |
| `npm run test:engine` | hepsi (bugün etiketli yavaş check yok) |
| `npm run test:engine:slow` (veya `-- --slow`) | hepsi, yavaşlar dâhil |
| `npm run test:engine -- --filter <konu>` | eşleşenler, **yavaşlar dâhil** |
| `npm run build:verify` / CI | `test:engine:slow` üzerinden hepsi |

Üç tasarım kararı ThreeAges'ten olduğu gibi geldi:

1. **Filtre yavaşları kapsar.** `slowEnabled = ENGINE_TESTS_SLOW=1 || filtre
   var`. Bir konuya daraltmak, o konunun pahalı check'lerini gizlememeli.
2. **`build:verify` `test:engine:slow`'a bağlandı**, böylece varsayılanın
   ileride hızlanması kapıyı sessizce zayıflatamaz. CI `build:verify`
   çağırdığı için otomatik olarak tam kapsam koşar.
3. **FAST koşum yeşil build değildir** ve çıktısı bunu yazar.

## 3. Faz 1 — Yavaş check'leri etiketle (ŞU AN GEREKSİZ)

Araç yerinde (§2), etiketlenecek check yok (§1.1). Bu faz, ilk check bir
saniyeyi geçtiğinde açılır. O gün gelirse yapılacak iş tek satırdır:
`check(...)` → `checkSlow(...)`.

**Tetik:** `npm run test:engine -- --timing` çıktısında >1000 ms bir satır.

## 4. Faz 2 — Paylaşılan fixture'ları çıkar

Herhangi bir bölmenin **ön koşulu**. Bugün top-level helper ve fixture'lar tek
modül kapsamında duruyor; dosyalar ayrılınca bunların ithal edilebilir olması
gerekir.

Hedef: `tools/engine-tests/fixtures/`

- `binary.ts` — `pngHeader`, `jpegHeader`, `webpVp8xHeader`.
- `fs.ts` — `listPublicFiles`, manifest fixture arayıcıları.
- `scene.ts` — sahne/entity kurucu yardımcılar (`buildCharacterRig`,
  `buildLayeredClips`, `buildZUpJumpClip` ve akrabaları).
- `audio.ts` — `fakeAudioHandle`, `fakeMusicHandle`, `musicRig`,
  `seededMusicRandom`.

Kural: fixture dosyaları **check içermez**, sadece dışarı veri/yardımcı verir.
Bu faz tek başına commit edilebilir ve check sayısı değişmez.

## 5. Faz 3 — Harness'ı çıkar

`tools/engine-tests/harness.ts`: `check`, `checkAsync`, `checkSlow`,
`checkSlowAsync`, filtre + timing + `FAST`/`PARTIAL` mantığı, sayaçlar.

Bugün `checks` / `skipped` / `skippedSlow` modül-global `let`. Dosyalar
ayrılınca sayaç tek bir yerde yaşamalı. Çözüm: harness modülü singleton sayacı
tutar, her test dosyası harness'ı **import eder**, özet basımı test
dosyalarından değil **runner'dan** çağrılır:

```ts
// tools/engine-tests/index.ts
import "./scene.test";
import "./editor.test";
// …
import { reportSummary } from "./harness";
reportSummary();
```

`run-engine-tests.mjs`'in entry point'i `tools/engine-tests/index.ts` olur.

`tests/engine/*.test.ts` dosyaları bugün harness'ı parametre olarak alıyor
(§1.3). Bu faz onları da import'a geçirebilir — ama **zorunlu değil**, ve
zorunlu olmaması bir avantaj: iki desen bir süre yan yana yaşayabilir, böylece
faz yarım bırakılsa bile suit kırmızıya düşmez.

## 6. Faz 4 — Alan bazlı dosyalara böl

Doğal bir tek kesme noktası yok; bölme **alan** (domain) esaslı olmalı, satır
esaslı değil. Dosyadaki mevcut banner'lar (`// --- başlık ---`) başlangıç
haritasıdır. Önerilen hedef dosyalar:

| Dosya | İçerik |
| --- | --- |
| `scene.test.ts` | sahne runtime, layout adapter, serialization |
| `editor.test.ts` | gizmo drag matematiği, snap, outliner, data table, EditorSceneController |
| `save-validator.test.ts` | save validator + skeleton/effect/material sidecar allowlist'leri |
| `audio.test.ts` | sound cue, audio bus + duck, event table, music director, dialogue/voice |
| `render.test.ts` | materyaller, post-process/GTAO, world mask, yansımalar, VFX |
| `spline-landscape.test.ts` | generic spline, painted roads, river water, sculpt, foliage |
| `ui-framework.test.ts` | UI widget/UMG lite, erişilebilirlik, game framework, gamepad/touch |
| `assets.test.ts` | manifest sağlığı, skeletal animasyon, collision/skeleton loader |
| `perf-physics.test.ts` | frame metrics, adaptive quality, GPU timer, Rapier, nav |

Yürütme kuralı: **her seferinde tek alan taşı, her taşıma kendi commit'i, her
commit'ten sonra `test:engine:slow` yeşil ve check sayısı değişmemiş.** Sayaç
değiştiyse bir check taşıma sırasında düşmüştür; bu, bu fazın tek ciddi riski ve
tek kabul ölçütüdür.

## 7. Faz 5 — Paralel koşum

Ancak Faz 4'ten sonra anlamlı, ve **Forge'da öncelik neredeyse sıfır**: koşum
zaten 0,8 saniye. ThreeAges'te bile Faz 1'den sonra bu fazın önceliği düşmüştü.

Buraya yazılma sebebi, bir fork'un ihtiyaç duyması hâlinde tasarımın hazır
olması: runner her test dosyasını ayrı bir worker process'te koşar
(`N = os.cpus().length`), özet toplanır, duvar saati **toplam** değil **en yavaş
dosya** olur. Faz 4 bittikten sonra "CI süresi gerçekten rahatsız ediyor mu"
sorusuna göre yeniden değerlendirilmeli, otomatik yapılmamalıdır.

## 8. Kabul ölçütleri (her faz için)

- `npm run test:engine:slow` yeşil ve **check sayısı fazdan önceki ile aynı**.
- `npm run test:engine` yeşil; FAST + atlanan = toplam.
- `npx tsc --noEmit` temiz.
- `npm run build:verify` yeşil.
- CI değişmeden yeşil; CI **hiçbir zaman** filtreli ya da FAST modda koşmaz.
- Her faz tek başına commit edilebilir; yarım bırakılan bir faz suiti kırmızı
  bırakmaz.

## 9. Kapsam dışı

- **Test framework getirmek yok.** Proje bilinçli olarak çerçeve kullanmıyor
  (`node:assert` + düz node, `verify-dist.mjs` ile aynı stil). Vitest/Jest bu
  planı kolaylaştırırdı ama konvansiyonu ve bağımlılık yüzeyini değiştirir; ayrı
  bir karar olarak ele alınmalı, bu planın içine kaçak yoluyla girmemeli.
- **Check silmek veya zayıflatmak yok.** Bu plan hiçbir testin kapsamını
  daraltmaz; sadece ne zaman koşulduğunu ve nerede durduğunu değiştirir.
- **Ayarlanabilir veriyi teste sabitlemek yok** — balans/tuning değerleri
  taşıma sırasında da teste çakılmaz.
