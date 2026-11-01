# Ridgebound — P1-C bağımsız build ve yeniden üretim raporu

Tarih: 01.11.2026. Durum: **P1-C teknik dilimi tamamlandı. P2/SP ve M0 kabulü açık.**

## Sonuç

Ridgebound kendi oyun modülü ve içerikleriyle statik üretim çıktısı alır.
Çıktı başka bir klasöre kopyalandığında Forge kaynaklarına ve geliştirme
sunucusuna erişmeden açılır. Yeni kaynak değişiklikleri eski build'i değiştirmez.
Preview açılışta seçtiği doğrulanmış build'i sunar; sonraki build'e geçmek için
preview yeniden başlatılır.

Forge kaynaklarına bağımsız sürüm numarası verilmedi, paket registry/release veya
oyun migration sistemi kurulmadı. P1-A/P1-B çalışmaları ve kullanıcının sahneleri
korundu. Bu çalışma için commit/push/yayın veya Codex Security taraması yapılmadı.

## Komutlar ve çıktı düzeni

Ridgebound klasöründe:

```powershell
npm.cmd run build
npm.cmd run preview
npm.cmd run verify:build
```

Üretim preview: `http://127.0.0.1:4175/`. Geliştirme/editör sunucusundan ayrıdır.
Alt dizin build'i: `npm.cmd run build -- --base /ridgebound/`.

```text
Ridgebound/builds/<kimlik>/
  dist/                 # Yalnız bunun içeriği statik siteye yayımlanır
  build-record.json     # Kaynak/bağımlılık/çıktı kaydı; web çıktısı değil
  inputs.json.gz        # Kaynak kanıtı; web çıktısı değil
  reproduction.json     # Temiz ortamda yeniden derleme sonucu
```

`builds/` ve `.forge/` Git dışındadır. Eski build'ler silinmez. Başarısız build,
son doğrulanmış build işaretçisini değiştirmez. Preview, çıktı dosyaları sonradan
değişmişse açmayı reddeder. Girdi arşivi yalnız kanıttır; oyun deposunda ikinci
bir düzenlenebilir Forge motor/editör ağacı oluşturulmaz. Yeniden üretim için
açılan geçici kaynak ağacı doğrulamadan sonra temizlenir.

## Son build kayıtları

Oyun kökü: `C:/Users/emret/Desktop/Games/Ridgebound`.

| Alan | Kök build | Alt dizin build |
|---|---|---|
| Kimlik | `20261101T072703198Z-e0d04053-2345ea71` | `20261101T072508193Z-e0d04053-292b6f7e` |
| Base | `/` | `/ridgebound/` |
| Çıktı dosyası | 27 | 27 |
| Toplam çıktı | 6,284,056 bayt | 6,284,155 bayt |

Kök çıktı digest'i:
`43e3fe016a1400f602e8343c1042cc901843eaebf305cb9b5eeda55d6cd40b8b`.

Son kaynak kaydı Forge commit'i:
`d769813ed32201659d48988e027688815c39571c`.
Forge çalışma ağacı değiştirilmiş; Ridgebound henüz ilk commit'ini içermiyor.
Bu nedenle SHA tek başına kabul/reproduction kanıtı sayılmaz. Kök build 691
Forge girdi dosyasını ve 19 oyun girdi dosyasını byte/hash içerikleriyle kaydeder.
Canlı Forge `public/` alanı kaynak arşivine veya Ridgebound web çıktısına alınmaz.

Kök Forge girdi digest'i:
`863c478777b9347aa946ef6fdfe543d207063e15ebc2ce544c22d60fc743369e`.

Oyun girdi digest'i:
`e0d04053bdc9ae8ee86db984a66951902ecd5314b6d1d849ce13cbb20f898f2f`.

Kilit dosyası SHA-256:
`d32312276a79399ccd7d202e59d2c4b82711f4f84d89cf79e74e5adb4b429c73`.

Kök girdi arşivi SHA-256:
`a7036de0d40228585f15026690d360b6d15c9d336043acd7c7abc509ebcb0c88`.

Çalışma sırasında kullanıcıya ait ayrı su sistemi commit'iyle HEAD ilerledi;
hiçbir commit geri alınmadı veya yeniden yazılmadı. Build sırasında kaynak
hashleri tekrar kontrol edilir; ilgili girdiler değişmişse build kabul edilmez.

## Üretim ve bağımlılık sınırı

Üretim manifesti oyun kaynak girişlerini, local preview URL'sini ve araç
komutlarını taşımaz. Ortak açılış derlenerek `index.html` üzerinden çalışır.
Editör chunk'ları/dev uçları için `verify-dist --strict` ve yerel dosya yolları
için ek çıktı kontrolü geçer. Kaynaklar, source map'ler ve `node_modules` web
çıktısına alınmaz. Bu kontroller Codex Security taraması değildir.

Bundle içindeki ortak paket kökleri kontrol edildi:

| Paket | Sürüm | Örnek sayısı |
|---|---|---|
| Three.js | 0.184.0 | 1 |
| Rapier compat | 0.19.3 | 1 |
| Recast core | 0.43.1 | 1 |
| meshoptimizer | 1.1.1 | 1 |

Kurulu birinci seviye paket sürümleri kilit dosyasıyla karşılaştırılır.
Ridgebound'un özel M0 save şeması henüz yoktur; build kaydı `gameDeclared: null`
yazar ve genel kayıt uygulamasını kaynak hashleriyle korur. M0 save/load ve tek
ödeme kabulü yapılmış sayılmaz.

## Doğrulama

Ortam: Windows, Node `v24.19.0`, Playwright Chromium; 1440×900.

| Kontrol | Sonuç |
|---|---|
| Kök ve `/ridgebound/` için `npm.cmd run build` | GEÇTİ; oyun/ortak açılış TypeScript kontrolü dahil |
| `npm.cmd run verify:project-build` | Son araç değişiklikleriyle 5 test GEÇTİ |
| `npm.cmd run build:verify` | GEÇTİ; TypeScript, import/proje kontrolleri, 2186 motor kontrolü, strict dist ve world-data |
| `production-build.spec.mjs` | Kök/alt dizin: 2 test GEÇTİ, 6.4 saniye |
| Son `npm.cmd run verify:build` | GEÇTİ; 27 çıktı dosyası birebir eşleşti |
| `npm.cmd run preview` | GEÇTİ; 4175'te son doğrulanmış statik build açıldı |

Tam gate sonrasında kurulum geri dönüşü ve preview ayarı için yapılan küçük
`.mjs` değişiklikleri odaklı 5 test, son gerçek build/temiz yeniden derleme ve
preview açılışıyla doğrulandı. Geniş gate gereksiz yere tekrarlanmadı.

Browser testi yalnız `dist` içeriğini ayrı geçici klasöre kopyalayıp düz HTTP
sunucusunda açtı. Normal açılış, başlık/kendi oyun modülü, çizilmiş 3B sahne,
`?editor` ile editör açılmaması, kaynak dosyalarının 404 olması ve POST kayıt
isteğinin reddi sınandı. Tarayıcı hatası kalmadı; statik dosyalar değişmedi.
Son kök build, browser'da sınanan kök build'le aynı çıktı digest'ine sahiptir.

İlk statik deneme, prototipin eksik isteğe bağlı meshpaint/foliage sidecar'larını
ortaya çıkardı. Yalnız Ridgebound'a geçerli boş sidecar'lar eklendi; genel
yükleyiciler veya kullanıcının Forge sahnesi değiştirilmedi. Görüntü testi,
soğuk tarayıcıda ilk 3B çizimi gözleyerek ekran görüntüsü alır.

Temiz kurulum ilk denemede eksik npm önbelleğinde durdu. Araç yalnız `ENOTCACHED`
durumunda aynı kilitle eksik paketleri indirerek devam edecek şekilde düzeltildi.
Son doğrulama önbellekten `npm ci --offline --ignore-scripts --no-audit --no-fund`
ile 235 paketi boş geçici ortama kurdu. Kaynaklar ve bağımlılıklar canlı
klasörlere bağlanmadan derlendi; bütün çıktı hashleri aynıydı. Yeni makinede
kilitli paketler için uygun npm önbelleği veya registry erişimi gerekir.
Farklı işletim sistemi/Node sürümü veya bütün cihazlar için kabul iddia edilmez.

## Yerel kanıtlar ve kalan iş

- `.dev-server/p1c-root-build.log`
- `.dev-server/p1c-subpath-build.log`
- `.dev-server/p1c-build-verify.log`
- `.dev-server/p1c-production-browser.log`
- `.dev-server/p1c-reproduce.log`
- `.dev-server/p1c-evidence/production-root-20261101.png`
- `.dev-server/p1c-evidence/production-subpath-20261101.png`
- Kök build klasöründeki `build-record.json`, `inputs.json.gz`, `reproduction.json`.

Terrain/foam/level dosyalarındaki eşzamanlı kullanıcı değişiklikleri korunmuştur;
P1-C işine dahil edilmez. P2'de SP-01–SP-10 kanıtları topluca değerlendirilip
iş akışı kabulü kapatılmalıdır. P1-C tamamlanması M0, M1, M2 veya oyun yayımlama
kabulü değildir. Nakliye işi, kargo, teslim ve ekonomi hâlâ uygulanmadı.
