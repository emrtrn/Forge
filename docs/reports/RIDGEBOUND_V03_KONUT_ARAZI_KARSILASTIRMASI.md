# Ridgebound v0.3 — konut dokusu / P1 ve Relief A karşılaştırması

**Tarih:** 2 Kasım 2026. **Durum:** SALT OKUNUR İNCELEME TAMAM; YERLEŞİM VE FORGE ÜRÜN KABULÜ AÇIK.

**Sonuç:** v0.3'ün konut koordinatları mevcut P1 kapsamına sığıyor. Relief A ise
yeni konut dokusunu korumuyor: 24 evin 22'sinin merkez kotu değişiyor, 17 evde
fark 1 m'yi aşıyor. En büyük fark RES-024'te **+44,83 m**. Mevcut Relief A üzerine
evleri doğrudan yerleştirmek uygun bir sonraki adım değildir. Öneri, konut
konumlarını koruyarak mahalle ve erişim alanlarını hesaba katan ayrı bir rölyef
adayı hazırlamaktır; bu incelemede böyle bir arazi değişikliği yapılmadı.

## Kaynak ve şema farkı

- [GPT → Codex ortak devir §0.3.6–0.3.7](https://drive.google.com/file/d/1Z8rkqGMz5b46ONP1IW5Dosz5Ftajy87n/view): görsel kabul korunur; sayısal yerleşim ve Forge kabulü açık.
- [SPATIAL_MASTER_v0.3.json](https://drive.google.com/file/d/15p_t0wLbF5qS1TVARVOwBN0slahpuIgq/view): Drive ham dosyası indirildi, 31.257 bayt; SHA-256 **`04bf826f5a11724ee15995c482e45abdc3928564f52b2f91d6361c6db9b2c80a`** doğrulandı.
- Baz v0.2 SHA-256 **`72afa23b7264b2e6e419ca700511e1b61cbdb6178bdf18fe53eb91e8e5e7f09b`**; repo fixture'ının hash'i doğrulandı.
- [GPT katman QA raporu](https://drive.google.com/file/d/1mlOiKGbFMU_JCBkiEGishIxQVj7e6ui4/view) hesap/görsel katman kanıtıdır; aşağıdaki ölçümler ayrıca gerçek kayıtlı Forge tile'ları üzerinde yapıldı.

v0.2–v0.3 anlamsal farkı yalnız `version`, `status`, `supersedes`, `scope`,
iki kaynak hash alanı ve **`settlement_fabric`** alanıdır. Eski `terrain`,
`hydrology`, `nodes`, `routes`, `poi`, `local_roads`, `bridges`,
`site_access_candidates`, eksenler ve sınırlar birebir aynı kaldı.

Yeni katman 4 mahallede **24 RES + 12 OUT** içeriyor; POI-01 ile toplam 25 konut
binası hesabı korunuyor. Yeni ev/müştemilatlar POI yapılmadı. Mevcut metrik importer,
recipe normalizer, save şeması veya editör değiştirilmedi. Yeni araç bu katmanı
yalnız inceleme için okur; v0.3'ün Forge'a aktarılmış olduğu anlamına gelmez.

Uygulama için açık veriler: ev parselleri, yapı dönüşleri, kesin girişler ve erişim
hatları, pad hedef kotları, müştemilatların nihai rolleri ve yerel yol genişlikleri.

## Ölçüm yöntemi ve sınırlar

Kaynak X/doğu ve Y/kuzey, mevcut datumla `Forge x=X; z=6000-Y` olarak çevrildi.
`public/layouts/RidgeboundP1.landscapes/` ve `RidgeboundReliefA.landscapes/`
altındaki gerçek tanım ve 24'er tile dosyası okundu. Dosya hash'leri ayrıntılı
JSON raporuna kaydedildi. Merkez kotu ve eğimi motorun `terrainHeightAt` /
`terrainFaceNormalAt` fonksiyonlarıyla ölçüldü.

Ayak izleri, kaynakta dönüş açısı bulunmadığı için **eksenlere paralel dikdörtgen**
varsayımıdır. Kaynaktaki bina ölçüsünün her yanına **2 m eklenerek** ayrıca tanı
amaçlı bir temel alanı değerlendirildi. Bu alan onaylanmış parsel veya pad değildir.
Temel alanı minimum/maksimum kotu yalnız dört köşeden değil, kapsanan bütün
heightfield üçgenlerinin dikdörtgene kırpılmış köşelerinden hesaplandı. Böylece
içeride kalan tepe veya collider diyagonali atlanmadı.

Erişim çizgileri, yapı ayak izinden en yakın kayıtlı yol merkez çizgisine en kısa
doğru ile okulun kaynak girişine çekilen tanı doğrularıdır. **Yeni patika/yol
tasarımı değildir.** Eğimi, grid ve collider diyagonal geçişlerinde bölünerek
aynı kayıtlı terrain üzerinde ölçüldü. Yol genişliği kaynakta varsa kenar açıklığı
hesaplandı; yerel yollarda genişlik uydurulmadı. %22 eğim ve 1 m kot farkı yalnız
inceleme eşikleridir; güvenli sürüş, erişilebilirlik veya yapı mevzuatı sınırı değildir.

İnceleme mevcut **6 m** çözünürlük içindir. İnce 1 m ayrıntı, nihai kazı/dolgu
hacmi, drenaj, jeoteknik uygunluk veya fiziksel bina/araç testi yapılmış sayılmaz.

## Arazi bulguları

| Ölçüm | Konutlar (24) | Müştemilatlar (12) |
|---|---:|---:|
| Relief A'da merkez kotu değişen (>2 cm) | 22 | 10 |
| Merkez kot farkı >1 m | 17 | 6 |
| En büyük merkez kot artışı | 44,83 m | 30,33 m |
| P1'de en büyük tanı temel alanı kot aralığı | 3,71 m | 2,25 m |
| Relief A'da en büyük tanı temel alanı kot aralığı | 23,11 m | 8,74 m |
| Relief A tanı temel alanında %22'yi aşan üçgen eğimi | 16 | 6 |

Konut merkezlerinin P1 kotları ile v0.3'ün yuvarlanmış analitik merkez kotları
arasındaki en büyük fark **0,051 m**. Konum dönüşümü ve kaynak kotu tutarlı;
büyük fark Relief A'nın eklediği rölyeften kaynaklanıyor.

Merkez kotu 2 cm eşiğinde değişmeyen evler yalnız **RES-017 ve RES-018**.
Merkezin değişmemesi ayak izinin tamamının veya erişimin uygun olduğunu kanıtlamaz.

| Öncelikli ev | P1 → Relief A merkez kot farkı | P1 tanı temel kot aralığı | Relief A tanı temel kot aralığı |
|---|---:|---:|---:|
| RES-024 | +44,83 m | 3,59 m | 23,11 m |
| RES-022 | +41,54 m | 3,42 m | 4,97 m |
| RES-023 | +39,99 m | 3,36 m | 10,25 m |
| RES-010 | +36,02 m | 3,45 m | 17,82 m |
| RES-011 | +26,53 m | 3,47 m | 13,90 m |
| RES-007 | +22,44 m | 3,32 m | 15,91 m |

P1'de konut tanı temel alanları üzerindeki en büyük üçgen eğimi **%17,40**;
Relief A'da RES-024 çevresinde yerel olarak **%160,55**. Bu son değer bütün
mahallenin ortalama eğimi değil, tanı temel alanına giren en dik üçgendir.
Sadece bina Y konumunu yükseltmek problemi çözmez. P1'de de temel düzleme,
yapı yönü ve erişim çözümü hâlâ gereklidir.

## Yerleşim, yol ve okul bulguları

**Yatay yerleşim:** 36 yeni yapı ayak izinde birbirleriyle, mevcut POI bina ayak
izleriyle veya POI parselleriyle alan çakışması bulunmadı. 2 m tanı temel alanları
da POI parselleriyle çakışmıyor. Kaynakta genişliği bulunan yollarla ayak izi
teması bulunmadı; genişliği bulunmayan yerel yollar için yalnız merkez çizgisi
teması denetlenebildi. Bu yüzden genel bir “yol koridoru uygun” kabulü verilmedi.

**B-FAB-01 — yol mesafesi semantiği:** v0.3'teki
`distance_to_existing_road_edge_m` değeri RES-017 için 6,0 m. Gerçek plan
geometrisinde yapı ayak izinden R03 merkez çizgisine açıklık **6,04 m**;
kaynak 5 m yol genişliği hesaba katılınca kenar açıklığı **3,54 m**. Bazı kaynak
değerler kenar yerine merkez çizgisi mesafesini anlatıyor. Yerel yolların sayısal
genişlikleri de yok. GPT tarafında alan adı/hesabı ve genişlik kaynağı uzlaştırılmalı;
bu incelemede master düzeltilmedi.

**B-FAB-02 — RES-006 erişimi:** en yakın mevcut yol çizgisine en kısa bağlantı
**POI-01 aile evi ayak izini kesiyor**. Bu, evin mutlaka taşınması gerektiği
anlamına gelmez; düz bağlantı yerine engelin çevresinden bir giriş/erişim tasarımı
gerektirir. OUT-006 için de en kısa bağlantı ana yapı RES-009'u kesiyor; ortak
parsel içi dolaşım ayrıca çözülmeli. Yeni bağlantı üretilmedi.

**B-FAB-03 — okul ve R03:** hem ana `R03` çizgisi hem onun yerel temsilcisi
`R03 → J1`, POI-05'in **parselinin içinden** geçiyor. Okul bina ayak izini
kesmiyorlar. Ana R03'ün 5 m aday genişliğiyle okul bina ayak izine yatay kenar
açıklığı yaklaşık **3,57 m**. Yerel çizginin genişliği bilinmediğinden onun kenar
açıklığı hesaplanmadı. Bu iki kayıt iki ayrı fiziksel yol kabul edilmedi. Bulgu,
v0.2'den devralınan geometride zaten var; yeni konutların sebep olduğu bir
kaydırma değil. Okul parseli, bahçe/çit, servis koridoru ve giriş ayrımı tasarım
kararıyla uzlaştırılmalı.

**B-FAB-04 — okula yürüyüş:** RES-010, RES-011, RES-017 ve RES-019…024'ten
kaynak okul girişine çekilen tanı doğruları servis trafiği adayı sayılan plan
çizgilerini kesiyor (**9 ev**). İşletme kolu, depo girişi ve R03 bu incelemede
servis koridoru göstergesi olarak kullanıldı; gerçek trafik rotası yok.
Bu bulgu dokuz gerçek yaya güzergâhının hatalı olduğu anlamına gelmez; güvenli
güzergâhların henüz tanımlanmadığını gösterir. Doğruların bina engelleri ve gerçek
terrain üzerindeki eğimleri ayrıntılı JSON'da ayrıca bulunur.

**B-FAB-05 — erişim eğimi:** Relief A'da RES-024'ün en kısa yol bağlantısı
üzerinde yerel boyuna eğim **%96,67**'ye çıkıyor (P1'de aynı tanı hattı %16,52).
Bu bir tasarlanmış yol veya yürünebilir rota değildir; Relief A'nın konutların
yalnız tabanını değil, çevresindeki erişim alanlarını da koruması gerektiğine
işaret eder.

## Önerilen sonraki sınırlı çalışma

1. **Konutları taşımadan rölyef uyarlaması:** v0.3 mahalleleri, ev/müştemilat
   ayak izleri, kararlaştırılacak parseller ve erişim koridorları için koruma
   maskelerini tamamla. Ayrı bir Relief B adayında bu alanlarda P1'e göre farkı
   raporla; P1 ve Relief A'yı değiştirme. Tek tek ev merkezlerini korumak yeterli değil.
2. **GPT'ye veri düzeltme girdisi:** yol mesafesini merkez/kenar olarak ayır,
   yerel yol genişliklerini ve ev girişlerini tanımla. RES-006/OUT-006 için
   alternatif dolaşım öner; okul parseli–R03 ilişkisini çözüm adaylarıyla sun.
   Bu adımda yeni yol veya ev taşıma kararı otomatik verilmez.
3. **Temel ve blokaj testi:** kullanıcıca seçilen adayda yönü ve hedef kotu
   belirlenmiş temelleri ayrı önizle. Yerel çözünürlük ihtiyacını açıkça kaydet.
   Gerçek bina/yaya hacimleriyle erişim engelleri, okul girişleri ve servis
   kesişimleri test edildikten sonra fiziksel yerleşim üretimine geç.
4. **Araç kabulü:** depo–R01–B1 için gerçek araç ölçüsüyle manevra/collider ve
   sürüş testi ayrı kalır; bu rapor bunlara PASS vermez.

## Çıktılar ve yeniden üretim

- [Karşılaştırma paftası](ridgebound-v03/konut-arazi-karsilastirmasi.svg): R1 = RES-001; küçük kutular müştemilat. SVG'de üzerlerine gelince tam ID ve ölçüm görünür.
- [36 yapının ölçüm tablosu](ridgebound-v03/konut-olcumleri.csv).
- Bütün hash'ler, arazi/pad ölçümleri, erişim ve okul tanı profilleri:
  `output/ridgebound/v03-fabric-review-delivery-20261102/review.json`.
- Ham v0.3 kaynak:
  `output/ridgebound/v03-fabric-review-20261102/RIDGEBOUND_SPATIAL_MASTER_v0.3.json`.

```powershell
npm.cmd run world:ridgebound:review -- --source output/ridgebound/v03-fabric-review-20261102/RIDGEBOUND_SPATIAL_MASTER_v0.3.json --out output/ridgebound/yeni-konut-incelemesi
```

`--out` verilmezse yalnız JSON raporu stdout'a yazılır. Çıktı yeni bir klasör
olmalıdır; mevcut çıktı/public üzerine yazılmaz. Kaynak hash'i veya devralınan
geometri farklıysa inceleme durur. Araç mevcut P1/Relief A dosyalarını okur;
ileride elle değiştirilmişlerse yeni ölçümler farklı olabilir ve hash'leri rapora yansır.

## Doğrulama ve koruma

- `npm.cmd run verify:ridgebound-tools`: **7 test geçti** (mevcut import testi +
  6 geometri/profil regresyonu). Collider diyagonali, iç tepe, üçgen kırpma,
  sınır/çakışma ve dik erişim bacağının ortalamada kaybolmaması kontrol edildi.
- Pafta görünür Chromium'da açıldı; iki arazi, konumlar, renk açıklaması ve
  okunabilir konut etiketleri incelendi. Forge'a yapı ekleyen browser akışı çalıştırılmadı.
- TypeScript, engine/runtime veya save sözleşmesi değiştirilmedi; bu rapor işi
  için tam engine/build kapısı tekrarlanmadı. Sürüş, fiziksel bina collision'ı,
  yaya güvenliği ve performans kabulü verilmedi.
- İnceleme başlangıcında mevcut level/recipe/terrain ve proje manifestlerinden
  alınan **400 dosya hash'i** işlem sonunda tekrar karşılaştırıldı; dosyalar aynı kaldı.
- Master, recipe, sahne, arazi ve aktif sahne ayarı değiştirilmedi. Commit/push
  yapılmadı; Drive ortak devir belgesine bu oturumda yazılmadı.
