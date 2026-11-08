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
- [x] 3. Su (8 Kasım 2026, kod; görsel onay bekliyor): `--rivers 0-3 --lakes 0-3` (varsayılan 0:
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
- [x] 4. Örtü tipleri (8 Kasım 2026, kod; görsel onay bekliyor): `--cover forest|meadow|farmland|steppe|desert|alpine`
  (varsayılan `forest`, bugünkü görünümle bayt bayt aynı) ve `--forest|--rocks|--fields low|medium|high`.
  Örtü bir veri dosyasıdır (`public/assets/world-builder/covers/*.cover.json`, `normalizeGroundCover`):
  en çok 8 boya katmanı ve rolleri, kaya eğimi, orman (köyden uzaklık, pay, yama boyu), su kenarı
  şeridi, köy çevresi tarlalar (yamalı parseller, düz yerde), kar çizgisi (yükseklik yüzdeliği, en
  alçak zeminin en az 60 m üstü; altında ağaç sınırı), bitkiler (`*.foliagetype.json` yolu) ve kaya
  sayıları. Toplanan doğa varlıkları gelince yalnız bu dosyalar değişir. Kar yalnız dağlıkta oluşur;
  "her yer karlı" mevsim işi (WES). Test: `tests/engine/groundCover.test.ts`.
- [ ] 5. Editör penceresi
- [ ] 6. Rol → model
- [ ] 7. Ada ve kıyı
