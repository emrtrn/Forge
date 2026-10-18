# Forge Yeterlilik Analizi

Olusturulma tarihi: 2026-07-03

Bu dokuman Forge projesinin yeniden kullanilabilir Three.js oyun platformu
olarak yeterlilik durumunu baslik baslik degerlendirmek icin canli analiz
iskeletidir. Analiz ilerledikce her baslik altina kanit, karar, eksik ve
aksiyon notlari eklenecek.

## Degerlendirme Lejanti

- `[ ] Incelenmedi`: Henuz kanit toplanmadi.
- `[~] Kismi`: Temel islev var, fakat eksik, kirilgan veya dogrulanmamis alanlar var.
- `[x] Yeterli`: Amac icin yeterli, dogrulama kaniti var.
- `[!] Riskli`: Kullanimda hata, veri kaybi, guvenlik veya mimari borc riski var.
- `[>] Yol Haritasi`: Su an zorunlu degil, fakat platform hedefi icin planlanmali.

## Analiz Yontemi

Her baslik ayni formatla doldurulacak:

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

Kanit siralamasi: calisan kod ve testler > editor/runtime davranisi > proje
manifestleri ve veri dosyalari > mimari dokumanlar > sohbet notlari.

## 1. Urun Kimligi ve Platform Hedefi `[x] Yeterli`

Forge'un hangi oyun/app turleri icin yeterli bir temel sundugu, hangi sinirlari
bilerek disarida biraktigi ve reusable platform hedefinin netligi incelenecek.

- Durum: Incelendi (2026-07-03). Kimlik tanimi tutarli ve kodla destekleniyor;
  urun zarfi (hedef tur/cihaz listesi, "app" iddiasi) ve sablon-uretme akisi
  henuz beyan/kanit duzeyinde eksik.
- Guncelleme (2026-07-04): Beyan aksiyonlari (1-4) uygulandi. Kok `README.md`
  eklendi; "app" iddiasi karara baglandi ("app" CLAUDE.md/AGENTS.md'den
  cikarildi, her yerde "game template" — package.json/ARCHITECTURE.md ile
  hizali); urun zarfi ve fork+upstream modeli ARCHITECTURE.md Direction'a beyan
  edildi. Ayrica **Aksiyon 5 olgu duzeltmesi**: 2026-07-03 analizi ilk gercek
  oyun forkunu "henuz acilmamis" sanmisti; aslinda `minigolf` forku mevcut ve
  fork+upstream modeli pratikte dogrulanmis (Kanit + Eksikler duzeltmesi).
  Geriye yalnizca ergonomi backlog'u kaliyor: `tools/create-project.mjs`
  scaffold'i yok — manuel fork zaten calisiyor. Bu duzeltmeyle basligin karari
  `[x]`'e yukseltildi.
- Kanit:
  - Kimlik cumleleri birbirini tutuyor: `CLAUDE.md:3` ("general-purpose,
    reusable Three.js game/app platform template", editor `?editor` ile yerlesik
    mod), `AGENTS.md:3`, `docs/architecture/ARCHITECTURE.md:14` ("reusable,
    single-codebase Three.js game template"; yeni oyun = repo kopyala + GDD/
    asset/layout degistir), `package.json` description ("Reusable Three.js game
    template with a built-in editor mode"), `public/project.3dgame.json`
    (`name: "forge-template"`, `type: "three-game"`).
  - Kanonik formul: `docs/architecture/UNREAL_BASICS_LESSONS.md:16-40` — 6
    mimari ayrim (Project != Level, Layout Data != Save Game Data vb.) +
    "reusable template + built-in dev editor + manifest-driven assets +
    layout-driven levels + runtime-only production package".
  - Bilincli disarida birakilanlar yazili: `ARCHITECTURE.md` "Not In Scope Yet"
    (monorepo, node editor, shader/material graph, tam Material Instance,
    physics editor, plugin marketplace, Project Browser'in geri getirilmesi) +
    "Removed architecture" (launcher, studio CLI, external-project middleware).
    Kalici kararlar roadmap'te tarihli: Material Instance Lite, ayri Texture
    Editor yok, Sound Cue Lite, Dialogue ayri alan
    (`UNREAL_BASICS_LESSONS.md:85+`).
  - Kanitlanmis dikey: tek oyunculu 3. sahis 3D web oyunu — Gameplay track
    G1-G6, Platform Foundations P0-P5 (CI, fizik, travel, save-game,
    boot/loading, perf altyapisi) ve Actor Runtime API A1-A6 tamam
    (archived completed doc PLATFORM_FOUNDATIONS_CHECKLIST.md (see docs/COMPLETED_WORK_INDEX.md),
    archived completed doc ACTOR_RUNTIME_API_CHECKLIST.md (see docs/COMPLETED_WORK_INDEX.md)).
  - Cihaz/girdi genisligi kod olarak var: `src/input/` keyboard, pointer,
    gamepad, touch + virtual joystick kaynaklari iceriyor (yalniz plan degil).
  - Dagitim modeli: oyun basina git fork + upstream sync
    (`docs/planned/GAME_FORK_WORKFLOW.md`, doc basligi hala "Kod uygulanmadi" —
    bayat); `tools/create-project.mjs` scaffold'i henuz yok (`CLAUDE.md`
    Near-Term #4).
    **Duzeltme (2026-07-04): model pratikte uygulanmis.**
    `C:\Users\emret\Desktop\Games\minigolf` gercek bir Forge forku:
    origin=minigolf / upstream=Forge, ~24 oyun-commit'i + tekrarli
    `Merge upstream/main` (son sync 2026-06-30), golf oyun kodu `src/game` +
    `public/assets/minigolf` + `docs/GDD.md` + `docs/ASSET_CREDITS.md`'de izole
    (hole 1-9, cup sensor, fizik). Manuel fork calisti; yalniz scaffold araci
    yok.
  - Repo kokunde `README.md` yok; kimlik yalnizca ajan-yuzlu dosyalarda
    (CLAUDE.md/AGENTS.md) ve mimari sozlesmede yaziyor.
- Yeterli olanlar:
  - "Yerlesik editorlu, yeniden kullanilabilir Three.js oyun sablonu" kimligi
    net, tum kaynaklarda tutarli ve kod sinirlarıyla (engine/editor/game ayrimi,
    dev-gated editor, runtime-only dist) fiilen uygulanmis.
  - Neyin bilerek disarida kaldigi (editor ozellik duzeyinde) yazili ve tarihli
    kararlarla korunuyor; kapsam suruklenmesine karsi gercek bir fren var.
  - Tek oyunculu 3D karakter oyunu dikeyi ucuca calisir durumda; platform
    iddiasinin cekirdegi kanitli.
  - **(2026-07-04)** Reusable-platform hedefi ampirik olarak dogrulandi: `minigolf`
    gercek bir Forge forku (origin/upstream ayrimi dokumante modelde), oyun kodu
    `public/` + `src/game`'de izole, upstream sync tekrarli calistirilmis.
- Eksikler / riskler:
  - "game/app" ifadesindeki **"app" iddiasi kanitsiz**: yalnizca
    CLAUDE.md/AGENTS.md'de geciyor; ARCHITECTURE.md ve package.json "game
    template" diyor. Oyun disi tek bir kullanim hedefi/ornegi yok. Kucuk ama
    gercek bir kimlik suruklenmesi. **(Cozuldu 2026-07-04, Aksiyon 2: "app"
    cikarildi, her yerde "game template".)**
  - **Urun zarfi beyan edilmemis**: hangi oyun turleri hedef (3. sahis kanitli;
    yarıs/bulmaca/FPS?), hangi cihazlar birincil (masaustu tarayici fiilen;
    mobil/touch girdi kodu var ama hedef mi?), multiplayer/VR/2D'nin non-goal
    oldugu hicbir yerde acikca yazmiyor (multiplayer yalnizca imported source
    planinda gecici olarak geciyor). Aday bir oyun icin "Forge yeterli mi?"
    sorusu bugun ancak sohbet bilgisiyle cevaplanabiliyor. **(Cozuldu
    2026-07-04, Aksiyon 3: ARCHITECTURE.md Direction "Product envelope" +
    README ozeti.)**
  - ~~**Sablon-uretme akisi kanitsiz**~~ → **Buyuk olcude kanitli (2026-07-04
    duzeltmesi):** ilk gercek oyun forku acildi ve calisiyor (`minigolf`;
    Kanit'teki duzeltme). "Reusable platform" hedefi manuel fork + tekrarli
    upstream sync ile pratikte dogrulandi. Kalan bosluk yalnizca ergonomi:
    `tools/create-project.mjs` scaffold'i yok (her fork elle kurulur) ve
    `GAME_FORK_WORKFLOW.md` hala docs/planned altinda "Kod uygulanmadi" diyor
    (bayat; detay: Baslik 16).
  - ~~Terminoloji kaymasi~~ **(Cozuldu 2026-07-04, Aksiyon 4):** ARCHITECTURE.md
    Direction artik "copy this repository" yerine fork+upstream modelini
    tanimliyor ve `GAME_FORK_WORKFLOW.md`'ye baglaniyor; "Updated" tarihi
    2026-07-04.
  - Insan-yuzlu giris noktasi yok: README'siz repo, fork tuketicisi veya yeni
    gelistirici icin urun cumlesi sunmuyor (Baslik 15 ile kesisir). **(Cozuldu
    2026-07-04, Aksiyon 1: kok README.md.)**
- Karar: `[x] Yeterli` (2026-07-04). Kimlik net ve tum kaynaklarda tutarli;
  beyan eksikleri kapatildi (README + urun zarfi + "app" karari + fork modeli
  sozlesmede) ve reusable-platform hedefi ampirik olarak dogrulandi: `minigolf`
  gercek Forge forku, oyun kodu `public/` + `src/game`'de izole, upstream sync
  tekrarli calistirilmis. Veri kaybi/mimari borc riski yok. Kalan backlog
  yeterliligi engellemez (bilincli "Later"): `tools/create-project.mjs`
  scaffold'i (manuel fork zaten calisiyor) ve `GAME_FORK_WORKFLOW.md`'nin
  docs/planned'dan guncel statuye tasinmasi (Baslik 15/16).
- Aksiyonlar:
  1. ✓ (2026-07-04) Kok `README.md` yazildi: kimlik + kanitli dikey (3. sahis
     3D web oyunu) + urun zarfi + bilincli non-goal listesi.
  2. ✓ (2026-07-04) "app" iddiasi karara baglandi: CLAUDE.md + AGENTS.md'den
     "app" cikarildi, her yerde "game template" (package.json/ARCHITECTURE.md
     ile hizali).
  3. ✓ (2026-07-04) Urun zarfi ARCHITECTURE.md Direction "Product envelope"
     alt-basliginda beyan edildi (kanitli dikey; birincil cihaz = masaustu
     tarayici; gamepad/touch birinci sinif degil; non-goal'lar:
     multiplayer/replication, VR/AR, 2D, native mobil) + README ozeti.
  4. ✓ (2026-07-04) ARCHITECTURE.md Direction fork+upstream modeline
     guncellendi ve `GAME_FORK_WORKFLOW.md`'ye baglanti verildi; "Updated"
     tarihi 2026-07-04.
  5. ✓ (buyuk olcude, 2026-07-04) Ilk gercek oyun forku zaten acilmis ve
     calisiyor (`minigolf`: origin=minigolf / upstream=Forge, tekrarli upstream
     sync, golf oyunu `public/` + `src/game`'de). Platform hedefi pratikte
     dogrulandi. Kalan (dusuk oncelik, Baslik 16): scaffold araci karari
     (`tools/create-project.mjs`) — manuel fork calistigi icin bloklamiyor.

## 2. Mimari Sinirlar ve Sahiplik Kurallari `[x] Yeterli`

Engine, editor, runtime, game, project ve public asset katmanlarinin net ayrilip
ayrilmadigi; generic platform kodu ile oyuna ozel kurallarin karisip karismadigi
degerlendirilecek.

- Durum: Incelendi (2026-07-03). Import grafigi grep ile, dist siniri calisan
  scan ile dogrulandi. Urun-kritik sinir (editor kodu production'a sizmaz)
  saglam; kaynak-duzeyi kurallar disipline dayaniyor ve editor->game yonunde
  yazili kuralla gerilimli 5 import var.
- Guncelleme (2026-07-04): Bes aksiyon da uygulandi. (1) Editor->game bagimliligi
  registry/DI ile TERS CEVRILDI: yeni `src/editor/gameEditorRegistry.ts`
  (editor-sahipli sozlesme) + `src/game/editorCatalog.ts` (game saglayici),
  kompozisyon kokunde (`src/main.ts`) enjekte edilir; `src/editor`'da artik SIFIR
  `@/game` importu (tsc yesil). (2) Kaynak-duzeyi import-graph denetimi eklendi
  (`builder/web/verify-imports.mjs` -> `npm run verify:imports`, `build:verify` +
  CI icinde): engine->ust katman/src, editor->game, game->editor,
  RuntimeSceneApp->editor yasak; negatif self-test guard'in isirdigini kanitladi.
  (3) CLAUDE.md Near-Term #1 + verify-dist.mjs baslik/WARN notu guncellendi (WARN
  debt kapandi, strict geciyor). (4) CLAUDE.md + ARCHITECTURE.md'nin "extracted
  under game/" asiri-iddiasi duzeltildi; game/+project/ README'leri "reserved;
  kod src/game+src/project'te" olarak yeniden yazildi (src-tabanli sahiplik
  karari; tasima reddedildi). (5) Disiplin notu fork rehberine islendi. DI
  sozlesmesi icin 2 headless check eklendi (engine-tests 596). Karar `[x]`'e
  yukseltildi.
- Kanit:
  - Yazili sozlesme: `ARCHITECTURE.md` Dependency Rules + Ownership Boundaries,
    `CLAUDE.md` Working Rules, `game/README.md` + `project/README.md` kural
    ozetleri. Uc kaynak birbiriyle tutarli.
  - Dogrulanan import grafigi (grep, 2026-07-03):
    - `engine/` (91 dosya, ~18k satir, 14 alt sistem) hicbir ust katmandan
      import yapmiyor (editor/game/builder/src sifir); tamamen kendi icinde.
    - `editor/` (ust-duzey, 25 dosya ~5k satir) `@game`'den import yapmiyor.
    - `src/game` -> editor importu yok; `RuntimeSceneApp` -> editor importu yok.
    - `src/main.ts:30-44`: `SceneApp` + `EditorUi` + `layoutSaver` ucu birden
      `?editor && import.meta.env.DEV` arkasinda dinamik import — production
      build'de DCE ile tamamen dusuyor.
    - Engine olu sinir degil: `src/`den `@engine` importu 41 adet / 15 dosya.
  - Otomatik kapi: `builder/web/verify-dist.mjs` — 13 FAIL + 2 WARN token'lik
    dist string taramasi, CI'da `--strict` (`.github/workflows/ci.yml`).
    Yerelde calistirildi: `[PASS] dist/ is runtime-only`, sifir uyari.
  - Engine/editor icinde projeye ozel sabit yok: playground/kenney/quaternius
    taramasi temiz (tek eslesme bir yorum, `engine/render-three/bodyMask.ts:11`).
  - Sinir ihlali bulgusu: `src/editor` -> `@/game` 5 import
    (`ActorScriptEditor.ts:49-50` montage/input binding'ler,
    `SkeletalMeshEditor.ts:49` ragdollDriver, `EditorUi.ts:72,74`
    gameModes/catalog + behaviors). **Duzeltme (2026-07-04): bu 5 import
    registry/DI ile kaldirildi** — editor artik `@/editor/gameEditorRegistry`
    uzerinden okur, `@/game` import etmez; `verify:imports` bunu zorunlu kilar.
  - Kutle dagilimi: `src/editor` 17.3k satir > `editor/` 5.1k; `src/scene`
    11.9k; `game/` ve `project/` ust-duzey klasorleri README-only placeholder —
    gercek oyun kodu `src/game`'de (30 dosya, ~5k satir).
- Yeterli olanlar:
  - Urun-kritik sinir cift katmanli korunuyor: yapisal (DEV-gated dynamic
    import + DCE) ve otomatik (CI strict dist scan). Bu, sablonun "runtime-only
    production package" vaadinin kanitli hali.
  - `engine/` izolasyonu ornek-temiz; headless engine testleri (CI'da calisan
    kontrol seti) bu katmani ayrica sabitliyor.
  - Yasak yonlerde (game->editor, runtime->editor, engine->ust katman) sifir
    ihlal; engine/editor icinde oyuna ozel sabit veri yok.
- Eksikler / riskler:
  - **Editor -> game bagimliligi (5 import):** editor, game katmaninin
    katalog/binding exportlarina (`GAME_MODE_OPTIONS`, `BEHAVIOR_SCRIPT_IDS`,
    montage binding'ler, ragdoll driver) dogrudan bagli. Fork'ta `src/game`
    degistirilirse bu exportlar sekil-uyumlu kalmak zorunda — yazili olmayan
    bir sozlesme. "Editor core generic" kuraliyla gerilim; dogru yon game'in
    editore kayit olmasi (registry/data), editorun game import etmesi degil.
    **(Cozuldu 2026-07-04, Aksiyon 1 — secenek (b): registry/DI inversiyonu;
    editor->game importu sifir, `verify:imports` ile korunuyor.)**
  - **Kaynak-duzeyi import kurallari otomatik denetimsiz:** verify-dist yalniz
    dist ciktisini tarar; ornegin bir `engine -> game` importunu bugun hicbir
    kapi yakalamaz (tsc derler, testler gecer). Kurallar disiplin + review'a
    dayaniyor. **(Cozuldu 2026-07-04, Aksiyon 2: `builder/web/verify-imports.mjs`
    kaynak-duzeyi tarama; `build:verify`+CI, negatif self-test'le dogrulandi.)**
  - **Cifte yapi / yanlis tarafa inme riski:** ust-duzey `engine/`+`editor/`
    gercek kod tasirken `game/`+`project/` placeholder; asil kutle hala
    `src/`de. Iki "editor", iki "input" konumu var. ARCHITECTURE.md bunu kabul
    ediyor ("src/* remains the active implementation") ama CLAUDE.md'nin
    "boundaries are extracted under ... game/" cumlesi game/project icin henuz
    dogru degil. **(Kismen cozuldu 2026-07-04, Aksiyon 4: CLAUDE.md +
    ARCHITECTURE.md asiri-iddiasi duzeltildi; game/+project/ "reserved" olarak
    belgelendi. Cifte yapi BILINCLI korunuyor — `src/game` fork-sahipli kalici
    ev; `game/`'e tasima forklarin merge'lerini kirardigi icin reddedildi.)**
  - **Bayat dokuman notlari:** CLAUDE.md Near-Term #1 ("SceneApp still ships
    gizmo/authoring code in the game chunk") artik dogru degil — SceneApp da
    dinamik importta ve strict scan sifir uyariyla geciyor. verify-dist.mjs
    basligindaki WARN-debt aciklamasi ayni bayat varsayimi tasiyor. **(Cozuldu
    2026-07-04, Aksiyon 3: her iki not da guncellendi.)**
  - verify-dist kendi beyaniyla heuristik string taramasi; minification token
    bozarsa sessiz gecebilir. Kabul edilmis sinirlama, ama dist'in tek kapisi.
    **(Not 2026-07-04: dist heuristigi kabul edilmis sinir olarak DURUYOR; ancak
    import kurallari artik ayrica kaynak-duzeyinde `verify:imports` ile
    korunuyor — dist artik "tek kapi" degil.)**
- Karar: `[x] Yeterli` (2026-07-04). Sinir mimarisi calisiyor; en kritik yuzey
  (editor kodu production'a sizmaz) cift katmanli otomatik korunuyor. Bu turda
  editor->game bagimliligi registry/DI ile ters cevrildi (editor artik generic),
  kaynak-duzeyi import denetimi eklendi (`verify:imports`, `build:verify`+CI) ve
  bayat notlar + game/project sahiplik iddiasi duzeltildi. `build:verify` yesil
  (596 engine check + strict dist scan + import scan, exit 0). Veri kaybi riski
  yok; eski "fork'ta sessiz sozlesme kirilmasi" riski hem yapisal (inversiyon)
  hem otomatik (import gate) kapatildi. Kalan yalnizca kabul edilmis sinir:
  verify-dist heuristik string taramasi (minification token'i bozarsa sessiz
  gecebilir) — ama import kurallari icin `verify:imports` ayri bir kaynak-duzeyi
  guvence.
- Aksiyonlar:
  1. ✓ (2026-07-04) Editor<->game: secenek (b) registry/DI uygulandi. Yeni
     `src/editor/gameEditorRegistry.ts` (editor-sahipli sozlesme + set/get) +
     `src/game/editorCatalog.ts` (game saglayici, editor import etmez); enjekte
     `src/main.ts` kompozisyon kokunde. `src/editor`'da sifir `@/game` importu;
     game'in beton tipleri sozlesmeyi yapisal olarak karsiliyor (tsc yesil).
  2. ✓ (2026-07-04) `builder/web/verify-imports.mjs` eklendi (`verify:imports`,
     `build:verify`+CI): engine->editor/game/builder/src/project, editor->game,
     game->editor, RuntimeSceneApp->editor yasak. Negatif self-test guard'i
     dogruladi (FAIL+exit1), pozitif PASS.
  3. ✓ (2026-07-04) CLAUDE.md Near-Term #1 "Done" olarak isaretlendi +
     verify-dist.mjs baslik/WARN notu guncellendi (split landed, strict = net).
  4. ✓ (2026-07-04) src-tabanli sahiplik: CLAUDE.md + ARCHITECTURE.md "extracted
     under game/" / "project+game now hold real extracted code" iddialari
     duzeltildi; game/+project/ README'leri "reserved placeholder; kod
     src/game+src/project" olarak yeniden yazildi. `src/game -> game/` tasima
     REDDEDILDI (fork maliyeti; minigolf gibi forklar src/game kullaniyor).
  5. ✓ (2026-07-04) verify-dist FAIL-listesi + `verify:imports` disiplini
     `GAME_FORK_WORKFLOW.md` "Platform katkisi yaparken" alt-basligina islendi.

## 3. Editor Deneyimi ve Uretim Akislari `[~] Kismi`

`?editor` deneyimi, scene/level authoring, selection, gizmo, details panel,
Content Browser, asset atama, undo/redo, coklu secim ve temel uretilirlik
akislari incelenecek.

- Durum: Incelendi (2026-07-03). Ozellik genisligi ve akis butunlugu guclu:
  tam authoring dongusu + 7 ozel alt-editor + 13 dev yazma endpoint'i. Zayif
  ayak dogrulama: UI katmaninin hicbir otomatik smoke'u yok ve ana kabuk
  5.8k satirlik monolit.
- Guncelleme (2026-07-04): Aksiyon 1/3/4/5 uygulandi; Aksiyon 2 icin
  dilimleme plani yazildi ve dort Details extraction slice'i uygulandi
  (`src/editor/panels/details/transformRows.ts`,
  `src/editor/panels/details/instanceDetails.ts`,
  `src/editor/panels/details/materialDetails.ts`,
  `src/editor/panels/details/collisionDetails.ts`,
  `src/editor/panels/details/physicsDetails.ts`,
  `src/editor/panels/details/componentDetails.ts`). Playwright Chromium smoke
  eklendi (`npm run smoke:browser`): `?editor` boot, shape asset placement,
  Details transform, undo/redo, Save Layout, temiz editor reload ve runtime `/`
  boot geciyor. Smoke aktif layout'u gecici kopyaya alir ve manifest'i test
  sonunda geri yukler; template layout'u kirlenmez. Karar simdilik `[~]`:
  browser dogrulama acigi kapandi ve `EditorUi.ts` dort details dilimi cikti, fakat
  content/outliner/world panelleri ve buyuk details alt bolumleri henuz kabukta.
- Kanit:
  - Cekirdek authoring dongusu kodda: gizmo (`editor/gizmos/` axes/builder/
    handles/interaction/transformDrag), secim + coklu secim + hiyerarsi
    (`editor/core/selection*`, `hierarchy.ts`), outliner + history paneli +
    World Settings + Details paneli (`EditorUi.ts` renderOutliner/
    renderHistory/renderWorldSettings/renderDetails +
    `src/editor/panels/details/`; transform + material/
    collision/physics/components/audio/behavior/particle/interaction/
    moving-platform/metadata bolumleri + 10 aktor-tipi detayi: light,
    reflection plane, reflective surface, blocking volume, world widget,
    reflection capture, sky, fog, cloud, post-process).
  - Content Browser: klasor agaci + filtreler + asset kartlari + thumbnail
    (`ThumbnailRenderer.ts`, texture thumbnail) + viewport'a drag-drop
    yerlestirme (asset drag preview, Player Start dahil).
  - Undo/redo komut disiplini gercek: `EditorCommandStore` + SceneApp'te 23
    komut label'i (Add/Place/Delete/Rename/Move/Edit pivot/Update world
    settings + toplu `${verb} N objects`) + flag komutlari (hide/lock/
    scale-lock/simulate-physics/cast-shadow/collision,
    `editor/core/commandLabels.ts`). Surekli drag pointer-up'ta tek komut
    (ARCHITECTURE.md kurali).
  - Ozel alt-editorler ayni kalipla: ActorScript (2.2k satir + viewport),
    SkeletalMesh/Persona (3.0k), StaticMesh (1.7k), Material (898), Dialogue
    (725), UI Widget (732), SoundCue (581) — her biri kendi store'u + dev-save
    endpoint'iyle.
  - Yazma yuzeyi: `vite.config.ts`'te 18 dev mutasyon endpoint'i (`__save-layout`,
    sidecar/asset save endpointleri, Content Browser create/rename/delete/import,
    `__new-behavior`, `__open-level`) + read-only `__project-dir`; structured
    yollarin validator/normalizer kapilari var.
  - Play akisi: toolbar "Play (P)" = layout'u kaydet + runtime route'unu (`/`)
    yeni sekmede ac + kamera pozu handoff (`src/play/cameraHandoff.ts`,
    `EditorUi.ts:949-962`).
  - Snap: grid/rotation/scale ayarlari `project.3dgame.json`'a kalici;
    floor/wall snap saf helper (`editor/render-three/floorSnap.ts`,
    `wallSnap.ts`).
  - Test kapsami: engine testleri yerelde calistirildi — **573 check gecti**
    (2026-07-03). Editorden saf cikarilan mantik test altinda: Section 7
    EditorSceneController state, Section 8 gizmo drag matematigi, Section 9
    wall-snap, Section 10 save validator. **Guncelleme 2026-07-04:** browser
    smoke da var ve yesil (`npm run smoke:browser`, 1 Chromium test, 1.8m).
    **Guncelleme 2026-07-04:** details slicing slice'lari dogrulandi:
    `npx.cmd tsc --noEmit`, `npm.cmd run test:engine` (596 check),
    `npm.cmd run verify:imports`, `npm.cmd run smoke:browser` (1 Chromium
    test, 1.9m-2.0m).
- Yeterli olanlar:
  - Unreal-esintili cekirdek dongu (sec → tasi → duzenle → kaydet → geri al →
    oynat) ucuca kodda; komut disiplini, snap, hiyerarsi, coklu secim dahil.
  - Uretim akislari tek desen: her icerik turu icin ozel editor + store +
    validator'lu dev endpoint. Desenin genisletilebilirligi kanitli — 7
    alt-editor ayni kalipla eklenmis.
  - Editor mantiginin saf cekirdegi headless testte; dist siniri Baslik 2'de
    kanitlandi (editor production'a sizmiyor).
- Eksikler / riskler:
  - **UI katmaninda sifir otomatik dogrulama:** Playwright/browser test yok
    (package.json'da dep yok); CLAUDE.md Near-Term #2 acik. Editor deneyimi
    manuel smoke'a dayaniyor ve acik kullanici smoke borclari birikiyor
    (A5.5 browser smoke, platform foundations smoke'lari). 5.8k satirlik
    `EditorUi` + 3k `SkeletalMeshEditor` DOM'a gomulu — regresyon ancak elle
    yakalanir. **(Cozuldu 2026-07-04, Aksiyon 1: Playwright smoke + Chromium
    kurulumu + `smoke:browser`; CLAUDE Near-Term #2 kapandi.)**
  - **Monolit kabuk:** `EditorUi.ts` 5,800 satir tek sinif (+ 2,889 satir
    css). Details panel render'lari dahil her sey icinde; yeni aktor tipi =
    monolite bir render metodu daha. Buyume bu bicimde surdurulebilir degil.
    **(Kismen azaltildi 2026-07-04, Aksiyon 2 iki slice: transform row
    helperlari, generic instance/character/actor Details render+binding,
    Materials Details, Collision Details ve Physics Details render+binding
    `src/editor/panels/details/` altina cikarildi. Kalan risk:
    components/metadata alt bolumleri, content/outliner/world panelleri ve
    ozel aktor details render'lari hala `EditorUi.ts` icinde.)**
  - **Dokuman/kod kaymasi:** CLAUDE.md + ARCHITECTURE.md yalniz 2 dev
    endpoint dokumante ediyor, gercekte 13 + import var. ARCHITECTURE'daki
    "editor SceneApp Play mode" ifadesinin kodda karsiligi yok (Play = route
    acar; in-viewport PIE yok — bilincli gorunuyor ama beyansiz). Near-Term
    #3'un "previews" kismi bayat (thumbnail'lar zaten var). **(Cozuldu
    2026-07-04, Aksiyon 3: CLAUDE/ARCHITECTURE endpoint listesi guncellendi;
    Play route handoff olarak beyan edildi; Near-Term #3 placement-rule
    affordances'a daraltildi.)**
  - **Autosave yan etkisi:** dev server acikken default layout/world settings
    otomatik yeniden yaziliyor (hafiza notu + CLAUDE.md autosave ifadesi) —
    fork/template hijyeni icin tuzak; repo dokumaninda yazili degil. **(Cozuldu
    2026-07-04, Aksiyon 4: CLAUDE ve fork rehberi dev editor yazma/hijyen
    notuyla guncellendi.)**
- Karar: `[~] Kismi` — ozellik genisligi platform iddiasini tasiyor;
  `[x]`'i engelleyen, UI dogrulama acigi (otomatik smoke yok + manuel smoke
  borcu) ve monolit kabugun bakim riski. Veri kaybi riski Baslik 6'nin konusu
  (validator allowlist) — burada akut risk yok.
- Aksiyonlar:
  1. Minimal Playwright smoke kur: `?editor` boot → asset yerlestir →
     transform → undo → save → reload → `/` Play boot. CLAUDE Near-Term #2'yi
     kapatir; acik kullanici smoke'larini (A5.5 vb.) ayni kapsama al.
  2. `EditorUi.ts` dilimleme plani: once details-panel renderer'larini panel
     modullerine cikar (saf-cekirdek cikarma deseni zaten isliyor); "yeni
     ozellik monolite eklenmez" kuralini yaz.
  3. Dokuman duzeltmeleri: 13+1 dev endpoint listesini CLAUDE/ARCHITECTURE'a
     isle; "editor SceneApp Play mode" ifadesini gercek akisla degistir;
     Near-Term #3'u kalan kisma (placement-rule affordances) daralt.
  4. Autosave davranisini dokumante et (hangi eylem neyi ne zaman yazar) ve
     fork rehberine "dev server acikken default layout kirlenir" notunu ekle;
     gerekirse autosave'i opt-in yap.
  5. (Yol haritasi) VFX editoru (archived completed doc VFX_Lite_Plan.md (see docs/COMPLETED_WORK_INDEX.md), tamamlandi)
     bu alt-editor kalibiyla uygulanan ilk ornekti; Content Browser
     placement-rule affordances siradaki adim olarak kalsin.
  - **Guncel aksiyon durumu (2026-07-04):** Aksiyon 1 tamamlandi
    (`smoke:browser` yesil); Aksiyon 2 plan + dort uygulama dilimi olarak
    tamamlandi (`EDITOR_UI_SLICING_PLAN.md`, simdi arsivde — bkz.
    `docs/COMPLETED_WORK_INDEX.md`; `transformRows.ts`,
    `instanceDetails.ts`, `materialDetails.ts`, `collisionDetails.ts`,
    `physicsDetails.ts`, `componentDetails.ts`; tsc + engine tests +
    verify:imports + smoke yesil);
    Aksiyon 3/4 dokumanlari
    guncellendi; Aksiyon 5 backlog karari olarak korundu. Guncel karar hala
    `[~]`: browser dogrulama acigi kapandi ve dort details slice'i cikti, fakat
    `EditorUi.ts` metadata, ozel aktor details, content/outliner/world refactor
    edilmeden `[x]` degil. Devam plani `EDITOR_UI_SLICING_PLAN.md` icinde
    5-10. slice checklist'leri olarak acildi: metadata details, special actor
    details, environment details, world settings, outliner/history ve Content
    Drawer.

## 4. Runtime ve Gameplay Temelleri `[~] Kismi`

Game mode, pawn/character, input, camera, actor/component modeli, behavior
baglama, level travel, save/load, boot/loading ve playable runtime akisi
degerlendirilecek.

- Durum: Incelendi (2026-07-03). Unreal-analog gameplay cercevesi (Game Mode /
  PlayerController / PlayerState / Pawn) ucuca kodda; saf cekirdekler genis
  headless test altinda (573 check gecti). Zayif ayaklar: runtime kabugu 3.6k
  satirlik ikinci monolit, tarayici smoke borclarinin tamami runtime'da
  birikmis, ve travel'da sahne-omru sanilan behavior state'inin app-omru
  yasadigina dair bir sizinti bulgusu (kod/yorum celiskisi + muhtemel
  round-trip portal bug'i).
- Guncelleme (2026-07-05): Aksiyon 1 uygulandi. Behavior registry artik
  sahne-yukleme omrune indirildi: `BehaviorSubsystem.setRegistry(...)` eklendi,
  `RuntimeSceneApp.buildScene(...)` her boot/travel rebuild basinda taze
  `createBehaviorRegistry(...)` kuruyor, `collisionAudioPlayed` module-global
  set'ten registry-kapsamli set'e tasindi. Headless regresyonlar eklendi:
  ayni `portal:0` yeni sahne registry'siyle tekrar travel tetikleyebiliyor ve
  ayni `mover` collision-chime yeni registry'de tekrar audio cue calabiliyor.
  Karar hala `[~]`: runtime browser smoke, kabuk dilimleme ve save zarfi
  dokumani acik.
- Guncelleme (2026-07-05, Aksiyon 2 kismi): Runtime Playwright smoke eklendi.
  `npm run smoke:browser` artik 2 Chromium test calistiriyor: mevcut editor
  authoring smoke + yeni runtime playflow smoke. Yeni smoke gecici
  `__playwright-smoke` layout/menu fixture'lariyla `/` boot, loading overlay
  kapanisi, HUD mount, Save/Load UI quick slot write+load round-trip ve runtime
  `travel:` UI mesajiyla hedef level load akisini dogruluyor. Kalan browser
  borcu: yuru/zipla input, portal sensor gidis-gelis ve checkpoint sensor
  autosave smoke'u.
- Kanit:
  - Kompozisyon: `src/main.ts` (56 satir) ince giris — `/` = `RuntimeSceneApp`
    (3,607 satir), editor DEV+`?editor` dinamik importta (Baslik 2 ile tutarli).
  - Frame dongusu acik siralamali (`RuntimeSceneApp.start`, :830-860): gamepad
    poll → session.beforeEngineUpdate → `engineApp.update` (subsystem'ler) →
    killZ → UI input edge → session.update → gameRules → UI store → world UI →
    audio listener → partikuller → sky/cloud takip → post-process/render.
    Delta 100ms'e, fizik adimi 1/20s'ye clamp'li — degisken timestep
    (`engine/physics/physicsSubsystem.ts:480`), sabit-adim accumulator yok.
  - Game Framework sozlesmeleri: `src/game/gameModes/types.ts` (231 satir,
    zengin dokumante) — GameModeDefinition/Session, PawnDefinition,
    PlayerControllerDefinition (input mode / pointer-look / cursor politikasi),
    PlayerState (ragdoll/get-up icin `pawnControlSuspended`), GameState. 2
    yerlesik mod (`forge.defaultCamera` flythrough, `forge.tpsCharacter`) +
    proje Game Mode'u Actor Script class-ref'iyle (`catalog.ts:53`,
    `createProjectGameMode`); bilinmeyen id guvenli fallback (`registry.ts:23`)
    — eski layout'lar default kamerayla acilir.
  - TPS dikeyi tam teskil (`tpsCharacterGameMode.ts` 579 satir + saf
    yardimcilar): spring-arm kamera + pointer-look, crossfade/layered
    locomotion, montage input binding, anim-notify tracker, ragdoll driver +
    get-up blender; possess secimi acik kural (metadata `player` > ilk
    `input-move`).
  - Karakter hareketi engine Subsystem olarak (`characterMovementSystem.ts`,
    554 satir): kameraya-gore planar hareket, substep'li AABB cozumleme,
    step-up/down (0.45/0.5), slope yurunebilirlik + uphill slowdown, moving
    platform binme/tasima (subsystem sirasi yorumla sabitlenmis: platform →
    character), launch/impulse sonumu, yercekimi worldSettings'ten.
    `CharacterMovement` component'i authored (`components.ts:274`).
  - Actor/component modeli: 19 component turu
    (`engine/scene/components.ts:8-26` — Transform/MeshRenderer/Light/Collider/
    Audio/ParticleEmitter/Interaction/CharacterMovement/MovingPlatform/Camera/
    SpringArm + 6 script component'i). `BehaviorSubsystem` saf; ScriptWorld
    sorgu yuzeyi (byName/byTag/byClassRef/withInterface/velocityOf/ownerOf),
    ScriptMessageBus, runtime actor spawn/destroy. Actor Runtime API A1-A6
    tamam (archived completed doc ACTOR_RUNTIME_API_CHECKLIST.md (see docs/COMPLETED_WORK_INDEX.md); tek acik A5.5
    browser smoke).
  - Input genisligi: `ActionMap` + 5 kaynak — keyboard, gamepad (poll,
    stick+dpad eslemesi headless testli), touch + virtual joystick
    (`isTouchLikely`), pointer look (right-drag / pointer-lock; kilit kaybinda
    pause menu, `RuntimeSceneApp.ts:666-675`), pointer button. Binding'ler
    oyun-tarafi (`defaultInputBindings.ts`).
  - Level travel: saf state machine (`levelTravel.ts`, 97 satir; unloading →
    loading, pending slot latest-wins) + kabukta teardown/rebuild;
    tetikleyiciler `level-travel` sensor behavior'u + `travel:` UI mesaji;
    spawnTag hedefli Player Start (`playerSpawn.ts`).
  - Save/load: engine `SaveGameStore` (slot + JSON envelope + schema/migrate
    hook + quota-korumali adapter, `engine/persistence/saveGameStore.ts`) +
    oyun-sahibi serializer (`src/game/saveGame.ts`: level path + player
    transform + opt-in persistent script state; savunmaci normalize). Restore =
    kayitli level'a travel, yukleme sonrasi uygula (`applyPendingSaveRestore`,
    :2465). Checkpoint behavior'u + save UI slotlari; UserSettings ayri store.
  - Kill Z + respawn: her frame `applyKillZ` (:2452); respawn transformu
    Player Start'tan cache'li (:2439).
  - Boot/loading UX (P4): `LoadProgressTracker` + `LoadingOverlay` + 300ms
    minimum gosterim + hata durumu; editor Play → kamera pozu handoff (:2520).
  - Oyun kurallari katmani: `gameRules.ts` (442 satir) + GameStateStore —
    degisken/objective/timer, win/lose ekranlari, restart; testlerde ayri
    "Game Framework (rules layer)" bolumu.
  - Test: 573 check gecti (yerelde kosuldu, 2026-07-03); ~150 check etiketi
    runtime/gameplay alanina isaret ediyor (movement/travel/save/camera/pawn/
    ragdoll/montage/notify) ve testlerde "Vertical Slice Readiness Gate"
    bolumu var (`tools/engine-tests.ts:1452`).
  - **Guncelleme (2026-07-05):** scene-lifecycle regresyonlari eklendi:
    `level-travel behavior: fresh scene registry lets the same trigger id fire
    again` ve `collision-chime behavior: fresh scene registry lets the same
    entity id play again`. Runtime artik `buildScene` basinda taze behavior
    registry atiyor; registry icindeki one-shot latch'ler scene visit basina
    sifirlaniyor.
  - **Guncelleme (2026-07-05):** Browser runtime smoke eklendi:
    `tests/smoke/runtime-playflow.spec.ts` + global setup/teardown fixture
    genisletmesi (`layouts/__playwright-smoke*.level.json` ve gecici
    `assets/__playwright-smoke-menu.ui.json`, manifestler teardown'da restore).
    `npm run smoke:browser` yesil: 2 Chromium test, editor authoring + runtime
    playflow.
- Yeterli olanlar:
  - Cerceve sozlesmeleri gercek ve dokumante: Game Mode/Controller/State
    ayrimlari, possession disiplini, "runtime state layout'a yazilmaz"
    guardrail'i kodda tutuyor. Eski/bozuk veriye karsi her katman guvenli
    fallback'li.
  - Saf-cekirdek deseni gameplay'de de isliyor: hareket/dikey/carpisma/kamera/
    locomotion/travel/save mantiklari Three'siz modullerde ve test altinda;
    kabuk yalniz kompozisyon + kopru.
  - Oynanabilir dongu ucuca: boot → possess → yuru/zipla/carp → etkiles →
    portal travel → checkpoint/save → kill-Z respawn → win/lose → restart.
    Platform iddiasinin runtime cekirdegi kanitli.
  - Input ve cihaz genisligi (klavye/gamepad/touch/pointer-lock) tek ActionMap
    sozlesmesinde toplanmis; UI/game input modu Unreal-esintili ve tutarli.
- Eksikler / riskler:
  - **Behavior state sizintisi kapatildi (2026-07-05):** Asagidaki eski bulgu
    dogrulandi ve duzeltildi. Runtime artik `buildScene` basinda taze behavior
    registry atiyor; `collisionAudioPlayed` registry kapsamina tasindi. Eklenen
    headless regresyonlar ayni `portal:0` ve `mover` id'lerinin yeni scene
    ziyaretinde tekrar calistigini dogruluyor.
  - **Behavior state sizintisi (bulgu — dogrulanmali, muhtemel bug):**
    `behaviors.ts:200` yorumu registry'nin "her sahne yuklemesinde" yaratilip
    "sahneler arasi sizmadigini" soyluyor; gercekte `createBehaviorRegistry`
    yalnizca constructor'da bir kez cagriliyor (`RuntimeSceneApp.ts:708`).
    Closure setleri (`traveledTriggers`/`reachedGoals`/`checkpointsSaved`/
    `vertical`, behaviors.ts:213-216) + module-global `collisionAudioPlayed`
    (behaviors.ts:135) travel'da sifirlanmiyor. Entity id'ler index-tabanli ve
    level-bagimsiz (`actor:<n>`, `actorInstance.ts:47`;
    `instance:<assetId>:<n>`), yani: ayni level'a donuste portal olu kalir;
    farkli level'larin ayni-index aktorleri birbirinin state'ini gorur. P2'nin
    kullaniciya kalan "Playground ↔ TestLevel gidis-gelis" smoke'u tam bu
    yuzeyi dogrulayacakti — henuz kosulmadi.
  - **Ikinci monolit kabuk:** `RuntimeSceneApp.ts` 3,607 satir; scene build +
    travel + save + UI koprusu + VFX + reflection hepsi icinde. EditorUi ile
    ayni buyume deseni (Baslik 3), ayni surdurulebilirlik riski. Devam eden
    VFX Lite isi de kabuga ekliyor.
  - **Tarayici smoke borclari runtime'da toplanmis:** P1.5 collision-gym, P2
    travel gidis-gelis + heap, P3 save round-trip, P4 overlay/Retry, A5.5
    actor API — hepsi acik (`PLATFORM_FOUNDATIONS_CHECKLIST.md`,
    `ACTOR_RUNTIME_API_CHECKLIST.md`). Oynanabilir dongu yalnizca manuel
    dogrulanmis durumda; yukaridaki sizinti bulgusu bu borcun somut maliyeti.
  - **Kucuk bilinen sinirlar:** facing matematigi +z-forward mesh varsayiyor
    (`playerMovement.ts:90`, yorumla kabul edilmis — baska asset ters bakar);
    fizik degisken timestep (clamp var, determinizm sinirli — kabul edilebilir
    ama beyansiz); possess edilmeyen karakterler tek authored klip oynatir —
    AI/NPC hareketi yok (bilincli: AI plani move-intent refactoru bekliyor);
    save zarfi dar (level + player + opt-in flag'ler; spawn/destroy edilen
    aktorler kaydedilmez) — bilincli tasarim ama sozlesme beyansiz.
- Karar: `[~] Kismi` — cerceve genisligi ve saf-cekirdek test disiplini guclu,
  oynanabilir dongu kanitli. `[x]`'i engelleyen: behavior-state sizintisi
  bulgusunun dogrulanip kapatilmasi, otomatik runtime smoke yoklugu ve monolit
  kabuk. Sizinti dogrulanirsa travel ozelinde `[!]` sinifinda bir davranis
  hatasi (veri kaybi degil, oynanis kilidi).
- Guncel karar notu (2026-07-05): Behavior-state sizintisi kapatildi; `[x]`'i
  artik otomatik runtime smoke yoklugu, monolit kabuk ve save zarfi sozlesme
  eksigi engelliyor.
- Planlama notu (2026-07-05): Kalan isler fazlara ayrildi ve takip kaynagi
  olarak `docs/ongoing/RUNTIME_GAMEPLAY_REMAINING_CHECKLIST.md` eklendi.
  (Not, 2026-10-18: dosya 2026-07-14'te `e107f11` ile repodan kaldirildi,
  arsive tasinmadi; icerigi git gecmisinde. Kaldirildiginda P5 kapanis
  maddeleri hala aciktir.)
- Aksiyonlar:
  1. Behavior state sizintisini dogrula ve kapat: registry'yi scene-load
     basina yeniden yarat (veya reset API'si ekle), `collisionAudioPlayed`'i
     registry kapsamina tasi; headless travel round-trip regresyon testi ekle
     (ayni entity id iki kez travel tetikleyebilmeli). `behaviors.ts:200`
     yorumunu gercek sozlesmeyle esitle.
     **Durum (2026-07-05): tamamlandi.**
  2. Runtime smoke otomasyonu (Baslik 3 Aksiyon 1 ile ayni Playwright
     kurulumu): `/` boot → yuru/zipla → portal gidis-gelis → checkpoint +
     save/load round-trip → `?debug` overlay. P2/P3/P4 + A5.5 kullanici smoke
     borcunu tek kapsamda kapat.
     **Durum (2026-07-05): kismi.** Browser smoke artik `/` boot, HUD,
     loading overlay kapanisi, Save/Load UI quick write+load round-trip ve
     runtime `travel:` UI mesaji ile level travel'i dogruluyor. Yuru/zipla,
     portal sensor gidis-gelis ve checkpoint sensor autosave browser smoke'u
     acik kaldi; portal/checkpoint davranislari headless test kapsaminda.
  3. `RuntimeSceneApp` dilimleme plani (EditorUi ile ortak karar): travel,
     save-game ve actor-spawn koordinatorlerini modullere cikar; "yeni ozellik
     kabuga eklenmez, modul olarak gelir" kuralini yaz.
  4. Save zarfi sozlesmesini dokumante et: neyin kaydedildigi/kaydedilmedigi,
     opt-in persistent-state deseni, schema/migrate hook kullanimi — fork
     tuketicisinin save tasarimi icin gerekli.
  5. (Yol haritasi) AI oncosulu move-intent refactorunun siralamasini koru;
     +z-forward facing varsayimini skeleton sidecar'ina tasinabilir hale
     getirmeyi ayni refactor paketine not et.

## 5. Asset Pipeline ve Icerik Yonetimi `[ ] Incelenmedi`

Asset manifest, import disiplini, material/mesh/skeletal/audio/UI sidecar
dosyalari, asset health, starter content ve downstream game fork kullanimina
uygunluk incelenecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 6. Veri Semalari, Save/Load ve Validator Kapsami `[ ] Incelenmedi`

Layout, environment, world settings, sidecar dosyalari, save-game verisi ve
`tools/saveValidator.ts` allowlist kapsaminin veri kaybi riski tasiyip
tasimadigi degerlendirilecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 7. Rendering, Aydinlatma ve Gorsel Kalite `[ ] Incelenmedi`

Three.js render ayarlari, editor/runtime goruntu paritesi, material sistemi,
post process, reflection capture, fog, sky/clouds, VFX ve gorsel dogrulama
akislari incelenecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 8. Fizik, Collision ve Hareket Dayanikliligi `[ ] Incelenmedi`

Rapier/Jolt yuzeyleri, static mesh collision authoring, character movement,
kill/respawn, zemin/duvar davranisi, complex collision ve gameplay tarafindaki
kullanim sozlesmeleri degerlendirilecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 9. UI Sistemleri `[ ] Incelenmedi`

Editor UI, runtime HUD/menu, UI view model, kaydet/yukle menuleri, input focus,
responsive davranis ve oyun projeleri icin yeniden kullanilabilir UI temelinin
yeterliligi incelenecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 10. Scripting, Extensibility ve Plugin Hazirligi `[ ] Incelenmedi`

Actor script sistemi, behavior API, plugin hooks, editor genisletilebilirligi ve
oyun projelerinin Forge cekirdegini bozmadan ozellestirme kapasitesi
degerlendirilecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 11. Performans ve Olceklenebilirlik `[ ] Incelenmedi`

Runtime frame maliyeti, editor buyuk sahne davranisi, asset yukleme, instancing,
profiling ihtiyaci, bundle boyutu ve gelecekteki performans altyapisi
incelenecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 12. Build, Packaging ve Dagitim `[ ] Incelenmedi`

Vite build, `build:verify`, dist dogrulamasi, public klasor disiplini, proje
manifestlerinin paketlenmesi ve downstream oyunlara tasinabilirlik
degerlendirilecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 13. Test, Dogrulama ve CI Koruma Agi `[ ] Incelenmedi`

TypeScript, engine tests, build verify, Playwright/browser smoke, visual
dogrulama, fixture kapsami ve regresyon yakalama gucu incelenecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 14. Guvenlik ve Veri Sinirlari `[ ] Incelenmedi`

Dev-server endpointleri, save/load, asset ingestion, dosya yazma sinirlari,
generated content ve izin/scope riskleri degerlendirilecek. Bu baslikta gereken
noktalarda Codex Security taramasi ayrica onayla calistirilmalidir.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 15. Dokumantasyon ve Onboarding `[ ] Incelenmedi`

Mimari dokumanlar, launch workflow, checklistler, module README'leri, karar
kayitlari ve yeni gelistiricinin projeyi dogru kullanma hizi degerlendirilecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 16. Oyun Sablonu ve Downstream Fork Hazirligi `[ ] Incelenmedi`

Forge'dan uretilen oyun repolarinin kendi icerigini koruyarak upstream
degisiklikleri alabilmesi, default scene/template sozlesmeleri ve fork-sync
akislari incelenecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## 17. Yol Haritasi, Onceliklendirme ve Kabul Kriterleri `[ ] Incelenmedi`

Eksiklerin hangi sirayla ele alinacagi, hangi basligin "platform icin yeterli"
sayilacagi ve hangi maddelerin bilincli backlog olarak kalacagi belirlenecek.

- Durum:
- Kanit:
- Yeterli olanlar:
- Eksikler / riskler:
- Karar:
- Aksiyonlar:

## Kanit ve Aksiyon Kaydi

Analiz sirasinda bulunan kararlar ve takip isleri buraya kisa kayit olarak
eklenecek.

| Tarih | Baslik | Bulgu | Aksiyon | Durum |
| --- | --- | --- | --- | --- |
| 2026-07-03 | Dokuman iskeleti | Analiz basliklari olusturuldu. | Basliklar tek tek kanitla doldurulacak. | `[ ]` |
| 2026-07-03 | 1. Urun Kimligi | Kimlik net/tutarli, urun zarfi + "app" iddiasi + fork hikayesi beyansiz; README yok. | README + urun zarfi beyani + ARCHITECTURE.md fork guncellemesi (5 aksiyon, baslikta). | `[~]` |
| 2026-07-04 | 1. Urun Kimligi | Beyan aksiyonlari (1-4) uygulandi: README.md eklendi, "app" iddiasi CLAUDE.md/AGENTS.md'den cikarildi ("game template" hizalamasi), urun zarfi + fork+upstream modeli ARCHITECTURE.md Direction'a beyan edildi. **Olgu duzeltmesi:** ilk fork "acilmamis" degildi — `minigolf` forku mevcut (origin=minigolf/upstream=Forge), upstream sync tekrarli calismis; reusable-platform hedefi ampirik dogrulandi. Karar `[x]`'e yukseltildi. | Kalan backlog (dusuk oncelik): `tools/create-project.mjs` scaffold + `GAME_FORK_WORKFLOW.md` statusunun guncellenmesi. | `[x]` |
| 2026-07-03 | 2. Mimari Sinirlar | Dist siniri cift katmanli ve kanitli (strict scan PASS); editor->game 5 import sozlesmesiz; kaynak-duzeyi import denetimi yok; CLAUDE.md Near-Term #1 bayat. | Editor<->game karari + import-graph check + bayat not duzeltme (5 aksiyon, baslikta). | `[~]` |
| 2026-07-04 | 2. Mimari Sinirlar | 5 aksiyon uygulandi: editor->game registry/DI ile ters cevrildi (yeni `gameEditorRegistry`+`editorCatalog`, `src/main.ts` enjekte; editor'da sifir `@/game`), kaynak-duzeyi `verify:imports` gate eklendi (`build:verify`+CI, negatif test dogrulandi), Near-Term #1 + verify-dist notu guncellendi, "extracted under game/" asiri-iddiasi duzeltildi + game/project "reserved" belgelendi (tasima reddedildi), fork rehberine disiplin notu. `build:verify` yesil (596 check + strict dist + import scan). | Kalan: yalnizca verify-dist heuristik sinirlamasi (kabul edilmis). | `[x]` |
| 2026-07-03 | 3. Editor Deneyimi | Tam authoring dongusu + 7 alt-editor + 13 dev endpoint; 573 engine check gecti; UI katmaninda otomatik smoke yok, EditorUi 5.8k satir monolit, endpoint dokumantasyonu eksik. | Playwright smoke + EditorUi dilimleme + dokuman duzeltmeleri (5 aksiyon, baslikta). | `[~]` |
| 2026-07-04 | 3. Editor Deneyimi | Playwright Chromium smoke eklendi ve yesil (`npm run smoke:browser`, 1 test, 1.8m): `?editor` boot, shape placement, Details transform, undo/redo, Save Layout, temiz editor reload, runtime `/` boot. Endpoint/Play/dev-editor-yazma dokumanlari guncellendi; `EDITOR_UI_SLICING_PLAN.md` eklendi. Ilk dort Details slicing dilimi uygulandi: `transformRows.ts`, `instanceDetails.ts`, `materialDetails.ts`, `collisionDetails.ts`, `physicsDetails.ts`, `componentDetails.ts`; tsc + engine tests (596) + verify:imports + smoke yesil. | Kalan uygulama: `EditorUi.ts` metadata details, ozel aktor details ve content/outliner/world panel dilimleme refactoru. | `[~]` |
| 2026-07-03 | 4. Runtime/Gameplay | Unreal-analog cerceve ucuca + saf cekirdekler testli (573 check); **bulgu:** behavior registry app-omru yasiyor (yorum sahne-omru diyor), travel'da `traveledTriggers` vb. sifirlanmiyor + entity id'ler level-bagimsiz → round-trip portal muhtemelen olu; RuntimeSceneApp 3.6k satir ikinci monolit; tum tarayici smoke'lari acik. | Sizintiyi dogrula+kapat (headless travel testi) + runtime Playwright smoke + kabuk dilimleme + save sozlesme dokumani (5 aksiyon, baslikta). | `[~]` |
| 2026-07-05 | 4. Runtime/Gameplay | Behavior state sizintisi dogrulandi ve kapatildi: runtime her `buildScene` basinda taze behavior registry atiyor; `collisionAudioPlayed` registry kapsamina tasindi; headless testler ayni trigger/entity id'nin yeni scene visit'te tekrar calistigini dogruluyor. | Runtime smoke, kabuk dilimleme ve save zarfi dokumani acik kaldi. | `[~]` |
| 2026-07-05 | 4. Runtime/Gameplay | Runtime Playwright smoke eklendi: gecici smoke layout/menu fixture'lariyla `/` boot, loading overlay kapanisi, HUD, Save/Load UI quick write+load ve `travel:` UI mesaji ile target level load dogrulaniyor. `npm run smoke:browser` yesil (2 Chromium test). | Kalan browser smoke: yuru/zipla, portal sensor gidis-gelis, checkpoint sensor autosave. | `[~]` |
| 2026-07-05 | 4. Runtime/Gameplay | Kalan isler fazlara ayrildi: runtime browser smoke kapsami, `RuntimeSceneApp` dilimleme, save-game zarfi sozlesmesi, AI/facing yol haritasi ve kapanis gate'i. | Yeni takip dokumani: `docs/ongoing/RUNTIME_GAMEPLAY_REMAINING_CHECKLIST.md`. | `[~]` |
