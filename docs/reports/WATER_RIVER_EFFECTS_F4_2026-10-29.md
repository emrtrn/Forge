# River caustics, otomatik geometri köpüğü ve F4

Tarih: 2026-10-29. C4 ve River otomatik geometri köpüğü uygulandı. Manuel engel
temas alanı ve Radial Foam oluşturma/düzenleme kontrolleri kaldırıldı; Lake/River
çizimi eski manuel engelleri ve Radial Foam kayıtlarını kullanmaz. Eski kayıt
alanları veri kaybı olmaması için okunabilir ve kaydedilebilir kalır.

## Kullanım

Water System içinden River seçilir. **Obstacle Foam → Calculate** görünür statik
geometrinin gerçek su kesişimlerini hesaplar. **Recalculate**, **Cancel** ve
**Clear** Lake ile aynı arayüz bileşenini kullanır. Width hesabın girdisidir;
Strength/Pattern Size/Animation Speed sunum ayarlarıdır. Kayalar veya spline
değişince kullanıcı yeniden hesaplar. Undo/Redo hazır maskeyi değiştirir.

**Caustics → Enabled** dip ışığını açar. Strength, Pattern Size, Animation Speed
ve Depth Fade ayarlanabilir. **Shore Foam**, terrain wet/dry kesişiminden gelen
otomatik kıyı köpüğünü kontrol eder; elle engel ekleme listesi yoktur.

Kaydetme önce içerik adresli manifest/binary verisini, ardından level referansını
yazar. Editör ve ayrı `RuntimeSceneApp` kayıtlı texelleri yükler; Play/Reload kaya
taraması veya kesişim hesabı başlatmaz. Eski su çizgisi yeni spline yüksekliğine
taşınmaz. Geçersiz/eksik bake yalnız bu efekti kapatır. Yeni endpoint eklenmedi;
mevcut dar `/__save-lake-foam` kayıt yolu ve ortak doğrulayıcı kullanılır.

## Geometri ve kaynaklar

- Ortak `RiverSurfaceQuery`, çizilen ortalama ribbon üçgenlerini yerel çerçevede
  indeksler. Yükseklik ve wet/dry derinliği barycentric hesaplanır; terrain
  deliği/kuru kıyı su sayılmaz. Büyük origin için üçgen koordinatları yerel kalır.
- Köpük gerçek kaya üçgeni ile her ilgili nehir yüzü arasındaki kesişimdir;
  segmentler yüzün wet kısmına kırpılır. AABB yalnız ön elemedir. Ortak Lake
  mesafe/union maskesi ve parçalı shader kullanılır. Akış yönlü sınırlı izler
  otomatik maskeden örneklenir; hidrodinamik simülasyon değildir.
- Caustics mevcut terrain ışık katmanını ve güneş/CSM gölgelemesini kullanır.
  Exact üçgen atlası yerel su yüksekliğini, wet derinliğini ve akış yönünü sağlar.
  Desen dünya koordinatında kalır ve yerel akışla ötelenir. Yeni capture/draw yok;
  River etkin olduğunda bir ek float sampler vardır.
- Sahne başına en çok sekiz caustics gövdesi (Lake + River), toplam en çok
  16 MiB River atlası. Etki başına 131.072 yüz, 65.536 indeks hücresi,
  524.288 yüz referansı ve hücre başına 64 aday sınırı vardır. Aşım tanı verir.
- Mevcut köpük maske sınırları korunur: gövde başına 16 MiB, 4 texel/temas
  bandı, 4.096 instance, 2M kaynak üçgen, 131.072 temas segmenti. River için
  ek kesişim iş sınırı 8M yüz testidir. Hesap bölünür, iptal kontrolü yapar.
- River geometri köpüğü yüklenirken o anda ayrılmış Lake/River maskelerine
  karşı 32 MiB ön kontrol yapılır. Hazır undo artifact'ları runtime cache'inden
  ayrı tutulur; eşzamanlı kalite/rebuild transient tepe kabulü ayrıca açıktır.

## Doğrulama

Engine regresyonları iki farklı su yüksekliği, kuru kıyı, gerçek delik, büyük
origin, hava/derin kaya reddi, Lake union davranışı, binary allowlist, eski su
çizgisinin reddi, terrain/görünürlük kapıları ve 20 dispose tekrarını kapsar.
Lake Calculate/503 Retry/Recalculate/Undo/Save/Reload/Play senaryosu geçti.
River Calculate/Clear/Undo/caustics/Save/Reload/Play ve manuel kontrollerin yokluğu
uçtan uca doğrulandı. Runtime caustics açık/kapalı ve iki zaman örneği karşılaştırıldı.

Tam `build:verify` 2.104 engine kontrolüyle geçti. Son kaynak durumunun kapısı
`.dev-server/river-effects-acceptance.log` kaydında izlenir. `tsc --noEmit`, smoke
test tipleri, production build, strict dist ve world-data bu kapıya dahildir.
Lake/River geometri shader browser regresyonları 2/2, River UI Save/Reload/Play
son tekrarı 1/1 ve gerçek Chrome F4 1/1 geçti.
İlk runtime koşusu bake yükleyicisi henüz ayrı runtime'a bağlanmadığı için başarısızdı;
bağlantı tamamlandıktan sonraki koşu geçti. İlk full gate eski Radial Foam draw
beklentisine takıldı; ilgili test yeni emeklilik davranışına güncellendi.
Ek kayıt tekrarında Windows `EPERM rename` yakalandı. İçerik adresli artifact
zaten aynı byte'larla diskteyse tekrar yazılmaz; aynı anda yazan iş varsa rename
hatasından sonra içerik eşitliği doğrulanır. River browser testi aynı binary'yi
yeniden POST edip mtime'ın değişmediğini, ardından Save/Reload/Play'i doğrular.

## Gerçek donanım F4 ölçümü

Chrome / RTX 3060 / ANGLE D3D11, DPR 1, **1920×1080 runtime**, post-process
(AO/DoF dahil) ve cascaded sun ile bir Lake + bir eğimli River. Her profil
10 hazırlık ardından 300 AB/BA çift örnek kullanır. Query tüm runtime render
submission'ını kapsar; GPU ölçümünde readPixels yoktur. Kamera sabittir.

| Profil | Baseline GPU p95 | Etkin GPU p95 | Çift farkı p95 | Ek draw |
| --- | ---: | ---: | ---: | ---: |
| Caustics (köpük sabit) | 4,378 ms | 4,543 ms | 0,540 ms | 0 |
| Köpük (caustics sabit) | 4,537 ms | 4,477 ms | 0,300 ms | 0 |
| İkisi birlikte | 4,547 ms | 4,589 ms | 0,568 ms | 0 |

Fark p95'i ayrı dağılımdır; iki sütunun p95'ini çıkarmak veya ayrı efekt
p95'lerini toplamakla elde edilmez. Biraz negatif baseline farkları kontrol
gürültüsünü gösterir. Bu fixture'da köpüğün 0,5 ms ve caustics'in 1 ms öneri
hedefleri karşılanır; büyük dünya/çok kaya kümesi taahhüdü değildir.

- Köpük texelleri: **953.600 byte**; River atlası: **344.064 byte**;
  ortak caustics maskesi/deseni: **524.288 byte** temel seviye.
- Efekt dokuları mip tahminiyle **1.996.715 byte (1,90 MiB)**.
  Bunlar sahip olunan texture array byte'larıdır; driver VRAM tepe ölçümü değildir.
- 20 gerçek UI Clear → Undo döngüsünde **36 texture / 19 geometri**, efekt byte'ları
  ve su buffer byte'ları başlangıç/son aynı. Runtime'da 36 texture / 7 geometri.
- Runtime GC sonrası browser heap: yaklaşık **26,8 MiB**, backing storage
  **52,0 MiB**. Toplam tarayıcı sayılarıdır; Lake/River'a özel transient CPU
  tepesini veya her iş diliminin ≤4 ms olduğunu kanıtlamaz.
- Konsol/page/GL hatası yok. Ön/ters açı, zaman değişimi ve gece görüntüleri alındı.
  **Masaüstü görsel kabulü tamamlandı:** Kullanıcı 2026-10-29'da paylaşılan ön
  görünüm ve ters açıdaki otomatik taş köpüğü ile dip ışığı yoğunluğu için
  “Görünüm uygun” yanıtını verdi. Bu onay büyük dünya/tepe bellek kabulünü kapsamaz.

[Ham sayısal kayıt](WATER_RIVER_EFFECTS_F4_2026-10-29.json),
[ön görünüm](images/water-river-effects-f4-front-2026-10-29.png),
[ters açı](images/water-river-effects-f4-reverse-2026-10-29.png).
Sayısal kayıttaki render kaynak hash'leri koşu sonrasında kaydedilmiştir.

Tekrar:

```powershell
$env:FORGE_SMOKE_PORT='5385'
$env:FORGE_WATER_F4='1'
npx.cmd playwright test --config playwright.water.config.ts --reporter=list
```

## Açık kabul sınırları

F4'ün büyük dünya/çok kaya kümesi, bake sırasında transient CPU/GPU tepe,
uzun ana thread görevlerinin fonksiyon bazında ayrılması ve export/clone uçtan
uca kabulü bu fixture ile kapanmaz. Kaynak toplama mevcut Lake yaklaşımı gibi
gerekli model cache'lerini kullanır; çok sayıda benzersiz asset'te ayrıca
ölçülmelidir. Dinamik mesh/karakter/araç köpüğü kapsam dışıdır.

Kayıt alanları, tekrar-kayıt yolu ve geometri okuması için Codex Security diff scan
önerildi; kullanıcı onayı verilmediği için scan başlatılmadı. Testler izole smoke
projesine yazdı. Son kontrolde ana Terrain level/global/tile/foliage dosyalarında
eşzamanlı değişiklikler görüldü; bu dosyalara müdahale edilmedi. Commit/push yok.
