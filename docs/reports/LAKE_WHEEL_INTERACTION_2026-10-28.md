# Lake tekerlek etkileşimi — L2, 2026-10-28

Kullanıcı L1 görsel kontrolünü tamamladı ve L2'yi uygulamaya açtı. Runtime'da
geçerli Lake su düzlemini kesen tekerler temas yerinden yayılan ve sönen normal
dalgaları üretir. Mevcut göller ve araçlar otomatik kullanır. Editörün durağan
görünümünde fizik çalıştırılmaz; ayarlar Lake Details → **Wheel Ripples**
bölümünden değiştirilir, etki Play'de araçla görülür.

## Göl arayüzünden ayar — kullanıcı geri bildirimi

İlk sabit şiddet kullanıcıya belirsiz göründüğü için her göle ayrı kontroller
eklendi. Varsayılan Wave Strength **2** ile önceki sabit sunumun iki katıdır.
Eski kayıtlar yeni varsayılanları kullanır; authored dosyalar migrate edilmez.

| Kontrol | Varsayılan | Aralık / anlam |
| --- | --- | --- |
| Enabled | Açık | Yalnız tekerlek dalgalarını açar/kapatır |
| Wave Strength | 2 | 0–6; 0 kapatır, büyük değer daha belirgin normal/yansıma |
| Spread Speed (m/s) | 1,8 | 0,2–5; halkanın dışa yayılma hızı |
| Ring Width (m) | 0,45 | 0,1–2; yayılan dalga paketinin kalınlığı |
| Wavelength (m) | 0,35 | 0,1–2; paket içindeki ardışık halkaların aralığı |
| Lifetime (s) | 1,6 | 0,2–4; sönerken var olma süresi |
| Emission Interval (s) | 0,12 | 0,04–1; teker başına en kısa üretim aralığı |

Her kontrol Türkçe tooltip taşır. **Reset Wave Settings** yalnız bu grubu
varsayılana döndürür ve geri alınabilir. Lake kilidi tüm yeni kontrolleri
kilitler. Eski Surface Strength/Normal Scale/Ripple Speed bu grubu değiştirmez.
Şiddet sıfır veya Enabled kapalıysa CPU geçmişi ve dalga üretimi de kapanır.
Hız/kalınlık/dalga boyu/ömür shader uniform'larına, ömür/üretim aralığı CPU
sabit-adım durumuna aynı gölün çözülmüş ayarlarından aktarılır. 24 dalga ve
128 temas sınırı korunur; düşük aralık/uzun ömür bu sınırları büyütmez.

Alanlar `appearance.wheelRipplesEnabled` ve `wheelRippleStrength/Speed/Width/
Wavelength/Lifetime/Interval` olarak ortak runtime/save allowlist'indedir.
Save validator aynı `validateWaterBodies` fonksiyonunu çağırır; bilinmeyen
alanlar gibi sessizce atılmaz. Sonlu değer ve min/max doğrulaması vardır.
Mevcut Lake edit komutu undo/redo ve Save/Reload/Play yolunu kullanır.
Yeni kayıt alanları için Codex Security diff incelemesi önerildi; scan yapılmadı.

## Davranış ve kaynaklar

**Yeni göl başlangıcı:** Kullanıcının sonraki isteğiyle Terrain / Lake 1'in
28 Ekim kayıtlı görünümü yeni göl oluşturma preset'i yapıldı.
`createLakeAppearance()` her taslağa bağımsız bir ayar kopyası verir:
ıslak kıyı/köpük/caustics açık, absorption 2, surface strength 2/roughness 0,2,
normal scale 1/ripple speed 2; teker dalgası açık, strength 3/speed 1,8/width 1/
wavelength 0,6/lifetime 4/interval 0,12; foam scale/speed 2; caustics strength 1/
scale 1/speed 2/depth fade 1; sharedPlanar/medium yansıma. Kaynak sahnenin
dosyasından çalışma anında okuma veya başka gölün ayarlarını değiştirme yoktur.
Eski kayıtların fallback değerleri ve Wave Settings reset değerleri korunur;
yeni gölün appearance alanları oluşturma anında kaydedilen preset'tir.
Oluşturma/kayıt/partition odaklı engine kontrolü geçti; yeni preset'in bağımsız
kopya olması ve eski kayıt fallback'inin korunması da sınandı. Gerçek göl
oluşturma → undo/redo → Save → Reload → Play browser kabulü **1/1 geçti
(3,1 dakika)**; bütün preset alanları ilk taslakta ve kayıtta doğrulandı,
terrain disk hash'i korundu. Son `tsc --noEmit` geçti.
Kanıt: `.dev-server/lake-creation-defaults-browser.log` ve
`lake-creation-defaults-results/`. Genel engine koşusu ve son tekrar, eşzamanlı
World Builder import sınırı testinde durdu: `stage.ts` → `terrainSplineData`.
Bu göl preset'inin hatası veya başarılı genel gate olarak sayılmaz; kapsam dışı
World Builder dosyaları değiştirilmedi. Son log:
`.dev-server/lake-creation-defaults-engine-final.log`.

- `engine/terrain/lakeInteraction.ts`: gerçek kırpılmış göl üçgenleri için
  grid indeksli derinlik sorgusu. Kaynak yüzün yalnız ıslak bayrağına bakılmaz;
  kısmen su altındaki üçgenin kuru kısmı, ada ve bağlantısız çukur elenir.
- `VehicleWheelState.worldCenter/worldAxle`: canlı fizik gövdesinin konum ve
  quaternion'ından hesaplanır. Araç eğimi, direksiyon, süspansiyon ve mevcut
  sink sunumu hesaba katılır; render interpolation veya önceki adımdan kalan
  ray hard-point'i dünya merkezi yerine kullanılmaz.
- Sonlu teker silindiri–su düzlemi kesişimi: zemine değmeyen fakat suyu kesen
  teker de uygundur. Tamamen su altında veya suyun üstünde kalan teker uygun
  değildir. Eğik teker için düzlemde gerçekten silindir içinde kalan örnek
  konumu hesaplanır. Taşın üstünde sudan yukarıda duran teker dalga üretmez.
- Sabit fizik adımındaki 3B temas hareketi ilerleme/dönüş/dalma enerjisini,
  `tractionSlip` patinajı sağlar. Rotation farkı yalnız slip sinyali vermeyen
  provider'lar için fallback'tir; authoritative sıfır, rotation reset'ini eler.
  İlk temas örneği, temas kaybı sonrası giriş, >2 m teleport ve >100 ms kesinti
  hareket enerjisi üretmez. İlk örnekten sonraki hareketli fizik dilimi üretir.
- Her gölde en çok 24 dalga, 128 temas geçmişi; varsayılan teker başına 0,12 s
  cooldown ve 1,6 s ömür. Dalga başlangıcı dünya sabittir; varsayılan halka
  yaklaşık 1,8 m/s yayılır. Ömür/üretim aralığı/hız üstteki kontrollerden ayarlanır.
  İnce dalgalar uzak ekran footprint'inde söner. Duran tekerin geçmiş dalgaları
  sönerken yeni enerji eklenmez.
- `LakeWaterController` runtime VehicleHost'un sabit-adım aboneliğini kullanır.
  Mud/deformation capability'si gerekli değildir. Gizleme, invalidate, rebuild,
  silme ve dispose/travel dalga/temas geçmişini temizler; abonelik dispose'ta
  bırakılır ve yeniden kullanılan controller rebuild'te tekrar bağlanır.
- `lakeRipples.ts` mevcut Lake shader'ına normal eğimi ekler. Kıyı sönmesi,
  ışık/gölge, yansıma ve snapshot/direct kompozisyonu mevcut yolu paylaşır.
  Surface Strength 0 arka plan yüzeyini düzleştirirken araç dalgaları çalışır;
  Normal Scale/Ripple Speed araç dalgasının metre ölçeğini veya ömrünü değiştirmez.

Bu iş terrain yüksekliği/boyası, araç kuvveti/tutunması, mud sink/deformasyonu
ve terrain kayıt verisi yazmaz. Yeni görünüm ayarları level JSON'da saklanır.
Dalga için ek sampler, texture, capture, mesh veya draw
yoktur. Her Lake shader'ı 24 vec4 dalga uniform'u, count ve görünüm parametreleri kullanır; aktif
dalgalar fragment ALU maliyeti ekler. CPU grid indeksinin boyutu
`4 * (hücre + çıktı üçgeni)` byte; kaynak hücre başına en çok dört çıktı üçgeni
ile 65.536 hücrede en çok yaklaşık 1,25 MiB, toplam alan bütçesinde 5 MiB.
Bu yalnız saklanan indeks buffer'larının hesabıdır; transient/heap tepe ölçümü
değildir. İndeks gövde yayımında senkron kurulur; gerçek donanım zaman kabulü ölçülmedi.

## Doğrulama

- Odaklı `test:engine -- --filter "lake interaction"`: **5/5 geçti**.
  Gerçek Rapier dünyasında zemine basmayan tekerlerin sabit-adım aboneliğinden
  Lake uniform'larına kadar çalışması; eğik araç dünya merkezi/aksı; büyük
  origin ve seam; kuru/ada/ayrı çukur/kırpılmış kıyı; hava/tam batma/taş;
  30/60/144 Hz enerji; dönme/patinaj/durma/reset/teleport; bounded çoklu temas,
  decay ve hide/rebuild/travel abonelik ömrü kapsanır.
- İlk L2 Chromium senaryosu **1/1 geçti (42,9 s)**. İzole runtime'da kontrollü
  teker girdileri gerçek yüzey sorgusu ve dalga durumundan shader'a gider.
  Hareket/patinaj ile görünür piksel farkı, iki zamanda yayılma/sönme, durma,
  hava/tam batma/ada reddi, snapshot ve direct yolları, aynı draw sayısı,
  GL/konsol hatasızlığı ve terrain disk hash korunumu doğrulandı.
  Görüntülerde temas bölgesinden dışa ilerleyen halkalar incelendi.
  Bu browser testi gerçek sürücü girdisiyle araç sürüş kabulü değildir;
  gerçek fizik bağlantısı ayrı Rapier engine regresyonunda sınanır.
- Tam `npm.cmd run build:verify` **çıkış 0**: TypeScript, smoke/content/UI test
  tipleri, release araçları, production build, **2.004 engine kontrolü**, strict
  dist ve world-data geçti. Yeni L2 engine test dosyası ayrıca TypeScript ile
  denetlendi. Kısmen ıslak tek hücrenin kuru kısmı ve farklı seviyelerde iki
  Lake'in dalga izolasyonu eklenerek odaklı beş kontrol tekrar geçti.
- Son birleşik Chromium koşusu **6/6 geçti (6,6 dakika)**: caustics/dip normal,
  kıyı köpüğü, dik kıyı geçişi, ıslak dip, L1 doğal yüzey ve L2 teker dalgaları.
  Yakın dalga ve ilerlemiş/sönmüş halka görüntüleri incelendi. Browser girdileri
  izole QA fixture'ıdır; gerçek donanım GPU veya kullanıcı sahnesinde sürüş
  kabulü olarak sayılmaz. Kanıtlar `.dev-server/lake-l2-build.log`,
  `lake-l2-browser.log` ve `lake-l2-browser-results/` altında tutulur.

L2'nin gerçek sahnede araçla masaüstü görsel kabulü, GPU p95 ve L3 köpük/
caustics/yansıma ile ortak araç kabulü açıktır. Normal dalgaları fiziksel
akış/engel kırınımı çözmez; ada etrafında hidrodinamik dolaşma, splash/araç
köpüğü, yüzdürme ve su direnci bu dilimde yoktur. Doğrulamalar izole smoke
projesindedir; kullanıcı sahnelerine test verisi yazılmadı. Eşzamanlı
World Builder/editör ve authored terrain değişiklikleri korunur. Commit/push yapılmadı.

## Arayüz kontrollerinin son kabulü

Odaklı yedi engine kontrolü geçti: eski kayıt varsayılanları, shared save
round-trip, tüm sayısal aralıkların sınır/geçersiz değerleri, Enabled/0 şiddet,
ayarlanabilir ömür/üretim aralığı ve önceki L2 fizik/geometri/yaşam döngüsü.
Yeni kontrollerle tam `build:verify` **çıkış 0**, **2.006 engine kontrolü**,
TypeScript, production build, strict dist ve world-data geçti. Yeni engine
test dosyasının ek TypeScript kontrolü ve son `tsc --noEmit` de geçti.

Aynı kaynakta doğal yüzey ve önceki L2 browser regresyonları **2/2** geçti.
Yeni **Wheel Ripples UI** senaryosunun son koşusu **1/1 geçti (1,8 dakika)**:
şiddet 0/2/3, hız/kalınlık/dalga boyunun görünür piksel farkı, uzatılmış ömür,
Enabled, reset, lock, undo/redo, açıkça kaydedilmiş false ve true, gerçek
Save/Reload/Play ve bütün sayısal ayarların runtime uniform'larına aktarımı.
GL/konsol hatası yok; terrain disk hash'i korundu. Panelin bütün kontrolleri
ve özelleştirilmiş dalga görüntüsü incelendi.

İlk UI koşusu, undo'nun eski implicit true varsayılanına dönmesini JSON'da
explicit true olarak beklediği için başarısızdı; kabul sayılmadı. Test hem
implicit varsayılanı hem explicit false/true kayıtlarını sınayacak şekilde
düzeltildi; runtime davranışını gevşeten bir değişiklik yapılmadı.

Kanıtlar `.dev-server/lake-wheel-controls-build.log`, ilk iki regresyon için
`lake-wheel-controls-browser.log` / `lake-wheel-controls-results/`, son UI
kabulü için `lake-wheel-controls-final-browser.log` ve
`lake-wheel-controls-final-results/` altındadır. Donanım GPU kabulü açık kalır.
