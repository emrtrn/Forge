# Reference Plan Import — T35 ilk dilim

World Builder → **Reference Plan Import**, editör dışında bir görsel yorumlayıcının
ürettiği JSON'u seçerek veya yapıştırarak alır. Bu adım görseli analiz etmez, API
çağırmaz ve sahne geometrisi üretmez. Önce Reference alanında üstten görünüşlü
bir görsel yolu, sol üst dünya koordinatı ve metre cinsinden boyutu ayarlanmalıdır.
`perspective` referanslar bu aktarım için reddedilir.

1. JSON dosyasını seç (otomatik önizleme) veya yapıştırıp **Preview Import** seç.
2. Altlık üstünde konumları ve eklenen/güncellenen/korunan öğe listesini incele.
3. **Apply Import** tüm değişiklikleri tek undo adımıyla recipe'ye alır.
   **Clear Import** geçici görünümü kaldırır. Önizlemede plan düzenleme ve
   üretim aşamaları kapalıdır; Save Layout sadece uygulanmış recipe'yi kaydeder.
4. İstenirse planı elle düzelt; üretim aşamalarını ayrıca çalıştır. Kalıcı yazım
   için **Save Layout** kullan. Undo/redo plan ile silme kayıtlarını birlikte taşır.

## Üretici sözleşmesi

```json
{
  "schemaVersion": 1,
  "coordinateSpace": "reference-normalized",
  "referenceImage": "maps/reference.png",
  "plan": {
    "settlements": [
      {"id":"village-north","source":"reference","observed":true,"confidence":0.8,
       "center":[0.4,0.3],"radius":0.08,"type":"village"}
    ],
    "roadGraph": {
      "nodes": [
        {"id":"road-west","source":"reference","observed":true,"confidence":0.9,"position":[0.1,0.5],"kind":"end"},
        {"id":"road-east","source":"reference","observed":true,"confidence":0.9,"position":[0.9,0.5],"kind":"end"}
      ],
      "edges": [
        {"id":"road-main","source":"reference","observed":true,"confidence":0.9,"from":"road-west","to":"road-east","roadClass":"local"}
      ]
    },
    "water": [
      {"id":"river-east","source":"reference","observed":true,"confidence":0.7,"kind":"stream","path":[[0.8,0.1],[0.7,0.9]]}
    ],
    "regions": [
      {"id":"forest-west","source":"reference","observed":false,"confidence":0.4,"kind":"forest.conifer","polygon":[[0.05,0.05],[0.3,0.05],[0.2,0.3]]}
    ]
  }
}
```

- `referenceImage`, mevcut recipe'deki görsel yoluyla birebir aynı olmalıdır.
- Bütün noktalar `[u,v]`, iki sonlu sayı ve `0..1` aralığındadır. Sol üst `[0,0]`,
  sağ alt `[1,1]`; sağa dünya +X, aşağı +Z. Dönüşüm:
  `[originX + u*width, originZ + v*height]`. `center`, `position`, `boundary`,
  `polygon`, `path`, `guide` bu kurala uyar. Yükseklik içerilmez.
- Yerleşim `radius`, görsel **genişliğinin** `(0,1]` oranıdır; diğer koordinatlar
  gibi metre cinsinden gönderilmez. Örneğin 400 m genişlikte `0.08` → 32 m.
- Her öğe kararlı bir `id`, `source:"reference"`, boolean `observed` ve `0..1`
  `confidence` taşır. Gözlenen ve tahmin edilen ayrımı dürüst tutulmalıdır.
- Yerleşim, bölge, su, işaret, düğüm ve kenar alanları recipe plan şemasıyla
  aynıdır; `protected` dışarıdan verilemez. `landmarks` için `position` ve `kind`,
  isteğe bağlı `settlement` kullanılır. Su, yalnızca `path` veya `polygon` taşır.
  İçe aktarma kökünde yalnızca örnekteki dört alan kabul edilir; sahiplik,
  üretilmiş veriler ve ayarlar aktarılamaz. Boyut sınırı 2 MiB / 5000 öğedir.
- Eksik listeler ve mevcut planda olup JSON'da bulunmayan öğeler korunur.
  Kenarlar JSON'daki veya mevcut plandaki düğümlere bağlanabilir. Geçersiz bir
  öğe, koordinat veya bağlantı tüm aktarımı reddeder; kısmi uygulama yapılmaz.

## Yeniden analiz kuralları

Birleştirme anahtarı `(öğe türü, id)`'dir. Aynı referanstaki aynı kimlikli öğeler
ancak kaynakları `reference` ise güncellenir. `manual`, başka kaynak ve korunan
bir yerleşim değiştirilmez. Kimlikleri her analizde yeniden üretmek yerine aynı
anlamdaki öğelerde aynı tutmak gerekir; farklı ID yeni öğe sayılır.

Elle silinen öğelerin kimlikleri ve düğümle birlikte silinen kenarlar recipe'nin
`ownership.deletedPlanElements` alanında tutulur. Kaydet/yükle sonrası yeniden
analiz bunları geri getiremez. Bu kimlikler yeni manuel öğeler için de ayrılır.
Silinmiş bağımlılığa bağlı yeni bir öğe uygulanmaz ve listede gerekçesi görünür.
Silme işlemini geri almak Undo ile mümkündür; ayrı bir silme kaydı temizleme
arayüzü bu dilimde yoktur. Aynı JSON tekrarlandığında değişiklik yoksa Apply
kapalı kalır. Referans değişirse eski önizleme geçersizleşir.

## Görsel yorumlayıcı için başlangıç yönergesi

> Bu üstten görünüşlü görselden yalnızca yukarıdaki sözleşmeye uyan JSON üret.
> Piksel/metre tahmini yerine normalize [u,v] kullan; görsel yolunu verilen
> referenceImage ile aynı tut. Yerleşimleri, ana yol bağlantılarını, su ve orman/
> dağ bölgelerini kaba geometriyle işaretle. Gözlenmeyen ayrıntı uydurma;
> çıkarımları observed:false ve düşük confidence ile belirt. Önceki analiz
> verildiyse aynı öğelerin ID'lerini koru. protected/manual/ownership/generated
> alanlarını yazma. Üçgen veya daha fazla noktalı poligon ve en az iki noktalı
> su çizgisi kullan; yol bağlantılarında yalnızca mevcut düğüm ID'lerini kullan.

## Referans görseli standardı (karar 16)

Karar 2026-11-07'de kapandı. Plan yalnız tepeden görselden okunur. Perspektif görsel
isteğe bağlı stil notudur: bugün onu okuyan kod yoktur, kabulde kullanılmaz.

- **Görünüm:** tam tepeden, perspektifsiz. Kuzey yukarıda; görselin sağı dünya +X,
  aşağısı +Z. Recipe'de `reference.view` `topDown` olur.
- **Tarz:** sade harita. Yazı, sembol, lejant, pusula, ölçek çubuğu, çerçeve, gölge
  ve kabartma gölgelemesi yoktur.
- **Biçim:** kare PNG, en az 1024 × 1024 px.
- **Ölçek:** varsayılan kapsam 1 km × 1 km (`reference.size` `[1000,1000]`), 1024 px'te
  yaklaşık 1 m/px. Ölçek görsel başına girilir; görselden çıkarılmaz.
- **Renkler:** su düz mavi, orman koyu yeşil, tarım açık yeşil, açık arazi soluk bej,
  kayalık gri, yol krem, yerleşim küçük binaların dolu lekesi. Her görselde aynı palet
  kullanılır ki öğeler birbirine karışmasın.
- **Yükseklik:** görsel yükseklik vermez; kabartma plan katmanına yazılmaz.
- **Kültür:** ilk bölge profili (karar 18) açık olduğundan görsel belirli bir bölgeyi
  taklit etmez.

### WB-13 test görselleri

Üç sahne farklı plan öğelerini sınar. Tarz ortak yönergesi:

> Top-down orthographic map of a fictional 1 km by 1 km rural area, north up, flat
> solid colours, clean shapes. Flat blue water, dark green forest, light green
> farmland, pale beige open land, grey rock, cream roads, settlements as solid clusters
> of small building footprints. No text, labels, symbols, legend, compass, scale bar,
> border, shadows, hillshading, contour lines or perspective.

| # | Dosya adı | Sahneye özel ek | Sınanan öğeler |
|---|---|---|---|
| 1 | `wb13-valley.reference.png` | `A river crosses the map from north-east to south-west. A village sits on the river's west bank, one main road runs along the valley and a side road leaves it for the village. Conifer forest covers the west edge.` | Akarsu, ana yol ve yan yol, kavşak, orman bölgesi |
| 2 | `wb13-highland.reference.png` | `A small hamlet in the north is linked by one winding road to a larger village in the south. A narrow stream runs beside the road. Bare rock covers the north-east corner and forest fills the rest of the high ground.` | Mezra ve köy, kıvrımlı yol, dere, kayalık bölge |
| 3 | `wb13-lakeside.reference.png` | `A lake fills the centre-east. Two small settlements stand on its west and south shores, joined by a road that follows the shore. A third road leaves the map to the west. Farmland surrounds both settlements.` | Göl çokgeni, iki yerleşim, kenardan çıkan yol, tarım bölgesi |

Her görsel için kabul, 2–3 kontrol noktasıyla planın altlık üstünde doğru yere
düştüğüne bakılarak; ardından elle düzeltme ve yeniden analizle düzeltmenin
korunduğu görülerek yapılır. Bu üç görselle WB-13 kabulü henüz yapılmadı; F1b'nin
sonraki kontrol noktası budur.
