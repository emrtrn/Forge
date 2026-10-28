# Göl/nehir kıyısı ve taş çevresi köpüğü — araştırma, 2026-10-28

## Güncel uygulama notu — 2026-10-28

F1 önceki Lake çalışmasında uygulandı. F2–F3 ortak engel temasları, River gerçek
kıyı maskesi ve akış izleri [uygulama kaydında](WATER_CONTACT_FOAM_2026-10-28.md)
izlenir. Aşağıdaki inceleme tabloları araştırmanın başlangıç durumudur.
F4 donanım GPU/büyük dünya kabulü açık kalır. L2/L3 önceki yüzey/tekerlek
çalışmasının görsel kabulü kullanıcı tarafından tamamlanmıştır; bu yeni köpük
uygulamasının masaüstü kabulüyle aynı kayıt değildir.

## Hedef ve referans görseller

Dört kullanıcı fotoğrafında üç davranış ayırt ediliyor: kıyıdaki parçalı köpük,
taşın suya değdiği çizgide yoğunlaşma ve akışın taşıdığı kopuk beyaz parçalar.
İkinci görselde daralan/hızlanan bölgelerde köpük yoğunluğu da artıyor.
TV fotoğrafı üzerindeki moiré, ekran yansıması, parlama ve renk sapmaları
malzeme dokusu veya fiziksel beyazlık ölçütü değildir. Görsellerden oyunun
kullandığı shader tekniği kesin olarak çıkarılamaz.

Kapsam göl ve nehirdir. Durgun gölde ince, aralıklı ve yavaş temas köpüğü;
nehirde daha yönlü ve hareketli bir görünüm önerilir. Her taşın etrafında aynı
beyaz halka veya bütün kıyı boyunca kesintisiz bir çizgi hedef değildir.
Gölge köpük oluşturmaz; mevcut köpüğün ışığını ve tonunu değiştirir.

## Forge'da doğrulanan mevcut parçalar

| Parça | Mevcut davranış / sınır |
| --- | --- |
| `engine/render-three/riverWater.ts` | `shoreFoam`, `rapidFoam`, hareketli noise, renk/opaklık, güneş gölgesi ve reflection azaltma mevcut. Kıyı bölgesi `vShoreDistance` ile şeridin normalize kenarına, ayrıca terrain derinliğine bağlı. Gerçek taş mesafesi yok. |
| River `foamStamps` | Point/strip kaynak verisi var; point için ayrı düzlemde hareketli parçalı köpük çiziliyor. Kod bunu açıkça authored sunum maskesi olarak tanımlıyor; taş şekli/hidrodinamik hesabı değil. |
| `engine/render-three/lakeWater.ts` | Dip geçirgenliği, yüzey normali ve yansıma var; köpük bileşeni ve River'daki güneş gölgesi hook'u yok. `receiveShadow` tek başına özel shader'a gölge eklemez. |
| `engine/terrain/terrainLakeWater.ts` | Ada dahil kesin kıyı segmentleri ve geçerli bağlı su yüzeyi var; göl temas maskesine sağlam kaynak. |
| `engine/render-three/waterSceneSnapshot.ts` | Postprocess yolunda ilk Lake çiziminde opaque renk/depth kopyası; ek sahne render'ı değil. Kamera/target/MSAA koşulları tutmazsa veri yok. River henüz bu kaynağı okumuyor. |

Bütün sistemi yeniden yazmak gerekmiyor. Ortaklaştırılacak parça köpük maskesi,
noise/animasyon ve kompozisyon; Lake geometrisi ile River ribbon üretimi ayrı
kalmalı. Mevcut River ayarlarının anlamı ve eski kayıtların görünümü korunmalı.

## Teknik seçeneklerin karşılaştırması

| Yaklaşım | Güçlü yanı | Sınır / maliyet |
| --- | --- | --- |
| Kamera depth ile intersection foam | Görünen opaque taş/zemin temasına hızlı tepki; mevcut Lake snapshot yeniden kullanılabilir. | Kamera bağımlı; taşın kameraya bakan yüzü arkasındaki temas bilgisi yok. Sığ zemin genişçe beyazlayabilir. Transparan/depth yazmayan nesneler görünmez; MSAA/direct yolunda fallback gerekir. |
| Dünya XZ kıyı/engel mesafe maskesi | Metre cinsinden genişlik; kameradan bağımsız; kıyı, ada ve statik taş etrafında tutarlı. | Maske üretimi, çözünürlük/bellek, terrain/engel değişince invalidation gerekir. Tek XZ katmanı üst üste su seviyeleri için yetmez; gövdeye bağlı tutulmalı. |
| Elle point/strip/ellipse proxy | Mevcut stamp sistemiyle küçük kapsam; taş önü ve arkası sanatçı tarafından kontrol edilir. | Gerçek mesh konturu değildir; hareket eden/karmaşık nesnelerde yeniden ayar gerekir. |
| Ayrı üstten engel capture | Mesh şekillerini otomatik maskeler. | Yeni render target, draw/capture ve culling maliyeti; su düzlemindeki kesişim ile üstten silüet aynı şey değildir. İlk dilim için önerilmiyor. |
| Akış simülasyonu / kalıcı köpük adveksiyonu | Engel arkası birikme ve zaman içinde taşınma. | Hız alanı, kalıcı buffer, çözünürlük ve streaming işi; ilk teslim için fazla kapsam. |

Depth farkı kullanılacaksa raw depth değerleri çıkarılmaz: kamera projeksiyonu
ile aynı view/world uzayında konumlar geri oluşturulur; su düzlemi normali
boyunca işaretli mesafe hesaplanır. Yalnız yakın yüzey örnekleri kabul edilir;
foreground/sky, kamera değişimi ve çözünürlük sınırları korunur. Bu yine de
kameranın göremediği taş çevresini tamamlayan bir çözüm değildir.

## Önerilen ilk mimari

**Dünya koordinatında temas maskesi ve ortak yüzey köpüğü**, isteğe bağlı depth
desteğiyle en güvenilir başlangıçtır. Yeni fizik/collider veya su hacmi yoktur.

1. Lake için bağlı geometri ve gerçek kıyı segmentlerinden su tarafına metre
   cinsinden mesafe çıkar. Ada kıyıları dahil; çalışma bounds'u kıyı sayılmaz.
   Segment sorgusunda grid/uzamsal indeks kullan; her pikseli her segmentle
   karşılaştırma. Maskeyi yalnız geometri revision'ı değişince yenile.
2. River için normalize şerit kenarını gerçek terrain temasından ayır. Kesin
   terrain derinliğiyle sığ temas + şerit içi metre mesafesi başlangıç olabilir;
   dik kıyıda yalnız sığ derinlik köpüğü sıfırlayabileceğinden gerçek temas
   segmentleri ayrıca çıkarılıp fixture'da doğrulanmalı. Hızlı akış bileşeni ayrı.
3. Taşlar ilk dilimde açıkça seçilen circle/ellipse/capsule engel proxy'leriyle
   su gövdesine bağlanır. Proxy yalnız geçerli su yüzeyi ve yakın su seviyesiyle
   kesiştiğinde etkilidir; kuru taş, havadaki taş ve tamamen derindeki taş için
   varsayılan köpük yoktur. Bütün sahneyi her kare tarama ve otomatik mesh-kesişim
   çözümü ilk teslim değildir. Mevcut River point/strip verisi sessizce dönüştürülmez.
4. Ortak shader, temas bandını iki ölçekli kırık köpük maskesiyle çarpar. Metre
   ölçekli büyük parçalar ile küçük gözenekler ayrı; filtreleme/distance fade
   uzakta alias yapmadan okunabilirliği korur. Kaynak özgün prosedürel veya
   lisansı doğrulanmış doku olmalı; TV görüntüsünden doku alınmaz.
5. Lake'te yavaş salınım ve kısa ömürlü yamalar; River'da mevcut yerel akış yönü
   boyunca taşınan desen ve proxy'nin downstream tarafında uzayan iz kullan.
   Bu görsel analitik wake'tir; gerçek girdap/akış çözümü olduğu iddia edilmez.
6. Köpüğü su kompozisyonunda yüzey katmanı olarak uygula; köpük arttıkça dip
   geçirgenliği ve ayna yansıması azalmalı. Emissive beyaz kullanılmaz: gölgede
   ve gece aydınlatmaya uyar, tamamen siyah da olmaz. Lake'e gölge bağlama ayrı
   iş olarak test edilir; caustics dipte kalır ve köpükle karıştırılmaz.

Depth desteği başlangıçta zorunlu değil. Dünya maskesi olan yol direct/MSAA ve
kameranın arkasındaki statik temaslar için de tutarlı taban sağlar. Suya giren
hareketli karakter/araç, parçacık sıçraması ve dinamik dalga sonraki kapsamdır.

## Uygulama dilimleri (öneri; henüz uygulanmadı)

- **F1 — Ortak shader + Lake kıyısı:** `foamEnabled`, opacity, metre genişliği,
  desen metre ölçeği ve hız; gerçek kıyı/ada maskesi. Mevcut River noise/optics
  parçalarını paylaş; kaynak/save/undo sözleşmesini aynı anda bağla.
- **F2 — River gerçek temas + engel proxy'leri:** göl/nehirde ortak engel verisi,
  seçme/düzenleme, su seviyesi/terrain/engel revision invalidation. Eski River
  stamp'leri çalışır. Kaynakları ortaklaştırırken veri migrasyonu zorunlu kılma.
- **F3 — Akış yönlü izler:** nehir akışına göre taş önü birikme/arkada kuyruk,
  rapid köpüğüyle kontrollü birleşme. Lake'te aynı kuyruk zorunlu değildir.
- **F4 — Kabul ve ölçüm:** görsel, persistence, gölge, kaynak yaşam döngüsü ve
  gerçek donanım GPU/bellek bütçesi. Kamera-depth desteği ancak maskenin çözemediği
  somut ihtiyaç kalırsa bu ölçümden sonra ayrı ek olarak değerlendirilir.

Önerilen başlangıç ayarları (ölçülmemiş): kıyı genişliği 0,2–0,8 m, taş temas
bandı 0,1–0,4 m; metre başına çözünürlük minimum banda göre seçilmeli. 256²
R8 maske 64 KiB ana seviye, miplerle yaklaşık 85 KiB; sekiz gövdede yaklaşık
0,67 MiB. Bu yalnız tek byte maskenin teorik belleğidir; float/çok kanallı
mesafe dokusu, staging ve eski+yeni rebuild buffer'ları ayrıca sayılır.
256² çözünürlükte 128 m alanın texeli 0,5 m olur; 0,1 m bandı temsil edemez.
Çözünürlük/alan/byte sınırları önceden belirlenmeli; sessiz genişletme veya
bütün dünyayı yüksek çözünürlükte maskeleme yapılmamalı.

GPU için ilk öneri: sabit kamera/aynı ışıkta baseline farkı p95 ≤0,5 ms hedefi;
**ölçülmüş sonuç veya taahhüt değildir**. Caustics'in halen açık 1 ms bütçesi
ayrı kalır. Ortak yüzey shader'ı ek draw gerektirmemeli; proxy sayısıyla draw
artışı yerine bounded veri/maskeye bake tercih edilmeli. Rebuild CPU/bellek,
texture upload ve 300 karelik donanım p95 ayrıca raporlanmalı.

## Kabul matrisi

- İki tile seam'i, ada, ayrı çukur, eğimli/sığ ve dik kıyı: köpük su tarafında;
  kara, bounds veya kuru iç alan üzerinde beyaz bant yok.
- Yuvarlak ve uzun taş, iki yakın taş, kısmen batık taş: kırık temas, kuru/derin
  taşta yok; kamera döndüğünde temas yüzmez veya kesilmez.
- Lake sakin / River hızlı: farklı hareket; nehir izi ters yönde gitmez;
  kapalı efekt eski görünümü geri getirir ve kaynakları bırakır.
- Yakın/orta/uzak kamera, farklı çözünürlük, perspektif/ortografik, direct/MSAA/
  postprocess: okunabilir desen, titreme/halka çizgisi yok; fallback açık.
- Güneş/gölge/gece, caustics açık/kapalı, planar yansıma: yüzey ve dip birbirini
  boğmaz. Lake gölge binding'i gerçek shader derlemesiyle doğrulanır.
- Sculpt/undo, engel taşı/sil/gizle, seviye değişimi, reload/Play, geç tile Retry:
  stale maske kalmaz; source verisi korunur; konsol/GL hatası ve kaynak sızıntısı yok.
- Gerçek Save/Reload ve editor/runtime eşleşmesi; runtime/save ortak allowlist;
  `tsc`, ilgili engine ve Playwright, `build:verify`. Save/load sınırı değişirse
  Codex Security diff scan önerilir; kullanıcı onayı olmadan çalıştırılmaz.

## Araştırma kaynakları ve erişim sınırı

2026-10-28'de okunan birincil kaynaklar:

- [Three.js Water.js](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water.js):
  normal katmanları, Fresnel, yansıma target'ı ve gölge kompozisyonu. Otomatik
  kıyı/taş köpüğü sağlamıyor; tek başına Forge çözümü olarak sunulmuyor.
- [Unity URP DeclareDepthTexture.hlsl](https://github.com/Unity-Technologies/Graphics/blob/master/Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl):
  kamera depth örnekleme, piksel/UV ve render yolu ayrımları. Bu bir köpük
  algoritması değil; depth yaklaşımının gerektirdiği veri yoluna referans.
- Forge kaynakları: `riverWater.ts`, `lakeWater.ts`, `waterSceneSnapshot.ts`,
  `waterEnvironment.ts`, `terrainLakeWater.ts` ve mevcut River/Lake veri sözleşmeleri.

Three.js belge sitesi ve NVIDIA GPU Gems sayfasına doğrudan erişim ağ
politikasınca 403 ile engellendi; içerikleri bu araştırmada okunmuş sayılmıyor.
Yukarıdaki mimari seçenekleri mühendislik değerlendirmesidir; dış kaynakların
Forge'a hazır köpük çözümü veya performans garantisi verdiği iddia edilmiyor.
Bu turda yalnız dokümantasyon değişti; yeni köpük shader'ı/sahne içeriği yoktur.

## Göl yüzeyi ve tekerlek etkileşimi — ilave kapsam

2026-10-28: kullanıcı beşinci TV fotoğrafını göl yüzeyinin görsel hedefi olarak
verdi; mud üzerindeki tekerlek/su etkileşiminin Lake yüzeyinde de olmasını istedi.
Bu talep önceki “hareketli araç sonraki kapsamdır” sınırını göl tekerlek dalgaları
için genişletir. Karakter, parçacık sıçraması, yüzdürme ve tam akış çözümü ayrı kalır.

### L1 — Doğal göl yüzeyi

Hedef, küçük ölçekli dalgacıkların daha geniş/yavaş yüzey hareketiyle karışması;
sığ kıyıda görünen dip, bakış açısına göre güçlenen yansıma ve kırık güneş
parlamalarıdır. Tam paralel sinüs çizgileri, plastik parlaklık veya bütün suyun
aynı beyaz renge dönmesi istenmez. Mevcut Lake iki normal örneği ve düşük genlikli
sinüs katkısı kullanıyor; önce bu mevcut yol üzerinde dünya-metre ölçeği,
farklı yön/hızdaki normal katmanları, roughness/specular görünümü ve kıyı sönmesi
ayarlanmalı. Kullanıcı sahnesindeki renk/derinlik değerlerini topluca değiştirme.

Fotoğrafın sağındaki düzenli geniş/renkli şeritler ekran-kamera moiré'si olabilir.
Mutlak renk, kontrast veya dalga boyu fotoğraftan ölçülmez; yakın/orta/uzak kamera
ve hareketli video kabulü gerekir. Önce normal üzerinden görünüm önerilir;
geometri deplasmanı gerekiyorsa kıyı maskesi, derinlik, yansıma ve temas seviyesine
etkisi ayrıca tasarlanır. Fotoğraf tek başına fiziksel dalga yüksekliği gerektirmez.

### L2 — Tekerlekten bağımsız Lake temas olayları

İncelenen kaynaklar:
`engine/render-three/terrain/terrainWaterState.ts`, `terrainWater.ts` ve
`src/scene/capabilities/terrainDeformationModule.ts`.

Mud sistemi temas başına kimlik, dünya konumu, genişlik/yarıçap, teker dönüşü ve
optional `tractionSlip` kullanıyor; hareket/patinajdan enerji çıkarıyor. Cooldown,
sönme, teleport süreksizliği kontrolü ve impulse/ripple üst sınırları var.
Mevcut sabitler 32 m yerel alan, en fazla 64 impulse ve 24 ripple, 1,6 s ripple
ömrü; bunlar Lake için ölçülmüş bütçe veya aynen taşınacak zorunlu değerler değil.
Mud sunumu deformasyon alanına ve ıslaklık maskesine bağlıdır.

Önerilen Lake uyarlaması:

- Teker dünya pozu/yarıçapı/genişliği ve hareket verisini ortak bir adapter'dan
  al; mud malzemesi veya terrain ground-contact olayını tek tetikleyici yapma.
  Önce teker hacmi–su düzlemi kesişimini, ardından temas XZ'sinin geçerli bağlı
  Lake yüzeyinde oluşunu kontrol et. Bounds testi tek başına yeterli değildir.
- Yüzeydeki temas noktası su kotundan hesaplanır; kuru ada, ayrı çukur, geçersiz
  Lake ve suyla temas etmeyen teker elenir. Sadece yüzeye yakın geçişten enerji
  üret; tamamen batık tekeri yüzeye yapışık kaynak gibi gösterme. Su altı
  türbülansının yüzeye aktarımı ayrı, ilerideki bir model olabilir.
- İleri/geri hız, dönüş ve patinaj enerji/yönü etkiler. Kayma verisi yoksa teker
  dönüşü fallback olabilir; park hâlindeki dönüş reset'i/teleport darbe üretmez.
  Suya giriş/çıkışta sınırlı darbe, hareket sırasında aralıklı dalga üretimi;
  durunca mevcut dalgalar yayılıp sönmeli, sürekli yeni halkalar oluşmamalı.
- İlk teslimde dünya sabit analitik ripple/normal alanı; gövde başına sınırlı
  kısa ömürlü olay buffer'ı. Dalga ve izler Lake'in geçerli su maskesinde kalır;
  ada/kuru sırtın ötesindeki suya halka atlamaz. Yalnız aynı Lake id'si bu
  engellemeye yetmez; yayılım yolundaki kuru bölge ayrıca ele alınmalı.
- Büyük Lake için tüm yüzeyi yüksek çözünürlükte simüle etme. Araç çevresinde
  sınırlı aktif alan ve gövde/olay sayısı bütçesi; pencere kayarken dalga konumu
  zıplamaz. Çok araç, çok Lake, silme/gizleme ve level değişimi temizlenir.
- Ripple normalini mevcut yüzey normaliyle birleştir; yansıma/güneş parlamaları
  tepki versin. İlk teslimde su kotu/geometri veya caustics fiziksel yeniden
  hesaplanmaz. Yoğun temasın kısa köpük izi, kıyı köpüğünden ayrı kontrol edilir;
  her teker halkasının beyaz köpük olması zorunlu değildir.
- Geçici dalga olayları level dosyasına kaydedilmez; yalnız kalıcı görsel ayarlar
  runtime/save ortak sözleşmesinde saklanır. Fizik ve terrain state'ine yazılmaz.

### L3 — İlave kabul

- Aynı araçla sert göl tabanı ve mud taban: her ikisinde yüzey dalgası; batma
  yalnız mevcut zemin fiziği gerektiriyorsa. Göl dalgası terrain hash'ini değiştirmez.
- Suya giriş/çıkış, düşük/yüksek hız, geri gitme, dönüş, patinaj, park ve teleport;
  tepki temas noktasına ve hareket yönüne bağlı, park hâlinde sürekli üretim yok.
- Ground contact olmadan su yüzeyiyle kesişen tekerde dalga; havada/kuru/çok
  derinde yanlış halka yok. Birden çok tekerin olayları bounded kalır.
- Ada, dar kuru sırt ve ayrı çukur: dalga kuru yüzeye veya öteki havzaya atlamaz;
  tile seam'i ve büyük origin'de faz/konum kopmaz.
- Yakın/orta/uzak ve kıyıya eğik kamera: doğal temel yüzey + araç dalgası birlikte
  okunur. Köpük, caustics, gölge/gece ve planar yansıma açık/kapalı karşılaştırılır.
- Sculpt/undo, Lake seviyesi değiştirme, aktör silme, pencere taşıma, reload/Play:
  eski temas alanı kalmaz. Çok araçlı donanım GPU/CPU/bellek p95 ölçülür; mud'daki
  mevcut çalışma, Lake performansının kabulü olarak gösterilmez.

Bu bölüm uygulama planıdır; yeni Lake etkileşimi veya görsel teslim yapılmadı.
