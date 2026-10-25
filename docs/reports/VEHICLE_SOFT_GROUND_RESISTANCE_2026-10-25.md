# Yumuşak zemin araç direnci — uygulama ve doğrulama

Tarih: 2026-10-25. Başlangıç: `main`, `d66b06b2`. Araştırma tabanı `e081cf1c` ile ilgili fizik/yüzey/deformasyon/şanzıman dosyaları aynıydı. Başlangıçta mevcut 9 odaklı regresyon geçti. Kullanıcının/Claude'un görsel, malzeme ve asset değişiklikleri korundu. Bu iş için Git pull/merge/commit/push yapılmadı.

## Davranış ve model

- Yüzey direnci Rapier freninden çıkarıldı. Sürücü ve motor freni mevcut kontrolcü yolunda kaldı. Teker yükü varsa, motor kuvveti açıkken de ayrı temas impulsu uygulanır.
- İmpuls, gövdenin ve zeminin temas noktasındaki göreli hızının yüzey teğetine karşıdır. Eğim, geri gidiş, yanal kayma ve dönen/hareketli zemin hızları hesaba katılır. Dinamik zemine eşit ters impuls gider. Havadaki tekere impuls verilmez.
- Büyüklük `min(F × dt, göreli_teğet_hız / ters_etkin_kütle)` ile sınırlanır. Ters etkin kütle iki gövdenin öteleme ve dönme ataletini içerir. Her temas düzeltmesi enerji tüketir ve o temasın göreli teğet hareketini tersine çeviremez.
- İmpuls motor ve yerçekimi uygulandıktan sonra çözülür. Böylece düşük hızda sonlu direnç kapasitesi aracı tutabilir; eğim veya çekiş kapasiteyi aştığında araç hareket eder. Bütün yokuşları kilitleyen bir kural yoktur.

Saf teker modeli `F = yük × [rolling + ploughResistance × clamp(batma / yarıçap, 0, 1)]`. Tekerin gövde açıklığıyla sınırlanan batması kullanılır. Bu sınırı aşan hedef derinlik mevcut gövde oturma direncinde ayrıca ele alınır; aynı derinlik iki kez sayılmaz. Gömülü zeminde rolling katsayısı duruşta da sonlu kopma kapasitesine katılır; yumuşak gömülme bulunmadığında eski düşük hız rampası korunur.

Preset-only `ploughResistance`: mud **0.05**, snow **0.045**, sand **0.20**. İlk daha yüksek mud/snow denemeleri stok kamyonun kalkışını fazla kısıtladığı için katsayılar düşürüldü. Sahne, terrain veya araç asset ayarıyla fizik eksikliği maskelenmedi. Yeni kalıcı save/load alanı yok; malzeme katsayıları built-in presetlerde, yeni teker okumaları runtime belleğinde tutulur.

Bu, yük/derinlik oranına dayanan basitleştirilmiş bir oyun fiziği modelidir. Hız veya malzemeye özgü gerçek toprak ölçümü, Bekker–Wong parametreleri, malzeme yığılması ve akışı modellenmez. Sayılar gerçekçilik iddiası taşımaz; sürüş hissi ve hedef cihaz kabulü ayrıdır.

## Fizik ve iz güncellemesi

Yük batması, mevcut iz ve patinaj kazması her sabit fizik diliminde birleştirilir. Eski derinlik ile yükün istediği derinlik toplanmaz; sıkışma yalnızca yük hedefinin altında kalan farkı kapatır, kazma malzeme derinliği sınırına kadar ilerler. Süspansiyonun 0.3 m/sn değişim limiti ve gövde açıklığı koruması sürer.

İz alanı yokken de fizik yük batmasını ve yerel kazmayı üretir. Yerel kazma aynı dünya temasının yarım lastik genişliği çevresinde tutulur; tekerle birlikte bütün güzergâh boyunca taşınmaz. Alan/modül kapalıyken kalıcı ve yeniden ziyaret edilebilir iz hafızası ve iz duvarı yönlendirmesi yoktur; temel batma, tutunma ve direnç devam eder.

`PhysicsSubsystem.onFixedStep` üzerinden CPU iz alanı her dilim sonunda basılır ve toparlanır. GPU yüklemesi yalnızca presentation aşamasındadır. Alanın pencere/recenter/sparse recovery davranışı korunur. `soilDepth` fizik hedefini iz basıcısına verir; renderer aynı kazma ve sıkışmayı ikinci kez uygulamaz. Module dispose aboneliği kaldırır; level unload alanı bırakır.

Şanzımanın mevcut direnç girdisine yeni toplam teker direnci ve gövde direnci aktarılır. Şanzıman algoritmasına ayrı bir araç/preset kuralı eklenmedi. 20 saniyelik stok GAZ-52 testinde tekrarlı vites avlanması yok; gelişen zeminin yükü nedeniyle en çok bir düzeltici küçültmeye izin veren regresyon kullanılır. Sert zemine çıkıldığında normal büyütme ve hızlanma sürer.

## Ölçümler

Kontrollü Rapier kutu zeminde stok GAZ-52 tanımı ve actor collider'ı kullanıldı. Aşağıdaki karşılaştırmalar LandscapeTest güzergâhının sayısal ölçümü değildir. Her satır gaz kesilmiş 3 saniyelik ileri hareketi gösterir; değerler km/sa.

| Giriş | İniş | Sert zemin | Mud | Snow |
| --- | --- | ---: | ---: | ---: |
| 20 | 0° | 10.76 | -0.01 | 3.35 |
| 40 | 0° | 32.14 | 19.53 | 25.78 |
| 60 | 0° | 50.94 | 38.64 | 44.75 |
| 20 | 5° | 19.68 | 6.86 | 13.03 |
| 40 | 5° | 40.85 | 28.36 | 34.56 |
| 60 | 5° | 59.47 | 47.29 | 53.33 |
| 20 | 10° | 29.95 | 15.71 | 22.11 |
| 40 | 10° | 50.12 | 37.17 | 43.28 |
| 60 | 10° | 67.87 | 55.91 | 61.85 |
| 20 | 15° | 39.72 | 24.82 | 32.95 |
| 40 | 15° | 59.14 | 45.93 | 52.82 |
| 60 | 15° | 76.09 | 64.45 | 70.23 |

Düz mud, 20 km/sa girişte 0.05 m/sn duruş eşiğine yaklaşık **7.9 m** içinde ulaştı; son küçük hız salınımı yaklaşık -0.003 m/sn. Diğer satırlarda 3 saniyelik pencere içinde durma iddiası yoktur. Test çıktısı her satır için gidilen mesafeyi, son batmayı ve direnç kapasitesini de kaydeder.

3 saniyelik stok kalkışı: mud **2.30 km/sa**, snow **2.18 km/sa**, her ikisinde de belirgin arka teker patinajı var. Mud 20 saniye sonunda **11.78 km/sa**; 30/60/144 Hz görüntü güncellemesinde aynı. Önceki motorun aynı 20 saniyelik mud deneyi **44.93 km/sa** idi. Bu değişim önceden motorlu tekerde atlanan yüzey direncini de kapsar.

Ek kuvvet dengesi testi referans araçla mud üzerinde: 5° inişte 5 saniye sonunda **0.0009 m/sn**, yatay yer değiştirme **0.012 m**; 15° inişte **3.869 m/sn**. 60/120 Hz sabit fizik adımı, 3 saniyelik izli coasting: mud **3.835 / 3.839 m/sn**, snow **5.331 / 5.343 m/sn**.

## Doğrulama

- Yeni regresyonlar: saf modelin derinlik/yük bağı, impuls enerji sınırı, motor açık/kapalı ileri/geri karşılaştırması, sonlu eğim eşiği, alan olmadan yeni zemin, sabit adımda izli 30/60/144 Hz karşılaştırması, tek yumuşak aks, yanal kayma, 60/120 Hz fizik adımı.
- Stok GAZ-52 matrisi: 3 yüzey × 3 giriş hızı × 4 eğim × 2 yön × 2 gaz durumu = **144 senaryo**. Her senaryo sayısal sonlu hız ve batma sınırlarıyla kontrol edilir; düz coasting ek olarak sert zeminle karşılaştırılır.
- Nötr yüzeyin kaydedilmiş eski hız eğrisi birebir aynı. Fren/geri, havadaki teker, provider temizleme, patinaj efektleri, kazma, gövde açıklığı, süspansiyon kararlılığı ve izden direksiyonla çıkış regresyonları korunur. Artan fiziksel direnç nedeniyle eski sabit hız alt sınırları ilerleme/kararlılık beklentisine uyarlandı; izden çıkış için daha uzun sürüş süresi tanındı. Gerçek saplanma testi artık duvar yerine yüksek zemin direnci kullanır.
- `npx.cmd tsc --noEmit`: geçti. `npx.cmd tsc --noEmit -p tsconfig.smoke.json`: geçti.
- `npm.cmd run test:engine`: ilk tam uygulama kontrolünde **1877 geçti**. Ek sabit adım regresyonuyla nihai `build:verify` içindeki tam/yavaş motor paketi **1878 geçti**.
- Playwright `terrain-surface.spec.ts`: **1 geçti**, OffroadTest üzerinde nötr/mud/snow, iz, batma ve canlı teker efektleri, konsol hatası olmaması. Yazılım GL ekran görüntüsü görsel kalite kabulü olarak kullanılmadı.
- `npm.cmd run build:verify`: **geçti (exit 0)**. Import sınırları, smoke fixture/type kontrolleri, içerik/UI tipleri, release araçları, üretim build, 1878 motor kontrolü, runtime-only dist ve world-data referans kapıları tamamlandı. İlk yönlendirilmiş PowerShell çalışması beklenen stderr uyarılarını hata durumu olarak raporladı; nihai çalışma cmd altında stdout/stderr birleştirilerek temiz süreç çıkışıyla doğrulandı.
- LandscapeTest mud tarayıcı senaryosu: **geçti**. Stok GAZ-52, gerçek terrain collider'ında dört temas, 0.12–0.19 m batma, motor açıkken yaklaşık **3205 N**, gaz kesildiğinde yaklaşık **3200 N** direnç kapasitesi ve büyüyen iz alanı okundu; konsol/page error yok. Test hostu hızlı girişi tekrarlamak için dünya Z hızını 40 km/sa olarak başlatır; sahnenin eğim/yönüne izdüşen giriş ileri hızı bu denemede **36.33 km/sa** idi. Bu engebeli gerçek sahnede hız kaybı yalnızca zemine atfedilmez; kalibrasyon tablosu yukarıdaki kontrollü Rapier deneyidir.
- LandscapeTest snow tarayıcı senaryosu: **geçti**. Dört temas, 0.17–0.25 m batma, motor açıkken yaklaşık **1864 N**, gaz kesildiğinde yaklaşık **1854 N** direnç kapasitesi, patinaj ve büyüyen iz alanı doğrulandı; konsol/page error yok. Dünya Z hızı 40 km/sa olarak başlatıldığında giriş ileri hızı **36.62 km/sa** okundu. Mud ve snow ayrı çalıştırmalarda birer Playwright testi geçti; OffroadTest ile toplam **3 tarayıcı senaryosu** başarılı.
- `vehicle-soft-ground.spec.ts` / `soft-ground-runtime` sayfası test-only hosttur; üretim API'si eklemez. Başlangıç asfalt spline'ından araziye geçici actor override uygulanır; spawn yüksekliği gerçek tile örneğinden hesaplanır. Katmanların fizik malzemeleri istek üzerinde mud/snow yapılır; kaynak sahne ve terrain dosyaları değiştirilmez. Klavye W, gaz kesme, batma, temas kuvveti ve iz alanı gerçek runtime içinde okunur. Son test hostu için smoke TypeScript kontrolü de geçti.
- Headless ekran görüntüleri incelendi. Araç/zemin çok karanlık göründüğünden görsel batma, malzeme kalitesi veya efekt görünümü bu görüntülerle kabul edilmedi; bu sınır motor/tarayıcı bağlantı testlerinin geçtiği sonucundan ayrıdır.

Kullanıcının LandscapeTest sürüş hissi kabulü ve hedef donanım performansı henüz alınmadı.
