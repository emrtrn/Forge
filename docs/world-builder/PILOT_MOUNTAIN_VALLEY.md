# World Builder pilotu — dağ vadisi

Durum: greybox sahne üretildi, hazır bitki modelleri bekleniyor (7 Kasım 2026).

Tasarım dokümanından dünya üretme hattının ilk uçtan uca denemesi. Amaç oyun değil,
hattın nerede kırıldığını görmektir. Tekrar eden adımlar pilottan sonra otomatikleşir.
Kararlar: [plan §10](../planned/WES/FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.4.md),
karar 20–22.

## Üretim

`npm run world:pilot` sahneyi editörsüz üretir:
`public/assets/world-pilot/Levels/WbPilotValley.level.json` (Content Browser'da
görünür, editörde düzenlenip commit'lenir; üretici `tools/world/wbPilotValley.ts`).
Var olan level'ın üstüne yazmaz; `npm run world:pilot -- --force` sıfırdan kurar ve
editörde yapılan değişiklikleri siler. Greybox modelleri `art/world-pilot/wp_greybox.py`
üretir. Foliage tipleri `public/assets/world-pilot/foliage/*.foliagetype.json`
dosyalarıdır; hazır model gelince yalnız `meshAssetId` değişir.

## Pilotun gösterdikleri

- Zincir editörsüz çalışıyor: arazi, ped, gerçek `roads` aşaması ve spline bake.
- Krokideki tırmanış kullanılamadı, dönemeçleri yamaçtan dik çıkıyor ve iniyor.
  Yol koridor ipucudur; tırmanışı rota çözücü kurdu (eğim çoğunlukla 8–10°).
- Bilinen açık: dönemeç uçlarında kısa bacaklar 20,4°'ye çıkıyor ve dönüş yarıçapı
  sınırın altında; rota çözücü dönemeç genişletmiyor.
- Arazi, nehir yatağı ve boya henüz aşama değil, bu üreticide elle yazılı.
- Foliage çizimi kamera çevresindeki halkadan gelir; uzak yamaçlar için ayrı bir
  uzak görünüm yok.
- Görsel ayar kapsam dışıdır: ışık ve renk kullanıcı tarafından editörde ayarlanır.

## Dünya özeti

Sayılar pilot için seçilmiş başlangıç değerleridir, kabul sırasında değişebilir.

| Konu | Değer |
|---|---|
| Alan | 1000 × 1000 m, dünya `x, z` −500…500; kuzey −Z |
| Vadi | Kuzey-güney ekseninde, taban yaklaşık 120 m geniş, kuzeyde 100 m, güneyde 90 m kot |
| Yamaçlar | Batı ve doğu, yaklaşık 20°, sırt kotu 240–260 m |
| Nehir | Vadi tabanında kuzeyden güneye, hafif kıvrımlı, 8–12 m geniş |
| Yol | 4 m stabilize; güney kenardan girer, nehrin batısında ona 25 m uzaklıkta kuzeye gider, `z ≈ −110` civarında ayrılıp batı yamaçtan kulübeye çıkar |
| Kulübe | Yaklaşık `(−215, −227)`, kot 155 m, 30 × 30 m düzlenmiş alan |
| Örtü | Yamaçlarda iğne yapraklı orman, tabanda çayır, sırta yakın kaya |
| WES | Yaz, tek sabit gün saati, hava olayı yok |

Bölge kültürü seçilmedi (karar 18). Kulübe genel bir dağ kulübesidir.

## Üretim sırası

Sıra kesin değildir, teknik bağımlılığa göre değişir. Başlangıç sırası:

arazi → nehir yatağı → yol → kulübe zemini → boya → bitki örtüsü → yapılar ve proplar

Greybox tamamlanınca kullanıcı onayı alınır. Sonra her aileden bir örnek detaylandırılır,
onay alınırsa geri kalanı tamamlanır.

## Model listesi

Liste pilot boyunca güncel tutulur. **Bekliyor** satırları sahnede placeholder ile durur.

### Hazır modeller (kullanıcı)

7 Kasım'da `starter-content/StaticMeshes/Environment/` altına gelen `Forest_*` paketi
bağlandı. Foliage tipleri `public/assets/world-pilot/foliage/` altında; bir modeli
değiştirmek için yalnız tipin `meshAssetId` alanı değişir.

| Tip / kullanım | Model | Ölçek |
|---|---|---|
| `wp-conifer-a` olgun çam | `forest-tree-01` (25 m) | 0,8–1 |
| `wp-conifer-b` orta çam | `forest-tree-02` (18 m) | 0,85–1,15 |
| `wp-conifer-c` genç çam | `forest-tree-04` (10 m) | 0,8–1,2 |
| `wp-bush-a`, `wp-bush-b` çalı | `forest-lowpolyprop-03`, `-05` | 0,45–0,7 |
| `wp-grass-a` çayır otu | `forest-lowpolyprop-01` | 0,2–0,3 |
| Kayalar (yerleşim) | `forest-rock-01` … `-09`; yüksek kaya, yamaç ve dere kenarı ayrı gruplar | 1–4 |

Kullanılmayanlar: `forest-tree-03` sonbahar renkli yaprak döken ağaç (sahne yaz);
`forest-lowpolytree-*` düz kart ağaçlar, foliage'da uzak görünüme geçiş olmadığı
için yakında yassı görünür; `forest-lowpolyprop-02`, `-04` sınıflandırılmadı.
Blender kayaları (`wp-rock-a/b/c`) yerini paket kayalarına bıraktı.

Yeni model kuralları:

- Forge `.glb` ve `.gltf` okur; FBX veya OBJ gelirse Blender ile çevrilir.
- Ölçek, pivot ve yön bağlarken düzeltilir.
- Foliage'a özel LOD kodu olmadığından üçgen bütçesi önemlidir.

### Claude'un Blender ile üreteceği modeller

Klasör: `public/assets/world-pilot/structures/` ve `.../props/`; kaynak script'ler
`art/world-pilot/`.

| Dosya | Ne | Durum |
|---|---|---|
| `wp-cabin.glb` | Dağ kulübesi | Greybox hazır |
| `wp-woodpile.glb` | Odun yığını | Greybox hazır |
| `wp-fence-module.glb` | Çit modülü | Greybox hazır |
| `wp-signpost.glb` | Yol tabelası | Greybox hazır |
| `wp-rock-a.glb`, `wp-rock-b.glb`, `wp-rock-c.glb` | Kaya varyantları | Greybox hazır |

Yol spline'dan, nehir su sisteminden üretilir; ikisi için model gerekmez.

### Codex'e ürettirilecek görseller

Klasör: `art/world-pilot/references/`

| Dosya | Ne | Durum |
|---|---|---|
| `pilot-plan-map.png` | [Karar 16 standardında](REFERENCE_PLAN_IMPORT.md#referans-görseli-standardı-karar-16) kroki, 1254 px | Üretildi |
| `pilot-cabin-concept.png` | Kulübe referansı | Üretildi |
| Arazi katmanı dokuları | Çayır, orman zemini, kaya, toprak yol | Greybox onayından sonra |

Krokide yol, okunabilirlik için dünya özetindeki 4 m'den yaklaşık 8 m geniş çizilidir;
genişlik için dünya özeti geçerlidir. İstemdeki konumla ölçülen konum farkı kulübede
yaklaşık %1, yol ayrımında yaklaşık %6'dır.
