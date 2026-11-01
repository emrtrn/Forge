# Ridgebound — P1-B: Bağımsız oyun modülü ve küçük sahne

Tarih: 2026-10-31. Durum: **P1-B uygulandı; bağımsız build ve tam SP kabulü açık.**

Forge başlangıç commit'i: `fdb83d6f7ad90b6dbdd7aeba5d3394c018982b8b`, `main`.
P1-A/P1-B değişiklikleri henüz commit edilmedi. Ridgebound `main` dalında boş
uzak depodan klonlandı; henüz ilk commit'i yok. Tek başına bu SHA, test edilen
iki çalışma ağacını yeniden üretmez. P1-B işi için tarafımdan commit/push yapılmadı.

Oturum sonunda eşzamanlı su sistemi commit'leriyle Forge HEAD'i
`6329693cc109a79e67e275da9d508cdbd422ed71` oldu. Testler hareketli çalışma ağacında
yürütüldü; sonuçlar bu yeni SHA için sabitlenmiş, temiz bir kabul kapısı olarak
sunulmamalıdır. P1-B dosyaları hâlâ çalışma ağacındadır; son kabul snapshot'ı P2'de
ayrıca kaydedilecek. Eşzamanlı commit'ler geri alınmadı veya yeniden yazılmadı.

## Yerleşim ve sahiplik

- Ortak kaynak: `C:/Users/emret/Desktop/Forge`.
- Oyun deposu: `C:/Users/emret/Desktop/Games/Ridgebound`.
- Origin: `https://github.com/emrtrn/Ridgebound.git`.
- Ridgebound motor/editör kaynak kopyası, ikinci `node_modules` veya ayrı motor
  release sistemi içermez. Ortak bağımlılıklar Forge'un kilit dosyasıyla yönetilir.

Forge'da `tools/projectPaths.ts`, `vite.config.ts`, `src/main.ts`,
`src/project/ProjectSystem.ts` ve `tsconfig.json` seçilebilir oyun girişlerini
bağlar. `tools/run-game-project.mjs`, ortak geliştirme ve TypeScript kontrol
aracıdır. Import guard yeni oyun girişlerini GAME katmanı olarak sınıflandırır;
genel motor/editörün bu girişleri kullanması engellenir.

Ridgebound'da `src/game/gameModule.ts`, `src/game/editorCatalog.ts`,
`public/project.3dgame.json`, `public/assets/manifest.json` ve
`public/layouts/Prototype.level.json` bulunur. `tools/forge.mjs` yalnız gerçek
Forge aracını çağırır. Prototip, Forge'un template modülü/kataloğunu kopyalamadan
kullanıp kendi modül kimliğini, durum kartını ve editör katalog etiketini ekler.
Bu tercih M0'ın görev ve kargo durum modelini belirlemez.

Downloads/Offroad'daki beş tasarım belgesi, içerikleri değiştirilmeden
`Ridgebound/docs/design/` altına alındı. `docs/GDD.md`, eski Offroad adının artık
Ridgebound olduğunu ve kaynakların rolünü açıklar. Kaynak belgeler değiştirilmedi.

## Giriş sözleşmesi ve çalıştırma

```json
"game": {
  "module": "src/game/gameModule.ts",
  "editorCatalog": "src/game/editorCatalog.ts"
}
```

Yollar oyun köküne göredir. Bildirilen iki girişin de geçerli `src/game/*.ts`
dosyası olması gerekir. Bildirilen giriş bozuksa Forge modülüne geri düşülmez.
Alan bulunmayan eski template/veri-only projeler aynı eski modülle çalışır.
`entry: "forge:default"`, ortak Forge açılışının kullanıldığını belirtir;
oyun girişlerini gerçekten bağlayan alanlar yukarıdaki `game` alanlarıdır.

Ridgebound klasöründe:

```powershell
npm.cmd run check
npm.cmd run dev
```

Runtime: `http://127.0.0.1:5175/`; editör: `http://127.0.0.1:5175/?editor`.
Sunucu yalnız localhost'ta dinler. Başka port: `npm.cmd run dev -- --port 5185`.
Forge seçimi `FORGE_ROOT` veya Git dışında `forge.local.json` üzerinden yapılır;
varsayılan göreli konum `../../Forge` şeklindedir. IDE tsconfig'i bu varsayılan
yerleşime göre ayarlıdır; CLI kontrolü seçilen gerçek Forge'a göre çözümleme yapar.

`check`, gerçek Forge tsconfig'ini ve seçilen girişleri kullanarak hem ortak
açılışı hem oyun kaynaklarını type-check eder; oyun import sınırlarını da tarar.
Dev sunucusu için Vite dependency dedupe ayarlanmıştır. Browser'da doğrudan oyun
Three.js import'u ile ortak kaynak import'larının tek modül kullanması doğrulandı;
bu, bütün bağımlılıkların production build kabulü yerine geçmez.

## Doğrulama ve kanıtlar

| Kontrol | Sonuç |
|---|---|
| `npx.cmd tsc --noEmit` | GEÇTİ |
| Ridgebound: `npm.cmd run check` | GEÇTİ; oyun modülü/kataloğu ve ortak açılış birlikte |
| `node --test tests/builder/project-roots.test.mjs tests/builder/verify-imports.test.mjs` | 14 test GEÇTİ |
| `npm.cmd run build:verify` | GEÇTİ; üretim Forge build'i, 2177 slow-engine kontrolü, strict dist ve world-data dahil |
| `playwright.project.config.mjs`, `independent runtime` filtresi | 1 test GEÇTİ |
| Aynı config, `independent editor\|actual Ridgebound` filtresi | 2 test GEÇTİ |
| Mevcut `editor-authoring.spec.ts runtime-playflow.spec.ts` | 2 test GEÇTİ; template/veri-only proje akışı, 45.0 saniye |
| Dolu 5175 portuyla ikinci başlatma | Beklenen hata; ikinci süreç kapandı, çalışan sunucu korundu |

Tarayıcı kontrol kapsamı:

1. Harici geçici oyunun kendi modülünün gerçekten çalışması, kendi manifest
   başlığı, Three.js'in tek örneği ve sayfa/console hata kontrolü.
2. Editörde harici oyunun kendi katalog etiketinin gösterilmesi; menüden World
   Settings açma; bir küpü Details üzerinden değiştirme; kaydetme; disk verisini
   kontrol etme; reload sonrasında değerin korunması. Test yalnız geçici sahneyi
   değiştirdi; Forge manifesti değişmeden kaldı. `game` alanları kayıtta korundu.
3. Gerçek Ridgebound prototipinde başlık, kendi runtime kartı, canvas ve
   editörde kendi sahne elemanları/katalog etiketi. Gerçek Ridgebound sahnesine
   test kaydı yapılmadı. 1440×900 ekran görüntüleri incelendi; kart ekran içinde.

İlk browser denemeleri, oluşturduğum asset manifestindeki eksik `version`,
`generated`, `ktx2` alanlarını ve testin önce ana menüyü açması gerektiğini
ortaya çıkardı. Bunlar düzeltildi. Başarısız/yarıda kesilen denemeler kabul
kanıtı sayılmadı. Shell aktarımındaki Türkçe karakter bozulmaları UTF-8 olarak
düzeltildi ve gerçek ekran görüntüsünde kontrol edildi.

Yerel kanıtlar (Git dışı çalışma çıktıları):

- `.dev-server/p1b-project-tests.log`
- `.dev-server/p1b-build-verify.log`
- `.dev-server/p1b-runtime-check.log`
- `.dev-server/p1b-editor-check.log`
- `.dev-server/p1b-port-conflict.log`
- `.dev-server/p1b-forge-browser.log`
- `.dev-server/p1b-evidence/independent-runtime.png`
- `.dev-server/p1b-evidence/ridgebound-runtime.png`
- `.dev-server/p1b-evidence/ridgebound-editor.png`

Proje browser testlerinin çıktı kökü `.dev-server/project-browser-results`
olarak ayrıldı; varsayılan smoke çalışması bu kanıt alanını temizlemez.

## Korunan çalışma ve kalan sınır

Oturum sırasında Forge'un `Terrain.landscapes/landscape-1.terrain.json`,
`landscape-1.global.bin` ve `landscape-1.tiles/1_1.tile.bin` dosyalarında eşzamanlı
değişiklikler görüldü. Bunlar P1-B kapsamına alınmadı, düzenlenmedi veya geri
alınmadı. Başka kullanıcının aktif sahnesi test fixture'ı yapılmadı.

P1-C: bağımsız Ridgebound build/preview, oyun ve Forge kaynak durumlarının
birlikte kaydı, bağımlılık/build girdileri ve temiz ortam kurulumu. P2: tam
SP-01–SP-10 kabulü. Editörün mevcut edit-mode davranış/AI önizleme kayıtları bu
dilimde yeniden tasarlanmadı; seçilen oyun modülü Runtime/Play açılışına bağlıdır.
Bu rapor tam Model 2 veya M0 kabulü değildir. M0 nakliye/teslim/ödül/save kuralları
henüz uygulanmadı. Üç küp sürülebilir araç, depo veya teslimat noktası sayılmaz.

Kullanıcının açık talebiyle **Codex Security diff taraması yapılmadı**.
