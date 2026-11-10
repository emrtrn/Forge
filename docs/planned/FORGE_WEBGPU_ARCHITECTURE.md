> **Bu belge Forge-WebGPU deposuna taşındı:** `C:\Users\emret\Desktop\Forge-WebGPU\docs\planned\FORGE_WEBGPU_ARCHITECTURE.md` (GitHub `emrtrn/Forge-WebGPU`); bu kopya güncellenmez.

# Forge WebGPU — Mimari Analiz ve Başlangıç Kararları

**Sürüm:** v0.1 · 2026-11-10
**Durum:** Öneri; §8'deki kararlar onay bekliyor.
**İlişkili:** [FORGE_WEBGPU_REBUILD_PLAN.md](FORGE_WEBGPU_REBUILD_PLAN.md) (faz
sırası), [FORGE_GAME_PROJECT_WORKFLOW.md](FORGE_GAME_PROJECT_WORKFLOW.md)
(Model 2).
**Amaç:** Forge WebGL'de sonradan fark edilip düzeltilen kararları kanıtlarıyla
çıkarmak ve yeni motorun başlangıcını bunları baştan doğru yapacak şekilde
tanımlamak. Yeni deponun `ARCHITECTURE.md` belgesi bu rapordan türetilir.

---

## 0. Özet — on doğru düğme

1. **Tek tip aktör + bileşen veri modeli.** Level'da türe özel diziler yok; her
   şey kimlikli bir aktör ve şemalı bileşenleri.
2. **Şema kaydı tek doğru kaynak.** Bir bileşen ya da asset türü şemasını bir
   kez tanımlar. Yükleme, kayıt doğrulaması, varsayılanlar, Details formu,
   undo ve sürüm geçişi bu şemadan türer.
3. **Her şeyin baştan kalıcı kimliği (GUID) var;** referanslar kimlikle kurulur.
4. **Dikey özellik modülleri.** Bir özellik tek klasördür (şema / runtime /
   render / editör) ve çekirdeğe kayıt noktalarından bağlanır. Kabuk dosyası
   büyümez.
5. **Tek sahne kurma yolu.** Editör viewport'u, editör Play'i ve bağımsız oyun
   aynı kurucuyu kullanır.
6. **Katman sınırları derleyiciyle zorlanır** (TypeScript proje referansları +
   AST denetimi), regex taramasıyla değil.
7. **İşlemsel kayıt servisi:** sürümlü kirli takibi, sıralı ve atomik çok dosyalı
   kayıt, temel sürüm çakışma kontrolü.
8. **Genel SDK.** Oyun projeleri motorun yalnız `@forge/sdk` yüzeyini import
   eder; oyun çatısı (game mode, kamera, araç girişi…) motorun parçasıdır.
9. **Motor deposunda "kendi oyunu" yok.** Örnekler dış proje biçimindedir;
   testler değişmez fixture projeleri kullanır.
10. **Açık dünya ve akış baştan temel model.** Level = kalıcı katman + hücreler;
    editör de akışla çalışır.

---

## 1. Yöntem ve kanıt kaynakları

- Forge `main` @ `b2efc208` kod ölçümleri (satır sayıları, import grafiği,
  özellik başına dosya dağılımı).
- Git geçmişi: 1.302 commit, mesaj temalarına göre kaba sınıflandırma.
- `Forge-Archive`'deki düzeltici planlar: `FORGE_RUNTIME_EDITOR_PARITY_PLAN`,
  `CHARACTER_CAPSULE_SOURCE_OF_TRUTH_PLAN`, `STATIC_SKELETAL_MESH_COMPONENT_SPLIT_PLAN`,
  `EDITOR_UI_SLICING_PLAN`, `ENGINE_TESTS_SPLIT_PLAN`, `FORGE_RELIABILITY_ACTIVE_PLAN`.
- [Kapsamlı inceleme, 2026-10-21](../reports/FORGE_KAPSAMLI_INCELEME_2026-10-21.md)
  (F01–F15).
- Ridgebound deposu (salt okunur): `tools/forge.mjs`, `tsconfig.json`,
  `src/game`, `docs/FORGE_INTEGRATION.md`.
- `CLAUDE.md`'deki kayıt / allowlist tuzakları ve oturum hafızasındaki tuzak
  notları.

Commit teması sayıları anahtar kelime eşleşmesidir; kesin değil, eğilim
göstergesidir.

---

## 2. Forge'da sonradan düzeltilen düğmeler

| # | Ne oldu | Kanıt | Kök neden |
|---|---|---|---|
| D1 | **Tanrı nesneleri** | `SceneApp` 16.379, `RuntimeSceneApp` 7.184, `EditorUi` 5.402, `tools/engine-tests.ts` 29.975 satır (~870 kontrol tek dosyada), `saveValidator.ts` 4.640, `specialActorDetails.ts` 2.397. Dilimleme planları (EDITOR_UI_SLICING, ENGINE_TESTS_SPLIT) sonradan açıldı. "split/slice/extract" geçen 110, "refactor" geçen 71 commit | Özelliklerin bağlanacağı kayıt noktası yoktu; her özellik kabuk sınıfına eklendi |
| D2 | **Özellik yatay dağılıyor** | Height Fog 8 alanda 16 dosya; Puddle Water 19, Blocking Volume 15, Cloud Layer 14 dosya (`engine/scene`, `render-three`, `world`, `src/scene`, `src/editor`, `panels`, `tools`) | Katmanlar var, özellik modülü yok |
| D3 | **Türe özel level dizileri** | `RoomLayout`'ta 23 türe özel alan: 6 tekil (sky, fog, cloud, reflection, post, WES) + 17 dizi (lights, reflectionPlanes, blockingVolumes, splines, landscapes, riverWaters, oceanWaters, characters, actors…). Bileşenli `actors[]` bunların yanında ikinci bir varlık dünyası | Unreal'ın "her şey aktör" modeli yerine her yeni tür için yeni dizi |
| D4 | **Doğrulayıcı ≠ yükleyici** | 8 ayrı kayıt allowlist yüzeyi; 20'den fazla ayrı `/__save-*` ucu; `spatiallyLoaded` 7 ayrı doğrulayıcıda elle kopyalanıyor; `validateAssetSkeletonDef` yükleyiciyi elle taklit ediyor; düşen alan ağı (`droppedFields`, Faz G) sonradan eklendi. "allowlist/validator" geçen 80 commit | Alan tanımı tek yerde değil; her katman kendi kopyasını tutuyor |
| D5 | **Kimlik sonradan** | Runtime kimliği `actor:<index>` düzenlemede yeniden numaralanıyor → `saveEntityKeys` çeviri katmanı; placement `id` / `role` sonradan; `ensureActorIds` yüklemede kimlik basıyor. Kimlik temalı 165 commit | Kalıcı GUID ilk günden yoktu |
| D6 | **Sürüm geçişi yok** | Eski `*.landscape.json` → "not supported" hatası, geçiş yolu yok; eski `MeshRenderer` geriye dönük yaşıyor; 1×1 köprü K1–K5 ile söküldü. "legacy/bridge/remove" geçen 135 commit | Şema sürümü + geçiş zinciri yoktu |
| D7 | **Editör ≠ oyun** | `FORGE_RUNTIME_EDITOR_PARITY_PLAN`: landscape RTS Play'de görünmedi, materyal değişikliği oyuna yansımadı, VFX için ayrı entegrasyon gerekti; çözüm her seferinde oyun uygulamasına ek kod | Sahne iki ayrı yoldan kuruluyordu |
| D8 | **Çift doğru kaynak** | Kapsül ölçüsü hem `Collider` hem `CharacterMovement` içinde authored (CHARACTER_CAPSULE_SOURCE_OF_TRUTH_PLAN) | Türetilen değer ikinci kez yazılıyordu |
| D9 | **Kayıt yarışları, çok dosyalı tutarlılık** | F01: kayıt yanıtı daha yeni değişikliğin dirty işaretini siliyordu; çakışan kayıtlarda terrain özeti bayatlıyor (`terrain:repair`); hücre kaydı sıralama kuralları; JSON gövde sınırı iki kez yükseltildi | Kayıt bir işlem (transaction) olarak tasarlanmadı |
| D10 | **Açık dünya sonradan** | World Partition sonradan eklendi; editör bütün hücreleri yüklüyor; runtime'da yalnız Actor Script aktörleri akıyor, gerisi hevesle (eager) kuruluyor | Akış temel model değil, ek katmandı |
| D11 | **Bileşen taksonomisi sonradan** | `MeshRenderer` → Static / Skeletal Mesh Component ayrımı (STATIC_SKELETAL_MESH_COMPONENT_SPLIT_PLAN) | Bileşen türleri baştan Unreal'a göre ayrılmadı |
| D12 | **Shader yaması yığılması** | `onBeforeCompile` 16 dosyada; aynı materyale world mask, foliage fade, rüzgâr, AO, dent wear yamaları sırayla ekleniyor | Materyal birleştirme sözleşmesi yoktu |
| D13 | **Sınır denetimi regex'le** | F02: çok satırlı import'lar kaçtı, gerçek bir `engine → src` ihlali gizli kaldı | Denetim derleyiciye değil metin aramasına dayanıyordu |
| D14 | **Testler düzenlenebilir içeriğe bağlı** | F03: browser fixture'ları varsayılan sahneye bağlı; dev server demo layout'u kendiliğinden yazıyor; fork'un dev sunucusu aynı portta Forge rotalarına cevap verdi (smoke artık 5273'te) | Motor deposu aynı zamanda bir oyun projesiydi |
| D15 | **Motor içeriği ile proje verisi karışık** | `public/` hem motorun başlangıç içeriği hem örnek projenin verisi; kökte boş `game/` ve `project/` yer tutucuları, oyun kodu `src/game`'de | Sahiplik klasör düzeninde ifade edilmedi |
| D16 | **Asset kökeni** | F04: 876 asset'in 810'unda lisans `Unknown`; `assetType: "effect"` sonradan, eski manifestlerde ek adına göre tahmin | İçe aktarmada köken ve tür zorunlu değildi |
| D17 | **Teşhis ve dağıtım sözleşmeleri** | F06 kök URL'leri alt dizine yayını bozuyor; F09/F10 bozuk veri ve erken boot hataları kullanıcıya ulaşmıyor; takılı "loading level" ekranı aslında görünmeyen bir yükleme hatasıydı | Hata yüzeyi ve dağıtım tabanı baştan tanımlanmadı |
| D18 | **Belge ve kod ayrışıyor** | F13; `CLAUDE.md`'nin yarısı tuzak ansiklopedisi (8 allowlist yüzeyi paragrafı) | Tuzaklar tasarımla kaldırılmak yerine belgelendi |

Ortak desen: kayıt noktası, şema ve kimlik baştan tanımlanmadığı için her yeni
özellik var olan büyük dosyalara eklendi; sonra sözleşme ihtiyacı fark edilince
geriye dönük köprü, çeviri katmanı ve tuzak notu üretildi.

---

## 3. Model 2 (oyun projesi) — durum ve boşluklar

### 3.1 Belge güncel mi?

**Mekanik olarak evet.** `FORGE_GAME_PROJECT_WORKFLOW.md` P2 kapanışını
(2026-11-01) doğru anlatıyor. Anlattığı araçlar yerinde: `tools/run-game-project.mjs`,
`tools/projectPaths.ts`, `builder/web/game-project-build.mjs`,
`game-project-reproduce.mjs`, `sync-forge-to-games`. Ridgebound bu düzenle M0
oyun kurallarını ve Derekavak greybox sahnesini geliştirdi (son commit
2026-11-07).

Eskimiş küçük kısımlar:
- §2.2–2.3 yerleşim örneği hâlâ `Games/Offroad` diyor; proje Ridgebound oldu.
- §2.5 "bilinen sınırlar" (2026-10-25) tarihsel; P1-A/B/C ile kapandı.
- `tools/create-project.mjs` hâlâ yok (belge bunu doğru söylüyor).

### 3.2 İşleyişteki yapısal boşluklar

1. **Genel API yok.** Ridgebound'un 926 satırlık oyun kodu Forge'dan 19 ayrı iç
   modül import ediyor: `@/scene/capabilities/runtimeServiceKeys`,
   `RuntimeContext`, `ForgeGameModule`, `@engine/scene/entity`,
   `@engine/persistence/saveGameState`… Forge'da yapılan bir yeniden
   düzenleme, Forge'un kapılarından geçip oyunu kırabilir.
2. **Oyun çatısı yanlış yerde.** Forge'un `src/game` klasörü (29 dosya, 5.189
   satır) aslında yeniden kullanılabilir oyun çatısı: TPS karakter modu, araç
   modu, araç girişi, RTS kamerası, oyuncu kamera yöneticisi, spring arm,
   ragdoll, player controller. Ridgebound bunlardan 7'sini kütüphane gibi
   import ediyor. "Fork başına oyun kodu" diye ayrılan yer fiilen motor kodu.
3. **Uyumluluk kapısı yok.** `build:verify` ve CI Ridgebound'u derlemiyor.
   Kırılma ancak oyun açıldığında görülüyor.
4. **Kaynak haritası ihtiyacı.** Ridgebound'un `FORGE_INTEGRATION.md`'si ajan
   için Forge'un iç dosya yollarını listeliyor. Tanımlı bir SDK olmadığı için
   gerekli; ama her Forge yeniden düzenlemesinde bayatlıyor.
5. **Sabit bağlantı yolu.** Başlatıcı `FORGE_ROOT` / `forge.local.json`
   destekliyor, ama Ridgebound'un `tsconfig.json`'u `../../Forge/tsconfig.json`
   yolunu sabit kodluyor.
6. **Oyun kendi tipli verisini tanımlayamıyor.** Görev kaydı gibi oyuna özel
   durum, şemalı bir bileşen olarak değil genel `ScriptState.persist` →
   `flags` alanında taşınıyor; kayıt doğrulayıcısı Forge'un `tools/` klasöründe
   ve oyun şemasını bilmiyor.

Model 2'nin özü doğru: tek canlı motor kaynağı, oyunda motor kopyası yok, motor
değişikliği motor deposunda. Yeni projede eksik olan, bu özün **sözleşmeye
bağlanması**: SDK, oyun çatısının motora alınması, oyunun kendi şemalarını
kaydedebilmesi ve uyumluluk kapısı (§4.8).

---

## 4. Önerilen mimari

### 4.1 Üç eksen

- **Katmanlar (yatay):** kim kimi import edebilir (§4.2).
- **Özellik modülleri (dikey):** bir özelliğin bütün parçaları tek klasörde
  (§4.3).
- **Sözleşmeler:** veri modeli (§4.4), şema kaydı (§4.5), kayıt servisi (§4.6),
  SDK (§4.8).

### 4.2 Katmanlar ve bağımlılık kuralı

| Katman | İçerik | Import edebileceği | three |
|---|---|---|---|
| `core` | aktör/bileşen modeli, şema kaydı, serileştirme, kimlik, olaylar, özellik kayıt noktaları | — | yok |
| `engine` | fizik (Rapier), terrain verisi, World Partition, AI, nav, hareket, ses, kalıcılık, World Builder algoritmaları | core | yok |
| `render` | WebGPU renderer, render bağlamaları, materyaller, pipeline, teşhis | core, engine | **tek sahip** (`three/webgpu`, `three/tsl`) |
| `runtime` | World, sahne kurucu, alt sistem ana makinesi, oyun modülü ana makinesi, boot | core, engine, render | dolaylı |
| `gameplay` | oyun çatısı: game mode tabanları, player controller, kamera yöneticisi, araç girişi, ragdoll (bugünkü `src/game`'in çoğu) | core, engine, runtime | yok |
| `editor` | editör uygulaması; yalnız dinamik import; oyun bundle'ına girmez | hepsi | dolaylı |
| `sdk`, `editor-sdk` | oyun projelerinin import edebildiği tek yüzey (yeniden dışa aktarım) | ilgili katmanlar | — |
| `tools` (Node) | dev server, kayıt uçları, build, World Builder CLI, içe aktarıcı | core, engine | yok |

**Zorlama:** her katman ayrı bir TypeScript projesi (`composite`, `references`
yalnız izin verilen katmanlara). `tsc -b` izinsiz import'ta derleme hatası verir;
regex taraması yok (D13). Klasör içi ince kurallar (ör. bir özelliğin `schema.ts`
dosyası three import edemez) AST tabanlı bir denetimle (dependency-cruiser)
ölçülür.

Tek npm paketi, katmanlar klasör. npm workspaces / ayrı paket yayını yok
(Model 2'nin "motor paket release sistemi kapsam dışı" kararıyla uyumlu).

### 4.3 Dikey özellik modülü

```text
features/height-fog/
  schema.ts     # bileşen şeması — three'siz, Node'da da yüklenir
  runtime.ts    # alt sistem / capability — three'siz
  render.ts     # render bağlaması — three/webgpu yalnız burada
  editor.ts     # özel araç veya Details (yoksa şemadan otomatik)
  feature.ts    # defineFeature({ components, subsystems, render, editor, addActor })
  height-fog.test.ts
  README.md     # 5–10 satır: amaç, şema, kayıt noktaları
```

Çekirdek kabuk yalnız kayıt noktaları sunar: `registerComponent`,
`registerSubsystem`, `registerRenderBinding`, `registerAssetType`,
`registerEditorMode`, `registerDetails`, `registerAddActorEntry`.

- **Hedef:** yeni bir özellik = bir klasör, 4–6 dosya, kabukta sıfır değişiklik.
  Bugün Height Fog: 8 alanda 16 dosya (D2).
- Dosya boyutu bütçesi: 800 satırda uyarı, 1.500'de kapı (üretilmiş dosyalar
  hariç). Tanrı nesnesinin geri büyümesini erken yakalar (D1).
- Oyunlar aynı API ile kendi özelliklerini oyun deposunda tanımlar (§4.8).

### 4.4 Veri modeli: tek tip aktör + bileşen

```jsonc
{
  "schema": "forge.level/1",
  "id": "lvl_7f3c…",
  "actors": [
    {
      "id": "act_91ab…",            // kalıcı GUID
      "name": "Exponential Height Fog",
      "class": null,                 // ya da bir aktör sınıfı asset'inin GUID'i
      "parent": null,
      "transform": { "p": [0, 0, 0], "r": [0, 0, 0, 1], "s": [1, 1, 1] },
      "components": {
        "fog": { "type": "forge.heightFog@1", "density": 0.02, "falloff": 0.2 }
      }
    }
  ]
}
```

- Işık, su, landscape, spline, blocking volume, ortam tekilleri: hepsi aktör.
  Tekillik (level başına bir WES gibi) şemada bir bayrakla ifade edilir.
- Aktör sınıfları (bugünkü `*.actor.json`) prefab'dır: level'daki aktör sınıfa
  GUID ile bağlanır ve yalnız farkları (override) taşır; override kuralı şemada
  tanımlıdır.
- Statik mesh yerleşimi de bir aktördür. Instancing veri türü değil, render
  katmanının otomatik toplu çizimidir. Toplu yerleşim için instanced static mesh
  bileşeni vardır; foliage kompakt örnek dizileri olarak hücre dosyalarında
  kalır.
- Büyük ikili veri (terrain tile, global harita, foliage örnekleri) GUID'li
  asset sidecar'larında, ikili kanalla taşınır.
- Level = kalıcı katman + hücreler. Hücre ataması aktörün konumundan türetilir;
  "akışa katılmaz" bayrağı temel aktör şemasında **bir kez** tanımlanır (D10,
  D4).

### 4.5 Şema kaydı — tek doğru kaynak

Her bileşen ve asset türü şemasını bir kez tanımlar:

```ts
export const HeightFog = defineComponent("forge.heightFog", 1, {
  density: num({ min: 0, max: 1, default: 0.02, ui: "slider" }),
  falloff: num({ min: 0, max: 5, default: 0.2 }),
  color:   color({ default: "#b8c4d6" }),
});
```

Bu tek tanımdan türeyenler:
- TypeScript tipi,
- yüklemede normalize (bilinmeyen alan raporlanır),
- kayıtta doğrulama (aynı fonksiyon; ayrı allowlist yok — D4),
- varsayılanlar,
- sürüm geçiş zinciri (`v1 → v2` fonksiyonları; D6),
- Details formu (parametre UI kuralları: kaydırıcı + kutu, min/max, TR ipucu /
  EN ad),
- undo farkı ve serileştirme turu testleri (otomatik).

Dev server (Node) aynı şemaları yükler; bu yüzden şema dosyaları three'siz
olmak zorundadır. Oyun projesinin kaydettiği şemalar da yüklenir. Geliştirmede
düşen alan uyarı değil, **hatadır**.

### 4.6 Kimlik, referans ve kayıt servisi

- Her aktör, bileşen örneği ve asset için kalıcı GUID; runtime'da doğan
  aktörler de GUID alır. Kayıt oyunu (save-game) anahtarları GUID'dir; indeks
  çevirisi yok (D5).
- **İşlem (transaction):** editördeki her düzenleme bir işlem; undo birimi ve
  kirli dosya kümesi bundan türer.
- **Sıralı, atomik kayıt:** yeni içerik geçici dosyalara yazılır → doğrulanır →
  dizin dosyası en son ve atomik yeniden adlandırmayla değişir. Kısmi hatada eski
  dizin geçerli kalır (D9).
- **İyimser eşzamanlılık:** her dosyanın bir revizyonu (hash) var; kayıt temel
  revizyonu gönderir, uyuşmazlıkta 409 ve editörde yeniden yükle / karşılaştır.
- **Genel uçlar:** tür başına uç yerine şemaya göre çalışan tek uç ailesi
  (`/__forge/save`, `/__forge/save-binary`); boyut sınırı ikili kanalda sorun
  olmaz.
- Yükleme her zaman geçiş zincirini çalıştırır; kayıt her zaman son şemayı yazar.

### 4.7 Uygulama kabuğu (SceneApp / RuntimeSceneApp yerine)

- **World:** runtime durumu (aktörler + alt sistemler). Unreal'daki `UWorld`
  karşılığı.
- **Sahne kurucu (LevelAssembler):** level verisi → World. Editör viewport'u,
  editör Play'i ve bağımsız oyun **aynı** kurucuyu kullanır; editör yalnız üstüne
  araç katmanı ekler (D7).
- **Alt sistemler:** açık yaşam döngüsü (init → beginPlay → tick grupları:
  fizik öncesi / fizik / fizik sonrası / render senkronu → endPlay → dispose).
  Authored ve runtime'da doğan aktörler aynı yaşam döngüsünden geçer (F11).
  Bugünkü capability modülleri ve tipli servis anahtarları bu yapının temelidir.
- **Render senkronu:** oynanış kodu three nesnelerine dokunmaz; render katmanı
  bileşenleri render bağlamalarıyla izler. "engine three'siz" kuralı böylece
  kalıcı olur.
- **Editör oturumu:** küçük servislerin bileşimi: SelectionService,
  TransactionService (undo), ViewportService (kamera, picking, gizmo),
  AssetService, SaveService, ModeManager (landscape / foliage / paint modları
  birer özellik), PanelHost (Outliner / Details / Content). Her servis dosya
  bütçesine tabi.
- **Oyun uygulaması:** boot + World + GameModuleHost + UI; boot hataları
  renderer kurulmadan önce de gösterilir (F10).
- **Editör Play:** v1'de bugünkü gibi yeni sekme (karar A6). Tek kurucu, editör
  ile oyun eşdeğerliğini zaten garanti ediyor.

### 4.8 Oyun projesi modeli (Model 2, ikinci sürüm)

- **Motor ev sahibi kalır.** Oyun projesi = manifest + içerik + oyun modülü +
  isteğe bağlı oyun özellikleri. Oyunda motor kopyası yok; motor değişikliği
  motor deposunda (Model 2'nin özü korunur).
- **SDK:** oyun yalnız `@forge/sdk` (runtime, oyun çatısı, şema tanımlama,
  kayıt oyunu, input, UI bağlama) ve editör uzantıları için `@forge/editor-sdk`
  import eder. Başlatıcının `check` komutu bu sınırı oyun deposunda da zorlar
  (§3.2-1).
- **Oyun çatısı motorda:** bugünkü `src/game` içeriğinin yeniden kullanılabilir
  kısmı `gameplay` katmanına taşınır; oyun bunları genişletir (§3.2-2).
- **Oyun özellikleri:** oyun, motorla aynı `defineFeature` / `defineComponent`
  API'siyle kendi bileşenlerini tanımlar; dev server bunları yükleyip doğrular.
  Görev ve kargo gibi veriler tipli ve doğrulanmış olur (§3.2-6).
- **Uyumluluk kapısı:** motor deposunda `npm run check:projects`: yerelde kayıtlı
  oyun projelerini (git dışı `forge.projects.local.json`) mevcut motora karşı
  derler ve başsız açar; motor push'undan önce çalışır. CI'da `samples/`
  sözleşme testi görevi görür (§3.2-3).
- **SDK sürümü:** `sdk/CHANGELOG.md` + manifestte `sdkVersion`; kırıcı
  değişiklik changelog'a yazılır, mümkünse bir tur kullanımdan kaldırma
  (deprecate) ile geçilir.
- **Bağlantı:** başlatıcı oyunun TypeScript ayarlarını çözülmüş motor kökünden
  üretir; sabit `../../Forge` yolu yok (§3.2-5).
- **Motor deposunda oyun yok:** `samples/` altında dış proje biçiminde örnekler
  (starter, test-range, open-world); motorun kendi içeriği `content/engine/`;
  testler `tests/fixtures/projects/` altındaki değişmez projelerle (D14, D15).
- **Dev server kimliği:** her proje kendi portunda; sunucu `/__forge/identity`
  ile hangi projeyi sunduğunu söyler, smoke testleri bunu doğrular (D14).
- **Proje oluşturma:** `create-project` aracı `samples/starter`'dan yeni oyun
  deposu üretir (Model 2'nin açık kalan boşluğu).
- Model 1 oyunları Forge WebGL'de kalır.

### 4.9 Render mimarisi (özet)

Ayrıntı yeniden inşa planında (§2.3–2.6); burada yalnız mimari kararlar:

- **Materyal bileşimi:** Forge materyali = temel graf + özelliklerin katkıları
  (rüzgâr, fade, world mask, ıslaklık, göçük) tanımlı sırayla TSL düğüm
  fonksiyonları olarak birleşir. `onBeforeCompile` yaması yığılması yok (D12).
- Işık alan yüzeyler standart node materyal slotlarında (MRT sözleşmesi), tek
  `RenderPipeline`, kalite profilleri, gerçek backend doğrulaması, GPU
  timestamp, addon'lar kendi sarmalayıcılarımızın arkasında.

### 4.10 Kalite altyapısı

- **Test koşucusu:** Vitest; testler modülün yanında, merkezi kayıt dosyası yok
  (D1: `engine-tests.ts` 29.975 satır). Yavaş testler dosya adıyla
  (`*.slow.test.ts`) ayrılır; bugünkü `--filter` / `--slow` alışkanlığı korunur.
- **Fixture'lar değişmez**; smoke testleri örnek projelere yazmaz (D14).
- **CI:** `tsc -b`, birim testleri, build, dist doğrulaması (editör sızıntısı),
  boyut / performans bütçeleri kapı olarak (F07). CI'da GPU yok: UI ve veri akışı
  smoke'ları açıkça etiketli `forceWebGL` test kipiyle çalışır (TSL WebGL2
  backend'inde de çalışır); render kabulü yerelde, gerçek GPU'da. Bu kip hiçbir
  zaman "WebGPU çalışıyor" sayılmaz.
- **Dağıtım tabanı:** bütün URL'ler `base`'e göre; alt dizin yayını ilk günden
  test edilir (F06).
- **Asset kökeni:** içe aktarmada tür + lisans + kaynak zorunlu; CI'da kapı
  (D16).
- **Hata yüzeyi:** şema / yükleme hataları editörde görünür; boot hata ekranı
  renderer'dan bağımsız (D17).
- **Belgeler:** `ARCHITECTURE.md` sözleşmedir ve kodla aynı commit'te güncellenir.
  `CLAUDE.md` kısa kurallar içerir; bir tuzak not edilecek hâle geldiyse önce
  tasarımla kaldırılması düşünülür (D18).

### 4.11 Ajanlarla çalışma düzeni

- **Özellik "bitti" tanımı:** şema + runtime + render bağlaması + editör yüzeyi
  (otomatik ya da özel) + kayıt turu testi + özellik README'si.
- Özellik README'leri, Ridgebound'daki `FORGE_INTEGRATION.md` gibi elle tutulan
  kaynak haritalarının yerini alır; SDK yüzeyi + README'ler ajanın girişidir.
- Paralel oturum kuralı sürer: yol sınırlı commit (`git commit -- <yollar>`).

---

## 5. Korunacak iyi tasarımlar

- three'siz motor sınırı (`engine/` ~70.000 satır bunu kanıtladı).
- `ForgeGameModule` yaşam döngüsü ve hatalı modülü karantinaya alma.
- Capability modülleri (22) ve tipli servis anahtarları (40).
- Düşen alan güvenlik ağı fikri (artık şemanın doğal parçası).
- World Builder'ın deterministik üretimi, CLI'ı ve istek allowlist'i.
- Model 2 başlatıcısı, proje kökü izolasyonu (SP-05/06), yeniden üretilebilir
  build kaydı (`build-record.json`, `verify:build`).
- Undo / redo komut modeli (artık şema farklarından otomatik).
- `verify:dist` editör sızıntı kapısı, `?debug` performans araçları, spike
  düzeni.

---

## 6. Yeniden inşa planına etkisi

Bu rapor [yeniden inşa planının](FORGE_WEBGPU_REBUILD_PLAN.md) iki önerisini
değiştirir:

1. **Veri formatı aynı kalmaz (eski K3).** Yeni tek tip format (§4.4) + Forge
   WebGL level'larını ve sidecar'larını bir kez çeviren tek yönlü içe aktarıcı
   (`tools/import-forge-webgl`). Referans level'lar, World Builder dünyaları ve
   Ridgebound içeriği bununla gelir. Forge WebGL'in normalizer'ları iyi
   tanımlandığı için çeviri izlenebilir bir iştir. Geriye uyumluluk (iki formatı
   birlikte yaşatmak) hedeflenmez.
2. **"Önce taşı, sonra iyileştir" daralır.** Algoritmalar olduğu gibi taşınır
   (fizik, terrain verisi, AI, nav, hareket, ses, diyalog, World Builder
   algoritmaları). Veri modeli, serileştirme, kayıt, uygulama kabuğu ve editör
   bu rapora göre yeniden tasarlanır. Cut-over fazı ikiye bölünür: **2a mimari
   iskelet**, **2b alt sistemlerin taşınması + içe aktarıcı**.

---

## 7. Riskler

| Risk | Önlem |
|---|---|
| Şema DSL'i gereğinden büyür | 2a'da yalnız bugün kullanılan alan türleri (sayı, bool, enum, renk, vektör, asset ref, aktör ref, dizi, nesne); yenisi ihtiyaç olunca |
| Tek tip modelde performans (binlerce aktör) | Instancing render katmanında otomatik; foliage kompakt dizi; Faz 1 S4 ölçümü + 2a'da 50.000 aktörlük yükleme / kayıt ölçümü |
| SDK'yı erken dondurmak | v0 süresince SDK değişebilir; changelog zorunlu, uyumluluk kapısı kırılmayı hemen gösterir |
| İçe aktarıcı her eski alanı taşıyamaz | Taşınamayan alan sessiz düşmez, rapor edilir; Ridgebound içeriği kopya üzerinde denenir |
| Mimari iskelet uzar, görsel değer gecikir | Faz 1 spike'ı iskeletten bağımsız ve önce; 2a dar kapsamlı, ilk özellik (Height Fog) iskeletin kabul testi |

---

## 8. Kararlar

| ID | Konu | Öneri | Durum |
|---|---|---|---|
| A1 | Level veri modeli | Tek tip aktör + bileşen (§4.4) + tek yönlü içe aktarıcı | Açık |
| A2 | Şema tanımı | Kendi ince DSL'imiz (UI metadata, geçiş zinciri ve Node yüklemesi için); doğrulama kütüphanesi (Zod / Valibot) yok | Açık |
| A3 | Katman zorlaması | TypeScript proje referansları + dependency-cruiser | Açık |
| A4 | Depo yapısı | Tek npm paketi, katmanlar klasör; workspaces yok | Açık |
| A5 | Test koşucusu | Vitest, testler modülün yanında | Açık |
| A6 | Editör Play | v1'de yeni sekme; aynı sayfada Play (PIE) sonra ayrı karar | Açık |
| A7 | Oyuna özel veri | Oyunun kendi şemalı bileşenleri; `flags` yalnız serbest durum için | Açık |
| A8 | Oyun–motor sözleşmesi | `@forge/sdk` + `@forge/editor-sdk`, `sdkVersion` + changelog, yerel `check:projects` kapısı | Açık |
| A9 | Depo düzeni | `samples/` dış proje biçiminde, `content/engine/`, `tests/fixtures/projects/`; motor deposunda oyun yok | Açık |
