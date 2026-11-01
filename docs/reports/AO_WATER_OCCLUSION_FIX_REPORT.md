# Su arkasındaki AO'yu örtme

Tarih: 2026-11-01.

## Kabul edilen basit davranış

Kullanıcı, su altındaki AO'nun kaybolmasını kabul etti; ek render hedefi veya fullscreen geçiş istemedi. Bu karar önceki planın geçirgen su altında AO koruma şartının yerine geçer. Artık su arayüzü, mevcut GTAO normal/derinlik geçişinde katı bir yüzey olarak temsil edilir. Global AO kapatılmaz. Kameraya göre su yüzeyinin arkasındaki nesnenin AO'su örtülür; öndeki veya suyu delen katı geometri normal biçimde kalır. Kamera tamamen su altındayken yüzeyin önünde kalan su altı nesnelerinin AO'su global olarak kapatılmaz.

## Değişiklik

- `lakeWater.ts` ve `riverWater.ts`: yüzey nesnelerine kalıcı `userData.aoWaterSurface` işareti eklenir.
- `postProcess.ts`: depthWrite:false istisnası snapshot'a bağlı `compositedWaterSurface` yerine bu açık yüzey işaretini kullanır. Partiküller, seçim decal'leri, ikonlar ve opt-out nesneler için genel dışlama korunur.
- `aoSurfaceMaterials.ts`: slot normal malzemesi de aynı işareti kullanır. Snapshot olmadan bile su yüzeyi katılır; yüz yönü taşınır. Beauty malzemesi, transparan sıralaması ve `depthWrite:false` değişmez.
- Dalgalı Lake, mevcut dalga normal/depth proxy yolunda kalır; dalga iki kez çizilmez. Düz Lake ve River mevcut normal geçişinde çizilir. Snapshot okuma, MSAA ve reversed-depth kodu değiştirilmedi.

Yeni fullscreen geçiş, tam sahne render'ı veya render target eklenmedi. Daha önce atlanan su yüzeylerinin mevcut normal geçişinde çizilmesi ve bunların mevcut cache'teki normal malzemeleri küçük bir ek maliyettir; sıfır CPU/GPU/bellek maliyeti iddia edilmez. Ek yüksek çözünürlüklü tampon yoktur.

## Regresyonlar

`tests/smoke/fixtures/ao-water.{html,ts}` gerçek LakeWaterObject ve RiverWaterObject oluşturur; authored içerik kullanmaz. Gerçek ForgeGtaoPass ile normal, derinlik ve ham AO çıktıları okunur.

Matris: düz Lake / dalgalı Lake / River × üst/alt bakış × snapshot işareti açık/kapalı = 12 durum. Su arkasındaki kutu kaldırılınca orta 80×80 alandaki normal/depth/AO piksel farkı sıfır olmalıdır. Kutu yüzeyi delince derinlik farkı sıfırdan büyük olmalıdır; böylece görünen katı nesnenin silinmediği kontrol edilir. Eski fallback davranışını temsil eden yüzey işaretinin kapatılması normal çıktısını değiştirmelidir. Beauty depthWrite ve visibility restorasyonu da kontrol edilir.

Bu test doğrudan AO geçişini çalıştırır; su beauty shader'ını veya snapshot üretimini çalıştırmaz. Snapshot bayrağı matrisi bu bağımlılığın kalktığını doğrular; gerçek samples:4 kaynakla MSAA/refraction entegrasyonu veya reversed-depth görsel kabulü yerine geçmez. İlk protrusion denemesinde düz kutu üstü ile düz su aynı normal verdiğinden normal karşılaştırması ayırt edici değildi; test derinlik karşılaştırmasına düzeltildi, kontrol kaldırılmadı.

`tools/engine-tests.ts`: snapshot açık/kapalı aynı AO katılımı; beauty materyal kimliği, opacity ve depthWrite korunması; işaretsiz blend slotun dışarıda kalması.

Çalışma dizini `/workspace/Forge`:

```sh
npx tsc --noEmit
npm run test:engine
npm run build:verify
npx playwright test --config .dev-server/playwright.cloud.config.ts ao-water.spec.ts
```

Yerel cloud config sistem Chromium'u ve SwiftShader kullanır. Tam GPU performansı, kullanıcının gerçek sahnesi, shoreline/foam/çoklu su katmanı renk görüntüleri, MSAA ve reversed-depth görsel kabulü yapılmadı. RTX 3060 performans iddiası yoktur. Toplam engine ve gate sonuçları son doğrulama kaydında aşağıda belirtilir.

Tanı görüntüleri: [düz Lake](images/ao-surface-occlusion/water-flat-normal.png), [dalgalı Lake](images/ao-surface-occlusion/water-wave-normal.png), [River](images/ao-surface-occlusion/water-river-normal.png). Bunlar su AO normal çıktılarıdır, beauty görüntüleri değildir.

## Son doğrulama

- `npx tsc --noEmit`: geçti.
- `npm run test:engine`: 2188 kontrol geçti.
- `npm run build:verify`: geçti (exit 0); smoke fixture türleri/testleri, üretim build'i, slow engine testleri, strict dist ve world-data dahil.
- Odaklı Playwright: 12/12 geçti; suyu delen geometri için derinlik kontrolü dahil.
- `git diff --check`: temiz. Bu takip çalışmasında commit veya push yapılmadı.

## Sonradan bildirilen siyah River — bilinen açık sorun

Kullanıcı siyah River yüzeyini bildirdi. Gerçek Terrain sahnesinde yeniden üretildi; AO geçici kapatılınca renkli su görünür. İzole River beauty testi snapshot/fallback ve gölge/çevre yansımasıyla renkli sonuç verirken, ham AO merkezi sıfır çıkıyor. River render geometrisinde `normal` attribute'u bulunmaması normal override için güçlü adaydır; henüz düzeltme uygulanmadı. Yukarıdaki 12 test gizli nesne izi ve görünür geometri kapsamını kontrol eder; tamamen siyah AO'yu dışlamaz. Kullanıcı siyah nehir düzeltmesini yerelde yapmayı seçti ve mevcut AO değişikliklerinin push edilmesini istedi. Bu teslim siyah River sorununu çözmüş sayılmaz.
