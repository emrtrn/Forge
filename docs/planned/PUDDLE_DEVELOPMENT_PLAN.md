# Puddle — çamurlu zemin ve gerçek tekerlek oyukları

Tarih: 3 Kasım 2026. Durum: **İzole prototip, Landscape/Water önizlemesi ve
kalıcı Puddle kaydı uygulandı.** Editör ve Play native terrain kurulumunu paylaşır.
Canlı deformasyon/araç bağlantısı ve genel W3 performans kabulü açık. Kaynak planlar:
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
2. **Landscape Puddle önizlemesi — uygulandı:** mevcut çukura tıklama, çalışma
   alanı ve su seviyesi; kuru/ıslak önizleme ve taşan sınır uyarısı. Panel bu
   önizlemenin Save/Play içine alınmadığını açıkça belirtir. Gerçek terrain
   aralığı kullanılır; düzlemi ayarlamak yeni Sculpt veya paint verisi üretmez.
3. **Kalıcı veri — uygulandı:** ayrı `puddleWaters` koleksiyonu; Puddle kimliği,
   terrain referansı, seed, sınır, kot, görünüm ve hidden/locked. Ortak read/save
   validator, Outliner/Water seçimi, oluştur/düzenle/sil undo/redo ve Save/Reload/Play
   desteği vardır. Geometri kaydedilmez. [Teslim raporu](../reports/PUDDLE_PERSISTENCE_2026-11-03.md).
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

## Landscape / Water oluşturma akışı

World Terrain seç → **Landscape Mode: Water** → **Water / Add Puddle** →
çukura tıkla → **Draft Preview** → **Create Puddle**.
Add Puddle, Add River ve Add Lake ile aynı Water bölümündedir; bağımsız bir
Puddle Preview giriş bölümü yoktur. Nokta seçiminde **Finish Picking** veya Esc
seçimi bitirir. **Water Level (World Y)** yatay su kotunu,
**Working Area (m)** başlangıç noktası çevresindeki kare bölgeyi ayarlar.
Alan native terrain grid'ine hizalanır. İlk kot tıklanan tabanın 5 cm üzeridir;
çukur sınıra kadar açık kalırsa alanı genişletmek veya kotu düşürmek gerekir.

Hazır önizlemede **Create Puddle** kalıcı gövdeyi oluşturur. Outliner veya Water
Bodies listesinden seçilen Puddle'ın kotu, alanı ve görünümü düzenlenir; hidden,
locked ve silme desteklenir. Create/Edit/Delete komutları undo/redo'ya katılır.
Save gövdeyi level'e yazar; Reload ve Play aynı kaynaktan yüzeyi tekrar üretir.

Taslak oluştuğunda Esc onu silmez; **Finish Editing** veya başka nesneye geçiş
girişimi **Pending Draft** durumunu açar. **Create Puddle and Continue** oluşturup
bekleyen seçime geçer, **Discard Draft** taslağı siler, **Resume Editing** geri
döner. Taslak/nokta seçimi sürerken diğer Water araçları ve gövde listesi
kilitlenir. Level değişimi geçici yüzeyi temizler. Esc panel alanında yazarken de
çalışır. Eksik tile yüklemeleri
iptal edilebilir; geç tamamlanan yükleme temizlenmiş yüzeyi geri getirmez.
Tek önizleme ve en fazla 16 eksik tile okuması vardır; gövde başına ek planar
capture tahsis edilmez. Önizleme Create yapılmadan kaydedilmez. Kalıcı gövdelerin
canlı araç/deformasyon bağlantısı sonraki dilimdir. Teknik kayıt:
[Landscape Puddle önizlemesi](../reports/PUDDLE_EDITOR_PREVIEW_2026-11-03.md).
