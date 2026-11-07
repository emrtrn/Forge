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
- [ ] 2. Rastgele üretici
- [ ] 3. Su
- [ ] 4. Örtü tipleri
- [ ] 5. Editör penceresi
- [ ] 6. Rol → model
- [ ] 7. Ada ve kıyı
