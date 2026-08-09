# Forge Editor → Oyun Runtime Paritesi
## Yeni Oyun Projeleri İçin Teknik Dönüşüm Planı

**Durum:** Planlanan altyapı çalışması  
**Hedef depo:** Orijinal Forge Editor / Forge Engine projesi  
**Amaç:** Forge Editor'da oluşturulan bir Level'ın, yeni bir oyun projesinde ek sahne entegrasyonu gerektirmeden aynı şekilde çalışması  
**Referans proje:** Sınır Krallıkları RTS projesinde edinilen deneyimler  
**Öncelik:** Yeni oyunlara başlamadan önce tamamlanması önerilir

---

## 1. Problem

Sınır Krallıkları geliştirilirken Forge Editor'da mevcut olan bazı genel sahne özellikleri oyun runtime'ında otomatik olarak çalışmadı.

Yaşanan örnekler:

- Editor'da Landscape oluşturuldu ancak RTS Play modunda görünmedi.
- Bir modelin Material'ı değiştirildi ancak oyun sahnesinde aynı değişiklik görünmedi.
- Lighting ve render ayarları Editor ile oyun runtime'ı arasında aynı davranmadı.
- Forge'da VFX özelliği bulunduğu halde RTS tarafında ayrıca entegrasyon gerekti.
- Benzer durumlarda çözüm, özelliğin `RtsApp` veya RTS runtime tarafına ayrıca eklenmesi oldu.

Bu yaklaşım tek proje için çözülebilir olsa da Forge'un tekrar kullanılabilir oyun geliştirme altyapısı olma amacına uygun değildir.

Yeni bir oyun başlatıldığında şu durum tekrar yaşanmamalıdır:

> "Bu özellik Forge Editor'da var, fakat GameApp tarafında karşılığı yok."

---

## 2. Ana Hedef

Forge'da **Editor tarafından kaydedilebilen ve Editor Play modunda çalışan genel bir sahne özelliği**, yeni bir oyun projesinde ayrıca GameApp desteği yazılmadan standalone oyun runtime'ında da çalışmalıdır.

Temel kural:

> **Editor Scene ile Game Scene iki farklı sahne oluşturma yolu olmamalıdır.**

İdeal akış:

```text
Forge Editor
    │
    │ Save
    ▼
Canonical Level Document
    │
    ▼
Forge Runtime / Level Runtime
    │
    ├── Landscape
    ├── Static Mesh / Model
    ├── Material
    ├── Light
    ├── Render / Environment Settings
    ├── VFX
    ├── Actor / Components
    ├── Collision
    ├── Animation
    └── diğer genel Forge özellikleri
    │
    ▼
GameApp
    │
    └── yalnız oyun kurallarını ekler
        AI / Combat / Economy / UI / Objectives / vb.
```

---

## 3. Mimari İlke

### Forge'un sorumluluğu

Forge aşağıdaki genel yeteneklerin sahibi olmalıdır:

- Level yükleme
- Scene oluşturma
- Entity / Actor oluşturma
- Transform
- Model / Static Mesh
- Material
- Texture
- Landscape / Terrain
- Lighting
- Shadow
- Environment
- Render settings
- VFX
- Animation
- Collision
- Camera'nın genel altyapısı
- Audio'nun genel altyapısı
- Genel component lifecycle
- Asset loading
- Serialization / deserialization

### GameApp'in sorumluluğu

GameApp yalnız oyuna özgü davranışları eklemelidir.

Örnek:

```text
Forge bilir:
- Mesh nedir?
- Material nasıl uygulanır?
- Landscape nasıl yüklenir?
- VFX nasıl oynatılır?
- Light nasıl oluşturulur?

Sınır Krallıkları bilir:
- Kışla ne üretir?
- Muhafız nasıl saldırır?
- AI ne zaman genişler?
- Yol ekonomiye nasıl bağlanır?
- Zafer koşulu nedir?
```

GameApp'in görevi Forge sahnesini yeniden oluşturmak değildir.

---

## 4. Hedef Runtime Yapısı

Dosya isimleri mevcut Forge deposu incelendikten sonra netleştirilebilir. Buradaki isimler mimari rolleri ifade eder.

Önerilen yapı:

```text
src/
  engine/
    ...

  runtime/
    ForgeRuntime.ts
    LevelRuntime.ts
    RuntimeContext.ts
    RuntimeRegistry.ts
    RuntimeComponentFactory.ts

  scene/
    SceneApp.ts

  editor/
    ...

  game/
    GameApp.ts
```

Temel ilişki:

```text
              Level JSON
                  │
                  ▼
          +----------------+
          |  LevelRuntime  |
          +----------------+
                  │
                  ▼
          +----------------+
          |  ForgeRuntime  |
          +----------------+
             │          │
             │          └── Forge systems
             │
             ▼
        Runtime Scene
             │
             ▼
          GameApp
       gameplay hooks
```

`SceneApp` mevcut mimaride tutulabilir. Ancak SceneApp, Editor Play ve Game Play için farklı sahne oluşturma mantığı içermemelidir.

En önemli hedef:

```text
Editor Play ─┐
             ├── aynı LevelRuntime / aynı loader / aynı factories
Game Play ───┘
```

---

# 5. Çalışma Fazları

## Faz 0 — Mevcut Mimari Denetimi

Codex önce kod değiştirmeden mevcut sistemi haritalamalıdır.

Araştırılacaklar:

- Editor Play modu Level'ı nasıl yüklüyor?
- `SceneApp` tam olarak ne oluşturuyor?
- Oyun runtime'ı Level'ı nasıl yüklüyor?
- Editor ve oyun için ayrı scene-construction yolları var mı?
- Landscape hangi loader/factory üzerinden oluşturuluyor?
- Material override nerede uygulanıyor?
- Light ve render/environment ayarları nerede okunuyor?
- VFX Editor verisi runtime'da hangi sınıfa dönüşüyor?
- Actor/component oluşturma sistemi nasıl çalışıyor?
- Serialization şeması nerede?
- Save validator hangi alanları allowlist ile filtreliyor?
- Editor'da çalışıp standalone runtime'da kullanılmayan diğer özellikler var mı?

### Faz 0 çıktısı

Codex kısa bir rapor oluşturmalı:

```text
docs/runtime-parity/AUDIT.md
```

Her özellik için:

| Capability | Editor Authoring | Saved | Editor Play | Game Runtime | Durum |
|---|---|---|---|---|---|
| Landscape | ✓ | ✓ | ✓ | ? | |
| Material override | ✓ | ✓ | ✓ | ? | |
| Lighting | ✓ | ✓ | ✓ | ? | |
| Render settings | ✓ | ✓ | ✓ | ? | |
| VFX | ✓ | ✓ | ✓ | ? | |
| Actor | ✓ | ✓ | ✓ | ? | |
| Collision | ✓ | ✓ | ✓ | ? | |
| Animation | ✓ | ✓ | ✓ | ? | |

Amaç tahmin etmek değil, gerçek kod yolunu bulmaktır.

---

## Faz 1 — Runtime Parity Contract

Kod değişikliğinden önce Forge için açık bir sözleşme tanımlanmalıdır.

### Zorunlu sözleşme

Bir Forge capability aşağıdaki zincirin tamamını destekliyorsa "runtime-ready" kabul edilir:

```text
Editor
  ↓
Serialization
  ↓
Level Document
  ↓
Runtime Loader
  ↓
Runtime Object / Component
  ↓
Play
```

Bir özellik yalnız Editor paneline sahipse tamamlanmış Forge capability sayılmaz.

### Temel invariant

```text
A level saved by Forge Editor must not require
project-specific scene reconstruction code
to reproduce its generic Forge content at runtime.
```

Bu invariant hem dokümana hem testlere eklenmelidir.

---

## Faz 2 — Tek Canonical Level Loader

Editor Play ile standalone Game Play'in kullandığı Level yükleme yolu birleştirilmelidir.

Hedef API örneği:

```ts
const runtime = new ForgeRuntime(...);

await runtime.loadLevel("levels/main.level.json");
runtime.start();
```

GameApp:

```ts
const runtime = await createForgeRuntime(...);

await runtime.loadLevel(gameConfig.startLevel);

const game = new GameApp(runtime);
game.start();
```

### Yapılmaması gereken

```ts
// GameApp içinde:
createGround();
createLights();
applyMaterials();
loadLandscape();
createVfx();
```

Bunlar Level tarafından tanımlanıyorsa GameApp içinde tekrar kurulmayacaktır.

---

## Faz 3 — Runtime Registry / Factory Sistemi

Level dosyasındaki genel içerikler merkezi bir registry/factory sistemiyle instantiate edilmelidir.

Örnek fikir:

```ts
runtimeRegistry.register("staticMesh", createStaticMeshRuntime);
runtimeRegistry.register("landscape", createLandscapeRuntime);
runtimeRegistry.register("light", createLightRuntime);
runtimeRegistry.register("vfx", createVfxRuntime);
runtimeRegistry.register("actor", createActorRuntime);
```

Böylece yeni bir Forge capability eklendiğinde:

1. Editor authoring
2. Serialization
3. Runtime factory

tamamlanır.

Her oyun için ayrı entegrasyon yapılmaz.

### Kritik kural

Yeni bir Forge özelliği eklenirken:

> "Bunu RtsApp / GameApp'e de ekleyelim."

varsayılan çözüm olmamalıdır.

Doğru soru:

> "Bu capability canonical LevelRuntime tarafından neden instantiate edilmiyor?"

---

## Faz 4 — SceneApp Rolünü Netleştirme

`SceneApp` incelenmeli ve görevi açıkça sınırlandırılmalıdır.

Tercih edilen rol:

- Three.js renderer/scene/camera lifecycle host
- LevelRuntime'ın çalışacağı genel sahne kabuğu
- Editor ve Game tarafından ortak kullanılabilir altyapı

SceneApp şunları bilmemelidir:

- RTS ekonomisi
- RTS birimleri
- belirli bir oyunun bina sistemi
- oyun-özel AI
- oyun-özel victory logic

GameApp ise SceneApp'in yaptığı genel sahne kurulumunu kopyalamamalıdır.

---

## Faz 5 — Game Extension API

Yeni oyunların Forge'a bağlanması için küçük ve stabil bir extension API oluşturulmalıdır.

Örnek:

```ts
interface ForgeGameModule {
  register(runtime: ForgeRuntime): void;
  onLevelLoaded?(ctx: RuntimeContext): void;
  start?(): void;
  update?(dt: number): void;
  dispose?(): void;
}
```

Yeni oyun:

```ts
const runtime = await ForgeRuntime.create(config);

runtime.use(new MyGameModule());

await runtime.loadLevel("main.level.json");
runtime.start();
```

Game module genel Forge nesnelerini tekrar oluşturmaz.

Yalnız gameplay davranışı ekler.

---

# 6. Öncelikli Parite Alanları

Sınır Krallıkları sırasında gerçek sorun oluşturdukları için aşağıdaki alanlar ilk sırada doğrulanmalıdır.

## 6.1 Landscape

Kontrol:

- Landscape Editor'da oluşturulabiliyor mu?
- Bütün gerekli veri Level'a kaydediliyor mu?
- Standalone runtime aynı Landscape'i instantiate ediyor mu?
- Material / texture / transform bilgisi korunuyor mu?

Kabul:

> Landscape içeren bir Level, boş bir GameApp ile açıldığında ekstra kod yazılmadan görünmelidir.

---

## 6.2 Material

Kontrol:

- Model üzerinde yapılan material assignment / override kaydediliyor mu?
- Level yüklenirken aynı material uygulanıyor mu?
- Actor ve Static Mesh aynı material resolution sistemini kullanıyor mu?

Kabul:

> Editor'da bir modelin materyali değiştirildiğinde Game Play'de aynı materyal görünmelidir.

---

## 6.3 Lighting ve Render

Kontrol:

- Directional / ambient / diğer desteklenen ışıklar
- intensity
- color
- shadow ayarları
- environment
- tone mapping / exposure veya Forge'un desteklediği eşdeğer render ayarları

Level veya project settings içinde tanımlanan değerler standalone runtime tarafından okunmalıdır.

Kabul:

> GameApp hiçbir light oluşturmadan Level'ın ışık ve render görünümü yüklenmelidir.

---

## 6.4 VFX

Kontrol:

```text
VFX Editor
→ VFX asset
→ serialization/reference
→ runtime loader
→ runtime VFX component/system
```

Kabul:

> Level'a yerleştirilmiş genel bir VFX, yeni oyun projesinde ayrıca `GameVfxSystem` yazılmadan görünmelidir.

Gameplay tarafından tetiklenen VFX için oyun yalnız olay/asset bağlantısını yapabilir:

```text
game event
→ Forge VFX API
```

VFX motorunu yeniden implement etmez.

---

# 7. Serialization Güvenliği

Sınır Krallıkları deneyiminde yeni layout/environment alanlarının save validator allowlist'i nedeniyle kaybolabilme riski bulunuyordu.

Bu nedenle Codex şunları denetlemelidir:

- Yeni Forge alanlarının serialization schema'da bulunması
- Save validator'ın schema ile senkron olması
- Bilinmeyen / desteklenmeyen alanların sessizce silinmemesi
- Runtime'ın desteklemediği alan için açık hata veya warning üretmesi

### Tercih edilen davranış

Yanlış:

```text
Editor kaydeder
→ alan sessizce düşer
→ oyunda görünmez
```

Doğru:

```text
Unsupported runtime capability: landscape.foo
Level: main.level.json
Entity: Landscape_01
```

Sessiz fallback minimuma indirilmelidir.

---

# 8. Parity Test Level

Forge deposuna özel bir test Level'ı eklenmelidir.

Önerilen ad:

```text
RuntimeParity.level.json
```

İçeriği:

- Landscape
- 2 Static Mesh
- iki farklı Material
- en az bir material override
- Directional Light
- desteklenen environment/render ayarları
- gölge alan bir obje
- VFX
- collision içeren Actor
- animated Actor veya animation-capable obje
- basit camera başlangıç noktası

Bu Level, Forge'un gelecekteki regression test sahnesi olacaktır.

---

# 9. Zorunlu Otomatik Testler

## Test A — Serialization

```text
Editor data
→ save
→ load
→ semantic equality
```

Özellikle:

- landscape
- materials
- lights
- environment
- VFX references

kontrol edilmelidir.

## Test B — Runtime Instantiation

RuntimeParity Level yüklendiğinde beklenen runtime nesnelerinin oluştuğu doğrulanmalıdır.

Örnek:

```text
1 Landscape
2 Static Mesh
1 Directional Light
1 VFX instance
...
```

## Test C — Editor Play / Game Play Paritesi

Aynı Level:

```text
Editor Play
Game Runtime
```

üzerinden açılır.

Her iki yolun aynı canonical loader'ı kullandığı test edilmelidir.

## Test D — Browser Smoke

Playwright veya mevcut browser test sistemiyle:

- Level açılıyor
- render loop çalışıyor
- kritik runtime exception yok
- Landscape mevcut
- Light mevcut
- VFX instantiate edilmiş

kontrol edilmelidir.

---

# 10. Yeni Oyun Starter Template

Bu çalışmanın en önemli çıktılarından biri yeni oyun başlangıç şablonu olmalıdır.

Öneri:

```text
templates/
  game-starter/
    src/
      GameApp.ts
      main.ts
    public/
      levels/
        main.level.json
```

Başlangıç GameApp mümkün olduğunca küçük tutulmalıdır.

Örnek hedef:

```ts
const forge = await createForgeRuntime();

forge.use(new GameApp());

await forge.loadLevel("levels/main.level.json");

forge.start();
```

Yeni oyuna başlamak için bunlar yeterli olmalıdır:

1. Forge Editor'da Level oluştur.
2. Level'ı oyun projesine kaydet.
3. GameApp'e gameplay sistemlerini ekle.
4. Play.

Landscape, material, light, render, VFX vb. tekrar bağlanmamalıdır.

---

# 11. Capability Manifest

Forge'un hangi özelliklerinin gerçekten reusable olduğunu takip etmek için küçük bir capability manifest tutulması önerilir.

Örnek:

```text
docs/FORGE_RUNTIME_CAPABILITIES.md
```

| Capability | Authoring | Save | Runtime | Parity Test |
|---|---:|---:|---:|---:|
| Static Mesh | ✓ | ✓ | ✓ | ✓ |
| Material | ✓ | ✓ | ✓ | ✓ |
| Landscape | ✓ | ✓ | ✓ | ✓ |
| Lighting | ✓ | ✓ | ✓ | ✓ |
| VFX | ✓ | ✓ | ✓ | ✓ |
| Animation | ✓ | ✓ | ✓ | ✓ |
| Collision | ✓ | ✓ | ✓ | ✓ |
| Audio | ... | ... | ... | ... |

Bir özellik ancak dört sütun da tamamlandığında "Forge reusable capability" kabul edilmelidir.

---

# 12. Sınır Krallıkları ile İlişki

Sınır Krallıkları projesi büyük ölçüde tamamlandığı için bu dönüşüm sırasında mevcut RTS mimarisini kapsamlı biçimde yeniden yazmak hedef değildir.

Sınır Krallıkları:

- geçmiş problemlerin referansı,
- runtime parity regression örneği,
- gerekiyorsa uyumluluk testi

olarak kullanılabilir.

Ana çalışma **orijinal Forge deposunda** yapılmalıdır.

Yeni mimariyi kanıtlamak için mümkünse sıfır gameplay içeren küçük bir `game-starter` veya `runtime-sandbox` oluşturulmalıdır.

Bu, mevcut RTS kodunu yeni mimarinin gereksinimlerine göre zorla taşımaktan daha güvenli ve daha temizdir.

---

# 13. Yapılmaması Gerekenler

Codex aşağıdaki çözümleri varsayılan olarak kullanmamalıdır:

### 1. Her oyun için ikinci runtime sistemi

```text
ForgeVfxSystem
RtsVfxSystem
NewGameVfxSystem
```

oluşturulmamalıdır.

### 2. GameApp içinde sahneyi tekrar kurmak

```text
createGround()
createLights()
applyEditorMaterials()
createLandscape()
```

gibi genel Forge sahne işlemleri GameApp'e taşınmamalıdır.

### 3. Editor ve Game için ayrı Level loader

İki loader zamanla tekrar ayrışır.

Tek canonical pipeline tercih edilmelidir.

### 4. Sessiz veri kaybı

Save validator veya runtime unsupported fields sessizce veri atmamalıdır.

### 5. Yalnız mevcut RTS'yi hedeflemek

Çalışmanın başarı ölçütü:

> "RTS artık çalışıyor."

değil,

> "Yeni ve boş bir oyun Forge Level'ını eksiksiz çalıştırabiliyor."

olmalıdır.

---

# 14. Definition of Done

Çalışma aşağıdaki senaryo başarıyla tamamlandığında bitmiş kabul edilir.

### Test senaryosu

1. Orijinal Forge Editor açılır.
2. Yeni boş Level oluşturulur.
3. Landscape eklenir.
4. Bir veya daha fazla model eklenir.
5. Modelin Material'ı değiştirilir.
6. Directional Light ve desteklenen lighting ayarları değiştirilir.
7. Render/environment ayarlarından en az biri değiştirilir.
8. VFX yerleştirilir.
9. Actor eklenir.
10. Level kaydedilir.
11. Yeni oluşturulmuş boş `game-starter` projesinde Level açılır.

### Beklenen sonuç

Aşağıdakilerin hiçbiri için GameApp kodu değiştirilmez:

- Landscape
- model render
- material
- lighting
- render/environment
- VFX
- Actor'ın genel Forge bileşenleri

Editor'da görülen genel sahne, oyun runtime'ında aynı veriyle oluşturulur.

GameApp yalnızca kendi gameplay davranışlarını ekler.

---

# 15. Codex İçin Uygulama Sırası

Codex çalışmayı aşağıdaki sırayla yürütmelidir:

```text
1. Audit
2. Mevcut scene/load yollarını diyagramla
3. Runtime parity contract oluştur
4. Canonical Level loader'ı belirle
5. Editor Play ve Game Play'i aynı loader'a bağla
6. Registry/factory eksiklerini kapat
7. Landscape parity
8. Material parity
9. Lighting/render parity
10. VFX parity
11. Serialization/save-validator güvenliği
12. RuntimeParity test Level
13. Automated tests
14. game-starter template
15. Capability manifest
16. Documentation
```

Her fazdan sonra mevcut testler çalıştırılmalı; büyük tek seferlik rewrite yapılmamalıdır.

---

# 16. Codex'e Verilecek Ana Talimat

Aşağıdaki talimat bu dokümanla birlikte kullanılabilir:

```text
Bu çalışma Sınır Krallıkları RTS'yi geliştirmek için değil, Forge'un sonraki
oyun projelerinde tekrar kullanılabilir runtime mimarisini sağlamlaştırmak
içindir.

Önce mevcut Forge Editor, SceneApp, Level loading, serialization ve runtime
kod yollarını incele. Kod değiştirmeden önce Editor Play ile standalone Game
Play'in sahneyi nasıl oluşturduğunu karşılaştır ve AUDIT.md hazırla.

Ana hedef şudur:

Forge Editor'da kaydedilebilen ve Editor Play'de çalışan genel bir Level
özelliği, yeni bir GameApp içinde ayrıca sahne entegrasyonu yazılmadan
standalone runtime'da da çalışmalıdır.

Landscape, material override, lighting/render settings ve VFX zorunlu kabul
senaryolarıdır.

GameApp genel Forge sahnesini yeniden kurmamalı; yalnız gameplay sistemlerini
eklemelidir. Editor Play ve Game Play mümkün olduğunca aynı canonical
LevelRuntime/loader/factory yolunu kullanmalıdır.

Her oyun için RtsVfxSystem, GameLandscapeLoader veya GameMaterialBridge gibi
paralel genel sistemler üretme. Eksik capability'nin Forge runtime zincirinde
nerede koptuğunu bul ve genel katmanda düzelt.

Büyük rewrite yerine küçük fazlarla ilerle. Mevcut davranışı koru, regression
testleri ekle ve her faz sonunda TypeScript/test/build kontrollerini çalıştır.

Çalışmanın nihai kanıtı, sıfır gameplay içeren yeni bir game-starter projesinin
Forge Editor'da hazırlanmış RuntimeParity Level'ını ek entegrasyon olmadan
çalıştırabilmesidir.
```

---

# 17. Son Mimari Karar

Forge'un bundan sonraki temel prensibi:

> **Level, oyun sahnesinin kaynak gerçeğidir.**

Editor Level'ı üretir.

Forge Runtime Level'ı çalıştırır.

GameApp Level'ın üzerine oyun kurallarını ekler.

```text
Editor → Level → Forge Runtime → Game
```

yerine

```text
Editor → bir sahne
GameApp → başka bir sahne
```

oluşmasına izin verilmemelidir.

Bu dönüşüm tamamlandıktan sonra yeni bir oyun geliştirilirken Forge Editor'da
Landscape, Material, Lighting, Render, VFX veya diğer genel Forge özelliklerini
kullanmak normal editör iş akışının parçası olmalı; her özellik için yeni
oyunun runtime uygulamasına özel destek eklemek gerekmemelidir.
