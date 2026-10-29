# River — Wet Shore

29 Ekim 2026. Lake'teki görsel ıslak taban/kıyı özelliği River'a eklendi.

## Kullanım ve davranış

Water → River → **Wet Shore** bölümünde Enabled, Wet Band Width (m) ve
Wet Band Strength bulunur. Varsayılan kapalı, genişlik 1 m, şiddet 0,65'tir;
eski sahneler otomatik olarak değişmez. Genişlik 0,2–4 m, şiddet 0–1.

Islaklık terrain rengini koyulaştırır ve roughness'ı düşürür. Nehrin gerçek
üçgenlerinin altındaki taban ıslanır; kuru kıyıda dar bir bant, suyun yerel
yüksekliğine göre sönümlenir. Yüzeyin eğimi ve farklı su kotları korunur.
Ribbon uçları, tamamen su altında kalan kenarlar ve eksik terrain, yapay
kıyı çizgisi üretmez. Terrain boya verisi ve toprak fiziği değiştirilmez.

Caustics ışığı kapalıyken de çalışır. Low kalitede ıslaklık kaynakları bırakılır;
Medium/High/Ultra'da authored ayara göre geri gelir. Profil değişikliği kalıcı
değerleri değiştirmez. Undo/Redo, Save/Reload ve Play desteklenir.

## Veri ve kaynaklar

- Kalıcı alan: `LayoutRiverWater.shoreWetness: { enabled, width, strength }`.
  Runtime çözümleyici ve `tools/saveValidator.ts` aynı doğrulamayı kullanır.
- Gerçek su kapsamı için mevcut River caustics yüzey atlası paylaşılır;
  yalnız Wet Shore açmak caustics ışığını açmaz. Yeni sampler eklenmez.
- Kıyı mesafesi ve 16 bit yerel kıyı yüksekliği CPU'da hazırlanır. Mevcut
  1024² RG wet-shore atlasında River maskesinin her örneği iki texel kullanır.
  Gövde başına GPU wet-shore katmanı Lake'teki gibi 2 MiB'dır.
- River maskesi en fazla 524.288 örnek, eksen başına 1024 texel ve
  hazırlıkta 16M mesafe örneklemesiyle sınırlıdır. Lake + River toplamı
  en fazla 8 wet-shore gövdesidir. Aşım açık hata verir; sessizce bant
  genişletilmez. Kaynak bırakma idempotenttir.
- Caustics kapalıysa Wet Shore, ortak River yüzey atlasının oluşturulmasını
  gerektirebilir. Toplam GPU maliyeti ve hazırlık dilimleri ölçülmedi;
  sampler sayısının değişmemesi performans kabulü değildir.

## Doğrulama

- `npx.cmd tsc --noEmit` ve smoke TypeScript geçti.
- `npm.cmd run build:verify` geçti: **2.151 engine kontrolü**, production
  build, import sınırları, strict dist ve world-data dahil.
- Beş ayrı browser senaryosu geçti: River Wet Shore (gerçek Low/Medium/Ultra
  menüsü, Undo, Save/Reload/Play); Lake kalite; Lake wet shore;
  River otomatik köpük/caustics; River nesne taşıma/Recalculate.
- Engine regresyonları: eğimin iki kotunda kıyı yüksekliği, büyük dünya
  origin'i, terrain/visibility sınırı, kapalı caustics ışığı, ortak atlas,
  20 kalite geçişi ve son dispose. Eski Lake atlas regresyonları da geçti.
- Tarayıcıda shader/GL/console hatası yok; bağımsız fixture terrain dosyaları
  değişmedi. Kullanıcının gerçek sahnesindeki görünüm kabulü ayrıca yapılır.

Yerel kanıt: `.dev-server/river-wet-shore-build.log`,
`river-wet-shore-engine.log`, `river-wet-shore-browser.log`,
`river-wet-shore-browser-final.log`; screenshot'lar Playwright test-results
dizinindedir. Codex Security diff incelemesi önerildi; tarama çalıştırılmadı.
