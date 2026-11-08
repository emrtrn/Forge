# Rastgele dünya: değerlerden hazır sahne

7 Kasım 2026, kullanıcı kararı. World Builder iki yoldan sahne kurar; ikisi aynı
kurucuyu (`world:brief` kurucusu, `tools/world/worldBriefBuild.ts`) kullanır:

1. **Plan modu:** oyunun tasarım dokümanındaki kroki ve ölçülerden dünya özeti
   (`*.worldbrief.json`) yazılır, kurucu sahneyi kurar
   ([WORLD_BRIEF.md](WORLD_BRIEF.md), pilot, Derekavak).
2. **Rastgele mod:** kullanıcı bir pencerede birkaç değer seçer, **Oluştur** der;
   rastgele üretici bir dünya özeti yazar, aynı kurucu sahneyi kurar. Çıktı "temel
   kabul"dür: arazi şekillenmiş ve boyanmış, yol, nehir ve göl kurulmuş, yerleşimler
   greybox. Sonra kullanıcı elle düzenler; yapılar rol rol Blender ya da Tripo ile
   yapılır.

Bu, Forge'un kalıcı ve oyundan bağımsız özelliğidir: oyuncu başlangıcı, araç modu ya
da oyuna özel kural yazılmaz, kamera serbest kalır.

## Pencere seçenekleri

| Seçenek | Değerler |
|---|---|
| Boyut | Küçük / Orta / Büyük: Tiles 8×8, Vertex Spacing 2 m, Tile Res 64 / 128 / 256 → 1 / 2 / 4 km. Büyük'te World Partition açık |
| Arazi şekli | Ova, Tepelik, Dağlık, Vadi, Plato, Kanyon (Ada, Kıyı: Ocean aracından sonra) |
| Örtü / iklim | Ormanlık, Çayır-mera, Tarım, Bozkır, Çöl, Karlı/alpin |
| Yerleşimler | Sayı; her biri mezra / köy / kasaba (nüfus ve çap türden, değiştirilebilir) |
| Su | Nehir sayısı, göl sayısı |
| Yollar | Yok / yerleşimler arası / + harita kenarına çıkış; köprü kendiliğinden |
| Dağ yüksekliği | Alçak / orta / yüksek |
| Yoğunluk | Orman, kaya, tarla |
| Önemli noktalar | Depo, maden, kule, kamp (greybox) |
| Mevsim ve hava | WES |
| Tohum | Aynı değerler aynı sahneyi verir; "Zar at" başka bir sahne |

Bitki ve doğa varlıklarını kullanıcı toplar; örtü tipleri o gelene kadar mevcut
varlıklarla ve renkli boyayla çalışır.

## Sıra

1. **Ortak kurucu:** köy yeri, sokak, parsel, arazi kullanımı, yapı, set, donatı ve
   çit adımları kurucuya bağlanır (bugün yalnız eski pencereden çalışıyorlar). Sokak
   ve yol araziye işlenir, setler araziye işlenir, çitler son zemini izler.
2. **Rastgele üretici, ilk sürüm:** boyut, Ova / Tepelik / Dağlık / Vadi, yerleşimler,
   yerleşimleri bağlayan yol ağı. **Onay:** üç örnek sahnenin ekran görüntüleri.
3. **Su:** yokuş aşağı akan rastgele nehir, çanakta göl.
4. **Örtü tipleri:** orman, çayır, tarım, bozkır, çöl, karlı (bölge profilleri).
5. **Editör penceresi ve önizleme:** Add Actor → Terrain'de yeni pencere; kuşbakışı
   önizleme, **Oluştur**, sahne açılır. Eski World Builder penceresi kaldırılır.
   **Takip işi:** köy/kasaba yollarında araç geçişi ve dönüş alanı
   ([uygulama planı](#takip-işi-yerleşim-yollarında-araç-geçişi)).
6. **Rol → model bağlama:** Blender / Tripo modelleri rolün yerine geçer.
7. **Ada ve kıyı:** Ocean aracı yapıldıktan sonra.

Plan modu (Derekavak, sabit koordinatlı özet) aynı kurucunun üstüne sonra devam eder.

## Durum

- [x] 1. Ortak kurucu (7 Kasım 2026): yerleşim zinciri kurucuda; sokak, yol ve setler araziye
  işlenir, setlerin altı toprak, ana yol asfalt boyası (bitki çıkmaz), donatı ve çit son zeminde
- [x] 2. Rastgele üretici (8 Kasım 2026): `engine/worldbuilder/randomWorld.ts` seçimleri bir dünya
  özetine çevirir, kurucu sahneyi kurar. Komut:
  `npm run world:random -- --out assets/Worlds/Ad.level.json --size small|medium|large
  --landform plain|hills|mountains|valley --mountains low|medium|high --settlements village,hamlet,town
  --roads between|exits --seed N`. Özet level'ın yanında kalır. Arazi: tepeler + sırtlı dağlar
  (özette `terrain.relief`), dağlar yerleşimlere, yollara, suya ve vadi tabanına uğramaz; yollar
  yerleşimleri en kısa ağla bağlar, `exits` iki yolu harita kenarına çıkarır. Boya eğimden kaya,
  yerleşimden uzakta orman. Orta boy ~10 s, büyük (4 km, World Partition açık) ~36 s.
  Test: `tests/engine/randomWorld.test.ts`.
- [x] 3. Su (8 Kasım 2026, görsel kabul kullanıcı tarafından onaylandı): `--rivers 0-3 --lakes 0-3` (varsayılan 0:
  su istenmezse özet birebir aynı). Su, köy/yol/dağ yerleşiminden sonra kendi rastgele dizisiyle
  eklenir (`engine/worldbuilder/randomWater.ts`): aynı tohum + su = aynı dünya + su. Nehir susuz
  arazide yüksek yerden başlar, suyun akacağı yolu izler (çukurları doldurup taşar), harita
  kenarında, bir gölde ya da başka bir nehirde biter; köylerin sel payına (nehirde yarıçapın yarısı
  + 170 m) ve yol çıkışlarına girmez. Göl önce derin çanaklara, yoksa nehrin aşağı kısmına (nehir
  orada biter), yoksa en alçak düz yere konur; kıyı halkası 6 m'den fazla yükselen yere (yamaç dibi)
  konmaz, gerekirse küçülür. Nehir göl kıyısında, kol ana nehrin çizgisinde biter. Vadide nehir
  varsa köyler tabanın bir yanına geçer.
  Kurucu gölü editörün göl yatağı biçimiyle oyar, kıyıyı boyar, göl aktörü yazar (plan modu da
  kazanır); yol nehri düz greybox tabliyeli köprüyle geçer (altı oyulu kalır), göllerin 20 m
  dışından dolaşır. Test: `randomWorld.test.ts`, `worldBriefWater.test.ts`.
- [x] 4. Örtü tipleri (8 Kasım 2026, görsel kabul kullanıcı tarafından onaylandı): `--cover forest|meadow|farmland|steppe|desert|alpine`
  (varsayılan `forest`, bugünkü görünümle bayt bayt aynı) ve `--forest|--rocks|--fields low|medium|high`.
  Örtü bir veri dosyasıdır (`public/assets/world-builder/covers/*.cover.json`, `normalizeGroundCover`):
  en çok 8 boya katmanı ve rolleri, kaya eğimi, orman (köyden uzaklık, pay, yama boyu), su kenarı
  şeridi, köy çevresi tarlalar (yamalı parseller, düz yerde), kar çizgisi (yükseklik yüzdeliği, en
  alçak zeminin en az 60 m üstü; altında ağaç sınırı), bitkiler (`*.foliagetype.json` yolu) ve kaya
  sayıları. Toplanan doğa varlıkları gelince yalnız bu dosyalar değişir. Kar yalnız dağlıkta oluşur;
  "her yer karlı" mevsim işi (WES). Test: `tests/engine/groundCover.test.ts`.
- [x] 5. Editör penceresi (8 Kasım 2026, görsel kabul kullanıcı tarafından onaylandı): Add Actor → Terrain →
  **World Builder…** penceresi komut satırındaki seçenekleri sorar (boyut, arazi, dağ yüksekliği,
  yerleşimler, yollar, nehir/göl, örtü, yoğunluklar, tohum + Roll Dice); plato, kanyon, önemli
  noktalar ve mevsim henüz yok. Kuşbakışı önizleme kurucunun kendi üreticisini bir worker'da
  çalıştırır (`engine/worldbuilder/randomWorldPreview.ts`, seçim başına ~0,3–0,6 s): dağlar,
  boya, su ve köy yerleri kurulacak sahneyle aynı yerde; yollar düz çizgi, sokak/yapı/ağaç yok.
  **Create** dünyayı pencerenin açıldığı level'a kurar (kullanıcı kararı, 8 Kasım: her level
  kendi dünyasını alır; level `public/assets` altında olmalı, değilse Create kapalı ve pencere
  nedenini söyler). Level'daki her şeyin yerini aldığı için önce sorar; `/__world-random`
  (yalnız geliştirme sunucusu, ayrı Node süreci, adım adım ilerleme, hata pencerede görünür),
  bitince level kuşbakışı kamerayla yeniden yüklenir; eski arazi klasörü ve mesh boyası silinir. Kurucu düzeltmeleri: büyük
  dünyada uzun yol / dağınık kasabalar "Terrain edit region is too large" ile duruyordu (yol ve
  ped işleme artık parça parça, çıktı bayt bayt aynı); başarısız kurulum özet dosyası bırakmıyor.
  Eski World Builder penceresi kalktı: panel, oturum, plan düzenleme, sahne katmanları,
  Save'in tarif yazması ve `/__save-worldrecipe`. Kalanlar: aşamalar (`engine/worldbuilder/stages/*`),
  tarif biçimi ve doğrulayıcısı, `world:brief` / `world:random`, pencere çerçevesi (`ForgeWindow`).
  Test: `randomWorldPreview.test.ts`, `randomWorldRequest.test.ts`, `terrainSplitBake.test.ts`,
  smoke `world-builder-random.spec.ts`.
- [ ] 6. Rol → model
- [ ] 7. Ada ve kıyı

## Takip işi: yerleşim yollarında araç geçişi

**Kayıt:** 8 Kasım 2026, kullanıcı isteği. **Durum: yapılacak; uygulama başlamadı.**
Mevcut dünyanın genel görsel kabulü kullanıcı tarafından onaylandı. Bu iş, köy ve
kasabalarda sürüş sırasında görülen darlığı gideren ayrı bir iyileştirmedir.
Auto Paint ortaklaştırması ve Foliage mesafe ayarları şimdilik beklemededir.

### Sorun ve mevcut ölçüler

Rastgele dünya varsayılan olarak `WbPilotValley.regionprofile.json` kullanır.
`streets` aşaması bütün yerleşimlerin iç sokaklarını aynı `local` kesitle kurar;
kasaba seçmek iç sokağı genişletmez.

| Konu | Mevcut değer / davranış |
|---|---|
| İç sokak ve `track` | 4 m; banket yok |
| Ana bağlantı (`collector`) | 7 m taşıt yolu + iki yanda 1 m banket = 9 m spline genişliği |
| Yol kenarı → parsel/çit hattı | Her yanda 0,5 m (`PARCEL_VERGE`); düz ve karşılıklı çitlerde yaklaşık 4,9 m net açıklık |
| Yol kenarı → konut cephesi | Düz kesitte yaklaşık 3,5 m: parsel payı 0,5 m + konut çekmesi 3 m |
| Yol kenarı → dükkân cephesi | Düz kesitte yaklaşık 0,5 m: ticari çekme sıfır |
| Çit giriş açıklığı | Varsayılan 3 m (`DEFAULT_FENCE_GAP`) |
| İç sokak dönüşü | Profilde `local.minTurnRadius = 10 m`; iç sokak üreticisi bu değeri almıyor, araç dönüş alanını denetlemiyor |
| Spline geçiş bandı | 3 m `falloff`; yol genişliğine veya garantili engelsiz geçiş alanına eklenmez |

Araştırma sırasında üretilmiş `Test1` level'ındaki 8 iç sokağın tamamında 4 m
genişlik doğrulandı. Doruk K-180 GLB modelinin dış sınırları yaklaşık 2,8 m genişlik,
7,07 m uzunluk verdi. Yerleşim ölçeği 1 iken 4 m yolda ortalanmış araç için her
yanda 0,6 m yol payı; 3 m girişte her yanda yalnız 0,1 m kalır. Bunlar görsel model
ölçüleridir; fizik çarpıştırıcısı ve dönüşte kaplanan alan ayrıca doğrulanmalıdır.

Kod dayanakları: `engine/worldbuilder/roadClass.ts`, `roadSpline.ts`, `parcels.ts`,
`buildings.ts`, `fences.ts`, `terraces.ts`, `streets.ts`, `stages/streets.ts`,
`sceneCheck.ts` ve `public/assets/world-pilot/Levels/WbPilotValley.regionprofile.json`.

### Hedef ve başlangıç önerileri

Hedef, araçların düz sokak, kavşak ve araç girişlerinde yeterli boşlukla
ilerleyebilmesidir. Yalnız yol boyasını genişletmek yeterli değildir; parseller,
yapılar, setler, istinat duvarları, merdivenler, çitler ve donatılar aynı geçiş
alanını korumalıdır. Dönüş sırasında aracın ön ve arka köşelerinin kapladığı alan
da hesaba katılır.

Aşağıdaki sayılar **uygulamada denenecek başlangıç önerileridir**, tamamlanmış
ayar veya gerçek yol standardı değildir. Nihai değerler sürüş kontrolüyle seçilir.

| Parametre | Başlangıç önerisi |
|---|---|
| Köy içi taşıt yolu | 7 m |
| Kasaba içi taşıt yolu | 8 m |
| Yolun dış kenarı → parsel/çit için ayrılan pay | Her yanda en az 1,5 m; banket/kaldırım varsa bunların dışından ölçülür |
| Araç giriş açıklığı | En az 4,5 m; açılı girişlerde dönüş alanına göre büyür |
| İç sokak merkez hattında minimum dönüş yarıçapı | İlk deneme 12 m; araç ölçüleri ve dönüş kontrolü daha fazlasını gerektirirse artırılır |

Mezra ve arazi patikaları için dar yol seçeneği korunur; bu işte her `track`
otomatik genişletilmez. Ana bağlantıların ve yerleşim girişlerinin iç sokaklara
geçişi ayrıca kontrol edilir. Bina çekmeleri, taşıt yolundan ayrı bir ölçüdür;
konutun bahçe boşluğu çit arkasında kalıyorsa sürüş alanı sayılmaz.

### Uygulama sırası

- [ ] **Y1 — Ortak yol ve açıklık verisi.** Bölge profilinde yerleşim türüne göre
  sokak kesiti, parsel kenar payı ve araç giriş açıklığını tanımlayan isteğe bağlı
  ayarlar tasarla; mevcut profillerin eski davranışını koruyan varsayılanları ve
  doğrulamayı ekle. Taşıt yolu, banket, kaldırım ve engelsiz kenar payının hangi
  sınırdan ölçüldüğünü açık tanımla. Varsayılan World Builder profiline köy/kasaba
  önerilerini uygula. Aynı çözümleyiciyi `world:brief` ve rastgele üretim kullansın.
- [ ] **Y2 — Sokak ve parsel yerleşimi.** `stages/streets.ts`, `streets.ts` ve
  `parcels.ts` genişlik ve kenar payını ortak veriden alsın. Sokaklar arası mesafe,
  parsel başlangıcı ve kavşak rezervi yeni kesitten hesaplansın. `PARCEL_VERGE`
  kullanan bütün hesaplar birlikte ele alınsın. Daha geniş kesit programa yeterli
  parsel bırakmıyorsa üretici bunu bildirsin; yolu sessizce daraltmasın.
- [ ] **Y3 — Dönüş ve kavşak alanı.** İç sokak üretimine `minTurnRadius` bağla;
  yan yola dönüş ve T/kesişim noktalarında dönüş hattı ile gerekli genişlemeyi
  üret. Araç genişliği, uzunluğu ve manevra ölçülerini genel veri olarak kullan;
  Doruk'a özel oyun kuralı yazma. Uzun aracın köşelerinin dönüşte kapladığı alanı
  denetle. Yalnız spline'ı yumuşatmak veya kontrol noktalarının yarıçapını ölçmek
  kabul için yeterli sayılmasın. Sığmayan dönüş yeniden çözülsün veya raporlansın.
- [ ] **Y4 — Yol kenarı ve araç girişleri.** Binalar, set/istinat duvarlarının
  dış yüzleri, merdivenler, çitler ve donatılar ayrılan geçiş alanının dışında
  kalsın. Duvarın kalınlığı ve setin geçiş bandı hesaba katılsın. Araç girişi ile
  yaya kapısını ayır; araç girişlerini profil açıklığı ve dönüş ihtiyacıyla kur.
  Zemin bağlantısı araç için geçilebilsin; gerekiyorsa rampa üret, yalnız merdiven
  bırakma. Kaldırım/banket payı parsel yerleşiminde de korunsun.
- [ ] **Y5 — Son sahne denetimi.** `sceneCheck.ts` mevcut yol–set çakışması ve
  giriş kot farkı kontrollerine ek olarak son üretilen engelleri ve dönüş alanını
  denetlesin. Sorunlu sokak/kavşak/giriş kimliği, gereken ve kalan açıklık raporda
  görülsün. Üretimin başarılı bitmesi tek başına araç geçiş kabulü sayılmasın.
- [ ] **Y6 — Doğrulama ve kabul.** Aşağıdaki ölçütleri izole örnek level'larda
  kontrol et; seçilen nihai değerleri ve doğrulama sınırlarını bu bölüme kaydet.

Yeni kalıcı alan gerekirse profil normalizer/loader'ı ve alanın kaydedildiği
yüzey birlikte güncellenir; `tools/saveValidator.ts` ve ilgili şema kontrolleri
gözden geçirilir. Var olan oyunların özel profilleri kendiliğinden değiştirilmez.

### Kabul ve doğrulama

- Aynı tohumla, düz köy + kasaba ve eğimli köy örnekleri ayrı çıktılara üretilir.
  Mevcut `Test1`, pilot ve kullanıcı tarafından düzenlenmiş level'lar yeniden
  üretilmez; mevcut sahnelere uygulama ayrı bir işlem olur.
- Motor testleri seçilen kesit/payların bütün aşamalara taşınmasını, yol dışına
  ötelenen parsel ve engelleri, uygun/uygunsuz dönüşleri ve araç girişlerini kapsar.
  Aynı girdinin aynı çıktıyı vermesi ve eski profil uyumluluğu doğrulanır.
- Düz sokakta iki referans aracın karşılaşması; sağ/sol dönüş, T kavşağı ve açılı
  bahçe girişi denenir. Düz yolda hedef: araç–kenar en az 0,5 m, karşılaşan
  araçlar arasında en az 0,4 m. Dönüşte aracın dış sınırı ile engel arasında en az
  0,5 m hedeflenir. Bu paylar veri olarak tanımlanır ve fizik ölçüleriyle sınanır.
- Playwright ile editör/runtime açılışı, konsol hataları ve üstten/araç hizasından
  görüntüler kontrol edilir. Görüntüler dönüş geometrisini gösterir; gerçek
  araçla sürüş ve fizik geçiş kabulünün yerine geçmez. Doruk K-180 ve daha küçük
  bir araçla sürüş yapılır; geri manevra gerektirmeden ana sokak dönüşleri ve
  tanımlı araç girişleri geçilir. Performans ve parsel kapasitesi değişimi kaydedilir.
- TypeScript değişikliklerinden sonra `npx.cmd tsc --noEmit`; motor değişikliği
  için `npm.cmd run test:engine` ve `npm.cmd run build:verify` çalıştırılır.
  Yol, parsel ve bina üretimini etkileyen ilgili tarayıcı senaryoları da kontrol edilir.

**Bitiş ölçütü:** yeni üretilen köy/kasabalarda seçilen kesitler, kenar payları ve
araç girişleri ölçüyle doğrulanmış; dönüşler son engellerle birlikte denetlenmiş;
referans araçlarla sürüş kabulü tamamlanmış ve kalan istisnalar raporlanmış olur.
