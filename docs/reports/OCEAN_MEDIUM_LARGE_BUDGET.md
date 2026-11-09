# Ocean — Medium/Large bütçe incelemesi

9 Kasım 2026. [Ocean planı O9-B](../planned/OCEAN_DEVELOPMENT_PLAN.md)
birinci adım: hücre, bellek ve hazırlık maliyeti. Üretim boyut desteği açılmaz;
ikinci adımın tasarım kararı için mevcut tam-domain yaklaşımı incelenir.

Devamı: [ikinci adımın kapsam hazırlama tasarımı](../planned/OCEAN_MEDIUM_LARGE_COVERAGE_DESIGN.md).
Bu rapordaki ölçümler mevcut RGBA32F yoluna aittir; seçilen tek atlasın
sayısal kaynak hesabı ve kabul kapıları sonraki belgede ayrı tutulur.

Güncel uygulama: [Medium Island/Coast ve atlas raporu](OCEAN_MEDIUM_WORLD_BUILDER.md).
Medium desteği 1.048.576 hücre tavanıyla açılmıştır; Large kapalıdır. Bu belgedeki
262.144 hücre sınırı, RGBA ölçümleri ve reddetme sonuçları birinci adımın tarihsel
kanıtıdır. Ham `budget.json` korunur; atlas ölçümü ayrı dosyada tutulur.

## Mevcut sınır ve ölçüm yöntemi

World Builder her boyutta 8×8 tile ve 2 m örnek aralığı kullanır. Tile başına
quad sayısı Small/Medium/Large için 64/128/256'dır. Ocean, bütün terrain'i
native çözünürlükte tek kapsam grid'ine toplar; deniz bağlantısını terrain'in
b–c üçgenleri üzerinden çözer. Üretim sınırı 262.144 hücre ve eksen başına
2048 hücredir. Medium/Large için hem üretici hem istek doğrulayıcı kısıtı sürer.

Tekrar üretim:

```powershell
node --expose-gc tools/ocean-budget-report.mjs
npx.cmd tsc --noEmit
npx.cmd tsc --noEmit -p tools/perf/tsconfig.ocean-budget.json
```

Araç, diskte kaynak değiştirmeden iki ayrı bundle oluşturur:

- **Üretim bundle'ı:** mevcut Small sınırını korur. Medium/Large üretiminin
  reddedildiğini ve Ocean hazırlığının tile okumadan bütçe hatası verdiğini doğrular.
- **Tanı bundle'ı:** yalnız bellekte Ocean hücre tavanını 4.194.304 yapar ve
  Random World'un boyut reddini kaldırır. Geri kalan generator, native
  snapshot/flood-fill ve `OceanSurface` CPU kurucusu gerçek kod yoludur.
  Bu deneyin başarılı olması üretimde Medium/Large desteği anlamına gelmez.

Fixture: seed=11, Island ve West Coast, altı Forest katmanı, 64 native tile,
World Builder'ın kullandığı `f32` dosya biçimi. Yerleşim/yol/nehir/göl üretimi,
paint dağılımı, fizik ve terrain renderer oluşturulmaz. Gerçek makro zemin
yükseklikleri örneklenir; katman payload'ının boyutu korunur. Fixture hazırlığı
Ocean zamanından ayrı tutulur. Geçici dosyalar OS temp altında oluşturulup silinir.

Her kombinasyon iki yoldan ölçülür: 64 tile bellekte hazır; veya resident map
boşken diskten en fazla dört eşzamanlı okuma + gerçek decode/validation.
OS dosya önbelleği temizlenmez; ikinci yol **cold disk ölçümü değildir**.
İki ısınma + beş ölçüm alınır; her koşudan önce Node GC çalıştırılır.
CooperativeWork'un varsayılan 2 ms hedefiyle, açıkça verilen Node `setImmediate`
task devamları kullanılır. Böylece Windows/Node timer granülerliği her tile'ın
başındaki beklemeyi baskın maliyet yapmaz. Duvar süresi ile process CPU süresi
ayrı kaydedilir. Node sonuçları browser `scheduler.yield` veya main-thread long-task
kabulünün yerine geçmez. Bu, planın 5 warm-up/30 tekrar nihai kabul koşusu değildir.

Hazırlık süresi snapshot + yerel dosya okuma/decode + flood-fill ve cooperative
beklemeleri içerir. CPU yüzey kurucusu ayrıca ölçülür: gerçek coverage paketleme,
grid ve material oluşturma; WebGL upload veya FFT çalıştırma değildir.
Her tekrarda resident/disk kapsam fingerprint'i (yükseklik ve bağlılık bitlerinin
toplamları), durum ve wet face sayısı eşit olmalıdır. Ocean'ın native residency map'ine tile eklemediği,
Coast'ta deniz yönünün ıslak ve anakara yönünün kuru kaldığı da kontrol edilir.

## Hücre ve bellek hesabı

| Boyut | Dünya kenarı | Native grid | Hücre | Small'a oran | Kapsam GPU dokusu |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small | 1.024 m | 512×512 | 262.144 | 1× | 4,02 MiB |
| Medium | 2.048 m | 1024×1024 | 1.048.576 | 4× | 16,03 MiB |
| Large | 4.096 m | 2048×2048 | 4.194.304 | 16× | 64,06 MiB |

`C = nx × nz`, `V = (nx+1) × (nz+1)`:

- Snapshot yükseklikleri `Float64`: **8V**; tile varlığı: **C**.
- Kalıcı kapsam yükseklikleri `Float32`: **4V**; bağlı üçgen bitleri: **C**.
- Flood-fill kuyruğu `Int32`, iki üçgen/hücre: **8C**; visited: **2C**.
- Hazırlık typed buffer toplamı: **12V + 12C**. Bu toplam kaynak terrain
  tile'larını, JS nesnelerini, decode ara buffer'larını ve eski yüzeyi içermez.
- Surface için RGBA32F paketleme: CPU'da **16V**, GPU biçim hesabında **16V**.
  Hazırlık çöpü henüz toplanmadan paketleme yapılırsa muhafazakâr allocation
  penceresi **28V + 12C + grid**; bu sayı ölçülmüş anlık bellek tepesi değildir.
- Ocean'ın kalıcı CPU typed kaynakları: **20V + C + grid**. FFT ayrı GPU
  kaynaklarıdır; varsayılan dört cascade format hesabı yaklaşık **22,67 MiB**.
- Ocean grid geometrisi boyuttan bağımsızdır. Caustics kapsam dokusunu ödünç
  kullanır; bu dokuyu ikinci kez saymak doğru değildir.

GPU sayıları texture/buffer biçim hesabıdır; fiziksel VRAM veya driver overhead
ölçümü değildir. Planar, scene snapshot/depth, terrain renderer, caustics
pattern/atlas ve diğer ekran çözünürlüğüne bağlı kaynaklar temel toplama dahil
değildir. Eski surface + FFT, yeni sunum kurulana kadar tutulduğu için
replacement sırasında iki temel Ocean kümesi birlikte yaşar.

| Kaynak — MiB | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| 64 decoded native tile payload'ı, Ocean'a ait değil | 3,09 | 12,19 | 48,38 |
| Hazırlık typed buffer toplamı | 6,01 | 24,02 | 96,05 |
| Kalıcı Ocean CPU typed kaynakları, grid dahil | 6,09 | 21,86 | 84,90 |
| Hazırlık çöpü + paketleme allocation penceresi, grid dahil | 10,85 | 40,88 | 160,93 |
| GPU temel Ocean: kapsam + FFT + grid | 27,50 | 39,52 | 87,55 |
| GPU replacement: iki temel Ocean kümesi | 55,01 | 79,04 | 175,10 |

MiB = 1.048.576 byte. CPU ve GPU satırları farklı bellek alanlarıdır; birbirinin
yerine kullanılmaz. Kaynak native tile payload'ı hazırlık satırlarına dahil değildir.
Resident terrain ile birlikte düşünüldüğünde Large CPU allocation penceresi
yaklaşık 209,31 MiB olur; eski sunum, JS/driver overhead ve diğer terrain
kaynakları bu sayının da dışındadır. Dört dosyanın mevcut koruyucu okuma hesabı
Large'da 6,05 MiB ile 32 MiB sınırının altındadır; büyüyen ana kaynak, bu dört
tile'ın kendisinden çok bütün domain'in snapshot, flood ve coverage dokusudur.

## Hazırlık sonuçları

[Ham ölçüm, koşular ve bundle SHA-256 kayıtları](evidence/ocean-medium-large/budget.json).
Windows kernel 10.0.26200, Node v24.19.0, Intel i5-11400F, 12 mantıksal işlemci.
Her satır 2 yol × (2 ısınma + 5 ölçüm); toplam 84 hazırlık ve CPU kurucu
çalıştırması, 60 kaydedilen örnek. Aşağıdaki değerler **ms** cinsindedir.
Beş örnekte kullanılan nearest-rank p95 aynı zamanda en büyük örnektir;
istatistiksel nihai kabul olarak yorumlanmaz.

| Arazi / boyut | Resident hazırlık p50 / p95 | Disk+decode hazırlık p50 / p95 | CPU kurucu p50, resident / disk |
| --- | ---: | ---: | ---: |
| Island Small | 67,7 / 109,1 | 92,5 / 93,9 | 37,9 / 31,8 |
| Island Medium | 223,7 / 243,2 | 219,9 / 231,9 | 58,6 / 52,2 |
| Island Large | 989,6 / 1461,8 | 806,8 / 854,2 | 163,2 / 145,0 |
| Coast Small | 46,5 / 54,7 | 75,9 / 77,0 | 26,0 / 24,7 |
| Coast Medium | 147,6 / 157,8 | 189,4 / 224,6 | 49,0 / 45,1 |
| Coast Large | 606,6 / 630,1 | 721,8 / 779,1 | 145,5 / 147,5 |

Process CPU süresi ayrıca ham veridedir: resident/disk hazırlık p50'si Island
Medium'da 250/250 ms, Large'da 1015/875 ms; Coast Medium'da 204/250 ms,
Large'da 641/797 ms. Process user+system toplamı GC/yardımcı thread'leri de
içerebilir ve duvar süresinden büyük olabilir. Disk yolunun bazı satırlarda
resident yoldan hızlı olması disk avantajı kanıtı değildir; örnek sayısı,
JIT/GC ve aynı makinedeki iş yükü etkileri vardır.

Cooperative hazırlıkta gözlenen en büyük dilim 5,96 ms; 4 ms başlangıç hedefi
bu deneyde koşulsuz geçmiş sayılmaz. Daha belirgin risk, **cooperative olmayan
CPU yüzey kurucusu**: Medium p50 45–59 ms, Large p50 145–163 ms; en büyük
Large örneği 222,9 ms. Height→RGBA paketleme, depth taraması ve grid/material
kurulumu senkron çalışır. Bu Node bloklarının doğrudan browser long-task
ölçümü olduğu ileri sürülmez; ikinci adımda paketlemeyi kaldırma veya bölme
gereğini gösterir.

Bellek checkpoint'leri `onSlice` ve kurucu dönüşünde alınır. Bunlar sürekli
heap/RSS/VRAM tepesi değildir; GC'nin eski buffer'ları bırakma zamanı nedeniyle
bir koşunun tabanına göre fark, teorik aktif kaynak hesabından küçük çıkabilir.
Bu nedenle kapasite kararı için bu deltalar yerine yukarıdaki açık buffer
envanteri ve allocation penceresi kullanılır. Gerçek browser transient tepe
ölçümü dördüncü adımda kalır.

Her disk koşusunda 64 dosya okunmuş, en fazla 4 eşzamanlı okuma görülmüştür.
Resident map değişmemiş; bütün ısınma/ölçüm tekrarlarında aynı kapsam
fingerprint'i ve wet face sayısı korunmuştur. Medium/Large üretim kontrolü
tile okumadan reddetmeye devam etmiştir. Small brief'i üretim ve tanı
bundle'larında birebir aynıdır.

## İkinci adım için bulgular

- Large'ın kapsam dokusu tek başına plandaki 64 MiB başlangıç GPU hedefini
  aşar. Mevcut formatla yalnız hücre limitini yükseltmek kaynak bütçesini çözmez.
- Medium için tam native domain, bütçe açısından ayrıca incelenebilir bir
  adaydır; bütün su kaynaklarının toplamı, replacement ve browser hazırlık
  süreleri görülmeden boyut açılmaz.
- Yakın kıyının kesin üçgenlerini koruyan, uzak deniz bağlantısı bilgisini
  bütçeli taşıyan seçenekler ikinci adımda karşılaştırılmalıdır. Bunlar henüz
  seçilmiş veya uygulanmış çözüm değildir.

Mevcut RGBA32F dokusunda yalnız R (yükseklik) ve G (0–3 bağlılık bitleri)
kullanılır; B/A boştur. İkinci adımda streaming'e karar vermeden önce **kayıpsız
format/paketleme düzenlemesi** de karşılaştırılmalıdır. Yükseklik çözünürlüğünü
azaltmadan teorik Large tablosu:

| Yalnız karşılaştırma adayı | Kapsam dokusu | Temel Ocean | Replacement |
| --- | ---: | ---: | ---: |
| Mevcut RGBA32F | 64,06 MiB | 87,55 MiB | 175,10 MiB |
| RG32F | 32,03 MiB | 55,52 MiB | 111,04 MiB |
| Ayrı R32F yükseklik + hücre başına R8 bağlılık | 20,02 MiB | 43,50 MiB | 87,01 MiB |

Son seçenek aynı zamanda ikinci 16V CPU paketleme buffer'ını önleme adayıdır.
Bunlar uygulanmış veya GPU'da ölçülmüş sonuçlar değildir; özellikle ek sampler
bütçesi, beauty/refraction/depth/normal/caustics tüketicilerinin ortak geçişi,
doğru maske örneklemesi ve gerçek replacement kabulü ayrıca tasarlanmalıdır.
Temel toplamın 64/96 MiB başlangıç hedeflerine sığması, diğer su kaynakları
eklendiğinde bütün Ocean bütçesinin geçtiği anlamına gelmez.

## Doğrulama ve sınırlar

TypeScript ve rapor aracı tip kontrolü geçti. Üretim istek sınırı, eksik tile,
native çoklu tile snapshot, controller ve iptal için odaklı engine grubu:
**10 başarılı, 2591 kapsam dışı**; tam engine/build kapısı değildir.

Bu adım engine/editor/runtime veya kalıcı şema değiştirmez. UI/renderer davranışı
değişmediği için önceki uzun browser ve build:verify senaryoları tekrarlanmadı.
Gerçek GPU süresi/tepe VRAM, browser cold/warm hazırlığı, kıyı görsel kabulü,
nehir ağızları, dört Coast yönü, streaming geçişleri ve Save/Reload/Play kabulü
sonraki adımlardadır. Araç kullanıcı sahnesine, `public/project.3dgame.json`,
manifest veya `docs/planned/FORGE_WEBGPU_EDITION_MASTER_PLAN.md` dosyasına yazmaz.
Başlangıç çalışma ağacı temizdi (`e70f3cc5`). Son kontrolde kapsam dışında
`public/project.3dgame.json`, manifest ve yeni
`public/assets/starter-content/Levels/sahne1.level.json` değişiklikleri görüldü;
bu dosyalara dokunulmadı veya geri alınmadı. WebGPU planında diff yok.
Commit/push yok.
