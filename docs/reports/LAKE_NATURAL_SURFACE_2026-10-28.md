# Lake doğal yüzey — L1, 2026-10-28

Amaç: farklı ölçeklerde hareket eden küçük dalgacıklar, açıya bağlı yansıma ve
parçalı güneş parlaması. TV fotoğrafındaki renkli düzenli çizgiler/moiré ve ekran
parlaması doku/desen hedefi değildir. Bu ilk sunum dilimi; fiziksel dalga hacmi,
vertex deplasmanı, rüzgâr simülasyonu ve tekerlek etkileşimi içermez.

## Kontroller

Lake → Appearance:

- **Surface Strength**: 0–2, varsayılan 1. Normal eğimlerinin şiddeti; 0 düz yüzey.
- **Surface Roughness**: 0,04–1, varsayılan 0,22. Parlamanın genişliği ve mevcut
  planar yansımanın örnekleme blur'u; dalga boyu değildir.
- **Normal Scale**: mevcut anlamı korunur; arttıkça desen küçülür.
- **Ripple Speed**: mevcut yüzey hareket hızı; normal/dalga zamanını ölçekler.

Yeni kaynak alanları runtime/save ortak allowlist'inde; sonlu sayılar ve aralık
sınırları doğrulanır. Eski Lake'ler yeni varsayılanları kullanır. Renk, opaklık,
soğurulma, yansıma modu ve mevcut kaynak sahneler kendiliğinden değiştirilmez.

## Uygulama

`lakeSurface.ts` ortak bir Lake shader parçasıdır. Aynı normal map üç ölçekte
okunur; ara örnekte UV rotasyonu ile beraber normal eğimleri de dünya XZ
çerçevesine geri döner. Birbirine paralel olmayan üç dalga bileşeni ve yavaş
noise paketleri hareketi çeşitlendirir. Fazlar da iki bağımsız düşük frekanslı
noise ile bükülür; dalgaların sabit kesişiminden oluşan düzenli elmas/ızgara
görünümü böylece kırılır. İkincil yönün katkısı baskın yönden daha düşüktür. Asset yüklenmezse bu prosedürel taban
çalışır; eksik asset için sahte doku/lisans verisi eklenmez.

Ekran türevleri örneklemeden önce hesaplanır. Fine katkı uzaklaşınca söner;
orta ölçekli prosedürel katkı da çok büyük footprint'te azaltılır. Specular
normal varyansı minimum roughness'ı artırarak subpixel parlamayı genişletir.
Dar güneş lobunun şiddeti ilk görüntü incelemesindeki aşırı beyazlığı azaltmak
için düşürüldü. Normal ayrıntısı kıyının mevcut shoreBlend katsayısıyla söner.

`lakeWater.ts`, hesaplanan normal/roughness/glint'i snapshot ve fallback
kompozisyonlarında paylaşır. Lake'in mevcut güneş/CSM alıcısı artık köpükten
bağımsızdır. Su seviyesi, gerçek kıyı, terrain bağlılığı ve dip geometrisi
aynıdır. Caustics dipte; köpük yüzeyde; Wet Shore terrain sunumu olarak kalır.

Kaynak farkı: aynı sampler'dan 2→3 normal texture örneği ve ek shader ALU;
yeni sampler, render target, mesh, kalıcı varlık veya draw geçişi yok. Planar
capture zaten açıksa blur aynı capture'ı kullanır. Hedef donanım GPU p95 ve
büyük dünya performans kabulü bu aşamada ölçülmedi.

## Kabul yaklaşımı

Sabit güneş yönünden yansıma açısına yerleşen izole kamera; Strength 0/1 ve iki
sabit zaman. Yakın/uzak görüntüler, gece, normal map'siz prosedürel hareket,
ada/kuru/ayrı çukur, aynı draw sayısı ve GL hatasızlık. Gerçek UI ile yeni
ayarlar Save/Reload ve runtime'da doğrulanır. Mevcut caustics, kıyı köpüğü,
yumuşak kıyı ve ıslak dip senaryoları regresyon olarak kullanılır. Motor
kontrolleri yeni alanların round-trip/default/invalid değerlerini kapsar.

Fotoğrafla nihai sanat kabulü ve gerçek GPU ölçümü yerelde yapılmalıdır.
Yeni save alanları için Codex Security diff incelemesi önerilir; otomatik
başlatılmadı. Kod henüz commit/push edilmedi.

Son yerel kabul: `build:verify` çıkış 0; TypeScript, **1.979 engine kontrolü**,
üretim build'i, strict dist ve world-data geçti. Son faz/paket düzenlemesiyle
caustics, kıyı köpüğü, dik kıyı, su altı ıslaklığı ve yeni doğal yüzey browser
senaryoları **5/5 geçti (3,3 dakika)**. Yeni senaryo yakın/uzak, hareket, gece,
normal map'siz hareket ve gerçek Save/Reload/runtime kontrollerini tamamladı;
GL/konsol hatası yoktu, yüzey açık/düz karşılaştırmasında draw sayısı aynıydı.
Yakın/uzak görüntüler incelendi; önceki aşırı parlama ve düzenli kesişim deseni
azaltıldı. Bu, fotoğrafla nihai masaüstü sanat kabulü veya donanım GPU zamanı
değildir. Kaynak sahneler değiştirilmedi; kod henüz commit/push edilmedi.
