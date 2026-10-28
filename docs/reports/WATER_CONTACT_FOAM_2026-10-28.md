# Lake / River temas köpüğü — 2026-10-28

**Sonraki kullanıcı kararı:** Elle taş temas alanı yerleştirme ana kullanım olarak
uygun bulunmadı. Bu rapor önceki uygulamanın teknik kaydıdır. Yerine Göl aracında
Hesapla/Yeniden Hesapla ile gerçek sahne geometrisinden üretim
[planlandı](../planned/LAKE_GEOMETRY_FOAM_BAKE_PLAN.md) ve Lake için uygulandı.
Güncel kayıt: [Lake geometri köpüğü](LAKE_GEOMETRY_FOAM_BAKE_2026-10-28.md).

## Teslim edilen davranış

Lake ve River aynı `contactFoam` kaynağını, engel shader'ını ve parçalı köpük
çekirdeğini kullanır. Varsayılan kapalıdır; eski River Radial Foam noktaları ve
eski kıyı görünümü korunur. Terrain yüksekliği, boya, collider veya fizik yazılmaz.

- **Contact Foam → Add Obstacle Contact:** daire/elips veya kapsül temas alanı;
  X/Y/Z, iki yarıçap, yön, yarı yükseklik, temas bandı, şiddet, görünürlük ve
  nehirde kuyruk uzunluğu. Her su gövdesinde en çok 16 kaynak.
- Lake'in ilk konumu dolum seed'idir; River'ınki ilk spline noktasındaki su
  seviyesidir. Konumlar su gövdesinin kayıt koordinat sistemindedir: Lake dünya,
  River mevcut `coordinateSpace` ayarı. Kaynaklar numaralı listeden düzenlenir.
- Kaynak merkezi geçerli ıslak yüzeyde olmalıdır. Ada, ayrı havza, ribbon dışı,
  gerçek terrain deliği, havada ve tamamen su altında kalan kaynak elenir.
  Yarı yükseklik boyunca elips/kapsül kesiti su çizgisine göre daralır.
- Lake'te yavaş, parçalı temas bandı; River'da yerel spline akış yönü/hızı ile
  hareket, taşın önünde daha güçlü temas ve arkasında daralıp sönen analitik iz.
  Lake için akış kuyruğu zorunlu değildir; `wakeLength` burada kullanılmaz.
- River'da Contact Foam açıkken eski normalize ribbon-kenarı köpüğü yerine,
  örneklenen gerçek terrain yüksekliği ile su yüzeyinin wet/dry kesişim
  segmentleri kullanılır. Tamamen su altında kalan ribbon kenarı kıyı sayılmaz.
  Eksik terrain yüzlerinin kenarları da köpük kaynağı değildir.
- Gerçek kıyı segmentleri Lake ile aynı metre ölçekli mesafe maskesine girer.
  River rapid köpüğü ve yeni temaslar örtüşürken katkı sınırlandırılır.
  Mevcut su kompozisyonu, güneş/gölge, dip geçirgenliği ve yansıma kullanılır.

Alanlar ortak runtime/save allowlist ile korunur; hatalı, yinelenen veya sınırı
aşan kaynak listesi sessizce kırpılmaz. Düzenlemeler mevcut tek undo/redo
komutundan, Save/Reload/Play ve water rebuild yolundan geçer. Terrain taşındığında
ona bağlı dünya koordinatlı Lake/River engelleri de taşınır; River hazırlığı
engel ve geometriyi aynı yerel çerçeveye çevirir. Eski/yeni kaynaklar derin kopyadır.

## Kaynak bütçesi ve sınırlar

Engeller için ek draw, capture, texture veya her kare CPU geometri üretimi yoktur.
Shader en çok 16 analitik kaynağı işler; üç adet 16-elemanlı vec4 uniform dizisi
ve küçük sabitler eklenir. Kalıcı akış buffer'ı yoktur.

Gerçek kıyı maskesi yeni etkin River başına en çok 1024² R8 / 1 MiB'dir;
bandın genişliğinde dört texel hedeflenir, mip üretilmez. Lake mevcut maskesini
kullanır. Üretim en çok 16.777.216 segment/piksel işlemiyle sınırlıdır; aşımda
`over-budget` hatası verilir. Alan/çözünürlük sessizce bozulmaz. Maske rebuild'de
yenilenir ve su nesnesi dispose edilirken bırakılır. River'ın işaretli derinlik
örnekleri build sırasında ek CPU dizisi gerektirir. Büyük dünya build süresi,
tepe bellek ve GPU maliyeti bu sınırlar sayesinde ölçülmüş kabul edilmez.

Bu araç **elle yerleştirilen temas alanlarıdır**. Sahnedeki meshleri otomatik
taramaz veya taş meshinin kesin kesişimini çıkarmaz; mesh taşındığında temas
alanı da düzenlenmelidir. Yeni kaynak eklemek bir taş mesh'i oluşturmaz.
River kıyısı mevcut ribbon örneklemesinin çözünürlüğündedir; yeni terrain
çözünürlüğü veya kesin mesh/mesh kesişim sistemi teslim edilmez. Analitik iz
hidrodinamik simülasyon değildir ve gövdenin kuru yüzlerinde çizilmez; araya
giren başka engellerin arkasındaki akışı çözmez. Dinamik araç/karakter köpüğü,
parçacık sıçraması ve depth-capture yolu bu kapsamda yoktur.

## Doğrulama

- Son kaynakla tam `npm.cmd run build:verify` **çıkış 0**: TypeScript,
  **2.070 engine kontrolü**, production build, strict dist ve world-data geçti.
  Son eklenen yakın plan fixture'ı ayrıca `tsconfig.smoke.json` ile tip denetiminden
  geçti; son uygulama kaynağında `npx.cmd tsc --noEmit` yeniden geçti.
- İki yeni engine kontrol grubu ortak runtime/save allowlist, bozuk/bütçe aşan
  veri, derin kopya, terrain taşıma/yerel çerçeve, kuru/ada/ayrı havza/derin/hava
  elemesi, gerçek wet/dry konturu, ribbon/delik kenarının elenmesi ve maskenin
  dispose edilmesini sınar. Mevcut Lake mesafe/default testleri de geçti.
- Son geçerli browser koşuları toplam **7 farklı senaryoyu** doğruladı:
  Lake yeni UI; River yeni UI; mevcut Lake kıyı köpüğü; dönüştürülmüş/eğimli
  River optiği; derin ribbon kenarı; eski point foam; Lake/River ortak taş
  temasları ve yönlü izlerin çizim/animasyon karşılaştırması.
- Yeni UI senaryoları ekleme, boyut/şekil/kuyruk ayarı, gizleme, undo,
  Save/Reload/Play ve terrain dosyalarının hash korunmasını doğrular.
  Uygulama kaynaklarında shader/GL/console hatası kalmadı.
- Yakın Lake/River görüntüleri iki zıt açıdan incelendi: dairesel ve uzun
  taşların çevresinde parçalı temas, Lake'te sakin bant, River'da downstream
  iz görülüyor. Aynı sahnede efekt açık/kapalı draw sayısı eşit. Bu ölçüm GPU
  süresi veya otomatik mesh konturu doğrulaması değildir.

Kanıtlar: `.dev-server/water-contact-acceptance-build.log`,
`water-contact-browser-acceptance.log` (Lake UI ve River görseli geçti;
River UI'ın ilk sabit-seviye beklentisi düzeltildi),
`water-contact-river-ui-regression.log` (**2/2 geçti**),
`water-contact-visual-regression.log` (**4/4 geçti**) ve
`.dev-server/water-contact-final-results/` içindeki yakın/zıt açı PNG'leri.
Lake UI'ın geçerli sonucu `water-contact-browser-acceptance.log` içindedir;
başarısız denemeler kabul sayılmaz.

Testler izole smoke projesine yazdı; bu çalışma kullanıcı sahnelerine taş,
engel veya köpük verisi eklemedi. Eşzamanlı dış kaynak sahne değişiklikleri
korundu. Donanım GPU p95, büyük dünya CPU/bellek ve kullanıcının yeni köpük
dilimi için masaüstü görsel kabulü ayrı kalır. Codex Security diff scan önerildi,
başlatılmadı. Bu çalışma commit/push içermez.
