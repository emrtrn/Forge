# Forge Water — ilk nehir optik prototipi

Sonraki çalışma: [LandscapeTest gerçek sahne/GPU incelemesi](WATER_LANDSCAPE_REVIEW.md) tamamlandı; [kaydırmalı görüntü karşılaştırması](WATER_LANDSCAPE_REVIEW.html). Aşağıdaki kayıt ilk prototip oturumunun sonuçlarını korur.

Tarih: 26 Ekim 2026. Başlangıç: `main`, HEAD `6486120bb178e3bf98871c8aa8912c2826354ca2`.
Kullanıcının “Önerilen ilk adımla başla” talebiyle kontrollü test sahnesi ve sınırlı nehir shader prototipi uygulandı. Bu, bütün Water v2 sisteminin veya Faz 1'in nihai görsel/performance kabulü değildir.

## Değişiklik

- `tests/smoke/pages/river-water-optics.html` / `.ts`: gerçek `RiverWaterObject`, üretilmiş kareli yatak, sabit saat ve sabit linear kırmızı/mavi reflection girdisi. Sahne dosyası yüklenmez veya kaydedilmez. Perspektif/ortografik kamera, iki output yolu ve üst/alt açı kontrol edilir.
- `tests/smoke/river-water-optics.spec.ts`: piksel/kontrast ölçümleri, gerçek form etkileşimleri, animasyon, kaynak sayısının rebuild sırasında sabit kalması, eğimli ve taşınıp döndürülmüş nesne kontrolü. Shader metni veya matematiğinin kopyası test sonucu olarak kullanılmaz.
- `engine/render-three/riverWater.ts`: dünya uzayında türev normal, akışa göre normal-map eksenleri, Schlick Fresnel (`F0=0.02`), su altından eski planar görüntüyü kullanmayan fallback. Derin şerit kenarı sığ renge zorlanmaz; kıyı köpüğü sığ terrain temasıyla sınırlanır. Nehir ve point-stamp foam shader'larına tone/output chunk'ları eklenir.
- Derinlikten geçirgenliğe geçiş ilk 35 cm'de yumuşatılır. Eğik bakışta düşey terrain derinliği sınırlı bir yol uzunluğu yaklaşımına çevrilir; cosine alt sınırı `0.12` olur. Bu iki değer prototip sabitidir. Özellikle ilk 35 cm'de `bedVisibility=0` dahil opak preset'lerin kenarı artık yumuşar; sanat kabulünde bu değişiklik incelenmelidir.
- `tests/engine/terrainRiverWater.test.ts`: eğim/dönüşüm, depth/flow attribute'ları, point stamp konumu, kaynak verisinin değişmemesi ve geometry/material dispose regresyonu.
- `engine/scene/riverWater.ts`: yalnız reflection varsayılanını açıklayan eski depth yorumu düzeltildi; varsayılan sayılar değişmedi.

Güncel motor, Faz 0 belgesinden sonra spline Y eğimini izlemeye başlamıştı. Bu çalışma onu korur; nehir tekrar sabit kota zorlanmadı. Göl, terrain filmi, validator, kayıt şeması, endpoint, authored level/terrain ve UI kaynakları bu çalışma tarafından değiştirilmedi. Başlangıçta dirty olan editor/UI/smoke dosyaları ayrı çalışmadır. Branch, commit veya push oluşturulmadı.

## Önce başarısız, sonra geçen ölçüm

Eski shader ile ilk koşuda **4 başarısız / 1 başarılı** sonuç alındı. Prototipten sonra ilave dünya uzayı testiyle **6/6 başarılı**. Sayılar 8-bit ekrandan alınan çoklu 3×3 probe ortalamalarıdır; fiziksel yansıma katsayısı veya GPU süresi değildir. [Ham karşılaştırma](evidence/optics-comparison.json).

| Kontrol | Eski | Prototip |
|---|---:|---:|
| Üstten kırmızı/mavi reflection sinyali | 56.06 | 2.06 |
| Yatay açıya yakın reflection sinyali | 56.02 | 85.28 |
| Alt kamerada reflection sinyali | 56.06 | 0 |
| Nötr direct/composer farkı, exposure 0.2 | 5.67 | 0.06 |
| Nötr direct/composer farkı, exposure 1 | 83.22 | 0 |
| Varsayılan preset, 0.1 m yatak kontrastı | 7 | 91.67 |
| 5 m derinlikte kenar/merkez renk farkı | 34.30 | 0 |

Clear-water profilinde (`bedVisibility=1`, `absorptionDistance=2`, `opacity=0`) 0 / 0.1 / 1 / 2.2 / 5 m derinlikte kontrast monoton azalır: yaklaşık 125 / 121 / 88 / 59 / 20. Bu profilin monotonluğu eski shader'da da vardı; yeni kazanım diye sayılmaz. Kuru terrain'de su çizilmemesi korunur. Default preset'in sığlık kazanımı ayrı ölçülür.

Renk karşılaştırması, dönüşümü alpha blend farkından ayırmak için **opak nötr su** kullanır. Transparan nesneler canvas'ta ve linear composer target'ında farklı uzayda blend edilir; tüm transparan sahnelerin birebir renk eşitliği iddia edilmez. Exposure `0.2` bir ışık düzeltmesi olarak değiştirilmedi; `1` ayrıca kontrol edildi.

İlk red koşusunda form seçimleri API ile sahne değişince eşitlenmiyordu; JSON ve alt durum satırı gerçek koşulu gösterir. Green koşusunda form da eşitlenir. Bu fixture düzeltmesi kamera ve probe koordinatlarını değiştirmedi.

## Doğrulama ve görsel inceleme

| Kapı | Sonuç / kayıt |
|---|---|
| `npx.cmd tsc --noEmit` | Geçti |
| Smoke TypeScript | Tam `build:verify` içindeki `verify:smoke-fixtures` geçti |
| `npm.cmd run test:engine` | **1.973 kontrol geçti**; [log](evidence/optics-engine-tests.log) |
| Yeni optik browser paketi | **6/6**; [log](evidence/optics-smoke.log), [JSON/PNG](evidence/optics-green/) |
| Mevcut çoklu tile nehir editor/runtime | **2/2**, spline Y, undo/redo, Save/Reload, sculpt depth, flow/foam ve runtime; [log](evidence/optics-editor-smoke.log) |
| `npm.cmd run build:verify` | Geçti; slow engine, strict dist ve world-data dahil; [log](evidence/optics-build-verify.log) |

İlk sandbox çalışması Vite/esbuild erişim engeliyle durdu; izinli çalışma kullanıldı. Fixture eklenirken bir TypeScript tuple hatası düzeltildi ve tam gate yeniden çalıştırıldı. Bu başarısız denemeler geçiş sayılmadı. Etkileşimli REPL'deki Playwright import'u araç hatası verdi; repo'nun mevcut Playwright runner'ı kullanıldı.

Görsel inceleme: üstten/yatay/alt yansıma, sığ/derin yatak, nötr çıkış, eğimli perspektif/ortografik görünüm ve 600 px genişlikte form/canvas. Kontroller sığıyor; incelenen durumlarda clipping, yatay taşma, konsol/shader hatası yok. Off→reflection→Off, camera/pipeline/depth ve water visibility dönüşleri normal form girdisiyle doğrulandı. Son kıyı koşusu ayrıca aktif dalga fazında (`time=2`) deep edge ve default-shallow PNG'sini kaydeder: [kıyı kanıtı](evidence/optics-shore-review/).

## Açık kabul sınırı

- Browser hâlâ **ANGLE / Vulkan SwiftShader**; `EXT_disjoint_timer_query_webgl2` yok. Donanım GPU delta, FPS hedefi ve gerçek donanım performansı doğrulanmadı.
- Sabit reflection girdisi shader davranışını izole eder; tüm planar capture/sorting/çoklu su grubu senaryolarının görsel kabulü değildir. Yeni reflection RT, environment fallback, refraction pass veya ortak water coordinator eklenmedi.
- Düşey terrain depth, bağımsız su altı mesh'lerini ölçmez. Sualtı optiği, scene-light BRDF/fog ve fiziksel refraction bu prototipte çözülmedi.
- Kaynak IMG kameralarıyla birebir eşleşme ve LandscapeTest üzerinde nihai sanat kabulü açık. Fixture'ın koyu derin suyu mevcut palette ve sabit exposure ile test girdisidir; fotogerçekçilik kabulü değildir.
- Faz 0'daki legacy migration timeout ve streamed retry bulgusu bu çalışma kapsamına alınmadı; kapanmış sayılmaz.

Sonraki karar: mevcut LandscapeTest nehrini aynı kamera/ışıkta kullanıcıyla görsel değerlendirmek ve donanım GPU A/B ölçümünü tamamlamak. Bu kapılar sağlanmadan bütün Faz 1 tamamlandı olarak işaretlenmemeli.
