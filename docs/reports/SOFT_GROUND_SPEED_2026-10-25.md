# Mud / snow hızlı giriş ve seyir hızı — 2026-10-25

Kullanıcı hedefi: sert zeminde hızlandıktan sonra mud/snow'a girişte belirgin hız kaybı, gaz kesildiğinde uzun mesafe süzülmeme, bu zeminlerde yaklaşık **10–20 km/sa** sürüş aralığı. Önceki 5° mud kalkış düzeltmesi korunacak.

Başlangıç HEAD: `b14d50e4`. Çalışma ağacındaki World Terrain/Water Body planları, önceki rapor ve authored LandscapeTest/Playground değişiklikleri korunuyor. Bu işte GAZ-52 asset ayarı veya sahne/terrain boyası değiştirilmedi.

## Model

Kalkış ve batma direncine, teker temasındaki **gerçek gövde/zemin göreli teğet hızına** bağlı ek direnç eklendi. Patinaj yapan tekerin görsel dönüş hızına bakılmaz. Böylece duran aracın patinajı yüksek hız direncini tetiklemez.

```text
q = clamp(2 × |teğet hız| / referans hız − 1, 0, 1)
F_hız = teker yükü × yumuşak zemin katılımı × katsayı × q²
```

Referans hız **20/3.6 m/sn**. Ek direnç 10 km/sa'de sıfırdan başlar, 20 km/sa'de tam katsayıya ulaşır. Katsayı mud için **0.65**, snow için **0.55**; diğer presetlerde varsayılan **0**. Daha yüksek giriş hızlarında katsayı sınırlı kalır; mevcut impuls sınırı hareketi tersine çevirmeyi ve enerji eklemeyi önler.

Hız doğrudan kırpılmaz: girilen yüksek hız, kuvvetlerle birkaç saniye içinde düşer. Motor açık/kapalı aynı direnç yolu kullanılır. Alan/iz dokusu olmadan da ilk yumuşak temas çalışır. Karışık zeminde ek direnç yumuşak katılım oranıyla azalır; temas/yük yoksa uygulanmaz. Genel motor modeli ve şanzımanın toplam direnç girdisi aynı kuvveti görür.

`highSpeedResistance` ve `resistanceSpeedMps` built-in preset parametreleridir; save/load şemasına alan eklenmez. Önceki düşük hız rolling/plough eğrileri ve tutunma/patinaj katsayıları korunur. Sand ve nötr zemin yeni hız direnci almaz. Bu bir oyun sürüş kalibrasyonudur; gerçek toprak mekaniği parametreleri değildir.

## Ölçümler

Stok GAZ-52 tanımı ve actor collider'ı, kontrollü Rapier kutu zemini. Eski hesapta düz mud'a **60 km/sa**, gaz kapalı girişin **4. saniyesinde 32.14 km/sa** kalıyordu; yeni kabul testi bu eski sürümde başarısız oldu.

Yeni hesapla düz zeminde:

| Ölçüm | Mud | Snow |
| --- | ---: | ---: |
| Duruştan 25 sn tam gaz, ileri seyir | 11.78 km/sa | 12.15 km/sa |
| Duruştan 25 sn tam gaz, geri seyir büyüklüğü | 11.46 km/sa | 11.50 km/sa |
| 60 km/sa giriş, gaz kapalı: 20 km/sa altına iniş | 1.37 sn | 1.67 sn |
| Aynı girişte duruş mesafesi | 20.54 m | 25.37–25.38 m |
| 60 km/sa giriş, gaz açık: 4 sn sonraki hız | 12.04 km/sa | 12.35 km/sa |
| 60 km/sa giriş, gaz kapalı: 4 sn sonraki hız | 0.02 km/sa | 2.01 km/sa |

Duruş ölçümü `|hız| < 0.05 m/sn` eşiğini kullanır; 6 saniyelik pencerede iki malzeme de bu eşiğe ulaşıyor. İleri/geri ve 30/60/144 Hz görüntü güncellemelerinde sonuçlar tutarlı.

40/60 km/sa giriş × gaz açık/kapalı × düz/5°/10°/15° iniş × iki malzeme = **32 giriş senaryosu**. Her birinde 4 saniye sonundaki hız 20 km/sa altında. Örneğin 60 km/sa ile 15° inişe tam gaz girişte 4 saniye sonra mud **14.53**, snow **16.28 km/sa**. İnişte yerçekimi ile aralık içinde hareket devam edebilir; her yokuşta frensiz duruş iddiası yoktur.

5° yukarı mud yeniden kalkış regresyonu aynı: taze zemin, kalıcı iz alanı, önler 12/arkalar 22 cm eski iz ve giriş–gaz kesme–park–kalkış geçmişi; 30/60/144 Hz. Taze zeminde 8 saniyede **3.463 m**, eski arka izlerde **2.562 m** ilerleme korunuyor. Patinaj devam ediyor.

Bu sonuçlar, önceki [mud kalkış raporundaki](MUD_HILL_LAUNCH_2026-10-25.md) düşük hız kabulünü korur ve eski yüksek hız/coasting ölçümlerini günceller. Derinlik kuvveti testlerinde yeni hız payı kapatılarak iki mekanizmanın ayrı etkisi de sınanır.

## Doğrulama

- Yeni saf model testi: düşük hızın korunması, kademeli ve sınırlı hız direnci, ileri/geri simetri, yarım soft katılım ve yüksüz temasın sıfır kuvveti.
- 32 giriş ve 12 uzun seyir/coasting senaryosu; karşılık gelen yönlerin 30/60/144 Hz hızları karşılaştırılır.
- `npx.cmd tsc --noEmit` ve odaklı hız/5° kalkış regresyonları geçti.
- `npm.cmd run build:verify`: **exit 0**. TypeScript/fixture/içerik/release sözleşmeleri, üretim build, **1905 motor kontrolü**, runtime-only dist ve world-data kapıları geçti.
- LandscapeTest mud/snow Playwright denemesi fixture aşamasında başarısız oldu: mevcut authored level'da `actors[0]` yoktu. Oyun fiziğine ulaşılmadığı için bu deneme fizik başarısızlığı veya başarı kanıtı olarak sayılmadı. Test, GAZ-52'yi yalnızca ağ cevabında kendisi oluşturacak ve yüksekliği kendi izole terrain kopyasından okuyacak şekilde düzeltildi. Kaynak sahneye araç eklenmedi. Bu fixture düzeltmesinden sonra tarayıcı tekrar koşturulmadı; son smoke TypeScript kontrolü ayrıca yapıldı.
- Kullanıcı yeni davranışı kendisi test ederek **“gayet başarılı”** değerlendirmesiyle sürüş hissini kabul etti. Yeni video istenmedi.

Kontrollü kutu zemin sonuçları gerçek LandscapeTest güzergâhının sayısal kabulü değildir. Gösterilen aralık, temaslı stok kamyon ve sınanan eğimler içindir; karma zemin geçişi veya havadaki tekerlere genel bir dünya hız kilidi uygulanmaz. Kamera, motorun bağımsız patinaj devri ve görsel iz şekli bu çalışmada değiştirilmedi.
