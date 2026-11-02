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

Üç gerçek görsel üstünde 2–3 kontrol noktası ve elle düzeltme/yeniden analiz
karşılaştırması henüz yapılmadı. Bu WB-13 kabulü ve kalan ölçek/görünüm kararı
F1b'nin sonraki kontrol noktasıdır.
