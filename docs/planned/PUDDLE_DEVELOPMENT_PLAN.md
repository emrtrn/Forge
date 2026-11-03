# Puddle — çamurlu zemin ve gerçek tekerlek oyukları

Tarih: 3 Kasım 2026. Durum: **İzole avlu prototipi uygulandı.** W3 editör ve
production entegrasyonu henüz tamamlanmadı. Kaynak planlar:
[Water Body / W3](WORLD_TERRAIN_WATER_BODY_PLAN.md),
[Terrain Deformasyonu](TERRAIN_DEFORMATION_PLAN.md).

## Kullanıcı hedefi ve yaklaşım

Referans: çamurlu depo avlusu; geniş sığ birikintiler, kuru tümsekler ve gerçek
tekerlek oyukları. İzler yalnız normal map olmayacak, zemin geometrisi çökecek.

- Landscape Paint zeminin malzemesini, ıslaklığını ve mekanik yumuşaklığını belirler.
- CPU-otoriter mevcut deformasyon alanı oyuk derinliğini sağlar. Görsel geometri
  çökmesi ve kenar kabarması aynı yükseklik fonksiyonundan hesaplanır.
- Puddle, deforme zeminin üzerindeki ayrı yatay su yüzeyidir. Su seviyesi, bir
  başlangıç noktası ve sınırlı çalışma alanıyla yalnız bağlı çukur doldurulur.
- Yeni oyuk suyu kendiliğinden üretmez. İlk sürüm bölgeye atanmış sabit su
  seviyesini kullanır; miktar korunumu, yağmur, taşma ve akış ayrı kapsamdır.

## İlk teslim — avlu prototipi

`tests/smoke/pages/terrain-puddle.html` Vite üzerinden açılır. Su eklemek için
çukura tıkla; seviye kaydırıcısı, kontrollü araç geçişi, suyu gizleme ve sıfırlama
kontrolleri vardır. Sağ fare kamera döndürür, tekerlek yakınlaştırır.

Prototip gerçek `DeformationField.stampWheel` ve mevcut
`terrainDeformationDisplacement` fonksiyonunu kullanır. Avlu zeminindeki vertex
yükseklikleri değiştirilir; bu geometri üzerinde bağımsız su yüzeyi yeniden
kırpılır. Araç kontrollü bir temas kaynağıdır, bu sayfa Rapier sürüş testi değildir.

Genel çekirdek `engine/terrain/terrainPuddle.ts`; renderer
`engine/render-three/terrain/terrainPuddleSurface.ts`. Çağıran, deforme yatak
yüksekliğini ve açık örnekleme aralığını sağlar. Örneklenen üçgenler gerçek bed
mesh'iyle aynı köşegeni/çözünürlüğü kullanmalıdır; bu prototip CDLOD'a henüz bağlı
değildir. Statik mesh veya bilinmeyen terrain verisi varsayımla doldurulmaz.

Sınırlar:

- Gövde başına en fazla 128×128 hücre; avlu 96×96, 12,5 cm aralıklıdır.
- Avluda en fazla dört birikinti. Ada ve bağlı olmayan diğer çukur kuru kalır.
- Su alanı çalışma sınırına erişirse veya gerekli zemin bilinmiyorsa açık sonuç
  döner, son geçerli yüzey korunur. Kuru sonuç yüzeyi temizler.
- Yatak revizyonları fixture'da 100 ms aralıklarla birleştirilir. Senkron geometri
  kurulumu production CPU dilim bütçesini sağlamış sayılmaz.
- Ortam yansıması ve derinliğe bağlı kıyı alpha geçişi; isteğe bağlı sahne-owned
  planar binding. Avlu aynı seviyedeki gövdeler için tek mevcut Medium planar
  kaynağı paylaşır (256 px, en az 32 ms aralık); gövde başına capture yoktur.
  Kırılma render target'ı yoktur. Bu limitler GPU süre kabulü değildir.
- En fazla 12 analitik tekerlek dalgası; iki saniyede söner. Henüz genel
  Lake/River etkileşim aboneliği ve kuru engellerde dalga yayılımı çözümü yoktur.
- Collider sabit kalır. Mevcut sistemde araç gömülmesi süspansiyon/kuvvet
  adaptörüyle sağlanır; bütün rigid body'ler deforme collider'a oturmaz.
- Runtime izleri authored terrain'e yazılmaz. Prototip kayıt/undo endpoint'i
  veya kalıcı Puddle şeması eklemez; reset izleri ve su seçimini temizler.

## Sonraki uygulama dilimleri

1. **Prototip kabulü:** yakın/eğik açıda gerçek oyuk, yükselen çamur kenarı,
   sabit seviyede değişen su sınırı; hedef GPU'da CPU/GPU ölçümü. Örnekleme
   doğruluğu ve kabul edilen görünüm belirlenmeden büyük dünya entegrasyonu yok.
2. **Landscape Puddle modu:** mevcut çukura tıklama, çalışma alanı ve su
   seviyesi; kuru/ıslak önizleme ve taşan sınır uyarısı. Paint yumuşaklık/ıslaklık
   için kullanılır; suyu eğimli araziye yapıştıran bir materyal boyaması yapılmaz.
3. **Kalıcı veri:** Puddle kimliği, terrain referansı, seed, sınır, seviye,
   appearance; validator, save/load, seçim ve undo/redo birlikte eklenir.
4. **World Terrain bağlantısı:** gerçek tile üçgenleri, Sculpt revizyonları,
   deformasyonun render filtrelemesi, CDLOD detayı, dirty rect güncellemeleri,
   eksik tile ve tile sınırları. Kaynak iptali, streaming ve travel temizliği.
5. **Araç entegrasyonu:** gerçek araç temas aboneliği; su derinliği, hareket ve
   patinaja bağlı dalga/çamur sıçraması. Kuru çukura su eklememe; basin ayrımı ve
   dalganın ada/kuru boşluk üzerinden atlamamasını doğrulama.
6. **Kaynak ve kabul:** kalite tavanları, kontrollü yansıma paylaşımı, production
   açılışı, çok gövde/araç, reset/rebuild/travel ve gerçek GPU ölçümü. Runtime
   iz kalıcılığı mevcut deformasyon planının ayrı açık işidir.

## Doğrulama

Engine testleri: bağlı çukur/ada, yatay su, açık sınır/eksik veri, son geçerli
geometriyi koruma ve gerçek tekerlek derinliğiyle büyüyen su alanı.
Playwright: kontrollü tekerlek geçişi, değişen geometri/alan, sabit su seviyesi,
su seviyesi değişirken izlerin korunması, konsol/WebGL ve tekrar reset kaynakları.
Nihai koşu sonuçları `docs/reports/PUDDLE_PROTOTYPE_2026-11-03.md` içindedir.
