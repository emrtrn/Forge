# R4 — Lake/River dalga tepesi köpüğü ve kalite entegrasyonu

Tarih: 30 Ekim 2026. Ana kapsam: [Water System §7.1 R4](../planned/WATER_SYSTEM_DEVELOPMENT_PLAN.md).

> **Sonraki değişiklik (aynı gün):** Aşağıdaki “göreli yükseklik” eşiği ve
> value-noise lekeleri [RDR2 görünüm çalışmasında](WATER_RDR2_LOOK_2026-10-30.md)
> dalga dikliği eşiğiyle ve yeni köpük dokusuyla değiştirildi. Alanlar ve
> varsayılanlar aynı; `crestFoamThreshold` artık dikliği (0→0,02 … 1→0,12) ifade eder.

## Uygulama

Kullanıcının görsel referansındaki yükselen su üzerinde parçalı beyaz köpük,
Lake ve River'ın **çizilen geometrik dalga yüksekliğine** bağlandı. Dünya Y kotu,
güneş parlaması veya yalnız normal dokusunun parlaklığı köpük kaynağı değildir.
Vertex dalga yer değiştirmesi ve genliği fragment'e taşınır; pozitif tepe eşiği,
iki ölçekli parçalanma, küçük genlik ve sığ/kuru kıyı sönümü ortak yardımcıdadır.
Geometrik dalgalar kapalıysa tepe köpüğü sıfırdır; mevcut rapid/kıyı/engel köpüğü
ayrı kalır. Yeni dalga modeli, draw/capture, render target veya runtime bake yoktur.

Lake/River **Wave Crest Foam** kontrolleri:

| Alan | Varsayılan | Aralık |
| --- | --- | --- |
| Enabled / `crestFoamEnabled` | true | boolean |
| Strength / `crestFoamStrength` | 0,75 | 0–1 |
| Threshold / `crestFoamThreshold` | 0,35 | 0–1 |

Lake için appearance, River için gövde alanlarıdır. Eksik alanlar eski kayda
otomatik eklenmez; çalışma zamanı varsayılanı uygulanır. Açıkça false kayıtlı
tercih kalite yükseldiğinde açılmaz. UI İngilizce, açıklamalar Türkçedir.
River'ın mevcut Foam Opacity çarpanı tepe köpüğüne de uygulanır. Lake'te yeni
kontrol Shore Foam aç/kapatından bağımsızdır. Surface Waves kapalıysa Lake'te
Enabled açık görünse bile tepe köpüğü oluşmaz.

Renk ve ışık mevcut ortak `WaterFoamMaterial` üzerinden gelir; Lake'in kabul
edilmiş taban rengi veya sahne ışığı değiştirilmedi. River köpük ışığı, mevcut
sürekli vertex normalini kullanır; kırılmanın gerçek üçgen normali korunur.

## Kalite ve kaynaklar

| Efekt | Low | Medium | High / Ultra |
| --- | --- | --- | --- |
| Köpük ve tepe köpüğü | kapalı | authored izinle | authored izinle |
| Caustics | kapalı | kapalı | authored izinle |
| Islak kıyı | kapalı | authored izinle | authored izinle |
| R3 kırılması | kapalı | kapalı | mevcut authored ayrıntı/strength sınırlarıyla |

Editör, runtime ve adaptif değişimler aynı River `applyQuality` yolunu kullanır.
Low'da kıyı maskesi, bake GPU dokusu ve ortak köpük malzemesi tüketicisi bırakılır;
geometri, kayıtlı ayarlar ve editörün pending/undo bake verisi korunur. Yeniden
yükseltmede mevcut manifest okunur; yeniden hesaplama yapılmaz. Geç yüklemeler
revision/dispose kontrolüyle GPU tüketicisini canlandıramaz. Toplam 32 MiB bake
GPU bütçesi tahsisten hemen önce de kontrol edilir. Kalite kapandıktan sonra
tamamlanan okumalar loaded cache'i bırakır; pending kayıt verisi silinmez.

R2 dip optiğinin kullandığı ortak snapshot, kırılma kapandı diye bırakılmaz.
R3 atlas kapısı ve diğer su tüketicilerinin kaynak sahipliği korunur.

## Doğrulama ve kabul sınırı

İlk tam `build:verify` koşusu eski River varsayılan nesnesini bekleyen teste
takıldı; yeni üç alan beklentiye eklendi. Sonraki tam kapı geçti: **2171 engine
kontrolü**, tür/fixture/import/build/runtime-only dist ve dünya verisi kontrolü.
Son küçük cache/kapalı shader işi düzenlemeleri için son kaynak kontrolleri ve
birleşik browser sonucu aşağıdaki teslim kaydında ayrıca belirtilir.

Son kaynakta `npm run build` (TypeScript dahil), strict `verify:dist`, smoke
fixture ve UI test tür kontrolleri ayrıca geçti. Geniş browser koşusunda
`Lake quality menu ... updates live Play` testi, `Ultra` kalite düğmesine
tıklarken görünürlük/kararlılık beklemesinde 300 saniye timeout aldı. Bu kontrol
başarılı değildir; render/kayıt assertion hatası olarak da sınıflandırılmaz.
Editör kalite geçiş görüntüleri oluştu; bütün canlı Play menüsü kabulü açık kaldı.

Birleşik koşu: **32/33 başarılı**. Tek başarısızlık yukarıdaki kalite menüsü
timeout'udur. Lake yeni tepe köpüğü kontrolleri ve River genişletilmiş
undo/Save/Reload/runtime akışı, mevcut otomatik engel bake/caustics akışı,
Lake/River ortak doku sahipliği ve geç/missing doku fallback'leri geçti.
[Koşu özeti](evidence/water-r4-crest/browser-regression-summary.log).

Son iki yeni kontrol, kesilmemiş viewport ve görünür kontrol paneliyle ayrıca
**2/2 geçti**; sıfır yoğunluk, kapalı dalga ve yüksek eşik durumları dahil.
[Son dar koşu](evidence/water-r4-crest/final-focused-summary.log),
[Lake kontrol paneli](evidence/water-r4-crest/lake-crest-controls.png).

Yeni izole WebGL kontrolü Lake/River için tepe maskesinin yükselmeyle eşleşmesini,
çukurlarda sıfır köpüğü, dalga kapalı fallback'i, eşik/yoğunluk/aç-kapat ve kalite
kontrollerini sınar. Gündüz, gölge, gece ve uzak görüntüler kaydedilir. Gece
köpük güneş/ambient girdileri sıfırdır. Lake'in doğrudan şeffaf render yolunda
alpha/output transfer birleşimi küçük pozitif piksel farkı verebildiğinden
tam görüntü karşılaştırması mevcut shore köpük kontrolü gibi ortalama gündüz/gece
farkına bakar; her pikselde aynı/azalan RGB iddiası yapılmaz.

Engine regresyonu gerçek bake verisiyle Low→High→Low döngülerini, geometri/veri
korunmasını, authored Off ve dispose sonrası geç yüklemeyi sınar. Browser
regresyonlarında iki suyun ortak malzeme tüketiciliği, mevcut R2/R3 optiği ve
gerçek editör kayıt/undo/runtime akışları kapsanır.

Kanıtlar: [Lake gündüz](evidence/water-r4-crest/lake-crest-day.png),
[River gündüz](evidence/water-r4-crest/river-crest-day.png),
[Lake gölge](evidence/water-r4-crest/lake-crest-shadow.png),
[River gölge](evidence/water-r4-crest/river-crest-shadow.png).

Bu kanıtlar izole fixture içindir. Kullanıcının kendi sahnesinde sanatsal kabul,
gerçek GPU maliyeti, production tarayıcı ve level travel'ın kapsamlı kabulü açık
kalır. Bu çalışma authored sahne, terrain/tile, ışık veya post-process dosyası
düzenlemedi. Son kontrolde çalışma ağacında ayrıca `Terrain.level.json`
değişikliği görüldü; R4 kod kapsamının dışındadır ve dokunulmadan bırakıldı.
Codex Security diff incelemesi önerildi; kullanıcı başlatmadığı için tarama yoktur.
