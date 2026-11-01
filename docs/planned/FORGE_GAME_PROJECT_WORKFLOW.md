# Forge ↔ Oyun Projesi İş Akışı

> Tarih: 2026-10-27 (iki belgenin birleşimi)
> Kaynaklar: `GAME_FORK_WORKFLOW.md` (2026-06-26, Model 1) ve
> `SHARED_FORGE_GAME_PROJECT_WORKFLOW.md` (2026-10-25, Model 2). Eski dosyalar
> bu belgeyle değiştirildi; içerikleri aşağıda korunmuştur.
> Kapsam: Forge'dan oyun projesi üretme, Forge'daki yeniliklerin oyuna gelmesi,
> oyunda bulunan genel motor/editör düzeltmesinin Forge'a dönmesi.

## 0. Hangi model, ne zaman?

| | Model 1: Fork + upstream | Model 2: Ortak kaynak |
|---|---|---|
| Durum | **Geçerli — mevcut oyunlar bununla yaşıyor** | **P2 teknik SP ve kullanıcı kabulü tamamlandı (01.11.2026)** |
| Kimin için | `minigolf`, `miniracer`, `platformer`, `freshcounter` ve benzeri mevcut oyunlar | Forge Offroad (ilk tüketici) |
| Oyun deposunda motor kopyası | Var (Forge'un klonu) | **Yok** |
| Forge yeniliği oyuna | `git merge upstream/main` | Oyun zaten aynı kaynağı kullanır |
| Oyunda bulunan motor hatası | Forge'da düzelt, oyuna çek (kural dışı: `cherry-pick`) | Baştan gerçek Forge dosyasında düzelt |

**Çıkış sorunu (neden iki model var):** Eskiden Forge klasörü kopyalanıp oyun adı
verilerek devam ediliyordu. Bu yöntemde kopya ile Forge arasında hiçbir bağ yok;
oyunun içinde yapılan genel motor/editör düzeltmeleri Forge'a dönmüyor, Forge'daki
yenilikler de oyuna gelmiyor (ThreeAges deneyimi).

> **Düz klasör kopyalama desteklenmez.** Model 1 `git clone` + `upstream` remote'u
> gerektirir; düz kopya hiçbir iki yönlü akışa katılmaz.

**Geçiş ilkesi:** Mevcut oyunlar otomatik taşınmaz. Her oyun için ayrı fark analizi
ve geçiş kararı gerekir. Yeni altyapı kabul edilene kadar eski projelerin çalışma
biçimi değişmez. `sync-forge-to-games` araçları yalnız Model 1 içindir.

**Açık boşluk — proje oluşturma bugün elle:** Klonla, remote'ları ayarla, adı ve
proje verisini değiştir. Bunu otomatikleştirecek `tools/create-project.mjs` yok
(`CLAUDE.md` Near-Term #4). Model 2'de oluşturma adımı P1 prototipinin konusudur.

---

# MODEL 1 — Fork + upstream (geçerli)

## Zihinsel model

```
                 ┌─────────────────────────┐
                 │  Forge (template)        │   origin = github.com/emrtrn/Forge
                 │  engine/ editor/         │   ← genel iyileştirmeler BURADA yaşar
                 │  builder/ tools/ docs/   │
                 └─────────────┬───────────┘
              fork/clone       │  upstream  (oyunlar buradan güncelleme çeker)
        ┌───────────┬──────────┴──────────────┬───────────┐
   ┌────▼────┐ ┌────▼──────┐            ┌─────▼────┐
   │minigolf │ │mini-racer │    …        │ dungeon  │
   │public/  │ │public/    │            │public/   │   her biri = ayrı GitHub repo
   │src/game │ │src/game   │            │src/game  │   ← oyun kodu YALNIZCA burada
   │docs/GDD │ │docs/GDD   │            │docs/GDD  │   ← GDD kendi reposunda
   └─────────┘ └───────────┘            └──────────┘
```

**Altın kural — değişiklik yönü:**
- **Platform kodu** (engine, editor, builder, ortak araçlar) → **Forge'da** yaz,
  oyunlar `upstream`'den çeker.
- **Oyun-özel kod ve data** → yalnızca **`public/` + `src/game`** içinde kalır.
  `engine/`, `editor/`, `builder/`'a oyun-özel kod **girmez**.
  Bu disiplin çakışmayı neredeyse sıfıra indirir.

## Klasör düzeni

```
C:\Users\emret\Desktop\
├── Forge\              ← şablon repo (emrtrn/Forge) — buradan hiç oyun kodu girmez
└── Games\
    ├── minigolf\       ← oyun forkları buraya (emrtrn/minigolf vs.)
    ├── mini-racer\
    └── …
```

## Aşama 0 — Forge'u temiz template haline getir (fork açmadan önce)

Her fork bu durumu miras alır; ne kadar temizse her oyun o kadar temiz başlar.

1. Demo model temizliği + starter content standardını Forge `main`'de bitir ve commit'le.
2. Kenney araçlarını commit'le (`tools/asset-library-index.mjs`, katalog, TSV,
   `.gitignore` güncellemesi).
3. Forge `main`'i GitHub'a push'la: `git push origin main`.

## Aşama 1 — Yeni oyun reposu oluştur

**1a.** GitHub'da boş repo aç (README olmadan), ör. `minigolf`.

**1b.** Forge'u klonla, remote'ları ayarla:

```bash
git clone https://github.com/emrtrn/Forge.git C:\Users\emret\Desktop\Games\minigolf
cd C:\Users\emret\Desktop\Games\minigolf

# Forge'u upstream yap; yeni origin = oyun reposu
git remote rename origin upstream
git remote add origin https://github.com/emrtrn/minigolf.git
git push -u origin main
```

| Remote     | URL                                    | Amaç                         |
| ---------- | -------------------------------------- | ----------------------------- |
| `origin`   | `github.com/emrtrn/minigolf.git`       | Oyunun kendi GitHub reposu    |
| `upstream` | `github.com/emrtrn/Forge.git`          | Platform güncellemelerini çek |

## Aşama 2 — Oyunu kur (yalnızca `public/` ve `src/game` içinde)

1. **GDD yaz** → `docs/GDD.md` (çekirdek döngü, asset listesi, gereken sistemler,
   dikey kesit). Oyun tasarım fikirleri/GDD'ler **GameDesign** stüdyo deposunda
   yaşar (`C:\Users\emret\Desktop\GameDesign`); Forge yalnızca platform geliştirir
   (2026-07-04 kararı).
2. **Asset'leri çek** — Kenney arşivinden (`C:/Users/emret/Documents/Kenney`)
   yalnızca gerekenleri `public/assets/...`'a kopyala. Her asset için kaynak paket
   + CC0 lisans notunu `docs/ASSET_CREDITS.md`'ye ekle. Arama: Forge'daki
   `tools/kenney/kenney-assets.tsv` veya GameDesign'daki
   `docs/kenney/KENNEY_CATALOG.md`.
3. **Oyun kurallarını yaz** → `src/game/` (GameMode, GameState, kurallar, HUD
   binding). `engine/`, `editor/`, `builder/`'a oyun-özel kod ekleme.
4. **Layout data** → `public/layouts/`, `public/project.3dgame.json`. Dev editör
   (`?editor`) aynı repo dosyalarına yazar: **Save Layout** aktif layout'u, snap ve
   World Settings'i kaydeder; **Open Level** `editor.defaultScene` değerini
   değiştirir; Content Browser create/rename/delete/import `public/` altındaki
   referansları günceller. Editör/dev server açıkken `git status` kontrolünü
   alışkanlık yap; template/default layout'u istemeden kirletme.

## Aşama 3 — Forge güncellemelerini oyuna çek

```bash
git fetch upstream
git merge upstream/main
```

Oyun-özel değişiklikler `public/` + `src/game`'de kaldığı sürece çakışma neredeyse
olmaz; olursa yalnızca bu iki klasörde çözülür. Alternatif: `git rebase upstream/main`
(doğrusal tarih, tek kişilik akışta tercih edilebilir).

## Aşama 4 — Platform eksiğini Forge'a geri besle

**Doğru yol — Forge'da düzelt, oyuna çek:**

```bash
cd C:\Users\emret\Desktop\Forge
git add <dosyalar>
git commit -m "fix: ..."
git push origin main

cd C:\Users\emret\Desktop\Games\minigolf
git fetch upstream
git merge upstream/main
```

**Toplu otomasyon.** Forge değişikliği commit'li ama push'lanmamışsa script Forge
`main`'i `origin/main`'e push eder; sonra `C:\Users\emret\Desktop\Games` altındaki
git repo oyunlarda `upstream/main`'i fast-forward merge edip `origin/main`'e push eder.

```bat
cd C:\Users\emret\Desktop\Forge
tools\sync-forge-to-games.bat                      :: hepsi
tools\sync-forge-to-games.bat -Projects minigolf   :: yalnız seçili oyunlar
tools\sync-forge-to-games.bat -DryRun              :: ne yapacağını göster
```

Güvenlik sınırları: Forge veya oyun reposunda uncommitted değişiklik varsa durur;
repolar `main` branch'inde değilse durur; çakışmada Git durur ve manuel çözüm ister
(`git merge --no-edit upstream/main`).

**İstisna — yanlışlıkla oyunda kodladıysan:**

```bash
git log --oneline -5                 # oyundaki commit SHA'sı
cd C:\Users\emret\Desktop\Forge
git remote add minigolf https://github.com/emrtrn/minigolf.git
git fetch minigolf
git cherry-pick <sha>
git push origin main
```

### Platform katkısı yaparken (engine/editor'a dokunuyorsan)

İki otomatik sınır kapısı `build:verify` içinde ve CI'da çalışır:

- **`verify:imports`** (`builder/web/verify-imports.mjs`): modül sınırlarını kaynak
  düzeyinde tarar. `editor/*` **`@/game` import edemez**; editörün gösterdiği oyun
  verisi `@/editor/gameEditorRegistry` ile enjekte edilir (`src/main.ts` bağlar).
  `engine/*` üst katmanları, `game/*` editörü import edemez.
- **`verify:dist`** (`builder/web/verify-dist.mjs`): yeni bir **editor-only**
  modül/sembol çıkarırsan sembolü `FAIL_TOKENS` listesine ekle; production `dist/`'e
  sızarsa kapı kırmızıya döner.

## GDD politikası

| Doküman | Repo | Açıklama |
| --- | --- | --- |
| `KENNEY_GAME_IDEAS.md`, `QUATERNIUS_GAME_IDEAS.md` | **GameDesign** | Genel fikir havuzu |
| Bu doküman | **Forge** `docs/planned/` | İş akışı referansı |
| `docs/GDD.md` | **Oyun reposu** | O oyuna özel tasarım dokümanı |
| `docs/ASSET_CREDITS.md` | **Oyun reposu** | O oyunda kullanılan asset'ler + lisans |

Forge oyun tasarım fikri/GDD üretmez; yalnız platform (engine/editor/builder)
geliştirir. `tools/kenney/kenney-assets.tsv` + `kenney-index.json` asset arama
aracıdır (`tools/asset-library-index.mjs`), tasarım dokümanı değildir.

## Neden ayrı repo (dal değil)?

| Kriter | Ayrı repo ✅ | Uzun dal ❌ |
| --- | --- | --- |
| Bağımsız yayın (itch.io) | Her repo kendi CI/deploy'u | Dal yayın zorlaşır |
| GDD / issue tracking | Repo başına proje tahtası | Tek repo kalabalıklaşır |
| Çapraz bulaşma riski | Remote sınırı net | Yanlışlıkla merge riski |
| Oyun sayısı arttıkça | Lineer (1 repo = 1 oyun) | Dal sayısı patlar |

## İleride: scaffold aracı

`tools/create-project.mjs` (CLAUDE.md backlog; **hâlâ yok**): Forge'u hedef klasöre
kopyalar, `project.3dgame.json` ve layoutları sıfırlar, remote'ları kurar, boş
`docs/GDD.md` + `docs/ASSET_CREDITS.md` oluşturur. Model 2 kabul edilirse kapsamı
yeniden değerlendirilmelidir.

## Yeni oyun açılırken kontrol listesi

- [ ] Forge `main` temiz ve güncel (`git push origin main`)
- [ ] GitHub'da boş oyun reposu oluşturuldu
- [ ] `git clone` + remote'lar ayarlandı (`upstream` = Forge, `origin` = oyun)
- [ ] `docs/GDD.md` yazıldı
- [ ] Asset'ler `public/assets/`'a çekildi + `docs/ASSET_CREDITS.md` dolduruldu
- [ ] Oyun kodu yalnızca `public/` + `src/game`'de
- [ ] İlk commit + push → `origin main`

---

# MODEL 2 — Ortak Forge kaynağı ve bağımsız oyun projesi (hedef)

> Durum: **P1-A/B/C uygulandı; P2 teknik SP ve kullanıcı kabulü tamamlandı.**
> Hedef ilkeler aşağıda korunur; güncel uygulama ve test kanıtı
> [P2 raporundadır](../reports/RIDGEBOUND_P2_ACCEPTANCE_REPORT.md).
> İlk tüketici Ridgebound (önceki adı Forge Offroad). Mevcut oyunlar için
> otomatik migrasyon kararı yoktur.

## 2.1 Problem ve karar

ThreeAges deneyiminde Forge kopyasından oluşturulan oyunda yapılan genel motor
düzeltmeleri Forge'a kendiliğinden dönmedi; elle taşınması gerekti veya ortak motor
bu iyileştirmeden mahrum kaldı. Model 1, Forge → oyun yönünde `upstream` merge'ü ve
ters yönde elle `cherry-pick` tarif eder; `sync-forge-to-games` de yalnız Forge →
oyun yönünde birleştirir. Oyunda başlayan motor geliştirmesini ortak kaynağa
taşıyan bir mekanizma değildir.

**Karar:** Yeni Offroad geliştirme akışında oyun projesi Forge'un düzenlenebilir
motor/editör kopyasını taşımaz. Oyun, geliştirme sırasında tek yetkili Forge
kaynağını kullanır. Genel motor/editör düzeltmesi, hangi oyun sırasında fark
edilirse edilsin, gerçek Forge kaynak dosyasında yapılır ve Forge deposunda tutulur.

Bu hedefin kabulü, mevcut kodun bu desteği sağladığı anlamına gelmez. İki yönlü
dosya kopyalama veya otomatik oyun deposu → Forge merge akışı hedef çözüm değildir.

## 2.2 Hedef sahiplik ve yerleşim

Temsili yerleşim; aşağıdaki oyun klasörünün oluşturulduğu iddia edilmez:

```text
C:/Users/emret/Desktop/
  Forge/                 # Yetkili motor, editör, ortak araçlar ve Git deposu
  Games/
    Offroad/             # Ayrı oyun Git deposu; oyun kodu, proje verisi, belgeler
```

| Sınıf | Yetkili kaynak | Örnek |
|---|---|---|
| ENGINE | Forge | Genel araç kütle/COM API'si, arazi fiziği |
| EDITOR | Forge | Genel içerik düzenleme ve kamera araçları |
| TOOLS | Forge | Proje başlatma, doğrulama ve ortak build araçları |
| GAME | Offroad | Sözleşme, yükleme/teslim koşulları, ödül, HUD, oyun kayıt modeli |
| CONTENT | Offroad | Sahne, terrain sidecar, kargo profili, proje manifesti, varlıklar |
| DESIGN | Offroad | GDD, oyun kabul raporu ve içerik kararları |

Forge'un kendi örnekleri ve test fixture'ları Forge'da kalabilir; bağımsız oyunun
verisi bunların üzerine kaydedilmez. Mevcut `src/game`, `src/project`, `engine`,
`editor` yerleşimi yalnız örnek bir paket ağacına uymak için topluca taşınmaz.

## 2.3 Geliştirme akışı

1. Geliştirme ortamı hem Forge hem oyun deposunu erişilebilir hale getirir.
2. Oyun, seçilmiş yerel Forge kaynağından motor/editör ve ortak araçları kullanır.
3. Oyun kodu ve veri değişiklikleri oyun deposunda yapılır.
4. Genel bir motor eksiği bulunursa sorun oyun sahnesinde yeniden üretilir;
   düzeltme Forge deposundaki gerçek kaynakta yapılır. Oyun içine motor yaması
   eklenmez.
5. Ortak motor testleri ve oyunun ilgili senaryosu aynı değişiklikle doğrulanır.
6. Motor değişikliği Forge'da, oyun değişikliği oyun deposunda ayrı kaydedilir.
   Commit/push/merge işlemleri mevcut kullanıcı yetkisi ve repo kurallarına tabidir.

**Örnek:** Ağır kargoda fren davranışı hatalıysa genel fren hesabı Forge'da;
kargonun ağırlığı ve hangi işte yüklendiği Offroad'da değiştirilir. Offroad testi
aynı Forge dosyasını kullanır; düzeltmeyi oyundan Forge'a taşıma adımı yoktur.

Yerel bir kaynağa bağlanmak değişikliği otomatik commit/push yapmaz. HMR veya
yeniden derleme davranışı uygulamada doğrulanmalıdır; her dosya değişikliğinin
yeniden başlatma gerektirmeden görüneceği vaat edilmez.

## 2.4 Claude bulut oturumu ve yerel geliştirme

- Motor geliştirmesi Claude Code bulut oturumunda Forge deposunda sürer.
- Kullanıcı onaylı Forge değişikliklerini yerel Forge deposuna çeker.
- Bağlı oyun geliştirme ortamı bu yerel kaynağı kullanır; motor dosyaları oyun
  deposuna ayrıca merge edilmez. Bağımlılık değişmişse kurulum/yeniden başlatma
  gerekebilir; oyun uyumluluğu kontrol edilmeden güncelleme kabul edilmiş sayılmaz.
- Yerelde Forge değişikliği varsa pull öncesi korunur. Paralel yerel/bulut
  geliştirme Git çatışmalarını ortadan kaldırmaz; tek kaynak, çift uygulamayı önler.
- Bulut/CI ortamında oyun ve kullanılan Forge commit'i birlikte hazırlanır.
  Kullanıcının Windows yolunun diğer makinelerde var olduğu varsayılmaz.

## 2.5 Mevcut koddan bilinen sınırlar (2026-10-25 incelemesi; uygulama başında tekrar kontrol et)

- `src/scene/ForgeGameModule.ts` oyun modülü yaşam döngüsünü tanımlar;
  `src/main.ts`, `src/game/gameModule.ts` modülünü runtime'a bağlar.
- `vite.config.ts`, `PUBLIC_DIR` ve `PROJECT_MANIFEST_PATH` için repo içindeki
  `public` yollarını kullanır. Bağımsız proje kökü hazır varsayılamaz.
- `tsconfig.json` alias'ları mevcut repo kaynaklarına bağlıdır. Yalnız klasör
  bağlantısı kurmak tüm import, derleme ve editör yazma yollarını çözmez.
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) önceki fork modelini ve eski dış
  proje/launcher sisteminin kaldırıldığını kaydeder. Bu hedef, eski Studio veya
  Project Browser'ı geri getirme kararı değildir.

Bu bölüm için runtime/build testi yapılmamıştır.

### 2.5A P1-A güncellemesi — 2026-10-31

Yeni oyunun adı **Ridgebound**; hedef klasör
`C:/Users/emret/Desktop/Games/Ridgebound`, uzak depo
`https://github.com/emrtrn/Ridgebound.git`.

Yukarıdaki 2026-10-25 envanterinin proje kökü eksikliği için ilk dilim uygulandı:
`FORGE_PROJECT_ROOT` ile sunucu başlatılırken oyun kökü seçilebilir. Statik
`public/`, editör kayıt/içerik işlemleri, üretilen behavior dosyaları ve Git
varsayılanları seçili projeye bağlanır. Değişken verilmezse Forge'un kendi proje
kökü kullanılır. Geçersiz seçimde Forge'a sessiz dönüş yapılmaz.

Bu **tam Model 2 kabulü değildir**: oyun modülü ve editör kataloğu henüz Forge
içindeki `src/game` üzerinden yüklenir. Ridgebound klasörü/deposu henüz
hazırlanmadı. Dış oyun modülü, bağımsız oyun build'i, temiz ortamda kurulum ve
SP-01–SP-10 kapanışı sonraki dilimlerde doğrulanacak.

İki geçici proje ile HTTP kayıt/işlem izolasyonu testleri, tam `build:verify`
kapısı ve iki hedefli Chromium smoke testi geçti. Ayrıntılar ve kullanım:
[Ridgebound P1-A raporu](../reports/RIDGEBOUND_P1A_PROJECT_ROOT_REPORT.md).

### 2.5B P1-B güncellemesi — 2026-10-31

Ridgebound'un kendi Git deposu belirtilen klasöre klonlandı; henüz commit/push
yapılmadı. Küçük prototip sahnesi, oyun modülü, editör kataloğu ve tasarım
kaynakları oyun deposunda bulunur. Motor/editör kaynakları kopyalanmadı.

Manifestin isteğe bağlı `game` alanı oyun köküne göre iki kaynak girişi tanımlar:

```json
"game": {
  "module": "src/game/gameModule.ts",
  "editorCatalog": "src/game/editorCatalog.ts"
}
```

Bu alan verilirse iki dosyanın da geçerli `src/game/*.ts` yollarında bulunması
gerekir; eksik/hatalı girişler Forge modülüne dönmez. Alan yoksa mevcut Forge
örneği ve yalnız veri içeren smoke projeleri ortak template modülünü kullanır.
`@forge-game/module` ve `@forge-game/editor-catalog` yalnız ortak açılışın seçilmiş
girişleridir; genel motor/editörün oyuna bağımlı olması için kullanılmaz.

Ridgebound klasöründe `npm.cmd run check` ve `npm.cmd run dev` kullanılabilir.
Geliştirme varsayılan olarak yalnız `127.0.0.1:5175` üzerinde açılır; editör
`?editor` adresindedir. Oyun başlatıcısı gerçek Forge araçlarına gider. Yerel Forge
konumu `FORGE_ROOT` veya Git dışında `forge.local.json` ile seçilebilir; varsayılan
yerleşim `Desktop/Forge` ve `Desktop/Games/Ridgebound` şeklindedir.

Oyuna ait modül, kendi editör katalog etiketi, statik dosyalar ve geçici projede
gerçek UI ile kaydet/yükle doğrulandı. Three.js için oyun ve Forge kaynaklarının
tek modül örneği kullandığı tarayıcıda kontrol edildi. Ayrıntılar:
[P1-B uygulama raporu](../reports/RIDGEBOUND_P1B_PROJECT_MODULE_REPORT.md).

Bağımsız oyun build'i, diğer bağımlılıkların build düzeyinde tekilleştirilmesi,
temiz ortamda kurulum ve tam SP kabulü hâlâ P1-C/P2 işidir. Kullanıcının isteğiyle
bu oturumda Codex Security diff taraması yapılmadı.

### 2.5C P1-C güncellemesi — 2026-11-01

Ridgebound bağımsız üretim build'i ve yalnız bu çıktıyı sunan preview komutu
uygulandı. Oyun klasöründe `npm.cmd run build`, `npm.cmd run preview` ve
`npm.cmd run verify:build` kullanılabilir. Varsayılan üretim önizlemesi
`http://127.0.0.1:4175/` adresindedir. Alt dizin için
`npm.cmd run build -- --base /ridgebound/` kullanılabilir.

Her build `builds/<kimlik>/dist/` altında ayrı tutulur. Yayımlanacak dosyalar
yalnız `dist/` içeriğidir. `build-record.json`, kaynak/kilit/çıktı hashlerini ve
Git durumlarını; `inputs.json.gz`, commit edilmemiş girdiler dahil tam kaynak
kanıtını tutar. Bu iki dosya web çıktısının dışındadır ve yayımlanmaz. Kaynak
arşivi, ikinci bir aktif motor kopyası veya bağımsız motor release sistemi değildir.

`verify:build`, girdileri boş geçici klasöre açıp kilitli bağımlılıkları yeniden
kurar; canlı kaynak veya node_modules bağlantısı kullanmadan derler ve çıktı
hashlerini karşılaştırır. Eksik çevrimdışı npm önbelleğinde yalnız aynı kilitle
eksik paketleri indirerek devam eder. Son doğrulamada 27 dosya birebir eşleşti.

Kök/alt dizin browser kontrolleri, üretimde `?editor` ile editör açılmaması,
kaynak/kayıt uçlarının bulunmaması ve çizilmiş 3B sahne doğrulandı. Three.js,
Rapier, Recast ve meshoptimizer için birer ortak paket örneği kaydedildi.
Ridgebound'un M0 kayıt şeması henüz tanımlı değildir; rapor bunu açıkça belirtir.

P1-C ayrıntıları: [Build ve yeniden üretim raporu](../reports/RIDGEBOUND_P1C_BUILD_REPORT.md).
P2/SP kabul tablosu ve kullanıcı kabulü henüz kapanmadı; M0 oyun mantığına
başlanmadı. Bu çalışma commit/push veya yayın yapmadı; kullanıcının talebiyle
Codex Security taraması çalıştırılmadı.

### 2.5D P2 kapanışı — 2026-11-01

SP-01–SP-10 teknik kontrolleri geçti. Kullanıcı “P2 görsel ve kullanım kabulünü
onaylıyorum” beyanıyla görsel/kullanım kapısını da kapattı. **P2 tamamlandı.**
Yukarıdaki P1-A/B/C güncellemeleri kendi aşamalarının tarihsel durumunu anlatır;
güncel sonuç [P2 kabul raporudur](../reports/RIDGEBOUND_P2_ACCEPTANCE_REPORT.md).
Kullanıcı P2 kapsamı için commit/push yetkisi verdi. M0 geliştirmesi, yayın,
bağımsız motor release sistemi ve eski oyun migrasyonu bu kapanışa dahil değildir.

## 2.6 Uygulama görevi ve sıra

**P0 — En küçük teknik tasarım.** Git durumu, `AGENTS.md`, aktif kaynaklar ve
mevcut testler incelenir. Motor kaynağı, oyun giriş/modül yolu, proje veri kökü ve
çıktı kökü arasındaki sözleşme tanımlanır. Mevcut Forge örnek akışı korunur. Yerel
paket bağlantısı, çalışma alanı veya eşdeğer bir yöntem değerlendirilebilir;
**kesin paket yöneticisi, komut, manifest alanı veya dizin migrasyonu seçilmiş
değildir.** Seçim kaynak sahipliği, build ve kayıt izolasyonu ile kanıtlanır.
`node_modules` içinde kalıcı motor düzeltmesi yapılmaz. Three.js/Rapier gibi ortak
bağımlılıkların farklı kopyalarla yüklenme riski ele alınır.

**P1 — Küçük bağımsız proje prototipi.** Bir oyun modülü ve küçük bir sahneyle:

1. Seçilen Forge kaynağı + oyun modülü + oyun manifestiyle başlatma.
2. Ortak Forge editöründe oyuna ait içeriği açma ve kaydetme.
3. Aynı oyun verisini runtime'da açma.
4. Bağımsız runtime build'i alma; editör/runtime import sınırlarını koruma.
5. Kullanılan Forge kaynağı, oyun kaynağı ve build girdilerini raporlama.

Editör ve runtime için ayrı motor kopyaları veya paralel scene loader'lar
üretilmez; gereken yeni davranış genel kalır.

**P2 — Kabul ve iş akışı belgeleri.** Aşağıdaki kabul tablosu kanıtlarla doldurulur.
İlgili mimari belgeleri, başlatma talimatları ve fork araçlarının kapsamı gerçek
uygulamaya göre güncellenir. Eski oyunlar taşınmaz.

## 2.7 Proje kökü ve yazma sınırları

Okuma/yazma kökü açıkça seçilir. Proje manifesti, sahne, terrain/tile, asset
sidecar, import, oluşturma, yeniden adlandırma, silme ve autosave işlemleri seçili
oyunun izin verilen veri kökünde kalmalıdır.

- Geçersiz proje yolu sessizce Forge `public/` alanına geri düşmez; anlaşılır hata verir.
- Yol çözümlemesi ve bağlantıların gerçek hedefi doğrulanır; proje dışına taşan
  dosya işlemleri engellenir. İstemciden gelen keyfi yol yetki sayılmaz.
- Var olan allowlist/validator'lar korunur; yeni alanlar ilgili doğrulayıcıya eklenir.
- Dev dosya erişimi ve editör middleware'i production build'e girmez.
- Geçici iki proje ile kayıt/rename/delete ve proje dışı yol denemeleri sınanır;
  kullanıcının gerçek sahneleri fixture yapılmaz.

Dev-server uçları, save/load ve dosya sınırlarını etkilediği için uygulama
sonrasında **Codex Security diff taraması önerilir**; sessizce başlatılmaz,
kullanıcı onayı beklenir.

## 2.8 Kabul kapısı — M0 öncesi

01.11.2026 P2 teknik doğrulaması: aşağıdaki SP maddeleri **GEÇTİ**. Kaynak
commit'leri, commit edilmemiş düzeltme hashleri, test/build/görüntü kanıtları ve
sınırlar [P2 kabul raporunda](../reports/RIDGEBOUND_P2_ACCEPTANCE_REPORT.md).
**Kullanıcı görsel ve kullanım kabulü 01.11.2026 tarihinde onaylandı; P2 tamamlandı.**
Bu tablo M0 oyun kabulü veya yayın yetkisi değildir.

| ID | Kanıtlanacak davranış | Durum |
|---|---|---|
| SP-01 | Oyun deposu düzenlenebilir Forge motor/editör kopyası içermeden açılır. | GEÇTİ |
| SP-02 | Editör ve runtime seçilen oyunun manifestini, modülünü ve sahnesini kullanır. | GEÇTİ |
| SP-03 | Forge'daki küçük bir genel değişiklik aynı kaynaktan oyunda sınanır; dosya taşıma gerekmez. | GEÇTİ |
| SP-04 | Oyun değişikliği yalnız oyun deposunda; motor değişikliği yalnız Forge deposunda görünür. | GEÇTİ |
| SP-05 | Save/autosave ve içerik işlemleri yalnız seçili oyun köküne yazar; Forge fixture'ları ve ikinci proje değişmez. | GEÇTİ |
| SP-06 | Geçersiz/proje dışına taşan yollar reddedilir; yanlış köke sessiz kayıt yapılmaz. | GEÇTİ |
| SP-07 | Bağımsız oyun build'i önizlemede çalışır; editör, dev uçları ve makineye özel yollar çıktıya sızmaz. | GEÇTİ |
| SP-08 | Forge güncellemesinden sonra oyun açılış, kayıt ve temel oynanış kontrolü geçer. | GEÇTİ |
| SP-09 | Temiz ortamda kayıtlı oyun/Forge commit'leri ve build girdileriyle proje yeniden hazırlanabilir. | GEÇTİ |
| SP-10 | Forge'un mevcut örnek editör/runtime akışı ve uygun regresyon kapıları korunur. | GEÇTİ |

TypeScript değişikliğinde `npx tsc --noEmit`; ortak runtime/motor işi için
`npm run test:engine` ve `npm run build:verify`. Editör/proje açma, dosya
izolasyonu ve build önizlemesi için hedefli browser testleri eklenir. Otomatik
kontroller kullanıcı görsel/oynanış kabulünün yerine geçmez.

## 2.9 M0 → M1 → M2 ile ilişki

Önce SP kabul kapısı, ardından bağımsız Offroad projesinde M0 geliştirmesi. Bu kapı
tüm Open World ve Terrain Deformation planlarının bitmesini gerektirmez. M0 ayrıca
güvenilir araç/sahne ve kendi görev/save kabulünü gerektirir.

- **M0:** İş kabulü, yük alma, taşıma, teslim, tek ödeme ve kayıt tutarlılığı.
- **M1:** Motorun yük-kütle/COM ve yüzey API'leri hazır olduğunda yük/rota farkının
  oyun içinde birleştirilmesi ve karşılaştırmalı kabulü.
- **M2:** Motorun iz/batma altyapısının oyun senaryosunda kullanımı ve performans kabulü.

Eksik genel API, Forge/Claude işi olarak kaydedilir; oyun içinde geçici motor
kopyasıyla kapatılmaz.

## 2.10 Build kaydı, kapsam dışı işler ve devir

Geliştirmede canlı kaynak kullanılabilir; kabul/yayın için oyun commit'i, Forge
commit'i, bağımlılık kilidi, asset/proje verisi, save şeması ve build ayarları
birlikte kaydedilir. Kaydedilmemiş diff varsa commit SHA tek başına tam kanıt
değildir. Yayımlanmış build sonradan yapılan Forge pull'u ile değişmez; yeni build
ayrı doğrulanır.

Kapsam dışı: bağımsız Forge paket release sistemi, her değişiklikte motor sürümü,
genel launcher, marketplace, bütün oyunların migrasyonu, otomatik çift yönlü merge.
Teknik seçimlerin gerektirdiği büyük taşıma/şema değişiklikleri ayrı gerekçe ve
inceleme konusu yapılır.

**Devir:** Önce P0 tasarımı ve etkilenen dosyaları çıkar; sonra küçük P1 prototipini
SP-01–SP-10 kanıtlarıyla doğrula. Offroad M0 oyun mantığını bu altyapı görevine
ekleme. Mevcut kullanıcı değişikliklerini, sahnelerini ve bulut/yerel çalışma
geçmişini koru. Bu belge commit/push/merge veya yayın talimatı değildir.
