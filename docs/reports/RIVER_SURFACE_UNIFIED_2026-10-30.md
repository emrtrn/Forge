# River — Tek yüzey ve manuel köpük test temizliği

Tarih: 30 Ekim 2026. Kullanıcı kararı: Deneme haritasındaki iki nehir stilini
birleştir; elle yerleştirilen köpüğe ait eski testleri kaldır.

## Son davranış

- Bütün River'lar R1 mikro yüzey/yansıma/güneş ve R2 dip optiği/kıyı yolunu
  kullanır. Legacy shader dalları ve profil makrosu kaldırıldı.
- Editörde Surface Style seçimi yoktur. Surface Strength ve Surface Roughness
  doğrudan kullanılabilir. Bu sayısal kontrollerin aralıkları ve ortak runtime/
  save doğrulaması korunur.
- `surfaceStyle` layout, resolver, editör görünümü/patch ve save allowlist'ten
  kaldırıldı. Eski JSON'da kalmışsa görünümü etkilemez; bir sonraki doğrulanmış
  kayıtta bilinmeyen alan olarak çıkar. Terrain örneğinden yalnız stil alanı
  temizlendi; kullanıcıya ait diğer sahne ayarları korunur.
- Snapshot desteklenmediğinde R2'nin güvenli şeffaf optik fallback'i sürer.
  Bu teknik fallback ayrı bir sanatsal stil veya kullanıcı seçimi değildir.

## Test temizliği

- Eski manuel halka/şerit yerleştirme, seri hale getirme, taşıma ve emekliye
  ayrılmış elle temas kaynağı kontrolleri kaldırıldı. Ortak geometri/terrain
  testleri manuel köpük örnekleri olmadan devam eder.
- Optik fixture'dan pointFoam/baselineFoam, çocuk halka shader'ı ve manuel köpük
  testi çıkarıldı. Kullanılmayan eski shader JSON'u silindi; tarihsel River
  karşılaştırma shader'ında sadece manuel radial bölüm temizlendi.
- Stil karşılaştırması testi kaldırıldı. Kalite, görünürlük ve snapshot kaynak
  geçişleri tek River görünümü üzerinden sınanır.
- Otomatik kaya mesh bake'i, gerçek kıyı konturları, akışla taşınan otomatik
  köpük, ortak köpük malzemesi, fallback ve kaynak ömrü testleri korunur.
- Manuel köpüğün eski kayıt okuma kodu bu görevde kaldırılmadı; kapsam test ve
  test fixture temizliğidir. Otomatik hesaplama/yeniden hesaplama akışı değişmez.

## Doğrulama

- `npx.cmd tsc --noEmit`: geçti; son tooltip temizliği sonrasında da tekrar geçti.
- `npm.cmd run build:verify`: çıkış kodu 0; fixture türleri, production build,
  strict runtime-only dist ve dünya verisi dahil.
- Son build kapısındaki slow engine suite: **2166 kontrol geçti**. Önceki 2167
  sayısından çıkarılan kontrol, manuel temas kaynağı testidir; ortak testlerdeki
  manuel halka/şerit assert'leri de kaldırıldı.
- Optik suite: **18/18 geçti**; iki eski test (manuel halka ve stil karşılaştırması)
  çıkarıldı. Kalan kontroller tek River görünümünü kullanır.
- Gerçek editör Save/Reload/runtime: **1/1 geçti**; yüzey kontrolleri, sculpt/undo
  ve kayıt aktarımı dahil.
- Korunan otomatik köpük/malzeme tarayıcı kontrolleri: **5/5 geçti**; ortak
  malzeme, geciken/missing texture, Lake kaya bake'i ve River kıyı/akıntı köpüğü.
- Birleşik son tarayıcı koşusu: **24/24 geçti** (18 optik + 1 editör + 5 köpük).

Önceki R1/R2 test sayıları bu değişikliğin kanıtı olarak kullanılmaz. Tarayıcı
SwiftShader kullanır; gerçek GPU performansı ve kullanıcı görsel kabulü açık.

Kayıt allowlist'i değiştiği için kapsamlı Codex Security diff incelemesi önerildi;
kullanıcı onayı olmadan tarama başlatılmadı.
