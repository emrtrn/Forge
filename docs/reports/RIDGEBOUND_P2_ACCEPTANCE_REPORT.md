# Ridgebound — P2 ortak kaynak iş akışı kabul raporu

Tarih: 01.11.2026. **SP-01–SP-10 teknik kontrolleri GEÇTİ. Kullanıcı görsel ve
kullanım kabulünü onayladı; P2 kabulü tamamlandı.** Bu kabul M0 oyun kabulü veya
M0'a başlama/yayın yetkisi değildir. Kullanıcı ayrıca P2 kapsamı için commit ve
push talimatı verdi.

## Kaynak durumu ve kanıtın kimliği

Başlangıçta iki çalışma ağacı temizdi. HEAD, yerel `origin/main` ve salt okunur
`git ls-remote origin refs/heads/main` sonuçları eşleşti:

- **F:** Forge `923f6056a82b7baddfbcd1f603b04119c7d49838`, `main`.
  Ortak kaynak altyapısı `9fbc68b5`; Terrain/foam sahne commit'i `923f6056` korundu.
- **R:** Ridgebound `4031ea68601e484ed06e868c90049bc921ea47d6`, `main`.
- Uzaklar: `https://github.com/emrtrn/Forge.git` ve
  `https://github.com/emrtrn/Ridgebound.git`.

İlk sandbox Git kontrolünde Ridgebound sahiplik kontrolü durdu. Genel Git
ayarları değiştirilmedi; salt okunur komutlarda yalnız bu komut için
`-c safe.directory=C:/Users/emret/Desktop/Games/Ridgebound` kullanıldı.
Sandbox içindeki ağ kontrolü başarısız oldu; izinli salt okunur tekrar iki uzak
SHA'yı doğruladı. Bu ilk denemeler başarı kanıtı sayılmadı.

**F+Δ**, yukarıdaki Forge commit'i ve bu oturumun commit edilmemiş P2
düzeltme/test dosyalarıdır. SHA tek başına son test durumunu yeniden üretmez.
Tam test/kod farkı `.dev-server/p2-source.patch`, dosya hashleri
`.dev-server/p2-source-state.json` içindedir. Patch SHA-256:

`c0c5d55864b658747c883ce5d2e688246b98e390b529bb349f248574cde19a6d`.

Build girdileri ayrıca aşağıdaki arşivde korunur. Ridgebound kaynakları teknik
doğrulamada değiştirilmedi; o aşamanın son Git kontrolünde oyun ağacı temiz kaldı. Forge'da
yalnız bu raporda belirtilen kod/test/iş akışı belgeleri değişti; `public/`
altında sahne değişikliği yok. Son kontrolde eşzamanlı, Git dışı
`docs/planned/AO_SURFACE_OCCLUSION_FIX_PLAN.md` görüldü; bu P2 çalışmasına ait
değildir, okunmadı/değiştirilmedi ve kapsam dışında korundu.
Geçici kaynak probu kaldırıldı. Teknik doğrulama aşamasında commit/push/merge
veya yayın yapılmadı. Sonraki commit/push yetkisi aşağıdaki kabul kaydındadır.
Codex Security taraması kullanıcının talebiyle çalıştırılmadı.

## Önceki kanıtların değerlendirilmesi

P1-A kök izolasyonunu; P1-B bağımsız modül/katalog, browser save/reload ve gerçek
Ridgebound açılışını; P1-C statik artifact ve yeniden üretimi kanıtlıyordu.
Ancak testler son iki temiz commit öncesinde hareketli çalışma ağaçlarında
alınmıştı. Bu nedenle güncel kaynak için proje izolasyonu, Forge gate'i,
bağımsız proje ve Forge browser akışları, gerçek oyun açılışı, build ve temiz
yeniden üretim yenilendi. Açık kalan import/sidecar ve autosave kapsamı eklendi.

P1-C üretim browser testi tekrar edilmedi: yeni kök build'in **bütün dosya
envanteri digest'i**, browser'da yalnız dist kopyasıyla sınanmış P1-C kök
artifact'ının digest'iyle aynı. Kaynaktan bağımsız bu artifact kanıtı SP-07'de
yeniden kullanıldı. Alt dizin build altyapısı değişmedi; eski alt dizin başarısı
güncel kaynakla yeniden çalıştırılmış gibi sunulmaz.

## Kapatılan eksik

Bazı içerik ve game-data doğrulayıcıları baştaki `/` karakterini silerek mutlak
yolu göreli kabul ediyordu. Yeni gerçek HTTP testinde
`/__import-asset?dir=/outside&name=Rejected.gltf` düzeltmeden önce **200** döndü
(`.dev-server/p2-import-before.log`). Dışarı yazma gerçekleşmedi; dosya seçili
projenin `public/outside` alanına yönleniyordu. Buna rağmen SP-06 açık ret
koşulu sağlanmıyordu.

`tools/saveValidator.ts` artık normalize etmeden önce baştaki slash/backslash,
drive/colon ve NUL içeren yolları reddeder. Import/reimport, create,
rename/delete/transfer, open-level, game-data ve World Recipe aynı göreli yol
kuralını kullanır. Göreli Windows ayraçları ve sondaki slash desteği korunur.
Mevcut traversal, junction, allowlist ve gerçek kök kontrolleri korunmuştur.
Yeni manifest veya sidecar alanı eklenmedi. Genel düzeltme yalnız Forge'dadır;
Ridgebound'a motor/validator kopyası taşınmadı.

## SP kabul tablosu — teknik kapsam

Her satırdaki **F+Δ / R**, yukarıda tam SHA ve patch hash'i verilen kaynak
durumudur. Kısaltılmış kanıt adları sonraki bölümde gerçek dosyalara bağlanır.

| ID | Durum | Kaynak | Somut kanıt ve kapsam |
|---|---|---|---|
| SP-01 | GEÇTİ | F+Δ / R | Ridgebound `git ls-files`: oyun modülü/kataloğu, public, belgeler ve ince araç çağırıcısı; engine/editor ağacı yok. Gerçek oyun browser açılışı ve 691 Forge + 19 oyun girdili build, kopyasız ortak kaynakla geçti. |
| SP-02 | GEÇTİ | F+Δ / R | `game-entry.spec.mjs`: bağımsız modül badge'i ve tek Three.js modülü; bağımsız katalog etiketi, save/reload/Play. Gerçek Ridgebound başlığı, `ridgebound.prototype`, kendi sahne outliner'ı ve katalog etiketi. `project-roots` testinde bildirilen girişler gerçekten alias olur; bozuk giriş fallback yapmaz. Kanıt: B1/B2/B3. |
| SP-03 | GEÇTİ | F+Δ / R | Forge `engine/p2-shared-<uuid>.ts` içinde testin sahip olduğu geçici probe, çalışan bağımsız oyunda `before` gösterdi; yalnız Forge dosyası `after` yapılıp reload edilince oyun `after` gösterdi. Oyun modülü byte/hash olarak değişmedi (`3b8b89ae…893d5b`). Probe sonra kaldırıldı. B1; gerçek ortak validator düzeltmesi de B2'nin kayıt yolunda kullanıldı. Reload kanıtıdır, kesintisiz HMR garantisi değildir. |
| SP-04 | GEÇTİ | F+Δ / R | B1 Forge probu yalnız Forge'da değişti; oyun kaynak modülü aynı kaldı. B2'nin manuel kayıt/autosave'i yalnız bağımsız geçici oyuna yazdı. T1 kendi proje kökünde behavior oluşturdu. Son Git kontrolünde Ridgebound temiz ve Forge public değişmemiş; genel düzeltme Forge'da. Gerçek Ridgebound sahnesi bu madde için değiştirilmedi. |
| SP-05 | GEÇTİ | F+Δ / R | T1 iki geçici projede eşzamanlı canlı sunucu: save/layout/editor/game-data, create, behavior, rename/delete ve Git varsayılanları. Ek test: glTF import/reimport, 409 overwrite reddi, collision sidecar save/rename/copy/delete; ikinci projenin bütün fixture dosyaları byte düzeyinde aynı. B2 gerçek 500 ms World Settings autosave, disk kontrolü ve reload; ayrıca manuel save/Play. Her dosya middleware'inin seçili `project.publicPath` veya sınırlandırılmış `sourcePath` kullanması kodda incelendi. |
| SP-06 | GEÇTİ | F+Δ / R | T1 eksik/boş/bozuk kök ve manifest, bozuk oyun girişleri, traversal, mutlak Windows/Unix/UNC yollar, junction ile statik okuma ve yazma reddi. Yeni test import/reimport/create/rename/delete/transfer/open-level/game-data için açık mutlak yol reddini sınar. T2 World Recipe için aynı regresyonu kapsar. Forge public fallback yok. |
| SP-07 | GEÇTİ | F+Δ / R | D1 yeni kök artifact strict dist kontrolü, makine yolu/kaynak sızıntısı envanteri ve tekil ortak bağımlılık kaydı. Çıktı P1-C statik browser artifact'ıyla birebir aynı digest'e sahip: kendi modülü/çizilmiş sahne, `?editor` ile editör yok, dist-only kopyada kaynak yok ve yazma reddi. P2 preview komutu tam D1 kimliğini açtı; POST save 404. Vite preview `/src/main.ts` isteğine SPA HTML fallback verir (200 text/html), kaynak TypeScript sunmaz. |
| SP-08 | GEÇTİ | F+Δ / R | Ortak kaynak değişiminden sonra B1 açılış; B2 manuel save, gerçek autosave, reload ve Play modül açılışı. B3 gerçek Ridgebound açılışı, W girdisiyle render edilen kamera görünümünün değişmesi, runtime/editör hatasız açılışı. Gerçek sahne yazılmadı. Temel oynanış burada mevcut prototipin serbest kamerasıdır; nakliye/araç/M0 oyunu değildir. |
| SP-09 | GEÇTİ | F+Δ / R | D1, iki kaynak commit'i ve dirty bilgisi, 691/19 girdi, kilit/paket sürümleri, snapshot ve çıktı hashleri içerir. `verify-build`: boş geçici ortam, kilitli offline `npm ci`, canlı kaynak/node_modules bağı olmadan derleme; 27 dosya byte düzeyinde eşleşti. `reproduction.json`: sourceDigestsMatch/outputDigestMatches=true, usedLiveSourceLinks=false. |
| SP-10 | GEÇTİ | F+Δ / R | T0 tam Forge gate'i: TypeScript, import/fixture/release/proje kontrolleri, üretim build, 2186 slow-engine kontrolü, strict dist ve world-data. Son küçük World Recipe değişikliği T2 ve son açık `tsc --noEmit` ile ayrıca doğrulandı. B4 mevcut Forge örnek editör yerleştirme/transform/undo/save/reload/Play ve runtime save/load/travel: 2 test geçti. |

Dosya sınırı kanıtı, ortak çözümleyicinin kod incelemesi ile temsilî gerçek HTTP
işlemlerinin birleşimidir; her sidecar türünün bütün UI kombinasyonları tek tek
sınanmış değildir. Başka yerel süreçlerin eşzamanlı dosya sistemi değişimlerine
karşı OS sandbox veya bütün cihazlarda görsel/performance kabulü iddia edilmez.

## Çalıştırılan doğrulamalar

Ortam: Windows, Node `v24.19.0`, kilitli Playwright Chromium; proje browser
kontrolleri 1440×900. Başarı kayıtları:

| Kod | Komut / kanıt | Sonuç |
|---|---|---|
| T0 | `npm.cmd run build:verify`; `.dev-server/p2-build-verify.log` | GEÇTİ; 2186 motor kontrolü, 5 project-roots ve 5 project-build testi dahil. |
| T1 | T0 içindeki `node --test tests/builder/project-roots.test.mjs` | 5 test GEÇTİ; genişletilmiş gerçek HTTP kapsamı dahil. |
| T2 | `node tools/run-engine-tests.mjs --filter "world recipe"`; `.dev-server/p2-worldrecipe.log` | 9 GEÇTİ; 2177 atlandı. Bu odaklı sonuç tam gate yerine sunulmaz. |
| T3 | Son `npx.cmd tsc --noEmit`; `.dev-server/p2-final-tsc.log` | GEÇTİ; ardından oyun+ortak açılış type-check'i D1'de geçti. |
| B1 | `game-entry.spec.mjs`, ortak kaynak ve independent runtime; `.dev-server/p2-project-browser.log` | İki ilgili test GEÇTİ. İlk toplam koşu 3 geçti/1 kaldı; tamamı başarılı gibi sunulmaz. |
| B2 | Aynı spec, yalnız `independent editor`; `.dev-server/p2-editor-recheck.log` | 1 GEÇTİ; save/autosave/reload/Play. |
| B3 | Aynı spec, yalnız `actual Ridgebound`; `.dev-server/p2-ridgebound-recheck.log` | 1 GEÇTİ; W kamera hareketi eklendikten sonra salt okunur tekrar. |
| B4 | `editor-authoring.spec.ts runtime-playflow.spec.ts`, `FORGE_SMOKE_PORT=5297`; `.dev-server/p2-forge-browser.log` | 2 GEÇTİ; geçici Forge smoke projesi. |
| D1 | `node tools/run-game-project.mjs build --project C:/Users/emret/Desktop/Games/Ridgebound`; `.dev-server/p2-ridgebound-build.log` | GEÇTİ; Ridgebound npm build çağırıcısının kullandığı aynı ortak araç. |
| D2 | Aynı araç `verify-build --project ...`; `.dev-server/p2-reproduce.log` ve D1 `reproduction.json` | GEÇTİ; 235 kilitli paket boş geçici ortamda offline kuruldu, 27 dosya eşleşti. |
| D3 | Ridgebound `npm.cmd run preview -- --port 4186`; `.dev-server/p2-preview-http.json` | GEÇTİ; tam D1 artifact'ı, runtime manifest, kaynak TS yok ve save POST 404. |

T0'dan sonra World Recipe'nin bir satırlık yol normalizasyonu aynı yardımcıya
bağlandı ve ilgili regresyon eklendi; bu son fark T2/T3/D1/D2 ile kontrol edildi.
Tam geniş gate gerekçesiz tekrarlanmadı. Browser'da ilk yeni autosave kontrolü,
küp yerleştirmenin autosave tetiklediğini yanlış varsaydığı için kaldı. Ürün
değiştirilmedi; test gerçek World Settings autosave tetikleyicisine düzeltildi.
Son B2 başarılıdır. Başarısız ilk deneme kabul başarısı sayılmadı.

## Build kimliği

Oyun kökü: `C:/Users/emret/Desktop/Games/Ridgebound`.
Build: `builds/20261101T075122497Z-e0d04053-18b00330/`.

- Forge commit: **F**, dirty=true; girdi sayısı 691.
- Oyun commit: **R**, dirty=false; girdi sayısı 19.
- Forge girdi digest: `572ef9d21a2926075db96af40ab2e0131c07889f23ee3bc73e17fcff49d1aeb2`.
- Oyun girdi digest: `e0d04053bdc9ae8ee86db984a66951902ecd5314b6d1d849ce13cbb20f898f2f`.
- Kilit SHA-256: `d32312276a79399ccd7d202e59d2c4b82711f4f84d89cf79e74e5adb4b429c73`.
- `inputs.json.gz` SHA-256: `63c17cf4f1a53ca465fceac85812bb26744d97c9b573fde4cc8f2e5b6cf5a87e`.
- Çıktı digest: `43e3fe016a1400f602e8343c1042cc901843eaebf305cb9b5eeda55d6cd40b8b`.
- `reproduction.json`: passed; 27 dosya; kullanılan kurulum
  `npm ci --offline --ignore-scripts --no-audit --no-fund`.

Web çıktısı yalnız `dist/` içeriğidir. `build-record.json`, `inputs.json.gz` ve
`reproduction.json` yerel kanıttır. Three.js 0.184.0, Rapier 0.19.3, Recast
0.43.1 ve meshoptimizer 1.1.1 birer ortak paket kökünden bundle edilir. Kayıt
şemasında `gameDeclared: null`, M0 save şemasının henüz tanımlanmadığını belirtir.

## Görsel kanıt ve kullanıcı kabulü

Görüntüler açılıp incelendi: prototip zemin/bloklar ve Türkçe durum kartı
görünüyor; runtime kartı, editör araç çubuğu, outliner, viewport ve Details
1440×900 içinde. Kartta veya temel kontrollerde görünür kesilme/üst üste binme
görülmedi. Bu inceleme kullanıcının sanat, kamera hissi veya oynanış kabulü değildir.

- `.dev-server/project-browser-results/game-entry-actual-Ridgebou-0a075-hout-changing-authored-data/ridgebound-runtime.png`
- Aynı klasörde `ridgebound-editor.png`.
- `.dev-server/p2-ridgebound-recheck/game-entry-actual-Ridgebou-0a075-hout-changing-authored-data/`:
  son kamera girdisi kontrolünün runtime/editor görüntüleri.
- `.dev-server/p2-editor-recheck/game-entry-independent-edi-78abe-e-the-selected-game-s-files/independent-editor.png`.
- Yeniden kullanılan P1-C dist-only browser kanıtı:
  `.dev-server/p1c-production-browser.log` ve `.dev-server/p1c-evidence/`.

**Kullanıcı kabulü — GEÇTİ (01.11.2026):** kullanıcı, runtime/editör görünümü,
prototip kamera kontrolleri, editör/Play kullanımı ve bağımsız preview için
sunulan kontrol adımlarından sonra şu onayı verdi:

> “P2 görsel ve kullanım kabulünü onaylıyorum” commit + push yap

Bu beyan kullanıcı kabulünün kanıtıdır; otomatik test sonucu olarak sayılmaz.
Teknik SP kapısı ve kullanıcı kabulü birlikte **P2'yi kapatır**. Nakliye/kargo/
teslim/ödül, araç oynanışı ve M0 save kabulü bu çalışmanın dışındadır ve uygulanmamıştır.

Kapanış kontrolünde Ridgebound'da `README.md`, `.vscode/` ve
`tools/open-dev-server.ps1` için eşzamanlı değişiklikler görüldü. Bunlar P2
doğrulama snapshot'ına ait değildir; değiştirilmeden ve commit kapsamına
alınmadan korunur. Forge'daki ayrı AO planı da kapsam dışında kalır. P2 commit'i
yalnız Forge'daki P2 kod/test/belge dosyalarını içerir; sahne veya build arşivi içermez.

Commit öncesi son kontrol (`.dev-server/p2-precommit.log`): `npx.cmd tsc --noEmit`
geçti; project-roots ve game-project-build paketlerinde toplam 10 test geçti.
İlgili content/import/game-data/World Recipe filtresinde 27 motor kontrolü geçti,
2159 kontrol atlandı. Bu odaklı koşu, yukarıdaki tam T0 gate'inin yerine geçmez;
kod/test dosyalarının T0 ve son odaklı doğrulama snapshot'ıyla aynı olduğu
SHA-256 karşılaştırmasıyla ayrıca kontrol edildi. Kapanışta yalnız kabul belgeleri güncellendi.

## İş akışı belgeleri ve devir

Forge README, `docs/architecture/ARCHITECTURE.md`, `LAUNCH_WORKFLOW.md` ve
ortak kaynak planının SP tablosu gerçek uygulamaya bağlandı. Fork sync aracına
yalnız Model 1 kapsam açıklaması eklendi; merge/push davranışı çalıştırılmadı
ve değiştirilmedi. Ridgebound için `sync-forge-to-games` kullanılmaz; motor
düzeltmesi Forge'da yapılır, oyun kendi dev/build komutlarıyla aynı kaynağı kullanır.
Ridgebound README/GDD zaten doğru sahiplik ve M0 sınırını anlattığı için değişmedi.
Bağımsız motor release sistemi, launcher ve eski oyun migrasyonu kurulmadı.

Kanıt logları `.dev-server/` altında Git dışındadır; build arşivi de oyun
deposunda Git dışındadır. Rapor ve test kodu incelemeye hazırdır; gelecekte bir
kaynak değişikliği bu kabul snapshot'ına otomatik dahil olmaz.
Bu oturumun 5186 dev ve 4186 preview sunucuları doğrulama sonunda kapatıldı.
