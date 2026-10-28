# Göl aracından gerçek geometri temas köpüğü hesaplama

Tarih: 2026-10-28. Durum: Lake geometri hesabı, araç ve kayıt yolu uygulandı;
kullanıcı masaüstü görsel denemeyi başarılı buldu. UI İngilizce, tooltip
açıklamaları Türkçedir. Doğrulama ve açık sınırlar
[uygulama raporundadır](../reports/LAKE_GEOMETRY_FOAM_BAKE_2026-10-28.md).
Bu belge önceki elle elips/kapsül yaklaşımının yerine geçen ana akışı tanımlar.

## 1. Kullanıcı akışı ve kapsam

1. Kullanıcı kayaları, kayalık kümelerini veya iskele gibi statik engelleri
   normal yerleştirme araçlarıyla sahneye koyar.
2. Gölü seçer. Lake Details içinde **Taş/Engel Köpüğü → Hesapla** düğmesine basar.
3. Araç, göle değen uygun sahne geometrisini otomatik bulur; gerçek su kesişimini
   hesaplar ve parçalı temas köpüğünü gösterir. Tek tek taş seçmek, merkez,
   yarıçap veya yükseklik girmek gerekmez.
4. Taşlar taşındığında, silindiğinde, döndürüldüğünde veya ölçeklendiğinde
   kendiliğinden yeniden hesaplama yapılmaz. Kullanıcı **Yeniden Hesapla** der.
5. **Kaydet** başarılı sonucu kalıcılaştırır. Reload/Play kayıtlı sonucu kullanır;
   sahne meshlerini yeniden taramaz veya kesişim hesaplaması başlatmaz.

İlk uygulama **Lake / statik sahne geometrisi** içindir. River'ın eğimli su
yüzeyine uyarlama, ortak çekirdeğin sonraki dilimidir; bu işte River'a tek düz
su seviyesi varsayımı eklenmez. Hareketli araç/karakter köpüğü, her kare temas
hesabı ve akış fiziği bu kapsamda yoktur. Köpük deseni mevcut shader'da zamanla
hareket etmeye devam eder; yalnız kaynak geometrisi hesaplaması kullanıcıya bağlıdır.

## 2. Arayüz ve değişikliklerin anlamı

Lake Details'taki yeni bölüm:

- Enabled: hesaplanmış taş/engel köpüğünü göster/gizle.
- **Hesapla / Yeniden Hesapla**, işlem sırasında **İptal**, ayrıca **Temizle**.
- Genel şiddet, desen boyutu ve animasyon hızı: mevcut shader üzerinden değişir,
  yeniden geometri hesaplaması gerektirmez.
- Metre cinsinden temas bandı genişliği: hesaplama girdisidir; değişince yeni
  hesaplama gerektiği gösterilir. Sessiz maske üretimi başlatılmaz.
- Durum: Hesaplanmadı / Hesaplanıyor / Hazır / Yeniden hesaplama gerekli / Hata.
  Hesaplanan nesne sayısı, süre ve sonucun alan/çözünürlük bilgisi gösterilir.

Taş/terrain/su seviyesi veya hesaplama girdisi değişirse mevcut sonuç korunur ve
**Yeniden hesaplama gerekli** uyarısı gösterilir. İşaretleme yeniden hesaplama
değildir; taş sürüklemek hesabı tetiklemez. Önceki köpük eski konumunda kalabilir;
kullanıcı Yeniden Hesapla veya Temizle ile sonucu değiştirir. Lake'in mevcut
geçerli su maskesi kuru yüzlerde çizimi engellemeye devam eder.

Gölün su seviyesi/bounds'u veya yerleşimi değişince eski maskenin yeni koordinatlara
sessizce esnetilmesi/taşınması yapılmaz. Sonuç kendi hesaplandığı dünya çerçevesini
korur ve güncel olmadığı belirtilir. Geçersiz Lake'te mevcut su sistemi gibi
yüzey çizilmez. Kaydedilmiş eski sonuç Reload/Play'de de aynı dünya çerçevesiyle
okunur; otomatik güncelleme yapılmaz. Kullanıcı yeniden hesaplamadan kaydederse
güncel olmadığı bilgisi de korunur.

Önceki **Add Obstacle Contact** listesi ana iş akışından çıkarılır. Mevcut kayıt
verisi sessizce silinmez; eski manuel kayıtlar okunmaya devam eder. İlk başarılı
otomatik hesaplamadan sonra otomatik kaynak kullanılır; iki kaynak aynı taşta
üst üste bindirilmez. Eski River Radial Foam kayıtları değiştirilmez.

## 3. Gerçek geometriyi bulma ve kesişim

### 3.1. Aday toplama

- Göle bağlı dünyada, Lake bounds'u + temas bandına değen statik ve görünür
  Environment/static-mesh nesneleri topluca bulunur. Taş adında belirli bir sözcük
  aranmaz; aynı kurallar iskele ayağı gibi başka statik engellere de uygulanır.
- Normal Mesh, GLTF alt meshleri ve InstancedMesh yerleşimleri desteklenir.
  Her yerleşimin dünya matrisi ve GLTF node matrisi doğru uygulanır; aynı asset'in
  döndürülmüş, nonuniform veya negatif ölçekli kopyaları ayrı konumlarda işlenir.
- Bounds yalnız ön elemedir; köpük sınırı bounding box/elips ile üretilmez.
  Kullanılan kaynak render geometrisidir; basitleştirilmiş collider değildir.
- Su, terrain, gizmo, yardımcı görünüm, parçacık ve hareketli/skinned meshler
  aday değildir. Terrain kıyısı mevcut ayrı kaynaktan gelir. Bitki/çim kategorileri
  varsayılan dışarıda kalır. Gerekirse asset/grup bazında toplu hariç tutma sağlanır;
  her taş için yeni ayar yapmak zorunlu değildir.
- Tekrar kullanılan geometri için yerel üçgen/ivme verisi asset başına paylaşılır.
  Instance başına gerekli dönüşüm ve kesişim yapılır; tüm dünyadaki üçgenler kopyalanmaz.

### 3.2. Su çizgisi

- Lake'in **ortalama su düzlemi** ile gerçek mesh üçgenlerinin kesişim segmentleri
  çıkarılır. Mevcut hafif geometrik dalga her kare yeniden kesişim yaptırmaz.
- Yalnız üstten silüet veya yalnız ekran depth'i kullanılmaz. Böylece su üstündeki
  çıkıntı, suya değmeyen köprü tabliyesi veya taşın kutusu sahte temas oluşturmaz.
- Tamamen yukarıda ve tamamen aşağıda kalan yüzeyler elenir; üçgenin suyu
  gerçekten kesmesi gerekir. Taşın merkezinin veya tabanının ıslak olması koşulu
  aranmaz: merkezi kuru kıyıda olan bir kaya, göle uzanan yüzeyiyle köpük üretebilir.
- Segmentler, mevcut Lake'in bağlı ve kırpılmış gerçek ıslak üçgenleriyle
  sınırlandırılır. Ada, kuru alan, ayrı çukur ve hesap bounds'u köpük kaynağı
  sayılmaz. Temas bandı da geçerli su tarafında kalır.
- Düzlem üzerindeki vertex/kenar, coplanar yüz, ortak kenar ve çok yakın yüzler
  için deterministik epsilon/tekilleştirme uygulanır. Açık meshlerde var olan
  yüzey kesişimleri kullanılabilir; eksik yüzeyler tahminle kapatılmaz. Geçersiz
  veya dejenere verinin atlanması sonuç raporunda belirtilir.
- Büyük dünya koordinatlarında hassasiyet için hesap, sabit bir yerel bake
  çerçevesinde yapılır; kaynak sahne koordinatları değiştirilmez.

## 4. Sonuç maskesi ve kaynak bütçesi

Kesişimler, mevcut parçalı köpük shader'ına beslenen **gövdeye bağlı mesafe
maskesine** dönüştürülür. Her taş için shader uniform'u veya ayrı köpük draw'u
oluşturulmaz; önceki 16 manuel kaynak sınırı taş sayısı sınırı olarak taşınmaz.
Taş içi alanlar birleştirilerek üst üste gelen kayaların iç temas çizgilerinin
gereksiz beyaz halkalar üretmesi engellenir; açık/dejenere geometride bu işlemin
kanıtlanamayan kısmı tanıyla raporlanır.

İlk mühendislik sınırları aşağıdadır; ölçülmüş performans taahhüdü değildir:

| Kaynak | Başlangıç sınırı / davranış |
| --- | --- |
| Aday instance | En çok 4.096; ön kontrolde sayılır, aşımda açık hata |
| İşlenecek aday üçgen | En çok 2.000.000 dönüştürülmüş üçgen; asset paylaşımı instance işini gizlemez |
| Üretilen temas segmenti | En çok 131.072; aşımda eski başarılı sonuç korunur |
| Maske | En çok 16 adet 1024² R8 parça, toplam 16 MiB temel mesafe verisi/Lake |
| Çözünürlük | Seçilen temas bandında en az dört texel; bütçeye sığmazsa sessiz genişletme/bulanıklaştırma yok |
| Parça sınırı | En az temas bandı kadar halo; parça sınırı köpük çizgisi oluşturmaz |
| Hesaplama çalışma belleği | Hedef en çok 128 MiB ek geçici veri; ön tahmin ve gerçek kullanım izlenir |
| Sunum | Mevcut su çizimine maske örneklemesi; taş sayısıyla draw/capture artmaz |
| Zamanlama | Worker veya bölünmüş iş; ilerleme ve iptal; ana thread'de >50 ms long task oluşmaması ölçülür |

Hesabın toplam süresi birkaç saniye olabilir; ilk hedef belirli bir milisaniye
vaadi değil, editörün kullanılabilir ve işlemin iptal edilebilir kalmasıdır.
Maske parçalaması, ek sampler/bellek ve shader maliyeti uygulama öncesi küçük
prototipte ölçülür. Global Lake bütçeleriyle toplam eski+yeni kaynak payı da
hesaba katılır; bu tablonun tek gövde sınırı toplam dünya bütçesi yerine geçmez.

## 5. Tutarlılık, kayıt ve runtime

**Hesapla** bir snapshot işi başlatır: Lake kimliği ve ıslak geometri revision'ı,
su seviyesi, kaynak actor/instance kimlikleri, asset geometri sürümleri, dünya
matrisleri ve ayarlar dondurulur. Başlatıldıktan sonra kaynak değişirse sonuç
yayına alınmaz; kullanıcıya yeniden hesaplama gerektiği söylenir. Eski başarılı
sonuç hesap sürerken görünür kalır. İptal/hata/bütçe aşımı kısmi sonuç yayınlamaz.

Başarılı hesap sonunda maskenin tamamı **tek undo/redo komutuyla** değiştirilir.
Undo eski başarılı sonucu geri getirir; Redo yeni sonucu geri yükler. İkisi de
mesh taraması veya kesişim hesabı yapmaz. Temizle de tek undo komutudur. Bellek
rezervasyonu yeni sonucun ve undo'nun birlikte tutulmasını önceden hesaba katar;
geçmiş sessizce budanmaz. Runtime kaynağı ile undo belleği ayrı sahiplenilir.

Kalıcılık kararı: maske texelleri level JSON'una büyük/base64 diziler olarak
gömülmez. Level'a ait veri dizininde sürümlü **foam manifest + binary maske**
saklanır; Lake kaydı bunlara referans, hesap çerçevesi, ayarlar ve kaynak
fingerprint'i taşır. İçerik adresli dosyalar önce yazılır, level referansı en son
güncellenir. Başarısız Save eski kayıtlı referansı korur ve düzenlemeyi dirty
bırakır. Yeni endpoint gerekiyorsa dar yol/uzantı/byte allowlist'iyle tasarlanır;
mevcut güvenli kayıt yolunun kullanılabilirliği ilk dilimde doğrulanır.

Runtime yalnız kayıtlı texelleri yükler/upload eder; taş taraması, segment
üretimi veya yeniden rasterizasyon başlatmaz. Eksik/bozuk/uyumsuz bake dosyası
açık tanıyla yalnız bu efekti devre dışı bırakır; göl yüzeyini yok etmez ve
otomatik fallback hesabı yapmaz. Export/clone/partition paketlemesi sidecar'ları
taşır. Kullanılmayan bake dosyalarını otomatik silme bu ilk kapsamda yoktur.

## 6. Uygulama dilimleri

- [x] **B0 — Kaynak ve kayıt prototipi:** Gerçek sahne Mesh/GLTF/InstancedMesh
  erişimi, kaynak kapsamı, streaming ve bake sidecar kayıt/export yolunu doğrula;
  küçük bağımsız fixture'da bütçe hesabını çıkar.
- [x] **B1 — Saf geometri çekirdeği:** Düzlem/üçgen kesişimi, dönüşümler,
  hassasiyet, tekilleştirme, bağlı Lake yüzeyine kırpma ve deterministik sonuç.
- [x] **B2 — Maske ve render:** Parçalama/halo, mesafe alanı, üst üste engeller,
  kaynak yaşam döngüsü; mevcut köpük ışık/kompozisyonunu kullan.
- [x] **B3 — Göl aracı:** Hesapla/Yeniden Hesapla/İptal/Temizle, ilerleme,
  güncellik uyarısı, snapshot/revision, tek undo/redo; manuel listeyi ana akıştan çıkar.
- [ ] **B4 — Kalıcılık son kabulü:** Ortak runtime/save allowlist, manifest/binary kayıt,
  gerçek Save/Reload/Play, export/clone/partition ve eksik dosya tanısı.
- [ ] **B5 — Kabul ve ölçüm:** Aşağıdaki engine/browser/görsel matris;
  büyük kaya kümelerinde süre/heap/GPU/texture/draw ölçümü ve kullanıcı görsel kabulü.

B4'ün kayıt, Save/Reload/Play ve hata/retry uygulaması tamamlandı; ayrı export/clone
uçtan uca kabulü açık. B5'te odaklı engine/browser ve kullanıcı görsel kabulü geçti;
büyük sahne/donanım ölçümü ve eşzamanlı su dışı hatalardan dolayı tam gate açık.
Sunumda halo yerine parça sınırını aşan bilinear örnekleme kullanıldı.

Streaming: Hesapla, gölün aday alanındaki gerekli nesneleri bounded geçici
okumayla tamamlar; yalnız kameranın o anda resident nesnelerini doğru tam sonuç
gibi kabul etmez. Yüklenemeyen/uygunsuz kaynak açıkça bildirilir; eksik sahneden
üretilen maske tam başarılı sonuç diye kaydedilmez. Kaynak yükleme terrain/actor
dirty durumuna, görünür streaming/collider listelerine veya kullanıcı yerleşimine yazmaz.

## 7. Kabul koşulları

- Tek taş, düzensiz kayalık, uzun kaya, iki yakın/örtüşen taş ve aynı asset'in
  çok sayıda instance'ı: tek Hesapla işlemiyle gerçek temas çizgilerini takip eder.
- Kuru kıyıya oturup suya uzanan kaya kabul edilir; taş merkezinin suda olması
  gerekmez. Havada, tamamen derinde veya yalnız bounds'u değen taş köpük üretmez.
- Döndürme, nonuniform/negatif ölçek, GLTF alt node dönüşümü, indeksli/indekssiz
  geometri, açık/dejenere/coplanar yüzler ve büyük origin ayrı sınanır.
- Ada, ayrı çukur ve iki tile seam'i: köpük geçerli su tarafında kalır;
  mesafe maskesi parça sınırı görünmez. Taş gölgesinden köpük oluşmaz.
- Taşı taşımak/silmek/gizlemek veya su seviyesini değiştirmek otomatik hesap
  yapmaz. Güncellik uyarısı çıkar; Yeniden Hesapla eski teması kaldırıp yenisini
  üretir. Temizle/Undo/Redo beklenen önceki sonucu anında getirir.
- Hesap sürerken taş/Lake değişimi, seçim değiştirme, level travel, iptal,
  okuma hatası ve bütçe aşımı stale/kısmi sonucu yayınlamaz; kaynak bırakmaz.
- Save/Reload/Play aynı bake sonucunu kullanır. Runtime'da otomatik tarama
  yapılmadığı ölçülür; bozuk/eksik sidecar ve save hatası görünür tanı verir.
- Yakın/orta/uzak ve iki kamera açısı; direct/MSAA/postprocess; gündüz/gölge/gece,
  yansıma ve caustics beraber doğrulanır. Görsel hedef doğal kırık temas bandıdır.
- Mevcut River/Lake kıyı, dalga, tekerlek ve terrain hash regresyonları korunur.
  TypeScript, ilgili engine testleri, tam build:verify ve Playwright çalıştırılır.
  Save/asset okuma sınırları genişlediğinden uygulama sonunda Codex Security diff
  scan önerilir; kullanıcı onayı olmadan başlatılmaz.

Bu plan test amacıyla mevcut kullanıcı sahnelerine veri yazmayı, commit veya push
yapmayı kapsamaz. Kullanıcı kendi sahnesinde Calculate/Save kullanabilir.
