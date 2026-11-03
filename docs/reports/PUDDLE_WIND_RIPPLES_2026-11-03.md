# Puddle Wind Ripples — Faz 4

3 Kasım 2026. Wheel Ripples teslimi temel alınarak Puddle yüzeyine World
Environment rüzgarıyla hareket eden normal-map dalgacıkları eklendi.
Bu belge ilk Faz 4 tesliminin ve görsel iterasyonların tarihsel ölçümlerini
korur. Son esinti, yansıma düzeltmeleri ve Faz 5 çamurlu yoğunluk için
[Faz 4–5 nihai teslim raporuna](PUDDLE_MUD_DENSITY_2026-11-03.md) bakın.

## Kullanıcı referansına göre görünüm düzeltmesi

Kullanıcının ilettiği ince, birbirini izleyen kavisli çizgi referansına göre
normal görünümü yeniden düzenlendi. Görünür ana desen artık düzenli aralıklı,
yumuşak yay biçimli dalga sırtlarıdır. Mevcut normal map katkısı küçük yüzey
ayrıntısına indirildi; ince çizgiler yüzey normali ve yansımadan okunur.

Yayların merkezi authored Puddle seed'ine sabitlenir; canlı çamur deformasyonu
kıyıyı değiştirdiğinde dalga deseni yeniden merkezlenmez. Yayların yan eğimi
sınırlıdır, genel ilerleme World Environment rüzgarını izler. World Scale
0.7 m iken sırt aralığı yaklaşık 0.168 m'dir. Uzakta ekran türevleriyle çizgiler
söndürülerek aliasing azaltılır. Dalga fazı simülasyon zamanı farkıyla ilerler;
pause ve hız/güç ayarı değişiminde faz korunur. Yeni kayıt alanı eklenmedi.

Aşağıdaki ilk teslim ölçümleri ve ilk yedi testlik koşu önceki görünümün
kaydını korur. Kavisli görünüm için son kontroller belgenin sonunda belirtilir.

## Kullanım ve davranış

Puddle seçimi ve oluşturma taslağı **Wind Ripples** bölümünü paylaşır:
Enabled, Normal Strength (varsayılan 0.16), World Scale (0.7 m), Speed Response
(1). Aralıklar sırasıyla 0–0.6, 0.1–4 m ve 0–3'tür. Kontroller kaydedilir,
undo/redo'ya katılır ve Locked durumuna uyar. Yön ve etkin güç global rüzgardan
gelir; Puddle başına ayrı rüzgar yönü yoktur.

- `resolveLevelWind` ile aktif World Environment, canlı hava/mevsim, editör
  önizlemesi ve mevcut World Settings/varsayılanlara dönüş kuralları kullanılır.
  Güncelleme foliage binding'den bağımsızdır. Editör viewport saati, Play ise
  simülasyon saati üzerinden ilerler; simülasyon zamanı durduğunda yüzey donar.
- Var olan `t-water-n` normal dokusu sahnenin su doku önbelleğinden alınır.
  Doku lineer normal verisidir; yeni asset veya render target eklenmedi.
  Dünya XZ metre koordinatında, ikinci katmanı döndürülmüş iki ölçek/hızda
  örneklenir. Her iki katman rüzgar yönünde kayar. Gust genlik ve kaymayı
  değiştirir; yavaş hareket eden yüzey paketleri tekdüze kayışı azaltır.
- UV kayması zaman farklarıyla biriktirilir. Güç/hız ayarı değişimi mutlak
  zamanı yeni hızla çarparak doku fazını sıçratmaz. UV sarımı ikinci katmanın
  kendi koordinatında yapılır. İnce detay uzakta filtrelenir; normal türevleri
  çözülemeyen parlak noktaların roughness değerini artırır.
- Rüzgar ve Wheel Ripples eğimleri aynı normalde birleşir. Yansıma UV'si de
  toplam eğimi kullanır. İki efekt bağımsız açılıp kapanır. Su kotu, yatak,
  bağlı havza, araç teması ve kıyı geometrisi değiştirilmez.
- Normal doku yüzey tarafından dispose edilmez; sahibi sahne önbelleğidir.
  Eksik/reddedilen doku sakin yüzeye döner, mevcut tekerlek halkaları korunur.
  Yükleme sonrası revision/abort kontrolü silinmiş gövdeyi geri getirmez.

## QA kapsamı

| Davranış | Kontrol ve kanıt |
| --- | --- |
| 0/düşük/yüksek rüzgar, yön ve gust | Ortak rüzgar çözümleyicisi, motion engine kontrolü ve gerçek yüzey piksel probları |
| Araç yokken normal hareketi | Taslak, kalıcı editör ve Play yüzeyinde animasyon karşılaştırması |
| Pause ve hız değişimi | Aynı simülasyon zamanında aynı UV/pikseller, aynı zamanda ayar değişiminde kesintisiz faz |
| Kontroller ve kayıt | Draft → Create, strength/scale, undo/redo, Lock, Hide/Delete, Save/Reload/Play |
| Wheel Ripples bağımsızlığı | Sıfır rüzgarda halka probu, gerçek Rapier araç ve Lake regresyonları |
| Kaynak/başarısız yükleme | Paylaşılan doku ownership, iptal/geç yükleme, eksik doku ve değişmeyen mesh |
| Görsel görünüm | Yansımalı avluda sakin/esintili yakın eğik ve üst açı; editör paneli ekran görüntüleri |

İki hata senaryosu özellikle sınanır: normal yüklenirken gövdenin silinmesi
ve normalin hiç yüklenememesi. Sayfa/panel viewport sınırları sayısal olarak
kontrol edilir; görüntüler ayrıca incelenir. Kaydırılabilir Details panelindeki
bölümler doğal panel kaydırmasıyla erişilir.

## Teknik doğrulama

- `npx.cmd tsc --noEmit` ve tam `npm.cmd run build:verify` geçti. Tam doğrulama
  import sınırları, fixture/content/UI türleri, builder paketleri, üretim
  derlemesi, yavaş engine paketi, strict dist ve world-data kontrollerini içerir.
- `npm.cmd run test:engine`: **2395 kontrol geçti**. Yeni dört kontrol; gerçek
  save/read alan koruması ve geçersiz değerler, 30/60/144 Hz faz eşdeğerliği,
  pause/ayar değişimi, controller/taslak ownership, geç yükleme ve eksik dokuyu kapsar.
- Gerçek editör/Play piksel probu: düşük/yüksek rüzgar farkı editörde
  **2785 / 10133**, animasyon **13140**, yön değişimi **10141**. Play'de
  **1491 / 5272**, animasyon **6681**. Bunlar tanı görünümündeki mutlak kanal
  farkı toplamlarıdır; doğal görünüm veya GPU süresi ölçütü değildir.
- Pause, Wind Disabled ve eksik doku karşılaştırmalarının farkı **0**;
  sıfır rüzgarda tekerlek halkası farkı editörde **25217**, Play'de **13503**.
  Geometri aynı kaldı, ek draw çağrısı **0**, WebGL hata kodu **0**.

- Playwright Chromium: **7 test geçti** (5.3 dakika). Gerçek Rapier Puddle
  yatağı/araç halkaları, Puddle Draft/Create/ayarlar/Save/Reload/Play, planar
  kalite/yansıma, Lake Wheel Ripples etkileşim ve kontrol/kayıt regresyonları,
  yansımalı avlu rüzgar görünümü ve mevcut avlu prototipi doğrulandı.
- Son smoke TypeScript kontrolü (`npx.cmd tsc --noEmit -p tsconfig.smoke.json`)
  geçti. Panel/görünüm sınırları ve sakin/esintili eğik/üst açı ekran görüntüleri
  incelendi. Avlu fixture'ı gerçek renderer görselidir; gerçek araç fiziği
  kabulü ayrı Rapier testinden gelir.

Kanıtlar: [ayar paneli](evidence/puddle-wind/controls.png),
[sakin yüzey](evidence/puddle-wind/calm.png),
[esintili yüzey](evidence/puddle-wind/breeze.png),
[üst açı](evidence/puddle-wind/overhead.png),
[taslak/editör/Play ölçümleri](evidence/puddle-wind/measurements.json).

Normal map iki ek texture örneklemesi ve az miktarda fragment işlemi ekler;
ek draw/capture olmaması ücretsiz GPU maliyeti anlamına gelmez.

## Kabul sınırları

Hedef GPU'da çok Puddle/araç, eşlenik CPU/GPU süreleri ve tepe bellek kabulü
açıktır. Kullanıcının kendi sahnesinde esinti ölçeği ve parlama kabulü ayrıca
yapılmalıdır. Bu teslim suyun berraklığını veya kayıtlı opacity değerlerini
değiştirmez; dibi gizleyen çamurlu profil Faz 5'tedir.

Etkileşimli Playwright REPL aracı `./index.js` default-export açılış hatası
verdiği için tarayıcı doğrulaması projenin izole Playwright CLI testleriyle
yapıldı. İlk engine denemesi Windows esbuild erişim kısıtında durdu; izinli
yeniden koşu geçti. Yeni engine testindeki dropped-fields dönüş şekli
beklentisi düzeltildikten sonra odaklı ve tam paketler geçti.

Yeni kayıt alanları için yalnız bu değişiklikleri kapsayan Codex Security diff
incelemesi önerilir; kullanıcı onayı olmadan güvenlik taraması başlatılmadı.
Authored level/terrain/foliage, manifest ve fracture çalışmalarına dokunulmadı.
Commit veya push yapılmadı.

## Kavisli ince çizgi düzeltmesinin doğrulaması

- `npx.cmd tsc --noEmit`, `npm.cmd run build` ve **2395 tam engine kontrolü**
  geçti. Dalga sırtlarının yeni fazı da pause ve hız/güç değişiminde korunuyor.
- Son **3 tarayıcı kontrolü** geçti: yansımalı avlu görünümü, Puddle taslak/
  oluşturma/undo/kayıt/Reload/Play ve planar kalite/yansıma regresyonu.
- Son editör probunda düşük/yüksek rüzgar farkı **92387 / 423308**, animasyon
  **612190**, yön farkı **446053**. Pause/Disabled/eksik doku farkları yine **0**;
  bağımsız tekerlek halkası farkı **25217**, ek draw **0**, WebGL hata kodu **0**.
  Bu sayılar tanı kanal farklarıdır; görüntü kalitesi veya GPU süre kabulü değildir.
- Eğik ve üst açı görüntüleri incelendi; ana sırtlar ince, düzenli aralıklı
  ve kavisli okunuyor. Yatak/terrain dosyaları düzenlenmedi. Görsel düzeltme
  için tam `build:verify` tekrarlanmadı; önceki tam Faz 4 koşusu yukarıdadır.

Yeni kanıtlar: [kavisli yüzey](evidence/puddle-wind/curved-breeze.png),
[üst açı](evidence/puddle-wind/curved-overhead.png),
[ölçümler](evidence/puddle-wind/curved-measurements.json).
