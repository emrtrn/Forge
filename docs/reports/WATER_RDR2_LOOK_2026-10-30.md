# Su — RDR2 tarzı görünüm: uygulama raporu

Tarih: 30 Ekim 2026. Plan: [WATER_RDR2_LOOK_PLAN.md](../planned/WATER_RDR2_LOOK_PLAN.md).

## Durum

| Katman | Sonuç |
| --- | --- |
| Uygulandı | 4.1–4.6 (doku, ortak malzeme, tepe köpüğü, River beyaz su/iz, Lake rüzgâr/kıyı, caustics) |
| Teknik doğrulama | `build:verify` yeşil (2175 engine kontrolü); su Playwright sonuçları aşağıda |
| Görsel kabul | İzole fixture görüntüleri var; **kullanıcı sahnesinde kabul açık** |
| Performans kabulü | **Açık**: GPU ölçümü yapılmadı. Yeni draw/capture/render target yok |

## Ne değişti

**Köpük dokusu (kök neden).** `water-foam.png`'nin R kanalı Voronoi F2−F1
kenarlarından üretiliyordu; eşiklenince terrain caustic'iyle aynı çokgen ağ
kalıyordu. Yeni [bake aracı](../../tools/bake-water-foam.mjs) domain-warp fBm
kümeleri ile dolu Worley-F1 kabarcıklarını birleştirir ve R'yi sıra dönüşümüyle
eşitler: yoğunluk ≈ kapsanan alan oranı. Sonuç: yoğun köpük dolu, azaldıkça
delikli dantel, en sonunda dağınık kabarcık. Ölçüm: R histogramı 8 kutuda
%12,35–12,55; eşik 0,7'de en büyük bağlı bileşen köpüğün %20,7'si (kenar ağında
neredeyse tamamı tek bileşendir). Dosya boyutu/biçimi ve sahipliği aynı.

**Ortak malzeme.** `waterFoamErosion` eşitlenmiş alana göre yeniden kuruldu;
ince köpük yarı saydam. Akış uzayında uzatılmış örnekleme (`waterFoamDetailFlow`).
Kıyı/temas bandı karesel sönümlü (`waterFoamBand`): temas noktasında kalın,
bandın dışına doğru seyrek.

**Tepe köpüğü.** Genliğe bölünmüş yükseklik yerine çizilen dalganın dikliği
`|∇h|`. `crestFoamThreshold` 0–1 → diklik 0,02–0,12 (`crestFoamSteepness`).
Varsayılan 0,35 → 0,055. Terrain sahnesindeki göl (4 cm / 6 m, en çok ≈0,045)
artık beyaz leke üretmez — kayıt değiştirilmedi. Göl beyaz başlıkları ayrıca
düşük frekanslı “ani esinti” alanıyla seyrekleşir. River dikliği `rapidness`
ile 2,5 kata kadar büyür; tepe köpüğü akış şeritleriyle bölünür.

**River.** Ribbon'a build-time `foamTrail` (eski boş `foamMask` özniteliği,
rapid'in 25 m sönümle akış aşağı taşınması) ve `riverLateral` (+4 byte/köşe)
eklendi. Rapid'de dolu beyaz su; altında akıntı ortasında toplanan, giderek
seyrekleşen şeritler. Kaya/engel bake maskesi yoğunluk olarak okunup aynı akış
dokusuyla çizilir (memba yığılması + 3 örnekli mansap izi korunur). Rapid'de
mikro normal 1,6×, havuzda 0,8×; roughness rapid ile +0,06. Bake parmak izi
girdileri (pozisyon/derinlik/indeks) değişmedi; mevcut bake'ler geçerli.

**Lake.** Rüzgâr lekeleri: rüzgâr (dalga) yönünde sürüklenen 25–30 m ölçekli
alan mikro normali 0,4–1,3× ve roughness'ı ±0,04 modüle eder; yansıma yüzeyde
yer yer netleşip bozulur. Kıyıda sürekli köpük konturu yerine kıyıya ilerleyen,
kıyı boyunca fazı kayan seyrek dalgalanma (`waterShoreLapping`, yoğunluk ≤0,62).

**Caustics.** İki katman `max()` (iki ağın birleşimi) yerine `sqrt(a·b)`
(yalnız çakıştıkları yer) ve daha geniş çizgiler: sabit çokgen ağ yerine kırık,
kayan ışık lekeleri. Tepe parlaklığı korunur, ortalama enerji bilinçli olarak
≈yarıya iner (0,20 → 0,10). Authored strength anlamı aynı.

## Sözleşme ve kayıt

Yeni kalıcı alan yok; allowlist/validator/Details alanları aynı. Tek anlam
değişikliği `crestFoamThreshold`; Details tooltip'i (Türkçe) güncellendi.
Kullanıcı sahnesi (`Terrain.level.json`) düzenlenmedi.

## Doğrulama

- `npx tsc --noEmit`: geçti.
- `npm run build:verify`: geçti — 2175 engine kontrolü, build, strict dist, dünya verisi.
- Yeni engine kontrolleri (`Water look:`): foam trail sönümü, ribbon trail/lateral
  verisi, diklik eşlemesi (sakin swell temiz, dik dalga köpürür), doku
  döşenebilirlik/eşitleme/ağ-değil ölçütü.
- Playwright, su kümesi (`water-crest-foam`, `water-contact-foam`,
  `river-water-optics`, `river-caustic-flow`, `terrain-water`,
  `terrain-water-runtime`, `terrain-lake-editor`): ilk koşu 51 geçti / 2 atlandı /
  5 başarısız. Düzeltmeler ve yalnız başarısızların yeniden koşusu:
  - River optik iki test: test sayfasının `unboundedFlow` tanısı, köpük kodunun
    kullandığı `localSpeed` bildirimini de siliyordu; köpük kendi hızını hesaplar → **geçti**.
  - Lake kıyı köpüğü “görünür olmalı”: kıyı dalgalanması yoğunluğu 0,22 + 0,4·cephe
    yapıldı → **geçti** (kıyıda sürekli çizgi yok, adacık kenarında seyrek kabarcık).
  - Tepe köpüğü testi yeni diklik modeline göre güncellendi → **geçti**.
  - **Açık — Lake refraction** (“refraction must change visible bed pixels > 10”):
    aynı test değişikliklerden önceki HEAD motor koduyla da başarısız (10, sınır >10);
    bu çalışmayla 8. Rüzgâr lekeleri kırılma normaline uygulanmıyor; caustic
    değişikliklerinin geri alınması da sonucu değiştirmedi (ikisi de 8). Önceden var
    olan sınırda bir ölçüt; ayrıca incelenmeli.
  - **Açık — Lake quality menu … live Play**: `Resume` düğmesinde 300 s timeout;
    R4 raporunda da aynı şekilde başarısızdı.
  Tüm küme düzeltmelerden sonra bütünüyle yeniden koşulmadı.
- Görsel kanıt (izole fixture, sayfa ekran görüntüsü):
  [Lake gündüz](evidence/water-rdr2/lake-crest-day.png),
  [River gündüz](evidence/water-rdr2/river-crest-day.png),
  [Lake gece](evidence/water-rdr2/lake-crest-night.png),
  [River gölge](evidence/water-rdr2/river-crest-shadow.png);
  önceki hâli: [R4 Lake gündüz](evidence/water-r4-crest/lake-crest-day.png).

## Açık kalanlar

- Kullanıcının Terrain sahnesinde görsel kabul (headless editörde Terrain level
  siyah render ettiği için otomatik görüntü alınamadı).
- Gerçek GPU AB/BA ölçümü. Beklenen ek maliyet: River fragment'te +4 köpük doku
  okuması ve birkaç noise; Lake'te 2 noise; caustics değişmedi (aynı okuma sayısı).
- V3 köpük geçmişi yok: foam trail ve şeritler deterministik/statik dağılımdır,
  zamanla doğup sönen köpük değildir.
