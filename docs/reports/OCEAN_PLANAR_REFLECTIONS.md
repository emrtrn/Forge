# Ocean — ortak planar yansıma

O4'ün ikinci parçası. [İlk optik bağlantısı](OCEAN_SHARED_OPTICS.md) ve
[ana plan](../planned/OCEAN_DEVELOPMENT_PLAN.md) üzerine devam eder.

## Davranış ve sahiplik

Ocean Details → Reflections altında Off, Environment ve Planar bulunur.
Environment eski Ocean görünümünü koruyan varsayılandır. Reflection Strength,
Reflection Group ve Medium/High kalitesi kaydedilir; loader/save aynı allowlist'i
kullanır. Grafik kalite profili üst sınırdır: Off tavanı environment'a döner,
Medium tavanı authored High ayarını Medium capture ile çizer. Kaydedilen tercih
değiştirilmez. Grup/kot/etkin kalite aynıysa mevcut Lake/River registry kaynağı
paylaşılır; Ocean için ayrı bir capture sistemi eklenmez.

Yüzey capture dokusunu ve matrisini ödünç alır. Controller'ın sunumu registry'de
bir lease tutar. Hide, Off/Environment, sıfır reflection strength, kalite düşüşü,
silme ve level kapanışında bu referans bırakılır. Diğer su yüzeyleri tutuyorsa
paylaşılan kaynak yaşamaya devam eder. Renk, yansıma, isim, lock/hidden ve
grafik kalitesi değişiklikleri terrain veya FFT'yi yeniden üretmez. Kot, kapsam,
terrain veya dalga parametreleri değişirse mevcut hazırlık/yenileme yolu kullanılır.

Yansıma aynı dalga ile yer değiştirmiş world-space noktadan örneklenir. Dokuz
örnekli roughness filtresi premultiplied geometri coverage'ını korur; boş/kenar
örnekleri environment/probe'a döner. Capture mevcut ortak kaynağın interval,
screen coverage, mirror kamera ve state restorasyonu kurallarını kullanır.
Ocean'ın coverage sınırı CPU grid'inin origin konumundan değil, ana kamera ile
taşınan world-space clipmap'ten hesaplanır. Mirror ve AO/DoF çizimleri FFT
saatini, texture update sayısını veya ana kamera anchor'ını değiştirmez.

Native SwiftShader doğrulamasında iç vertekslerin de dört gereksiz coarse-ring
örneği hesapladığı görüldü. Coarse hesap artık yalnız `edgeBlend > 0` noktalarında
yapılır; b-c kenar interpolasyonu değişmez. Varsayılan grid'in 23.809 kullanılan
tekil verteksinin 6.832'si morph kenarındadır. Bu verteksler üzerinden
`shallowDisplacement` çağrı hesabı 119.045'ten 51.137'ye iner (%57). Bu statik
iş hesabıdır; GPU süre/FPS kazanımı olarak yorumlanmaz.

## Doğrulama

İki yeni engine kontrolü coplanar paylaşımı, başarısız binding cleanup'ını,
kalite/hidden release'lerini, son lease sahipliğini ve optik değişikliklerin
FFT'yi korumasını sınar. Mevcut save/read/partition/drop ve hatalı veri testleri
yeni alanları da içerir. Surface kontrolü uzak dünya konumundaki coverage
sınırını ve kaynak bağlama/ayırma durumunu denetler.

GPU testi, kamerayı X=10.000 m'ye taşır ve su üstündeki kırmızı nesnenin
yansımasını alt ekran bölgesinde ölçer. Su rengi, ortam ışığı, köpük ve ölçüm
sırasında sis devreden çıkarılarak kırmızı katkının planar capture'dan geldiği
ayrılır. Gerçek sahnenin sisi ve ışığı korunur. Medium/High/ceiling geçişleri,
Off/Environment dönüşü, kaynak sayıları ve sabit FFT saati kontrol edilir.
Native smoke gerçek editörde seçimi, undo/redo, diskte Save, Reload ve Play
yolunda aynı authored ayarları kullanır.

| Kontrol | Sonuç |
|---|---|
| TypeScript + smoke type-check | Başarılı |
| `npm run build:verify` | Başarılı; 2.585 motor kontrolü ve import/build/dist/world-data kapıları |
| `npm run check:assets` | Başarılı; 0 hata, baseline içindeki 6 bilinen uyarı |
| Ocean engine kontrolleri | 14 başarılı; paylaşım, hot update, veri, lifecycle, terrain ve LOD |
| `ocean-planar.spec.ts` | Başarılı; uzak anchor, gerçek kırmızı capture, High/Medium/Off ve bellek/saat kontrolleri |
| `ocean-reference.spec.ts` | Başarılı; mevcut optik, depth/normal, rebuild ve pause/resume regresyonu |
| `ocean-editor.spec.ts` | Başarılı; 5,8 dakika, Save/Reload/Play ve yeni yansıma alanları |

Chromium `/usr/bin/chromium` ve SwiftShader kullanıldı. Native testte bu
executable seçiliyken rAF çağrıları arasına 250 ms boşluk konur; callback/cancel
ve gerçek FFT/planar çizimi korunur. Ekran görüntülerinden önce iki gerçek
render frame'i beklenir. DOM trace açık, sürekli trace filmstrip'i kapalıdır;
explicit editör/runtime görüntüleri alınır. Bu düzen yalnız test context'indedir,
üretim döngüsünü değiştirmez ve FPS/GPU kabulü olarak kullanılmaz. Native
senaryo genişlediği için yazılımsal GPU toplam timeout'u 10 dakikadır. Optik
testinin cold rebuild sonrası ilk FFT frame'i 60 saniyeye kadar beklenir.

Aynı kamera ve donmuş FFT karesi: [Planar](images/ocean-planar/planar.png),
[Environment](images/ocean-planar/environment.png). Kırmızı nesne yansımanın
nedensel kontrol hedefidir; bu bir içerik/tekne veya nihai köpük görsel kabulü değildir.

## Açık kabul

Bu parça O4'ün tamamını kapatmaz. SSR karşılaştırması, caustics, ortam
profillerinin görsel değerlendirmesi, kıyı/sığ dip offshore sürekliliği ve hedef
GPU'da süre/bellek bütçesi açıktır. İlk crest köpüğü O5'in üç katmanlı sistemi
yerine geçmez. Önceden ölçülen production paket boyutu engeli ayrı kayıtta
izlenir: [bütçe karşılaştırması](OCEAN_RELEASE_BUDGET_CHECK.md).
