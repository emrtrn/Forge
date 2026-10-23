# FORGE OFFROAD — Arazi Detaylandırma, Çok Katmanlı Yüzey ve Deformasyon

**Belge türü:** Problem analizi, mimari alternatifler ve çözüm önerileri  
**Sürüm:** v0.1 — 23 Ekim 2026  
**Proje:** Forge Offroad  
**Kapsam:** 4096 × 4096 m `World Terrain` üzerinde yüksek detaylı yerel yüzeyler, çamur ve tekerlek deformasyonu  
**Durum:** Tasarım tartışması derlemesi. Bu belgede önerilen mimariler **uygulanmış veya onaylanmış kararlar değildir**.

**İlgili proje kaynakları:**
- `FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_2026-10-23.md`
- `FORGE_OFFROAD_WORLD_LEVEL_DESIGN_RAPORU_v0.1.md`
- `FORGE_OFFROAD_GDD_PROJE_CERCEVESI_v0.3.md`

---

## 1. Amaç ve temel problem

Forge Offroad'un temel dünyası **izole dağ yerleşimleri** arasında geçen **lojistik ve taşımacılık** deneyimine hizmet eder. Harita **4096 × 4096 metre** (yaklaşık 16,78 km²) olarak planlanmıştır. Dağ sırtları, vadiler, nehir yatakları ve yollar için geniş ölçekli, performanslı bir arazi gereklidir. Buna karşılık çamur, tekerlek izi, yol kenarı hendeği ve yerel erozyon gibi ayrıntılar metre altı çözünürlük ve bazı durumlarda oyun sırasında değişen bir yüzey gerektirir.

**Ana tasarım sorusu:** Dünyanın tamamında aşırı yüksek vertex yoğunluğuna çıkmadan, seçili bölgelerde hem görsel hem fiziksel olarak ayrıntılı ve gerektiğinde deforme olabilen yüzeyleri nasıl oluşturacağız?

Bu konuşmada iki kullanıcı önerisi değerlendirildi:

1. **Birden çok küçük `Landscape` katmanı:** Mevcut tek parça `Landscape` aracını çoklu örnek destekleyecek şekilde genişletip `World Terrain` üzerine yerel, yüksek çözünürlüklü alanlar yerleştirmek. Çamur yüzeyi deforme olurken altındaki `World Terrain` sert taban / maksimum batma sınırı olarak kullanılır.
2. **Boyamayla yerel çözünürlük artırma:** `World Terrain` üzerinde fırçayla işaretlenen alanlarda vertex aralığını küçültmek. Bu, uzaklığa göre LOD'dan farklı olarak, **tasarım aşamasında konuma göre gerçek geometrik detay** yaratmayı hedefler.

**Önerilen birleşik yön:** Dünya ölçekli `World Terrain` + yerel `Landscape` altyapısından yararlanan **Detail Patch** + alan seçen **Detail Paint Tool** + bunlardan ayrı **Soil/Surface Physics**. Gerçek adaptif World Terrain topolojisi alternatif olarak değerlendirilmeye devam eder; ilk uygulama yolu olarak önerilmez.

---

## 2. Mevcut araçlar ve doğrulanması gereken sınırlar

### 2.1 World Terrain

Editördeki **New World Terrain** ekranında 4096 × 4096 m dünya aşağıdaki yapılandırmayla oluşturulabiliyor:

| Parametre | Değer |
|---|---:|
| `Tiles X / Z` | 8 × 8 (64 tile) |
| `Tile Resolution` | 256 × 256 quad |
| `Vertex Spacing` | 2 m |
| `Base Height` | 0 m |
| Her tile fiziksel boyutu | 512 × 512 m |
| Toplam vertex (tile başına uçlar dahil) | 4.227.136 (yaklaşık 4,23 milyon) |

Editörün oluşturma arayüzü bu konfigürasyonu kabul ediyor. Bu olgu, **çoklu tile runtime render / collision / streaming / uzun sürüş performansının tamamının doğrulandığı anlamına gelmez**; bu hususlar ayrı test konusudur. Güncel teknik durum raporunda World Terrain veri/saklama temeli ile uygulama tarafındaki çoklu tile entegrasyonu ayrı aşamalar olarak ele alınmıştır.

**Vertex spacing kararı:** 2 m, 4096 m ana coğrafya için *çalışma önerisidir*, kilitlenmiş nihai çözünürlük değildir. 1 m de değerlendirilmiştir; daha yüksek çözünürlük hem render hem editör belleği/işleme maliyetini büyütür. Araçla yakın temas gerektiren ayrıntılar nedeniyle bütün dünyayı 0,25 m grid'e dönüştürmek doğru varsayılan çözüm sayılmamaktadır.

### 2.2 Eski Landscape

23 Ekim teknik envanterine göre eski `Landscape` tarafında sculpt/paint, spline deformasyonu ve kaydetme akışları bulunur; mevcut `SceneApp.addLandscape` yaklaşımı sahne başına bir Landscape ile sınırlıdır. **Çoklu Landscape, World Terrain'e bağlama ve runtime tekerlek deformasyonu bugün hazır özellikler olarak kabul edilmemelidir.**

Eski Landscape'in temel grid çözünürlükleri 65×65, 129×129 ve 257×257 vertex olarak raporlanmıştır. Fiziksel alan, grid boyutu ile vertex spacing'in çarpımına bağlıdır. Bu alt sistemin mevcut kodundan yararlanmak, doğrudan yeni bir örnek sayısı sınırsızlığı sağladığı anlamına gelmez; nesne yaşam döngüsü, referanslar, serialize/save ve collision yolları incelenmelidir.

### 2.3 Görsel zemin ile fiziksel zemin ayrımı

Mevcut görsel terrain katmanları, araç lastiği için doğrudan `mud`, `wetness`, `sink resistance` veya zemin tutuşu sağlamaz. Rapier tabanlı raycast araç sistemi, görsel lastik izinin kendiliğinden fiziksel batma oluşturacağı bir sistem değildir. Nehir görselleştirme altyapısının olması da su fiziği bulunduğu anlamına gelmez.

---

## 3. Problem envanteri

| ID | Problem | Neden önemli? | Çözüm yönü |
|---|---|---|---|
| **P-01** | 2 m world grid'de detay yetersizliği | Tekerlek izi, küçük hendek, çamur olukları yüzeye sığmaz | Yerel yüksek çözünürlüklü geometri / detail overlay |
| **P-02** | 0,25 m aralığı tüm dünyaya uygulamanın maliyeti | Bellek, geometri, collision ve düzenleme yükü büyür | Dünyada kaba grid; yalnız ihtiyaç alanında detay |
| **P-03** | Eski Landscape tek örnek sınırı | Birden fazla bağımsız çamur/yol alanı yerleştirilemez | Çoklu Landscape veya ondan türetilen Detail Patch |
| **P-04** | İki yüzey çakışması | Z-fighting, üst üste collider, sahte temas | Surface ownership, kenar geçişi, collision authority |
| **P-05** | Çamur kalınlığı / sert taban mantığı | Üst ve alt yüzey aynı kotta ise fiziksel batma hacmi yoktur | Yumuşak tabaka kalınlığı ve gerçek alt taban tanımı |
| **P-06** | Görsel deformasyon ≠ fiziksel deformasyon | Tekerlek görünürde batarken çarpışma eski seviyede kalabilir | Soil Physics + özel wheel contact / kontrollü collider güncellemesi |
| **P-07** | Düzenli World Terrain üzerinde seçili vertex artırma | Grid topolojisi, T-junction ve çatlak riski | Detail Patch veya ileri aşamada adaptive topology |
| **P-08** | Patch–World Terrain kenar dikişleri | Çatlak, basamak, yol yüzeyi kopukluğu | World Terrain'den örnekleme, falloff ve seam testi |
| **P-09** | Runtime deformasyon performansı | Her tekerlek temasında büyük mesh/collider rebuild pahalı olabilir | Yerel aktif pencere, GPU gösterim, sınırlı CPU fizik verisi |
| **P-10** | Veri sahipliği, kayıt ve streaming | Patch başka tile'a taşabilir; izler kaybolabilir | Patch kimlikleri, tile ilişkilendirmesi, ayrı deformasyon kaydı |
| **P-11** | LOD ile üretim çözünürlüğünün karıştırılması | LOD tek başına yeni şekillendirilebilir veri yaratmaz | Authoring detail resolution / render LOD ayrımı |
| **P-12** | Yol ve nehirle entegrasyon | Detay patch'i spline koridoru ve su yatağıyla çelişebilir | Patch yerleşiminde yol/su maskeleri, kesit testleri |

---

## 4. Seçenek A — World Terrain üzerinde çoklu Landscape

### Fikir

Mevcut `Landscape`, sahneye birden fazla eklenebilir. Her Landscape küçük fiziksel boyuta ve sık vertex aralığına sahiptir. World Terrain büyük formları temsil ederken Landscape, örneğin 32×32 m veya 64×64 m çamur alanının üst yüzeyini temsil eder.

### Avantajlar

- Mevcut sculpt, paint ve spline kodlarının yeniden kullanılma olasılığı yüksek.
- Yalnız belirli bölgelerde 0,25–0,5 m geometrik detay sağlanabilir.
- Dünya topolojisini bütünüyle değiştirmek gerekmez.
- Her bölge bağımsız tasarlanabilir, kaydedilebilir ve ileride aktif/pasif hale getirilebilir.

### Problemler ve önerilen tedbirler

**A1 — Yüzeyler aynı konumdaysa:** Aynı yükseklikte iki render yüzeyi titreyebilir (*z-fighting*). Aynı yükseklikte iki fizik collider'ı ise raycast tekerlekler için kararsız temas yaratabilir. Çözüm, görünür yüzeyin ve fiziksel temasın tek bir yetkili kaynak üzerinden seçilmesidir. Yalnız render sırası veya küçük bir Y ofseti, fizik problemini çözmez.

**A2 — World Terrain'i sert taban saymak:** Bu fikir **koşullu olarak uygulanabilir**. Çamur başlangıç yüzeyi ile alt sert taban arasında gerçek ya da simüle edilmiş `mudDepth` bulunmalıdır. Çamurun kenarlarda çevredeki terrain kotuna bağlanması gerekir.

Önerilen yazım modeli:

```text
baseHeight(x,z)    = World Terrain sert taban kotu
mudThickness(x,z)  = düzenleme sırasında tanımlanan yumuşak tabaka kalınlığı
rutOffset(x,z,t)   = tekerlek izinin zaman içindeki aşağı/yana yer değiştirmesi
mudSurface(x,z,t)  = baseHeight + max(0, mudThickness + rutOffset)
```

Bu formül, fizik modelinin kendisi değil; **üst yüzeyin sert tabanın altına inmeyeceği** geometrik kuralın örnek ifadesidir. `rutOffset` için kısmi negatif değer, yanlara sıkışma ise ek alan/kanal gerektirir.

**Kritik uygulama seçimi:** 

- **Tercih edilen örnek:** World Terrain üzerinde çamur yatağı kadar **kalıcı, kontrollü bir çukur** oluşturulur; Detail Patch bu çukurun üstüne yumuşak yüzey olarak oturur. Böylece çamur yüzeyi çevre araziyle aynı kota bağlanabilir ve altında batma payı kalır.
- **Alternatif:** Alt taban korunur, çamur yüzeyi ana terrain'in üzerine yükseltilir. Bu durumda yüzeyde tümsek oluşması veya tabaka sınırının görünmesi ayrıca çözülmelidir.
- **Sanal fizik alternatifi:** Dünya geometrisi kazılmaz, `mudDepth` yalnız fizik profilinde temsil edilir. Bunun görsel/collider tutarlılığı özel test ister.

**A3 — Collider yetkisi:** Tekerlek ilk olarak hangi yüzeyi okuyacak? World Terrain'in sert yüzeyi, patch'in yumuşak yüzeyi ve olası yol mesh'i için **temas önceliği/surface ownership** kuralı gerekli. Üst yüzeyin görünür kotu değişirken alttaki statik collider'ın teması erken kesmesi veya aracın gözle görülür şekilde havada kalması engellenmeli.

**A4 — Gerçek zamanlı geometri güncellemesi:** Mevcut Landscape editor sculpt işlemi, oyun sırasında tekerlek deformasyonu için doğrudan uygun varsayılamaz. Editör snapshot ve mesh rebuild mekanizması her fizik adımında kullanılırsa performans riski yaratır. Ayrı runtime deformasyon verisi gerekir.

### İlk değerlendirme

**Uygun**, ancak `Landscape` nesnelerini yalnızca çoğaltmak yeterli değildir. Daha tutarlı yaklaşım, Landscape'in grid/sculpt yardımcılarını kullanan yeni bir **Detail Patch** rolü tanımlamaktır.

---

## 5. Seçenek B — Boyanmış bölgelerde World Terrain vertex aralığını küçültmek

### Fikir

Kullanıcı World Terrain üzerinde detay istediği yerleri fırçayla boyar; böyle alanların örnekleme aralığı 2 m'den 0,5 m veya 0,25 m'ye düşer. Amaç oyuncu yakınlığına göre değişen render LOD değil, **authoring verisinin konuma göre daha yoğun hale gelmesidir**.

### Avantajlar

- Detaylar temel dünya yüzeyinin doğal uzantısıdır; bağımsız üst yüzey miktarı azalabilir.
- Kullanıcı açısından sezgisel bir iş akışıdır: “Burada daha fazla sculpt detayı istiyorum.”
- Yol ve dere yataklarında yüksek detaylı statik geometriye izin verir.

### Mühendislik maliyeti

- Mevcut düzenli tile heightfield biçiminden **değişken çözünürlüklü veri/topoloji** modeline geçiş gerekebilir.
- Yüksek ve düşük yoğunluk sınırlarında **T-junction, çatlak veya basamak** oluşabilir. Stitch/skirt/geçiş üçgenleri gerekebilir.
- Sculpt, paint, collision, save/load, tile sınırları ve streamer çözünürlük farkını birlikte yönetmelidir.
- Rapier heightfield collider gibi düzenli grid varsayımlarının bu uyarlamayla nasıl kullanılacağı ayrıca tasarlanmalıdır.
- Bir alanı boyamak tek başına yeni vertex yüksekliği üretmez; ayrıntı için yeniden örnekleme veya bağımsız sculpt verisi gereklidir.

### LOD'dan farkı

| Konu | Render LOD | Boyanmış authoring yoğunluğu |
|---|---|---|
| Sorun | Uzak nesneyi daha ucuza çizmek | Belirli yerde daha fazla gerçek şekil verisi tutmak |
| Ölçüt | Kamera mesafesi / ekran hatası | Tasarımcı maskesi / bölge sınıfı |
| Vertex etkisi | Genellikle mevcut detayın alt örneklemesi | Gerçek yeni örnekler ve topoloji gerektirir |
| Save / sculpt | Normalde ana height verisini değiştirmez | Yeni veri üretir; kalıcı düzenleme ister |

### İlk değerlendirme

**Teknik olarak mümkün ancak ilk geliştirme için yüksek riskli.** Uzun vadeli bir “adaptive authoring terrain” çalışması olabilir. Çamur deformasyonunu tek başına çözmez; değişken vertex olsa bile zemin fiziği ve dinamik veri gerekir.

---

## 6. Seçenek C — Birleşik Detail Patch + Detail Paint Tool (önerilen yön)

İki fikrin üretim açısından en kullanışlı yanlarını birleştiren öneri:

```text
                       FORGE EDITOR
                           |
               4096 × 4096 m World Terrain
                 (örnek: 2 m base grid)
                           |
                   Detail Paint Tool
         (statik detay / deformable / çözünürlük)
                           |
                 Detail Patch Generator
             (Landscape grid kodunu yeniden kullan)
                           |
             +-------------+-------------+
             |                           |
       STATIC DETAIL                 DYNAMIC SOIL
      0,5–0,25 m mesh             mudDepth / wetness
      hendek / yol kenarı         compaction / rutField
             |                           |
         render + collision          wheel response
             +-------------+-------------+
                           |
                save / load / LOD / test
```

### 6.1 World Terrain'in görevi

- Dağ, sırt, vadi, geniş yol koridoru ve nehir yatağı gibi makro jeometri.
- Yerleşimler arası yolun temel yükselti profili.
- Normal zeminde temel collision / height query.
- Detay alanlarında gerektiğinde sert alt taban.

### 6.2 Detail Patch'in görevi

- Belirli X/Z alanında ana terrain'den başlangıç yüksekliğini örnekleyerek yerleşmek.
- Yerel yüksek çözünürlüklü **statik** şekiller (yol kenarı, hendek, erozyon) veya **dinamik** üst yüzey (çamur/gevşek zemin) barındırmak.
- Kenarlarda taban araziyle yumuşak ve çatlağı olmayan geçiş üretmek.
- Kalıcı benzersiz kimlik, parent World Terrain/tile referansı, çözünürlük ve malzeme/soil tanımı taşımak.
- Birden fazla patch'in örtüşmesi durumunda açık **öncelik ve karışım** kurallarına uymak.

### 6.3 Detail Paint Tool'un görevi

Boya aracının ilk sürümde **World Terrain topolojisini değiştirmesi gerekmez**. Bunun yerine patch talep maskesi üretir:

- `Standard`: Yalnız World Terrain.
- `Detailed Static`: Yerel statik ayrıntı için patch.
- `Deformable`: Çamur/gevşek zemin için ayrı runtime deformasyon verisi ve soil profili.

Editör fırçasında amaç, patch genişliği, kenar falloff, çözünürlük kademesi ve soil türü gibi parametreler bulunabilir. Boyanan sınırların tek bir devasa patch yerine örneğin 32/64 m yerel parçalara dönüştürülmesi streaming ve düzenleme açısından değerlendirilmeli. Bu bir uygulama önerisidir, kesin boyut kararı değildir.

### 6.4 Başlangıç çözünürlüğü adayları

| Grid | Vertex spacing | Alan | Kullanım |
|---|---:|---:|---|
| 129 × 129 | 0,25 m | 32 × 32 m | Küçük çamur geçidi |
| 257 × 257 | 0,25 m | 64 × 64 m | Geniş çamur bölgesi |
| 129 × 129 | 0,5 m | 64 × 64 m | Statik arazi ayrıntısı |
| 257 × 257 | 0,5 m | 128 × 128 m | Yol / dere kenarı ayrıntısı |

**Performans uyarısı:** 257×257 vertex'li tek düzenli patch yaklaşık **131.072 üçgene** karşılık gelir. Çok sayıda patch'i sürekli maksimum çözünürlükte çizmek uygun olmayabilir.

**Önemli ayrım:** Görünür mesh vertex aralığı ile tekerlek izini tutan sayısal deformasyon grid'i aynı olmak zorunda değildir. Örneğin görünür mesh 0,5 m, deformasyon veri dokusu 0,125–0,25 m örnekleme kullanabilir. GPU displacement / shader yöntemi ayrıca geliştirilir; mevcut sistem özelliği değildir.

---

## 7. Dinamik çamur sistemi: önerilen sorumluluk ayrımı

`Detail Patch` bir geometri altyapısıdır; **tek başına çamur fiziği değildir**. Dört veri/süreç ayrı düşünülmelidir:

| Bileşen | Verisi / işlemi | Başlangıç yaklaşımı |
|---|---|---|
| **Base Terrain** | `height(x,z)`, normal, sert altlık | World Terrain |
| **Soil Properties** | soil türü, çamur derinliği, ıslaklık, taşıma direnci, sıkışma | Patch'e veya soil maskesine ait veri |
| **Wheel–Soil Response** | tekerlek normal yükü, kayma, ilerleme direnci, batma limiti | Rapier araç sistemiyle entegrasyon gerektirir |
| **Visual Deformation** | iz derinliği, yüzey yer değiştirme, normal/decal, sıçrama | Yerel deformasyon alanı + gerektiğinde mesh/shader |

### Önerilen tek tekerlek akışı

1. Araç tekerleği temas konumunu sorgular; varsa ilgili soil patch'i bulur.
2. `mudDepth`, ıslaklık, tekerlek yükü ve kayma gibi veriler okunur.
3. Batma ve direnç hesabı yapılır; batma, alttaki sert tabanla sınırlandırılır.
4. Fizik sistemi temasa ve sürüş kuvvetlerine bunun etkisini uygular.
5. Oluşan oluk/sıkışma, yerel deformasyon verisine işlenir.
6. Görsel yüzey, tekerlek izi ve VFX yeni durumu yansıtır.
7. Save/reload ve ikinci geçiş kuralları ayrı test edilir.

### Çarpışma için açık iki seçenek

**F1 — Sabit temel collider + özel tekerlek teması [ilk prototip adayı].** Çamur batmasını fiziksel kuvvet, süspansiyon ve sanal temas düzeltmeleriyle taklit et. Daha az collider rebuild gerektirir. Ancak gövde collider'ının zemine vurması, tekerleğin görünür konumu ve sert tabana geçiş zorlayıcıdır.

**F2 — Aktif küçük bölgede deformable collider [ileri alternatif].** Fiziksel geometriyi de güncelle. Görsel ve fiziksel yüzey daha iyi eşleştirilebilir fakat update maliyeti, tile sınırı ve collision stabilitesi test gerektirir.

Bu seçeneklerin hiçbiri henüz doğrulanmış Forge özelliği değildir. Önce **tek patch + tek araç** üzerinde aynı girdilerle karşılaştırılmalıdır.

---

## 8. Karşılaştırmalı mimari değerlendirme

| Ölçüt | Çoklu Landscape | Adaptif World Terrain topology | Hibrit Detail Patch |
|---|---|---|---|
| Mevcut Landscape kodunu yeniden kullanma | Yüksek | Düşük | Yüksek |
| Ana World Terrain grid'ini koruma | Evet | Hayır / kapsamlı değişim | Evet |
| Yerel statik yüksek detay | Evet | Evet | Evet |
| Dinamik çamur | Ek fizik/görsel çalışma gerekir | Ek fizik/görsel çalışma gerekir | Ek fizik/görsel çalışma gerekir |
| Dikiş ve yüzey çakışması | Önemli risk | Topoloji dikişi önemli risk | Açık patch seam/authority tasarımı gerekli |
| İlk geliştirme karmaşıklığı | Orta | Yüksek | Orta–yüksek |
| Proje için önerilen rol | Teknik temel / prototip | İleri araştırma | **Birincil tasarım adayı** |

**Değerlendirme sonucu:** Kullanıcının iki fikri birbirinin alternatifi olmaktan çok, **boya aracıyla yerel yüksek detay talebinin tanımlandığı ve bu ihtiyacın ayrı Detail Patch'lerle karşılandığı** hibrit üretim hattına dönüştürülebilir. Ancak bu, teknik keşif/testlerden önce kesin karar değildir.

---

## 9. Uygulama sırası ve test kapıları

### Aşama D0 — Kod ve veri akışı incelemesi (değişiklik yapmadan)

- `Landscape` örnek sayısı kısıtı nerelerde var?
- World Terrain tile tanımı/render/collision köprüsü hangi sınırları koyuyor?
- `Landscape` spline/sculpt/geometri güncelleme mekanikleri bir Detail Patch'e ayrıştırılabilir mi?
- World Terrain ve Landscape aynı sahnede hangi transform/height/collider referanslarını paylaşıyor?
- Save, undo/redo, bağımlılık ve taşıma işlemleri nasıl etkilenecek?
- İstenen mimari için **minimum etkili değişiklik listesi** çıkarılacak; bu aşamada kod değiştirilmez.

**Çıkış ölçütü:** Kod konumları, veri sözleşmesi, ilk prototip tasarımı, risk listesi.

### Aşama D1 — Statik çoklu patch prototipi

- World Terrain üzerinde en az iki bağımsız 32/64 m patch.
- Başlangıç yüksekliğini base terrain'den alma, kenarlarda uyum, birbirinden bağımsız sculpt.
- Save/reload, undo/redo, tile sınırlarını geçme ve renderer doğrulaması.
- Henüz tekerlek deformasyonu / toprak fiziği yok.

**Çıkış ölçütü:** Görünür çatlak/z-fighting olmadan ve bozulmadan kaydedilen çoklu yerel geometri.

### Aşama D2 — Detail Paint Tool

- Boya maskesiyle patch alanı oluşturma ve kaldırma.
- Statik/dinamik niyet ile çözünürlük seçimi.
- Yol, nehir, yerleşim ve foliage maskeleriyle etkileşim.
- Performans: boyama sırasında gereksiz dünya çapı rebuild olmamalı.

**Çıkış ölçütü:** Kullanıcı bir çamur aday bölgesini boyayıp konumu/çözünürlüğü düzenleyebilir.

### Aşama D3 — Soil Physics ve tekerlek testleri

- Sert zemin / kuru toprak / çamur profilleri.
- Tek araç, aynı yük ve giriş koşullarında çekiş / yuvarlanma direnci / sanal batma farkı.
- Çamur derinliği ile alt sert tabanın ilişkisinin test edilmesi.
- Kontak hataları, collider çakışması, gövde teması ve ters eğimler.

**Çıkış ölçütü:** Görsel materyal değiştirmeden fiziksel zemin farkı ölçülebilir.

### Aşama D4 — Runtime iz ve deformasyon

- Tek bir küçük aktif patch üzerinde kontrollü deformasyon verisi.
- Tekerleğin ikinci geçişi, tekrar sıkışma, sınır koşulları.
- GPU görselleştirme / veri dokusu, gerekirse collision karşılaştırması.
- Save/load ve 10–15 dakikalık sürüş performans testi.

**Çıkış ölçütü:** Tekrar edilebilir deformasyon, tutarlı temas ve ölçülmüş maliyet.

### Örnek kabul testleri

| Test ID | Amaç | Beklenen kanıt |
|---|---|---|
| TD-01 | 2 ayrı patch oluştur–kaydet–yeniden yükle | Konum, çözünürlük, geometri korunur |
| TD-02 | Patch çevresinde sürüş/kamera | Çatlak, z-fighting, ani basamak yok |
| TD-03 | Patch World Terrain tile sınırını kesiyor | Dikiş/örnekleme hatası yok |
| TD-04 | Sert zemin–çamur karşılaştırması | Aynı araçta ölçülebilir sürüş farkı |
| TD-05 | Alt sert tabana kadar batma | Geçersiz derinlik ve erken collider teması yok |
| TD-06 | İkinci teker geçişi ve save/reload | İz ve fizik davranışı tasarımla tutarlı |
| TD-07 | Çoklu patch, uzun sürüş | FPS, frame p95/p99, bellek ve collider maliyeti kaydedilir |

---

## 10. Kodlama öncesi açık tasarım kararları

| ID | Karar konusu | Durum |
|---|---|---|
| K-01 | Makro World Terrain vertex aralığı **2 m** mi, 1 m mi? | **[ÖNERİ: 2 m]** |
| K-02 | Legacy Landscape çoklanacak mı, grid yardımcılarından yeni Detail Patch mi yapılacak? | **[İNCELEME]** |
| K-03 | Detail patch boyama maskesi 32/64 m bloklara mı dönüşecek? | **[TEST]** |
| K-04 | Detail Patch başlangıç grid'i 0,5 m mi, 0,25 m mi? | **[TEST]** |
| K-05 | Çamur tabakası için World Terrain çukuru açılacak mı? | **[ÖNERİ: kontrollü çukur]** |
| K-06 | Soil malzemeleri hangi data asset biçiminde saklanacak? | **[AÇIK]** |
| K-07 | Çamurda fiziksel temasın yetkilisi kim? | **[AÇIK / P0]** |
| K-08 | Görsel iz çözünürlüğü ve collision güncelleme stratejisi ne olacak? | **[TEST]** |
| K-09 | Patch ve rut verileri level save mi game save mi kapsamına giriyor? | **[AÇIK]** |
| K-10 | Uzak patch render LOD ve runtime streaming nasıl yönetilecek? | **[AÇIK]** |

**Kayıt ilkesi:** [ÖNERİ] ve [TEST] başlıkları tamamlanmış bir özellik gibi işaretlenmemeli; kullanıcı kabulü ve çalışan prototip kanıtı gerekiyor.

---

## 11. Codex için ilk teknik inceleme görevi

> **Amaç:** 4096 × 4096 m World Terrain üzerinde yerel yüksek çözünürlüklü Detail Patch sistemi kurulabilir mi? Var olan Landscape kodundan ne kadar yararlanabiliriz?
>
> Önce repository ve mevcut testleri **kod değiştirmeden** incele. `SceneApp.addLandscape`, eski Landscape veri modeli ve renderer/sculpt/paint/spline sistemi, World Terrain veri modeli/bridge/loader, collider üretimi, editor save/undo/redo ve runtime vehicle contact akışını haritala.
>
> İki alternatifi karşılaştır: **(A)** birden fazla normal Landscape örneği, **(B)** Landscape altyapısını paylaşan World Terrain'e bağlı `Detail Patch`. Boyalı bölgenin World Terrain gerçek topolojisini değiştirmesi seçeneğini ayrıca değerlendirme bölümüne koy; ilk çözüm olarak varsayma.
>
> Özellikle height sampling, patch kenarları, iki collider çakışması, sert taban/çamur kalınlığı, tile sınırı, serialization, editör/runtime deformasyon ayrımı, test kapsamı ve performans risklerini incele. Yapılacak değişiklikleri dosya/fonksiyon düzeyinde ve aşamalı kabul testleriyle raporla. Çalışmayan veya yalnız planlı sistemi hazır diye tanımlama. Kod değişikliği için önce inceleme raporu oluştur.

---

## 12. Kısa sonuç

1. **4096 × 4096 m World Terrain** büyük coğrafyanın otoritesi olarak korunmalı; bütün dünyada 0,25 m vertex yoğunluğuna geçilmemeli.
2. **Yerel detay** için eski `Landscape` kodunu yeniden kullanma fikri teknik incelemeye değer; fakat çoklu Landscape desteği tek başına yeterli değil.
3. **Boyama aracı**, ilk sürümde World Terrain'in vertex topolojisini değiştirmek yerine, detail patch üretimini ve alan çözünürlüğünü yönetebilir. Gerçek adaptif topoloji ayrı ileri aşama seçeneği olarak kalır.
4. **Çamur yüzeyi ve alt sert zemin** arasında fiziksel/yazılımsal olarak tanımlanmış bir kalınlık ve batma sınırı olmalı. İki collider'ı sadece üst üste yerleştirmek doğru çözüm değildir.
5. **Zemin fiziği, görsel mesh ve runtime iz verisi** ayrıştırılmalı; lastik davranışı yalnız görüntüyle taklit edilmiş kabul edilmemeli.
6. Önce **tek patch üzerinde geometri ve collider doğrulaması**, sonra soil physics, ardından runtime deformasyon, en son performans/streaming ölçekleme yapılmalı.

**Önerilen çalışma başlığı:** `World Terrain Detail Patch & Soil Deformation System`  
**Sonraki adım:** Codex'ten kod değişikliği yapmadan teknik fizibilite ve entegrasyon planı çıkarmak.
