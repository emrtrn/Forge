# Ridgebound — P1-A: Açık proje kökü ve dosya izolasyonu

Tarih: 2026-10-31. Durum: **P1-A teknik dilimi tamamlandı; Model 2 / SP kabulü açık.**

Başlangıç Forge commit'i: `fdb83d6f7ad90b6dbdd7aeba5d3394c018982b8b`, dal `main`.
Doğrulama bu commit üzerindeki henüz commit edilmemiş P1-A değişiklikleriyle
yapıldı; başlangıç SHA'sı değişiklikleri tek başına yeniden üretmez.

## Başlangıç ve kapsam

- Forge başlangıç çalışma ağacında `git status --short` değişiklik göstermedi.
- Mevcut `.dev-server/integration-worktree` worktree'sine müdahale edilmedi.
- `C:/Users/emret/Desktop/Games/Ridgebound` mevcut ve boştu; yerel Git deposu yoktu.
- GitHub `emrtrn/Ridgebound` deposu mevcuttu; branch listesi boştu.
- Ridgebound'a dosya yazılmadı; Forge/Ridgebound için branch, commit, push veya
  uzak depo değişikliği yapılmadı. Git varsayılanı testi yalnız geçici test
  deposunda kendi fixture commit'ini oluşturur.

## Yapılan değişiklik

| Dosya | İşlev |
|---|---|
| `tools/projectPaths.ts` | Açık proje seçimi; public/source yolu sınırları; mevcut yol bileşenlerinde symlink/junction reddi |
| `vite.config.ts` | Sunucuya özel proje bağlamı; statik public ve editör işlemlerinin aynı kökü kullanması; seçili proje Git varsayılanları |
| `tests/smoke/start-server.mjs` | Geçici test projesini `process.chdir` yerine açık kökle seçme |
| `tests/builder/project-roots.test.mjs` | İki canlı sunucu ve iki geçici proje ile gerçek HTTP işlemleri ve yol reddi |
| `package.json` | `verify:project-roots` komutu ve `build:verify` bağlantısı |

Proje seçimi yalnız sunucunun ortam değişkeninden gelir; HTTP isteği proje kökü
seçemez. `FORGE_PROJECT_ROOT` verilmezse varsayılan kök config dosyasının bulunduğu
Forge'dur; işlem çalışma dizinine bağlı değildir. Açık seçim boş, eksik veya
geçersizse başlatma hata verir. Bu dilim `publicDir: "public"` düzenini destekler.

Manifest, sahne, terrain ve asset sidecar işlemleri ortak public yol çözümleyicisini
kullanır. Behavior üretimi yalnız seçili projenin `src/game/scripts/*.ts` alanına
yazar. Git varsayılanları için seçili kökün kendi Git deposuna sahip olması
gerekir; üst klasörün deposuna sessizce geçilmez.

Static public okumaları da bağlantılı dosya/klasörlerin proje dışına erişim
vermemesi için kontrol edilir. Var olan localhost yazma sınırı ve içerik
validator'ları korunur. Yol kontrolleri, başka bir yerel sürecin eşzamanlı dosya
sistemi değişikliklerine karşı OS seviyesinde sandbox iddiası taşımaz.

## Kullanım

Forge klasöründe, **geçerli manifesti ve public dizini hazırlanmış** bir proje için:

```powershell
$env:FORGE_PROJECT_ROOT = 'C:\Users\emret\Desktop\Games\Ridgebound'
npm.cmd run dev:local
```

`?editor` editörü, normal adres runtime'ı açar. Seçim sunucu ömrü boyunca sabittir;
proje değiştirmek için sunucuyu kapatıp yeni seçimle başlatmak gerekir.
Ridgebound henüz boş olduğundan bu komut şu anda anlaşılır bir başlatma hatasıyla
durur; Forge verisine geri düşmez.

Forge'un kendi projesine dönmek için değişkeni kaldırıp sunucuyu yeniden başlat:

```powershell
Remove-Item Env:FORGE_PROJECT_ROOT -ErrorAction SilentlyContinue
npm.cmd run dev:local
```

## Doğrulama

Ortam: Windows, Node `v24.19.0`; tarayıcı testleri Playwright Chromium,
`FORGE_SMOKE_PORT=5287`. Gerçek kullanıcı sahneleri test fixture'ı yapılmadı.

| Komut | Sonuç |
|---|---|
| `npx.cmd tsc --noEmit` | GEÇTİ |
| `node --test tests/builder/project-roots.test.mjs` | 3 test GEÇTİ |
| `npm.cmd run test:engine` | 2177 kontrol GEÇTİ |
| `npm.cmd run build:verify` | GEÇTİ; yeni izolasyon testleri, build, slow engine, dist ve world-data kapıları dahil |
| `npx.cmd playwright test editor-authoring.spec.ts runtime-playflow.spec.ts` | 2 test GEÇTİ, 53.7 saniye |

Yeni testler: geçersiz kök/manifest; yeni public ve kaynak yolları; iki canlı
sunucuda farklı manifestler; layout ve editor ayarlarını kaydetme; game-data
kaydı ve kendi Git HEAD'inden varsayılan okuma; behavior dosyası oluşturma;
klasör/asset oluşturma, klasör rename/delete; traversal ve mutlak yol reddi;
junction üzerinden statik okuma, oluşturma, rename/delete/transfer reddi.
İkinci projenin örnek verisi ve Forge manifesti değişmeden kaldı.

Browser testleri: editörde yerleştirme/transform/undo/save/reload/Play;
runtime'da boot, save/load UI ve level travel. Bunlar Ridgebound nakliye oyunu
veya görsel/oynanış kabulü değildir.

Yerel loglar (Git dışında, bu çalışma ortamında):

- `.dev-server/p1a-engine.log`
- `.dev-server/p1a-build-verify.log`
- `.dev-server/p1a-browser.log`

Esbuild ilk sandbox çalıştırmasında üst dizin erişimi nedeniyle başlayamadı;
testler izin verilen sandbox dışı çalıştırmada tamamlandı. Bu başarısız ilk
deneme test başarısı olarak sayılmadı.

## Kalan iş ve kabul sınırı

- **P1-B:** Ridgebound deposunu yerelde hazırlamak; gerçek oyun modülünü ve editör
  kataloğunu seçilebilir girişler olarak bağlamak; küçük sahneyle başlatmak.
- **P1-C:** Ridgebound'a ait build girdileri/çıktısı ve preview; bağımlılıkların
  tekilleştirilmesi, iki kaynak durumunun kaydı ve temiz ortamda yeniden kurulum.
- **P2:** SP-01–SP-10 için tam kanıt ve kullanıcı kabulü. Bu rapor yalnız kök
  seçimi/izolasyon dilimini kapatır; SP tablosunu topluca GEÇTİ yapmaz.
- **M0:** Nakliye, kargo, tek ödeme ve oyun kayıt modeli henüz uygulanmadı.
- Dev-server ve dosya sınırları değiştiği için **Codex Security diff taraması
  önerilir**. Kullanıcı başlatmadığından tarama çalıştırılmadı.

Bağımsız motor release/paket sistemi, launcher, eski oyun migrasyonu veya motor
kopyası oluşturulmadı. Oyun modülü şimdilik Forge'un kendi `src/game` girişinden
yüklendiği için yalnız veri kökü seçimi tam Model 2 desteği olarak sunulmamalıdır.
