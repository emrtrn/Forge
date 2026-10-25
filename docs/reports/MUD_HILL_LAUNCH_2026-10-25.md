# Çamurda hafif eğimde yeniden kalkış — 2026-10-25

Başlangıç: `main`, `493f45e2`; çalışma ağacı temizdi. Kullanıcının `4.mp4` kaydı, çamurda hareket hâlindeki direncin mevcut olduğunu fakat kalkış kuvvet payının çok dar kaldığını gösterdi. Stok GAZ-52, standart actor collider'ı ve kontrollü Rapier zeminiyle 5° yukarı eğimde sorun yeniden üretildi: 8 saniye gaz sonunda hız yaklaşık **0 m/sn**, yer değiştirme **0.15 m**; son aktarılan itki **3951 N**, teker direnç kapasitesi **3317 N** idi. Yerçekimi ayrıca karşı koyuyordu.

## Değişiklik

Eski mud hesabı, gömülü tekerde hız sıfıra yakınken de `0.12 × yük` yuvarlanma direncini tam uyguluyordu. Derinlik katkısı `0.05 × yük × batma/yarıçap` ile zayıf kalıyordu.

Yeni mud eğrisi:

```text
r = clamp(batma / yarıçap, 0, 1)
F = yük × [0.12 × min(|teğet hız| / 1 m/sn, 1) + 0.30 × r²]
```

Yuvarlanma payı duruşta sıfırdan başlayıp 1 m/sn'de tam değerine ulaşır. Derinlik payı duruşta da vardır; gaz açılması hiçbir payı kaldırmaz. Yeni davranış gaz, vites veya araç adına bakmaz. Bağımsız temas impulsu, enerji/hareket tersine çevirme sınırı, tutunma katsayısı, teker patinajı, süspansiyon batması, gövde oturma direnci ve şanzıman algoritması korunur.

`ploughExponent` ve `rollingResistanceAtRest` built-in fizik malzemesi parametreleridir. Varsayılanları 1 olduğu için snow ve sand'ın önceki kuvvet eğrileri korunur. Mud bunları 2 ve 0 kullanır. Parametreler mesh/collider ve terrain katman karışımlarından aynı biçimde aktarılır; yeni kalıcı sahne/save alanı yoktur. GAZ-52 asset ayarları, authored terrain, kamera veya UI değiştirilmedi.

Örnek hesap (2500 kg, 0.537 m yarıçap, tüm tekerler aynı derinlikte, toplam yük yaklaşık ağırlık):

| Batma | Eski direnç, duruş ve >1 m/sn | Yeni duruş direnci | Yeni >1 m/sn direnci |
| --- | ---: | ---: | ---: |
| 11 cm | 3.19 kN | 0.31 kN | 3.25 kN |
| 22 cm | 3.45 kN | 1.23 kN | 4.18 kN |

Bu sayılar oyun modelinin kalibrasyonudur; gerçek toprak mekaniği ölçümü değildir. Hızlı girişteki direnç korunurken derinliğin etkisi güçlenir. Yeni statik eşik, eski tam yuvarlanma payından düşüktür: fren tutulmadan bir eğimde kalma garantisi yoktur. Yerçekimi mevcut statik direnci aşarsa yuvarlanma başlayabilir; kalkış testi el freniyle park ettikten sonra freni bırakıp gaz vererek yapılır.

## Kalkış ölçümleri

Stok kamyon, 5° yukarı eğim, 3 saniye el freniyle park, ardından 8 saniye tam gaz. Aynı deneyler 30/60/144 Hz görüntü güncellemesinde aynı sonuçları verdi.

| Durum | Son hız | İleri mesafe |
| --- | ---: | ---: |
| Alan/modül olmadan taze zemin | 0.477 m/sn — 1.72 km/sa | 3.463 m |
| Sabit adımlı kalıcı iz alanı | 0.449 m/sn — 1.62 km/sa | 3.189 m |
| Önler 12 cm, arkalar 22 cm eski iz | 0.346 m/sn — 1.25 km/sa | 2.562 m |
| 20 km/sa giriş, gaz kesme, park ve yeniden kalkış | 0.352 m/sn — 1.27 km/sa | 2.761 m |

Her durumda arka teker patinajı devam ediyor. Motor gücü veya tutunma katsayısı artırılmadı; tekerlerin gerçek aktarabildiği kuvvet yaklaşık 3.7–4.0 kN aralığında kaldı.

Şanzıman tork kesintilerinden ayrı bir düz kuvvetli referans araçla, 40 km/sa giriş ve 3 saniye sonundaki derinlik karşılaştırması:

| Girdi | 8 cm iz | 22 cm iz |
| --- | ---: | ---: |
| Gaz kesilmiş | 13.65 km/sa | 5.80 km/sa |
| Gaz açık | 31.90 km/sa | 23.81 km/sa |

Stok kamyonun düz mud kalkışı 3 saniyede **4.60 km/sa**, 20 saniyede **12.45 km/sa**; 30/60/144 Hz aynı. Snow'un 3 saniyelik kalkışı önceki gibi **2.18 km/sa**. Stok 40 km/sa düz mud coasting senaryosu 3 saniye sonunda **19.71 km/sa**; eski eğri **19.53 km/sa** idi. Hızlı giriş direnci belirgin biçimde hafifletilmedi.

## Doğrulama ve sınırlar

- Saf kuvvet modeli: mud'da derinlik iki katına çıkınca statik yarma payı dört katına çıkıyor; yuvarlanma hıza kademeli bağlanıyor. Snow/sand eski kuvvet değerleri korunuyor; nötr hız eğrisi birebir aynı.
- Stok 5° kalkış: 4 zemin/iz geçmişi × 3 görüntü frekansı = 12 senaryo. Her birinde ileri hız/mesafe ve patinaj kontrol edilir.
- Mevcut 144 giriş hızı/eğim/gaz/yön matrisi; gaz açık/kapalı derinlik karşılaştırmaları; 60/120 Hz fizik adımı; fren/geri, gövde açıklığı, süspansiyon, yüksek dirençli bağımsız presetle saplanma/kazma, izden direksiyonla çıkış regresyonları korunur.
- Statik kuvvet eşiği testi yeni mud kalibrasyonuna göre 1° tutunma ve 15° serbest yuvarlanmayı karşılaştırır. Eski 5° frensiz sabit duruş beklentisi bir kabul koşulu olarak taşınmadı.
- `npx.cmd tsc --noEmit`: geçti. `npm.cmd run build:verify`: **exit 0**. TypeScript/fixture/içerik/release sözleşmeleri, üretim build, **1883 motor kontrolü**, runtime-only dist ve world-data kapıları geçti.
- İlk LandscapeTest mud Playwright denemesi, gaz kesme sonrası duruşa yakın **414 N** kapasite okudu ve eski `>500 N` beklentisine takıldı. Yeni kalibrasyonda tam yuvarlanma payının duruşta kaldırılması amaçlandığından bu koşul mud için `>100 N` sonlu zemin direnci sınırına uyarlandı; snow'un koşulu korunur. Motor açık durumdaki direnç, batma ve iz kontrolleri korunur.
- Nihai Playwright `vehicle-soft-ground.spec.ts --grep mud`: **1 geçti**. Gerçek LandscapeTest runtime'ında dört terrain teması, arka tekerlerde yaklaşık %56–59 patinaj, motor açık durumda yaklaşık **2911 N** kapasite; gaz kesilip duruşa yaklaşınca yaklaşık **414 N** sonlu kapasite ve 940 aktif iz hücresi okundu. Console/page error yok. Sahne testi hızlı giriş/gaz kesme bağlantısını doğrular; 5° kalkış ölçümü kontrollü Rapier deneyidir.
- Son smoke TypeScript kontrolü ve `git diff --check` geçti. Headless ekran görüntüsü incelendi; önceki karanlık 3B sahne görünümü sürüyor, görsel kalite kabulü olarak kullanılmadı. Yeni branch/commit/push yapılmadı.
- Teslim sırasında paralel gölge commitleri (`c478a116`, `9c66a7d4`, `b14d50e4`) ve authored LandscapeTest/Playground değişiklikleri görüldü. Mud eğrisi ve regresyonları güncel dosyalarda korunuyor. Yukarıdaki tam build sonucu bu fizik çalışmasının doğrulama anına aittir; daha sonra gelen bağımsız gölge/sahne değişiklikleri için yeni bir tam gate iddiası değildir. Bu paralel çalışmalara müdahale edilmedi.

Kontrollü motor testi, kullanıcının LandscapeTest güzergâhındaki sürüş hissinin kabulü değildir. Arazinin gerçek eğimi, iz derinliği ve teker yük dağılımı farklı olabilir. Kullanıcı aynı noktada panel açıkken deneyebilir; hâlâ kalkamama varsa o noktadaki kısa kayıt sonraki teşhise doğrudan veri sağlar. Motorun patinajla bağımsız devir yükseltmesi bu çalışmanın kapsamına alınmadı.
