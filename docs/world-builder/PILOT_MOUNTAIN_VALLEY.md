# World Builder pilotu — dağ vadisi

Durum: kapsam ve iki referans görseli hazır, kroki onayı bekleniyor (7 Kasım 2026).

Tasarım dokümanından dünya üretme hattının ilk uçtan uca denemesi. Amaç oyun değil,
hattın nerede kırıldığını görmektir. Tekrar eden adımlar pilottan sonra otomatikleşir.
Kararlar: [plan §10](../planned/WES/FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.4.md),
karar 20–22.

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

### Kullanıcının getireceği hazır modeller

Klasör: `public/assets/world-pilot/foliage/`

| Dosya | Ne | Hedef boy | Sahnede şimdilik | Durum |
|---|---|---|---|---|
| `wp-conifer-a.glb` | Olgun iğne yapraklı ağaç | 18–22 m | `Pine` foliage tipi | Bekliyor |
| `wp-conifer-b.glb` | Genç iğne yapraklı ağaç | 8–12 m | `Pine` foliage tipi | Bekliyor |
| `wp-bush-a.glb` | Dağ çalısı | 1–1,5 m | `Bush` foliage tipi | Bekliyor |
| `wp-grass-a.glb` | Çimen veya ot öbeği | 0,3–0,6 m | `kenney-nature-kit/grass.glb` | Bekliyor |

Dosya kuralları:

- Dosya başına tek bitki. Dokular `.glb` içinde gömülü ya da aynı klasörde olsun.
- Forge `.glb` ve `.gltf` okur. FBX veya OBJ gelirse aynı adla bırakılır, Blender ile çevrilir.
- Ölçek, pivot ve yön sorun değildir; bağlarken düzeltilir.
- Foliage'a özel LOD kodu bulunmadığından bütçe önemlidir. Öneri: ağaç başına 15 bin üçgen
  altı, çalı 3 bin, ot 500. Daha ağır modeller reddedilmez, ölçülüp raporlanır.
- Kaynak ve lisansı bildirin. Lisans depoya girebilecek bir model olup olmadığını belirler.

Model eklenince Claude'a dosya adını söylemek yeterlidir. Bağlama adımları:
ölçü ve üçgen kontrolü → gerekirse normalizasyon → manifest kaydı → `*.foliagetype.json`
→ sahnede placeholder ile değişim → ekran görüntüsüyle kontrol.

### Claude'un Blender ile üreteceği modeller

Klasör: `public/assets/world-pilot/structures/` ve `.../props/`; kaynak script'ler
`art/world-pilot/`.

| Dosya | Ne | Durum |
|---|---|---|
| `wp-cabin.glb` | Dağ kulübesi | Sırada |
| `wp-woodpile.glb` | Odun yığını | Sırada |
| `wp-fence-module.glb` | Çit modülü | Sırada |
| `wp-signpost.glb` | Yol tabelası | Sırada |
| `wp-rock-a.glb`, `wp-rock-b.glb`, `wp-rock-c.glb` | Kaya varyantları | Sırada |

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
