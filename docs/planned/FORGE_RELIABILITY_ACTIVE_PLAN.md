# Forge güvenilirlik — aktif iş listesi

Tarih: 21 Ekim 2026.
Kaynak: [kapsamlı inceleme](../reports/FORGE_KAPSAMLI_INCELEME_2026-10-21.md).

Bu dosya seçilen uygulama dilimlerini izler. Kaynak rapor, inceleme anının
kanıt kaydı olarak korunur. Kod, otomatik doğrulama ve kullanıcı kabulü ayrı
değerlendirilir.

## 1. F01 — Editör kayıt yarışı

- Kod: uygulandı.
- Otomatik doğrulama: TypeScript, tam `build:verify` ve hedefli browser akışları geçti.
- Kullanıcı kabulü: bekliyor.

### Uygulanan davranış

- Arazi, foliage ve mesh-paint düzenlemeleri bellek içinde sürümlenir; içerik
  dosyalarının şeması değişmez.
- Bir kayıt yanıtı yalnız gönderdiği sürümü temizleyebilir. Yanıt beklenirken
  yapılan yeni düzenleme dirty kalır.
- Save, autosave ve doğrudan arazi kaydı aynı editör oturumunda sırayla çalışır.
  Her kayıt turu, layout ve dirty sidecar verilerini ilk istekten önce yakalar.
- Kısmi hatada tamamlanan ve bekleyen dosyalar hata mesajında gösterilir.
  Başarısız/denenmemiş sidecar'lar dirty kalır; sonraki Save tekrar dener.
- Kayıt sürerken yeni sidecar düzenlemesi varsa durum mesajı tekrar Save
  gerektiğini belirtir. Arazi ekleme ve heightmap import kayıt hataları gizlenmez.
- Landscape silinip aynı kimlikle yeniden eklendiğinde eski yanıt yeni kaydın
  dirty durumunu temizleyemez.

### Doğrulama

- [12 yeni regresyon kontrolü](../../tests/engine/editorSaveCoordinator.test.ts):
  üç sidecar türünde geciken yanıt, ortak snapshot, kayıt sıralaması, dört hata
  noktası ve retry, belge değişimi, aynı landscape kimliğinin yeniden kullanımı,
  snapshot hazırlama hatasından sonra kuyruğun çalışması.
- `npx.cmd tsc --noEmit`: geçti. Değişen test dosyaları ayrıca TypeScript
  programına dahil edilerek kontrol edilir.
- F01 checkpoint'inde `npm.cmd run build:verify`: **1.234 kontrol geçti**;
  import denetimi, build ve sıkı production paket taraması geçti. O koşumda
  mevcut olan import denetleyicisi sınırlaması aşağıdaki F02 diliminde düzeltildi.
- Browser kapsamı: editör authoring/save/reload/Play; landscape paint;
  landscape sculpt sırasında gerçek başarılı HTTP yanıtını bekletme,
  bu sırada Undo, sonraki Save ve disk/reload doğrulaması.
  Authoring ve paint ilk koşumda geçti. Gecikmeli sculpt testi, önceden kuyruğa
  girmiş autosave'i ayırt edecek şekilde düzeltildikten sonra ayrı koşumda geçti.
  Toplam **3 hedefli Chromium akışı** doğrulandı; tüm browser paketi çalıştırılmadı.
  Test teardown'u ortak proje/asset manifestlerini, test seviyelerini ve arazi
  sidecar'ını geri yükledi.

Hata testleri kontrollü HTTP/saver hata enjeksiyonudur; fiziksel disk arızası
veya gerçek süreç kesintisi testi değildir.

### Açık sınırlar

Bu dilim editör içindeki kayıt yarışını ve hata sonrası tekrar denemeyi ele alır.
Sunucu tarafında geçici dosya ile değiştirme, birden fazla dosyada crash/disk
kesintisi kurtarma ve farklı sekme/istemcilerin çakışan yazmalarını koordine etme
henüz uygulanmadı. Layout endpoint'inin layout ve manifest yazması tek disk
transaction'ı değildir. Raporun F01 maddesi bu daha geniş kapsamıyla tamamen
kapanmış sayılmaz.

## 2. F02 — AST import denetimi ve engine bağımsızlığı

- Kod: uygulandı.
- Otomatik doğrulama: TypeScript, tam `build:verify` ve hedefli runtime
  browser kontrolü geçti.
- Görsel animasyon/kullanıcı kabulü: bu dilimde yapılmadı.

### Uygulanan davranış

- [Import denetleyicisi](../../builder/web/verify-imports.mjs) TypeScript AST
  kullanır. Çok satırlı import/export, type-only import, import type,
  import-equals ve literal dinamik import ifadelerini denetler; yorum ve metin
  içindeki örnekler bağımlılık sayılmaz. Mevcut katman kuralları korunur.
- Alias ve göreli yollar normalize edilir. Alias içindeki `..` geçişi hedef
  katmanı gizleyemez. Denetlenen dosyada bozuk sözdizimi veya taramada erişim
  hatası varsa denetim sessizce başarılı sayılmaz.
- [Blend-space hesapları ve tipleri](../../engine/animation/blendSpace.ts)
  engine'e taşındı. `locomotionAnimation.ts` doğrudan bu modülü kullanır;
  HTTP sidecar yükleme/normalizasyonu host katmanında kalır.
- `assetSkeletonLoader.ts` ve editör store'unun mevcut export'ları korunur.
  İçerik şeması ve ağırlık hesaplama davranışı değiştirilmedi.
- `verify:imports`, önce denetleyicinin kendi regresyonlarını, ardından mevcut
  kaynak ağacının taramasını çalıştırır; yerel `build:verify` ve mevcut CI kapısı
  bu kontrolleri otomatik içerir.

### Doğrulama

- Düzeltmenin ilk adımında AST denetimi mevcut
  `engine/movement/locomotionAnimation.ts -> @/scene/assetSkeletonLoader`
  bağımlılığını yakaladı ve exit code `1` verdi. Taşıma sonrası **366 kaynak
  dosyasında sıfır yasak doğrudan bağımlılık** ile geçti.
- [10 denetleyici regresyonu](../../tests/builder/verify-imports.test.mjs)
  geçti. Geçici fixture üzerinde gerçek komut akışı, yasak çok satırlı import'ta
  exit code `1`, düzeltildiğinde `0` üretti.
- `npx.cmd tsc --noEmit`: geçti.
- `npm.cmd run build:verify`: **1.235 engine kontrolü + 10 denetleyici testi**
  geçti; üretim build'i ve sıkı dist taraması geçti. Mevcut blend-space/locomotion
  kontrolleri ve eklenen engine/loader/editor export uyumluluk kontrolü dahil.
- Browser: `runtime-locomotion.spec.ts` **1/1 geçti** (37,8 saniye); klavye
  hareketi, durma, zıplama ve debug readout doğrulandı. Teardown geçici proje
  verilerini geri yükledi. Tam browser paketi bu dilimde çalıştırılmadı.

Denetleyici mevcut katman kurallarına göre doğrudan, literal import yollarını
kontrol eder. Hesaplanan dinamik yolların veya transitif bağımlılıkların tamamı
için doğrulama iddiası yoktur. Uzak CI koşumu ve canlı dağıtım yapılmadı.

## 3. Sonraki dilimler

1. **F03 + F15:** Bağımsız browser fixture'ları ve debug panelinin Load
   tıklamasını kesmesinin giderilmesi.
2. **F04–F07:** Yayın içerik kümesi, asset kaynak kayıtları, browser CI,
   root/subpath production HTTP kontrolü ve paket bütçeleri.

Kayıt endpoint/validator güvenlik incelemesi ayrı öneridir. Bu uygulama diliminde
Codex Security taraması başlatılmadı.
