# Forge → Oyun Fork İş Akışı

> **2026-10-25 — Yeni Offroad hedefi:**
> [Ortak Forge Kaynağı ve Bağımsız Oyun Projesi](SHARED_FORGE_GAME_PROJECT_WORKFLOW.md)
> çalışma ilkesi onaylandı; uygulama ve kabul bekliyor. Hedef, motor/editör
> kopyasını oyun deposunda geliştirmek yerine bağımsız oyunun ortak Forge
> kaynağını kullanmasıdır. Aşağıdaki fork/upstream ve elle `cherry-pick` akışı
> mevcut oyunların eski yöntemidir; yeni Offroad hedefinin çözümü sayılmaz.
> Yeni altyapı kabul edilene kadar eski projelerin çalışma biçimi değişmez.
> `sync-forge-to-games` araçları yalnız bu eski fork akışı içindir.

> Tarih: 2026-06-26
> Durum: Referans doküman. İlk gerçek fork (`minigolf`, `origin` = oyun /
> `upstream` = Forge) bu akışla kuruldu; araç tarafı (`tools/create-project.mjs`)
> henüz yok.
> Amaç: Forge şablonundan bağımsız oyun repoları türetme ve bakım sürecini
> standart hale getirmek.

## Zihinsel Model

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

---

## Klasör Düzeni

```
C:\Users\emret\Desktop\
├── Forge\              ← şablon repo (emrtrn/Forge) — buradan hiç oyun kodu girmez
└── Games\
    ├── minigolf\       ← oyun forkları buraya (emrtrn/minigolf vs.)
    ├── mini-racer\
    └── …
```

---

## Aşama 0 — Forge'u Temiz Template Haline Getir (Fork Açmadan Önce, Bir Kez)

Her fork bu durumu miras alır; ne kadar temizse her oyun o kadar temiz başlar.

1. Demo model temizliği + starter content standardını Forge `main`'de bitir ve commit'le.
2. Kenney araçlarını commit'le (`tools/asset-library-index.mjs`, katalog, TSV, `.gitignore`
   güncellemesi).
3. Forge `main`'i GitHub'a push'la:
   ```bash
   git push origin main
   ```

---

## Aşama 1 — Yeni Oyun Reposu Oluştur

### 1a. GitHub'da boş repo aç
GitHub → New repository → `minigolf` → boş (README olmadan) oluştur.

### 1b. Forge'u klonla, remote'ları ayarla
```bash
git clone https://github.com/emrtrn/Forge.git C:\Users\emret\Desktop\Games\minigolf
cd C:\Users\emret\Desktop\Games\minigolf

# Forge'u upstream yap; yeni origin = oyun reposu
git remote rename origin upstream
git remote add origin https://github.com/emrtrn/minigolf.git
git push -u origin main
```

Sonuç — iki remote:

| Remote     | URL                                    | Amaç                         |
| ---------- | -------------------------------------- | ----------------------------- |
| `origin`   | `github.com/emrtrn/minigolf.git`       | Oyunun kendi GitHub reposu    |
| `upstream` | `github.com/emrtrn/Forge.git`          | Platform güncellemelerini çek |

---

## Aşama 2 — Oyunu Kur

Oyun reposunda yapılacaklar (yalnızca `public/` ve `src/game` içinde):

1. **GDD yaz** → `docs/GDD.md`
   - Çekirdek döngü, asset listesi, gereken sistemler, dikey kesit.
   - Fikir havuzuna (`GameDesign/docs/kenney/KENNEY_GAME_IDEAS.md`,
     `C:\Users\emret\Desktop\GameDesign`) bakarak bağlam kur. Oyun tasarım
     fikirleri/GDD'ler artık **GameDesign** stüdyo deposunda yaşar — Forge
     yalnızca platform (engine/editor/builder) geliştirir (2026-07-04 karar).

2. **Asset'leri çek** — Kenney arşivinden (`C:/Users/emret/Documents/Kenney`)
   yalnızca ihtiyaç duyulan dosyaları `public/assets/...`'a kopyala.
   - Her asset için kaynak paket + CC0 lisans notunu `docs/ASSET_CREDITS.md`'ye ekle.
   - Arama: **Forge**'daki `tools/kenney/kenney-assets.tsv` (aranabilir index,
     Forge'da kalır — asset-çekme aracı) veya **GameDesign**'daki
     `docs/kenney/KENNEY_CATALOG.md` (paket/tema kataloğu).

3. **Oyun kurallarını yaz** → `src/game/` (GameMode, GameState, kurallar, HUD binding).
   - `engine/`, `editor/`, `builder/`'a oyun-özel kod **ekleme**.

4. **Layout data** → `public/layouts/`, `public/project.3dgame.json`.
   - Dev editor (`?editor`) ayni repo dosyalarina yazar: **Save Layout** aktif
     layout'u, snap ayarlarini ve World Settings degisikliklerini kaydeder;
     **Open Level** `project.3dgame.json` icindeki `editor.defaultScene`
     degerini degistirir; Content Browser create/rename/delete/import
     aksiyonlari `public/` altindaki asset/layout referanslarini gunceller.
     Editor/dev server acikken fork hijyeni icin `git status` kontrolunu
     aliskanlik yap; template/default layout'u istemeden kirletme.

---

## Aşama 3 — Forge Güncellemelerini Oyuna Çek

Forge'da genel bir iyileştirme yapıldığında, oyun reposunda:

```bash
git fetch upstream
git merge upstream/main
```

Oyun-özel değişiklikler `public/` + `src/game`'de kaldığı sürece çakışma
neredeyse olmaz. Çakışma olursa yalnızca bu iki klasörde çözülür.

> Alternatif: `git rebase upstream/main` — doğrusal tarih, tek kişilik akışta
> tercih edilebilir. Tercih duruma göre bırakıldı.

---

## Aşama 4 — Platform Eksiğini Forge'a Geri Besle

Oyun yaparken engine/editor'da eksik ya da hata bulunursa:

**Doğru yol — Forge'da düzelt, oyuna çek:**
```bash
# 1. Forge klasörüne geç
cd C:\Users\emret\Desktop\Forge

# 2. Düzeltmeyi yap, commit'le, push'la
git add <dosyalar>
git commit -m "fix: ..."
git push origin main

# 3. Oyuna dön, Forge'dan çek
cd C:\Users\emret\Desktop\Games\minigolf
git fetch upstream
git merge upstream/main
```

**Toplu otomasyon — Forge değişikliklerini oyunlara yay:**
Forge değişikliği commit'lenmiş ama push edilmemişse script Forge `main`'i
`origin/main`'e push eder. Sonra `C:\Users\emret\Desktop\Games` altındaki git
repo oyunlarda `upstream/main`'i fast-forward merge eder ve `origin/main`'e push
eder.

```bat
cd C:\Users\emret\Desktop\Forge
tools\sync-forge-to-games.bat
```

Sadece belirli oyunları güncellemek için:

```bat
tools\sync-forge-to-games.bat -Projects minigolf
```

Önce ne yapacağını görmek için:

```bat
tools\sync-forge-to-games.bat -DryRun
```

Güvenlik sınırları:
- Forge veya oyun reposunda uncommitted değişiklik varsa durur.
- Forge ve oyun repoları `main` branch'inde değilse durur.
- Oyun merge'i normal `git merge --no-edit upstream/main` çalışır; çakışma varsa
  Git durur ve manuel çözüm ister.

**İstisna — yanlışlıkla oyunda kodladıysan:**
```bash
# Oyundaki commit SHA'sını al
git log --oneline -5

# Forge'a geç, cherry-pick ile al
cd C:\Users\emret\Desktop\Forge
git remote add minigolf https://github.com/emrtrn/minigolf.git
git fetch minigolf
git cherry-pick <sha>
git push origin main
```

### Platform katkısı yaparken (engine/editor'a dokunuyorsan)

Forge çekirdeğine (engine/editor/builder) katkı verirken iki otomatik sınır
kapısını koru — ikisi de `build:verify` içinde ve CI'da çalışır:

- **`verify:imports`** (`builder/web/verify-imports.mjs`): modül sınırlarını
  kaynak düzeyinde tarar. `editor/*` **`@/game` import edemez** (editör generic
  kalır); editörün gösterdiği oyun verisi başlangıçta
  `@/editor/gameEditorRegistry` ile enjekte edilir (`src/main.ts` bağlar).
  Ayrıca `engine/*` üst katmanları, `game/*` editörü import edemez.
- **`verify:dist`** (`builder/web/verify-dist.mjs`): yeni bir **editor-only**
  modül/sembol çıkardığında (editör kodunu ayırırken), o sembolü
  `FAIL_TOKENS` listesine ekle — böylece production `dist/`'e sızarsa kapı
  kırmızıya döner. Yeni editör state store'ları, viewport controller'ları vb.
  bu listeye eklenmelidir.

---

## GDD Politikası

| Doküman | Repo | Açıklama |
| --- | --- | --- |
| `KENNEY_GAME_IDEAS.md`, `QUATERNIUS_GAME_IDEAS.md` | **GameDesign** `docs/kenney/`, `docs/quaternius/` | Genel fikir havuzu, tüm oyunlara ortak (2026-07-04'ten beri Forge'da değil) |
| `GAME_FORK_WORKFLOW.md` | **Forge** `docs/planned/` | Bu doküman — iş akışı referansı |
| `docs/GDD.md` | **Oyun reposu** | O oyuna özel tasarım dokümanı |
| `docs/ASSET_CREDITS.md` | **Oyun reposu** | O oyunda kullanılan Kenney asset'leri + lisans |

> **2026-07-04 politika notu:** Forge artık oyun tasarım fikri/GDD üretmiyor —
> yalnızca Forge platformuna (engine/editor/builder) yönelik geliştirme yapılır.
> `docs/kenney/` ve `docs/quaternius/` (katalog + fikir havuzu + GDD taslakları)
> `C:\Users\emret\Desktop\GameDesign\docs\` altına taşındı. Forge'da yalnız
> `tools/kenney/kenney-assets.tsv` + `tools/kenney/kenney-index.json` (asset arama
> index'i, `tools/asset-library-index.mjs` ile üretilir) kaldı — bunlar oyun
> kodlarken asset çekmek için Forge'un kendi geliştirme aracıdır, tasarım
> dokümanı değildir.

---

## Neden Ayrı Repo (Dal Değil)?

| Kriter | Ayrı repo ✅ | Uzun dal ❌ |
| --- | --- | --- |
| Bağımsız yayın (itch.io) | Her repo kendi CI/deploy'u | Dal yayın zorlaşır |
| GDD / issue tracking | Repo başına proje tahtası | Tek repo kalabalıklaşır |
| Çapraz bulaşma riski | Remote sınırı net | Yanlışlıkla merge riski var |
| Oyun sayısı arttıkça | Lineer (1 repo = 1 oyun) | Dal sayısı patlar |

---

## İleride: Scaffold Aracı

İkinci oyun açılmadan önce `tools/create-project.mjs` yazılacak (CLAUDE.md
backlog). Yapacakları:
- Forge'u hedef klasöre kopyala.
- `project.3dgame.json` ve layoutları sıfırla.
- Remote'ları otomatik kur.
- Boş `docs/GDD.md` + `docs/ASSET_CREDITS.md` şablonu oluştur.

İlk oyun için manuel fork yeterli; scaffold'un tam kapsamı ilk oyun sürecinde netleşir.

---

## Özet Kontrol Listesi (Yeni Oyun Açılırken)

- [ ] Forge `main` temiz ve güncel (`git push origin main`)
- [ ] GitHub'da boş oyun reposu oluşturuldu
- [ ] `git clone` + remote'lar ayarlandı (`upstream` = Forge, `origin` = oyun)
- [ ] `docs/GDD.md` yazıldı
- [ ] Asset'ler `public/assets/`'a çekildi + `docs/ASSET_CREDITS.md` dolduruldu
- [ ] Oyun kodu yalnızca `public/` + `src/game`'de
- [ ] İlk commit + push → `origin main`
