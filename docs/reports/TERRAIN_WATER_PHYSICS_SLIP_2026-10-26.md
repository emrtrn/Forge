# Arazi suyu: fizik patinajı bağlantısı

26 Ekim 2026

## Değişiklik

Mevcut `TerrainWater`, 32 × 32 m yerel alanda iki GPU yükseklik/hız
tamponu, dalga normali ve kaliteye bağlı planar yansımalar sunuyordu.
Bu çalışma bu altyapının eksik fizik bağlantısını tamamlar.

`terrainDeformationModule`, her gerçek tekerlek temasının `tractionSlip`
değerini artık su sistemine geçirir. Rapier'de tekerleğin konumu ve dönüşü
sabit kalsa bile, yerinde patinaj suya enerji ekler. Fizik kayma değeri
varsa dönüş farkından önce gelir: sıfır kayma ile park edilmiş tekerleğin
dönüş açısı sıfırlanması sahte dalga oluşturmaz. Bu veriyi sağlamayan
araçlar için açısal hareket hesabı korunur. Konum değişimi her iki durumda
da ilerleyen tekerleğin izine dalga ekler.

Patinaj katkısı yüzey VFX yolundaki 0,6 durgun hareket katsayısını kullanır.
Enerji geçen süreyle ölçeklenir; uzun bir duraklama, GPU'nun dört sabit
adımlık telafi bütçesinden fazla enerji ekleyemez. Kuru temaslar enerji
eklemez; geçersiz veri, havadan yeni iniş ve teleport eski temas geçmişini
sürdürmez.

## Doğrulama

- `npx.cmd tsc --noEmit`: geçti.
- Hedefli engine kontrolleri: 10 geçti; tam gate yerine sayılmadı.
- `npm.cmd run build:verify`: geçti; TypeScript, smoke/content/UI tipleri,
  üretim build'i, **1.938 engine kontrolü**, strict dist ve world-data.
- `terrain-water.spec.ts`: iki WebGL testi geçti. Fizik patinajı, sönüm,
  pencere hareketi, üç kalite, planar yansıma, reversed-Z, 25 cm dar izler
  ve kaynakların bırakılması kontrol edildi.
- `terrain-water-runtime.spec.ts`: GAZ-52/LandscapeTest testi geçti;
  dört gerçek tekerlek teması 512² su alanına ulaştı. Ultra/reversed-Z
  görüntüsünde aracın yansımaya katkısı 5.199 pikselde 15/255'ten fazla
  kanal farkı oluşturdu; en büyük fark 76/255'tir. Fixture, HTTP yanıtında
  fizik profilini çamur yapar ve görsel aşamada gerçek temas izlerini geçici
  olarak uzatır; bu sonuç kaydedilmiş sahnede uçtan uca sürüş kabulü değildir.
- `git diff --check`: geçti.

Yeni GPU regresyonu görünür yüzey maskesine güvenmek yerine gerçek
half-float dalga tamponunu da okur. Yalnızca sol su izi uyarıldığında
sağdaki ayrı su izinin ve aradaki kuru hücrelerin dalga yüksekliği sıfırdır.
Patinaj sırasında sakin suyun kıyı maskesi aynı kalır. Pencere 0,5 m
kaydırıldığında dalganın dünya X merkezi yaklaşık 1,1 mm değişmiştir.

Kontrollü fixture'da 24 sabit patinaj adımı sonrasında en büyük dalga
yüksekliği yaklaşık 1,39 mm'dir. Shader normal hareketi göstergesi 15.726'dan
180 durgun adım sonunda 2.404'e düşmüştür; bu gösterge fiziksel enerji
birimi değildir. Engine testleri, aynı sabit patinajın 30/60/144 Hz'de aynı
toplam dürtüyü ürettiğini ve runtime modülünün kayma verisini ilettiğini
ayrıca doğrular.

Kanıtlar:

- `.dev-server/terrain-water-slip/`: JSON ölçümleri ve hareketli/sönmüş
  su, kalite ve yansıma görüntüleri.
- `.dev-server/terrain-water-slip-build-verify.log`: tam gate çıktısı.
- `.dev-server/terrain-water-slip-runtime/`: GAZ-52 görüntüleri, runtime
  snapshot'ı ve yansıma piksel farkı.

## Performans ve kabul sınırı

Tarayıcıdaki kısa ölçüm SwiftShader üzerinde çalışmıştır; GPU timer query
sonucu yoktur. Bu sonuçlar gerçek GPU maliyeti, kalite sıralaması veya açık
dünya FPS kabulü olarak kullanılamaz. Gerçek donanımda sürüş sırasında
görsel şiddet ve performans kabulü açıktır. Dalga hareketi normal/yansıma
üzerindedir; ayrı su hacmi, akış veya dalgayla oynatılan geometri eklenmez.
