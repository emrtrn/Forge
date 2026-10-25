# Araçların Çamur / Kar Direnci: Araştırma ve Düzeltme Planı

> Tarih: 2026-10-25
> Durum: **2026-10-25: motor uygulaması ve otomatik doğrulama tamamlandı. 1878 motor kontrolü, build gate ve OffroadTest/LandscapeTest Playwright senaryoları geçti. Görsel kalite ve kullanıcı sürüş hissi kabulü açık; ayrıntılar uygulama raporunda.**
> Kullanıcı kararı: Çakışmayı önlemek için önce Claude'un çalışması alınacak, ardından güncel kod karşılaştırılarak bu işe başlanacak.
> Araştırma tabanı: `main`, `e081cf1c`. Bulgular bu revizyondaki kod ve yerel fizik deneylerine aittir; pull sonrasında yeniden doğrulanmalıdır.

İlgili planlar: [Terrain Deformasyonu](TERRAIN_DEFORMATION_PLAN.md), [Araç Fiziği](VEHICLE_PHYSICS_PLAN.md).

## 1. Problem ve hedef

LandscapeTest seviyesindeki GAZ-52, fizik malzemesi `mud` / `snow` olan katmanda durduğu yerden kalkarken patinaj yapıyor ve yavaş hızlanıyor. Kullanıcı bu davranıştan memnun. Ancak hızlı girişte batmanın sürüşü yeterince zorlamadığını, gaz kesildiğinde yokuş aşağı aracın yoluna devam edebildiğini bildiriyor.

Hedef, mevcut patinajı koruyarak tekerin yumuşak zemini sıkıştırması ve yararak ilerlemesi için gereken kuvveti modellemek. Batma derinliği arttıkça direnç artmalı; gaz verilmesi bu direnci kaldırmamalı. Araç, çekişi toplam direnci karşılayabildiği ölçüde ilerlemeli.

Batmış bir aracın her eğimde mutlaka durması fiziksel hedef değildir. Eğimden gelen kuvvet zemin direncini aşarsa hareket edebilir. Kabul, seçilen malzeme ve derinlik için kuvvet dengesine dayanmalı; her yokuşta aracı kilitleyen bir kural olmamalı.

## 2. Doğrulanan bulgular

### 2.1. Çekiş sınırı ile batma direnci farklı mekanizmalar

`engine/physics/surface/surfaceResponse.ts` içindeki mevcut yüzey direnci:

```text
F_rolling = rollingResistance × teker yükü × min(|ileri hız|, 1)
```

Direnç 1 m/sn üzerinde sabitleniyor; batma derinliğini kullanmıyor. Mud için katsayı `0.12`, snow için `0.06`. Çekiş sınırı ise `tractionCoefficient` ile uygulanıyor; düşük hızda patinajın çalışması, batmış tekerin ilerleme direncinin tamamlandığı anlamına gelmiyor.

### 2.2. Gövde direncinin eşiği GAZ-52'nin standart katmanlarında aşılmıyor

`engine/physics/physicsSubsystem.ts` içindeki `applyWheelSink`, batmayı süspansiyon dinlenme boyunu kısaltarak temsil ediyor; arazi collider'ı değişmiyor. Ek gövde direnci yalnızca istenen batma tekerin batma sınırını aştığında uygulanıyor.

- GAZ-52'nin hesaplanan teker batma sınırı: her tekerde `0.30 m`.
- Mud azami katman derinliği: `0.22 m`.
- Snow azami katman derinliği: `0.30 m`.

Bu nedenle normal mud/snow derinliklerinde bu ek direnç devreye girmiyor. Gövde direnci tek başına, gövde henüz yere oturmamışken tekerin zemini yararak ilerlemesinin maliyetini karşılamıyor.

### 2.3. Motor kuvveti olan tekerde yüzey freni atlanıyor

Forge, `rollingResistanceForce` değerini `controller.setWheelBrake` çağrısına ekliyor. Rapier'in raycast araç kontrolcüsü aynı tekerde `engine_force != 0` olduğunda ileri itkiyi motor kuvvetinden hesaplayıp fren dalını atlıyor. GAZ-52 arkadan çekişli olduğu için motor kuvveti uygulanan arka tekerlerde yüzey direnci kayboluyor; ön tekerlerde uygulanmaya devam ediyor. Vites değişimi gibi motor kuvvetinin sıfır olduğu anlarda arka teker freni yeniden çalışabiliyor.

Kurulu `@dimforge/rapier3d-compat 0.19.3` ile doğrudan deney: arka teker başına `1000 N` motor kuvvetinde, fren sınırı `0` ve `1000 N·s` iken ileri impuls aynı: yaklaşık `16.67 N·s` (1/60 sn adım).

Birincil kaynaklar: [Rapier kontrolcü kodu](https://github.com/dimforge/rapier/blob/v0.30.1/src/control/ray_cast_vehicle_controller.rs#L560-L582), [rapier.js v0.19.3 bağımlılık kilidi](https://github.com/dimforge/rapier.js/blob/v0.19.3/Cargo.lock) (`rapier3d 0.30.1`).

### 2.4. Batma, önceki görüntü karesinde basılan izden okunuyor

`src/scene/capabilities/terrainDeformationModule.ts`, izleri fizik sonrasında `presentation` aşamasında basıyor. Fizik sonraki adımlarda bu alanı okuyor. Aynı noktada duran / patinaj yapan teker zemini tekrar tekrar sıkıştırıp kazıyor; hızlı ilerleyen teker yeni zeminde daha kısa kalıyor.

Hızla geçen tekerin daha az kazması makul olabilir. Eksik olan, yeni zemini sıkıştırma ve önündeki malzemeyi itme direnci. Fiziksel tepkinin görüntü karesinde birikmiş iz verisine bağımlılığı da uygulamada gözden geçirilmeli.

## 3. Ölçümler ve doğrulama sınırı

Deneyler projeye dosya eklemeden geçici dizindeki betiklerle yapıldı. Stok GAZ-52 araç tanımı ve actor gövde ayarları kullanıldı. Kontrollü düz / eğimli kutu zemin, malzeme sağlayıcısı ve runtime'daki iz basma/okuma döngüsünü temsil eden deney kullanıldı. Bunlar LandscapeTest'in belirli bir güzergâhında tarayıcı sürüşü değildir.

Gaz kesilmiş, yaklaşık 40 km/sa giriş hızı ve 60 Hz görüntü güncellemesi:

| Zemin | Başlangıç hızı | 3 sn sonraki hız |
| --- | ---: | ---: |
| Düz mud | 40.00 km/sa | 20.06 km/sa |
| Düz snow | 40.00 km/sa | 26.11 km/sa |
| 10° aşağı eğimli mud | 40.23 km/sa | 37.90 km/sa |
| 10° aşağı eğimli snow | 40.23 km/sa | 43.78 km/sa |

Düz zeminde direnç tamamen yok değil. İnişte mevcut direnç, yerçekiminden gelen kuvveti karşılamayabiliyor; batmaya bağlı ek teker direnci bulunmuyor.

Aynı snow yüzeyinde sabit sanal batma derinlikleri `0`, `0.10` ve `0.22 m` karşılaştırıldığında gaz kesilmiş aracın hızları değişmedi: 1 sn sonunda yaklaşık `36.04`, 2 sn sonunda `31.00 km/sa`. Derinliğin tek başına yavaşlamayı artırmadığı doğrulandı.

Düz zeminde 40 km/sa hızlı giriş deneyinde mud/snow iz döngüsü 30/60/144 Hz'de de batma üretti. Dolayısıyla mevcut kanıt, hızlı girişte batmanın tamamen kaybolduğunu değil, batmanın yeterli ek hareket direnci üretmediğini gösteriyor.

Mevcut test komutu:

```powershell
node tools/run-engine-tests.mjs --filter "wheel traction rapier: stock GAZ-52,surface response rapier: GAZ-52,wheel sink rapier"
```

Sonuç: **9 geçti, 1857 atlandı**. Filtreli sonuç tam gate değildir. Testler patinajı, batmayı, kazmayı ve bazı sürüş davranışlarını doğruluyor; hızlı yüzey girişi ve inişte gaz kesme senaryolarını kapsamıyor. Bu araştırmada tam build gate ve LandscapeTest tarayıcı sürüşü yapılmadı.

## 4. Pull sonrasında başlama sırası

1. Claude'un çalışması pull edilmiş olmalı. Bu belge pull / merge / commit işlemi için talimat veya yetki oluşturmaz.
2. Güncel dal, HEAD ve çalışma ağacı incelenecek; kullanıcının ve Claude'un değişiklikleri korunacak.
3. Özellikle fizik, yüzey, deformasyon ve şanzıman dosyaları araştırma tabanı `e081cf1c` ile karşılaştırılacak. Claude aynı sorunun bir bölümünü çözmüşse o bölüm yeniden uygulanmayacak.
4. Aşağıdaki teşhis senaryoları güncel kodda yeniden ölçülecek; sayısal hedefler ve dosya kapsamı buna göre kesinleştirilecek.
5. Sonra genel motor düzeltmesi uygulanacak. LandscapeTest boyası, arazi geometrisi veya GAZ-52 asset ayarlarıyla genel eksik maskelenmeyecek.

## 5. Uygulama adımları

### A. Yüzey direncini motor kuvvetinden bağımsız uygula

- Yüzey direncini, Rapier'in motor/fren dallarından bağımsız bir temas kuvveti / impulsu olarak uygula.
- Kuvveti teker temasındaki göreli hareketin zemin teğetindeki yönüne karşı hesapla; ileri/geri sürüş, yanal kayma ve eğim ele alınmalı.
- Teması olmayan tekere direnç uygulama. Nötr yüzey davranışını koru.
- Eski yüzey fren katkısını kaldırarak aynı direncin iki kez uygulanmasını önle. Sürücü freni ve motor frenini ayrı tut.
- Bir adımdaki direnç impulsu hareketi tersine çevirmemeli veya enerji üretmemeli.

### B. Derinliğe bağlı teker direnci ekle

- Teker yükü, batma/yarıçap oranı ve malzeme özelliklerinden sıkıştırma / zemini yarma direnci hesaplayan saf bir model ekle.
- Mud ve snow için ayrı, ayarlanabilir katsayılar kullan. Katsayılar uygulama sırasında ölçülerek belirlenecek; mevcut hızlar gerçekçilik hedefi olarak sabitlenmeyecek.
- Gövde yere oturmadan da teker batması direnç üretmeli. Gövde oturma direnci ayrıca korunmalı; toplamda çift sayım olmamalı.
- Fiziksel direnç hesabını görünür iz dokusundan ayır; alan yokken / modül kapalıyken kullanılacak davranışı açıkça tanımla ve test et.
- Tam toprak mekaniği simülasyonu gerekmiyor; basitleştirilmiş modelin fiziksel sınırları ve kalibrasyon kapsamı belgelenmeli.

### C. Batma ve zemin durumunu fizik adımlarında tutarlı güncelle

- Yeni yumuşak zemine giren tekerin yükten kaynaklanan batmasını, önceki karede iz bulunmasına bağımlı bırakma.
- Mevcut iz derinliğini, yükten doğan batmayı, sıkışmayı ve patinaj kazmasını ortak kuralla birleştir; iz derinliklerini körlemesine toplama.
- Fizik durumunu sabit adımlarda güncelle; render/iz dokusu bu durumu izlesin. Mevcut alanın pencere, toparlanma ve performans davranışı korunmalı.
- Mevcut batma hızı sınırı ve gövde açıklığı korumalarını, yüzeyden çıkarken sarsıntı oluşturmayacak şekilde sürdür.

### D. Düşük hızda saplanma ve şanzıman uyumu

- Düşük hızda zeminin sağlayabileceği tutunma / kopma eşiğini ele al. Zemin yeterli direnç sağlıyorsa araç sürekli sürünmemeli; sürüş veya eğim kuvveti eşiği aşarsa hareket başlayabilmeli.
- Duruş ve hareket arasında titreşim, yapay yön değişimi veya her eğimde koşulsuz kilitlenme oluşmamalı.
- Mevcut patinaj ve kazma davranışını koru; yüksek direnç çekişi aşıyorsa teker dönerken gövde zorlanabilmeli.
- Yeni toplam direnci şanzımanın vites uygunluk hesabına aktar; eski vites avlanmasını geri getirme.

## 6. Beklenen dosya kapsamı

Pull sonrasında yeniden kesinleştirilecek adaylar:

- `engine/physics/physicsSubsystem.ts`: temas, direnç uygulaması ve toplam yükün şanzımana aktarılması.
- `engine/physics/surface/surfaceResponse.ts`, `wheelSink.ts`, `sinkage.ts`: yüzey/batma verisi ve saf kuvvet hesapları; gerekirse ayrı genel fizik modülü.
- `engine/physics/surface/wheelTracks.ts`, `src/scene/capabilities/terrainDeformationModule.ts`: fizik ve iz güncelleme sırası.
- `engine/scene/collision.ts`, gerekirse `engine/terrain/terrainSurface.ts`: malzeme parametreleri ve karışımları.
- `engine/physics/vehicle/vehicleDrivetrain.ts`: toplam dirençle vites kararı.
- `tests/engine/surfaceResponse.test.ts`, ilgili terrain/track/drivetrain testleri ve tarayıcı smoke senaryoları.

Yeni kalıcı alan gerekirse ilgili normalizer, save/load sözleşmesi ve `tools/saveValidator.ts` allowlist'i birlikte ele alınmalı. Sadece built-in malzeme katsayısı değişikliği için gereksiz sahne şeması değişikliği yapılmamalı. Save/load veya güvenlik sınırlarına kapsam genişlerse AGENTS.md uyarınca uygun Codex Security incelemesi kullanıcıya önerilmeli; tarama sessizce başlatılmamalı.

## 7. Doğrulama ve kabul

- Aynı araçla sert zemin, mud ve snow karşılaştırılacak.
- Durarak kalkış ve 20/40/60 km/sa hızlı giriş; gaz açık/kapalı, ileri/geri sürüş ölçülecek.
- Düz zemin ve 5°/10°/15° inişlerde hız, duruş mesafesi, batma, çekiş ve toplam direnç kaydedilecek. Beklenti malzeme/derinlik/kuvvet dengesine göre belirlenecek.
- Sabit yük ve hızda daha derin batma, gövde eşiğinin altında da ek direnç üretmeli. Motor kuvveti açılınca bu direnç kaybolmamalı.
- Karışık katman, yalnızca bir aksın yumuşak zeminde olması, havadaki teker, mevcut iz ve yüzeyden çıkış kapsanacak.
- Nötr yüzey hız eğrisi, fren/geri vites, patinaj/kazma, vites avlanması ve süspansiyon kararlılığı regresyonları kontrol edilecek.
- 30/60/144 Hz görüntü güncellemesi ve uygun sabit fizik adımı karşılaştırmalarıyla sayısal tutarlılık ölçülecek.
- TypeScript değişikliklerinden sonra `npx.cmd tsc --noEmit`; motor değişikliği için `npm.cmd run test:engine` ve `npm.cmd run build:verify` çalıştırılacak. Tekrarlı gate çalıştırmaları yalnızca yeni değişiklik veya başarısızlık gerektirirse yapılacak.
- Playwright ile LandscapeTest üzerinde hızlı giriş, gaz kesme, görsel batma, efektler ve konsol hataları kontrol edilecek. Kullanıcının sürüş hissi kabulü ayrıca kaydedilecek.

## 8. Bu belgenin teslim sınırı

Bu aşama yalnızca araştırma ve plan kaydıdır. Motor, test, sahne ve asset dosyalarında bu plan kapsamında uygulama yapılmadı. Başlangıç, Claude'un çalışmasının alınmasından ve güncel kodla karşılaştırmadan sonradır.

## 9. Uygulama kaydı — 2026-10-25

Yukarıdaki 2–3 ve 8. bölümler ilk araştırmanın tarihsel kaydıdır. Kullanıcının başlama talimatından sonra güncel `main` incelendi; birleşmiş Claude çalışması ve çalışma ağacındaki görsel değişiklikler korundu. Bu iş için pull, merge, commit veya push yapılmadı.

A–D motor adımları uygulandı: motor/fren dalından bağımsız temas impulsu, derinliğe bağlı teker direnci, sabit fizik adımında yük batması ve patinaj kazması, fizik durumunu izleyen iz dokusu, sonlu kopma eşiği ve şanzımana toplam teker/gövde direnci aktarımı. Katsayılar yerel deneylerle ayarlandı; gerçek zemin ölçümlerine dayanan toprak mekaniği kalibrasyonu değildir.

Ölçümler, doğrulama sonuçları ve açık kabul sınırları: [uygulama raporu](../reports/VEHICLE_SOFT_GROUND_RESISTANCE_2026-10-25.md).
