# Ocean Medium/Large — kapsam hazırlama tasarımı

9 Kasım 2026. O9-B adım 2 tamamlandı: uygulama için seçilen yaklaşım ve kabul
sınırları. Kaynak incelemesi `8e2f988f` üzerindedir. Bu belge uygulama veya GPU
kabulü değildir; tasarım aşamasında Medium/Large açılmamıştır.

Uygulama devamı: [Medium Island/Coast raporu](../reports/OCEAN_MEDIUM_WORLD_BUILDER.md).
Small atlas yoluna taşındı ve Medium açıldı; Large kapalıdır. Aşağıdaki kaynak
tablosu yedi ring tasarım hesabını korur. Medium uygulaması sekizinci dış ring
ile 28,11/56,23 MiB temel/replacement ve 6,45 MiB kalıcı CPU hesabına ulaşır.
Tasarımın tam performans/kaynak kabul kapıları hâlâ açıktır.

Dayanak: [birinci adımın ölçümü](../reports/OCEAN_MEDIUM_LARGE_BUDGET.md),
[ham ölçümler](../reports/evidence/ocean-medium-large/budget.json),
[yerleşim/bit doğrulaması](../reports/evidence/ocean-medium-large/design-layout.json).

## Karar ve alternatifler

**Tam native domain + tek R32F atlas + cooperative CPU hazırlığı + kontrollü
GPU yüklemesi** seçildi. Terrain çözünürlüğü, tüm domain'deki deniz bağlantısı,
b–c üçgenleri ve World Builder'ın 2 m aralığı korunur. Native terrain'in
mevcut streaming sistemine yeni bir kamera takipli Ocean streaming sistemi
eklenmez. Hazırlık sırasında eksik resident tile'lar yine bütçeli okunabilir.

| Seçenek | Large temel / replacement GPU biçim hesabı | Sampler etkisi | Karar |
| --- | ---: | --- | --- |
| Limit artışı, mevcut RGBA32F | 87,55 / 175,10 MiB | Aynı | 64/96 MiB başlangıç hedeflerini aşar |
| RG32F, tam domain | 55,52 / 111,04 MiB | Aynı | Replacement hedefini aşar; ayrı CPU paketleme sürer |
| R32F yükseklik + ayrı R8 hücre maskesi | 43,50 / 87,01 MiB | Bir ek sampler | Yedek aday; mevcut terrain gölge bütçesini daraltır |
| **Tek R32F atlas, 8 hücre/maske sözcüğü** | **41,51 / 83,01 MiB** | **Aynı** | **Seçildi** |
| Kamera çevresinde tile/clipmap kapsamı | Tasarlanmadan sayı verilemez | Yeni adresleme/sınır aktarımı | Bu ölçekte ilk uygulama için ertelendi |

Yakın/uzak bağlantı veya düşük çözünürlüklü flood-fill, dar boğazı açıp kapalı
çukuru yanlışlıkla denize bağlayabilir. Tile-local flood-fill de tile dışındaki
bağlantıyı tek başına bilemez. Büyük/infinite world veya aşağıdaki bütçe kapıları
bu tasarımla geçilemezse bu seçeneklere ayrı topoloji tasarımıyla dönülür.
Large için yalnızca Medium ölçümünü doğrusal ölçekleyerek destek ilan edilmez.

## Tek atlasın veri sözleşmesi

`nx`, `nz` hücre sayısı; `C=nx*nz`, `W=nx+1`, `V=W*(nz+1)`:

- İlk `nz+1` satır: mevcut `Float32` yükseklikler, aynı vertex adresleri.
- Sonraki satırlar: `ceil(C/8)` maske sözcüğü. Hücrenin iki biti (0–3), sekiz
  hücre için tek float'ın **tam sayısal değerine** paketlenir.
- `maskRows=ceil(ceil(C/8)/W)`; atlas boyutu `W × (nz+1+maskRows)`.
- Sözcük `sum((triangles[8*k+j]&3) << (2*j))`; aralık 0–65535.
  Bu tam sayılar Float32'de kayıpsızdır. Float bit reinterpretation veya
  yüksekliğin düşük bitlerine maske yerleştirme yapılmaz.
- GPU hücre indeksi `cell.y*nx+cell.x`; sözcük `index>>3`, bit kayması
  `(index&7)*2`. Sözcük texel'i `(word%W, nz+1+word/W)` adresindedir.
  `uint(round(texelFetch(...).r))` üzerinden iki bit çıkarılır.
- Son sözcükteki kullanılmayan hücreler ve son satır padding'i sıfırdır.
- `RedFormat` / `FloatType` → R32F; nearest min/mag, clamp, mipmap yok,
  renk dönüşümü yok, `flipY=false`, `unpackAlignment=1`, highp adres/mask hesabı.

Kapsamın CPU `heights` alanı atlas buffer'ının ilk V float'ına **view** olur;
ikinci bir yükseklik kopyası oluşturulmaz. CPU `triangles: Uint8Array(C)`
otorite olarak kalır. Maske paketlemesi yalnız hazır kapsamdan, generator ile
yapılır. NaN/eksik veri içeren bir sonuç GPU'da yayınlanmaz.

| Boyut | Yükseklik alanı | Atlas | Atlas MiB | Temel GPU MiB | Replacement MiB | Kalıcı Ocean CPU typed MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Small | 513×513 | 513×577 | 1,13 | 24,62 | 49,24 | 2,20 |
| Medium | 1025×1025 | 1025×1153 | 4,51 | 28,00 | 55,99 | 6,33 |
| Large | 2049×2049 | 2049×2305 | 18,02 | 41,51 | 83,01 | 22,84 |

Temel GPU = atlas + mevcut 22,67 MiB FFT + 0,82 MiB grid. Replacement iki
temel kümeyi içerir; FFT paylaşımı/refactor'ı bu kararın şartı değildir.
Önceki rapordaki iki dokulu adayların sayıları geçerlidir; atlas bu aşamada
eklenen başka bir adaydır. Rakamlar biçim hesabıdır, ölçülmüş VRAM/GPU süresi değildir.

JS kontrolünde 65536 olası maske sözcüğünün tamamı, üç boyutta toplam
5.505.024 hücre ve 5.512.195 yükseklik örneği round-trip ile kontrol edildi.
Yükseklikler Float32 bit düzeyinde aynıdır. Bu kontrol GLSL, driver veya GPU
format desteğinin kanıtı değildir.

## Ortak sorgu ve sampler bütçesi

Atlas adresleme ve b–c interpolasyonu tek GLSL yardımcısında tutulur. Surface
vertex/beauty, normal/depth override, refraction adayının su sorgusu ve terrain
Ocean caustics aynı yardımcıyı kullanır. Ortak helper yalnız bed/bağlılık
okur; çağıranın offshore izni ve live inlet kesimi korunur.

Coast `connectedBoundary`, domain dışındaki sınır hücresinin bağlılık/bed
sonucunu kullanmayı sürdürür. Ada/eski `all` offshore davranışı değişmez.
Son düz River erişimi, widthScale, hidden/delete, gerçek endpoint kotu ve
optik geçiş bandı yeni dokunun içine bake edilmez; mevcut canlı inlet uniformları
aynı şekilde çalışır. Width/appearance güncellemesi atlası veya FFT'yi yenilemez.

Mevcut `TERRAIN_LIT_FIXED_SAMPLERS=11`; aktif varyantların sayısı
`11-2+textured+normalMapped+puddleCoverage+oceanCaustics` ile hesaplanır.
16 texture unit ve iki ortam sampler'ı rezerviyle örnekler:

| Terrain varyantı | Mevcut/seçilen atlas sampler | Seçilen atlas için en çok cascade | İki dokulu adayda en çok cascade |
| --- | ---: | ---: | ---: |
| Textured + Ocean | 11 | 3 | 2 |
| Textured + normals + Ocean | 12 | 2 | 1 |
| Textured + normals + Puddle + Ocean | 13 | 1 | 0 |

Bu nedenle iki dokulu düzen, mevcut görsel kaliteyi koruyan ilk tercih değildir.
Seçilen atlasın Ocean coverage sampler sayısı bir kalır; shader'da maske için
bir ilave texelFetch vardır. Daha düşük byte hesabı daha hızlı GPU süresi
kanıtı sayılmaz. Surface vertex ve fragment, terrain fragment ve combined
texture sınırları gerçek context'te ayrıca kontrol edilir.

## Hazırlık ve sahiplik akışı

1. **Ön kontrol:** hücre/eksen ve boyut feature cap'i, atlas boyutunun gerçek
   `maxTextureSize` içine sığması, typed-array byte hesabı, mevcut dört okuma
   için 32 MiB tavanı kontrol edilir. Large atlas yüksekliği 2305'tir; yalnız
   `2049 sığıyor` kontrolü yeterli değildir. Bilinmeyen tile offshore olmaz.
2. **Native snapshot:** Float64 snapshot ve seam kontrolü ilk uygulamada korunur.
   Dört eşzamanlı I/O, seri/cooperative kopya ve mevcut eksik-hücre kontrolü
   devam eder. Kaynak `document.tiles` map'ine Ocean okuması eklenmez.
3. **Coverage:** Float32 hedefi atlasın yükseklik view'ı olacak şekilde mevcut
   flood-fill generator'ına sağlanır. Genel senkron/standalone API kendi
   normal array'ini kullanabilir; render pipeline'ında tekrar 4V kopyalanmaz.
   Aynı final Float32 değerleri yazılırken min bed hesaplanır; surface kurucusu
   bütün height dizisini yeniden taramaz. `maxDepth=max(offshoreDepth, seaLevel-minBed)`
   ve eski `max(1,maxDepth*.7)` reflection bound hesabı korunur.
4. **Mask/grid:** maske paketleme bounded generator olur. Grid'in aynı indeks
   ve ring/morph düzeni, kapasitesi önceden hesaplanmış typed buffer'lara
   cooperative yazılır; büyük geçici JS number array'leri ve son kopyaları
   kaldırılır. Bounds doldurma sırasında hesaplanır. Production surface
   kurucusunda O(V)/O(C) dolaşım veya başka uzun hazırlık kalmaz.
5. **GPU staging:** yeni atlas görünmez durumda ayrılır ve yüklenir. Yeni
   FFT'nin ilk hazırlığı ve shader warm-up da ayrı ölçülür. Staging sırasında
   eski geçerli sunum ve simülasyon çalışmaya devam eder.
6. **Atomik yayın:** generation/revision ve kaynaklar son kez kontrol edilir;
   reflection/caustics kapasitesi doğrulanır. Caustics kaydı eski sahibin yerine
   **await içermeyen** commit bölümünde alınır, yeni surface eklenir, eski sahip
   kaldırılır. İptal/hata yalnız staging kaynaklarını bırakır. Eski caustics
   dispose'u yeni registry kaydını silemez.

Önerilen sorumluluklar (henüz dosya/API eklenmedi):

| Dosya/alan | Uygulamadaki sorumluluk |
| --- | --- |
| `engine/terrain/oceanCoverageStorage.ts` | Three bağımsız atlas layout, hedef view ve maske paketleme generator'ı |
| `oceanPreparation.ts`, `oceanCoverage.ts` | Hedef view, min bed, native doğruluk, kooperatif hazırlık |
| `engine/render-three/ocean/oceanCoverageTexture.ts` | Texture sahibi, upload helper ve ortak GLSL okuma |
| `oceanGrid.ts`, `oceanSurface.ts` | Hazır grid/atlas tüketimi; kısa surface kurulumu |
| `oceanCaustics.ts`, `terrainCaustics.ts` | Aynı atlası ödünç kullanma; tüm shader tüketicilerini birlikte taşıma |
| `src/scene/oceanWaterController.ts` | Async staging, generation/terrain revision, atomik commit ve cleanup |
| `tools/ocean-budget-report.mjs`, `tools/perf/oceanBudgetStudy.ts` | Yeni atlas/pipeline ölçümü ve güncel boyut cap'i; eski RGBA raporunu ayrı baseline olarak koruma |

DataTexture tek sahibi sunumdur. Caustics, normal/depth proxy'leri ve reflection
aynı texture/uniformları ödünç alır; ayrı bir tam-domain kopyası tahsis etmez.
Atlas immutable yayınlanır. Yeni kalıcı layout alanı, dosya şeması veya bake yoktur.

## GPU yüklemesinin uygulama sınırı

Yerel Three.js 0.187.0 `WebGLTextures.updateTexture()` içinde update range
hesabı `componentStride=4; // only RGBA supported` kullanıyor. Dolayısıyla
R32F atlas için `Texture.addUpdateRange` ile doğru band upload varsayılmaz.
`needsUpdate=true` tek başına tam upload yapabilir; CPU döngüsünü bölmek bu
maliyeti çözmez.

Seçilen staging yolu mevcut public API'lerle uygulanır ve önce küçük GL
probe'unda doğrulanır:

- Hedef texture'da `source.dataReady=false`, `needsUpdate` ve `initTexture`
  ile storage ayır; bütün atlası ilk bind'de göndermeyi önle.
- CPU atlas view'ları için init/bind edilmemiş geçici DataTexture bandlarıyla
  `copyTextureToTexture` CPU→GPU yolunu kullan. Bu kaynaklar GPU'ya ayrıca
  yüklenmez; yeni tam atlas kopyası tutulmaz. Tam satırlar, örneğin başlangıçta
  en çok 256 KiB/call ile gönderilir; her banddan sonra cooperative task sınırı
  ve abort/revision kontrolü vardır.
- Son banddan sonra atlasın tamamını GPU readback/örneklerle doğrula ve hazır
  olarak işaretle. Immutable texture'da sonradan bir `needsUpdate` ile sessizce
  tam upload tekrarlanmamalı; context restore açık bir yeniden staging yoludur.
- Helper renderer'ın pixel-store/binding durumunu bozmaz; engine'in mevcut
  WebGL state cache'i dışına raw GL çağrılarıyla çıkılmaz.

Texture storage ayırma, FFT init ve shader compile da senkron driver maliyeti
yaratabilir. Küçük band seçmek bunları garantiyle 4 ms yapmaz. Probe veya gerçek
ölçüm bu yolu desteklemezse çözüm doğrulanmış sayılmaz ve ilgili büyük boyut
açılmaz; untested upload veya kaliteyi sessiz düşürme fallback'i kullanılmaz.

## İptal, revision ve geçersiz kaynak

`generation + AbortSignal + document identity` kontrolleri bütün yeni await
noktalarında sürer. Ayrıca terrain **aynı document nesnesinde** değişebildiği
için force/height/spline/domain invalidation'ı ayrı bir transient revision/dirty
durumuyla izlenir. Mevcut editörde height patch sonrası `rebuildOceans(true)`
yolu vardır. Uygulamada bu revision'ın bütün ilgili invalidation yollarından
ilerletildiği doğrulanır; authored veriye revision yazılmaz.

Özel regresyon: terrain rebuild sürerken River Width Scale/appearance değişimi,
pending hazırlığı iptal edip eski coverage'ı yanlışlıkla güncel/Ready saymamalı.
Eski görünür sunuma width uniformu uygulanabilir; ancak built terrain revision
gerekli revision'dan eskiyse yeni hazırlık gerekli revision için devam eder veya
yeniden başlatılır. Başarıyla commit edilene kadar dirty durumu temizlenmez.

Eksik tile, seam uyuşmazlığı, decode/GL hatası veya kapasite aşımında aynı
geçerli Ocean'ın önceki sunumu korunur. Ocean silinmesi, terrain'in gerçekten
kaldırılması veya level travel/dispose ise sahipsiz eski sunum da bırakılmaz.
Stale task sonradan yüzey veya caustics kaydını geri getiremez.

## Kaynak ve kabul kapıları

64 MiB steady / 96 MiB replacement GPU, mevcut planın mühendislik başlangıç
hedefleri olarak korunur. Atlas tablosu yalnız temeldir. FFT, grid, atlas,
Ocean'a atfedilen reflection/capture/snapshot/caustics ve staging kaynakları
aynı ölçümde toplanır; paylaşılan kaynak bir kez sayılır. Large temel replacement
83,01 MiB olduğundan kalan yaklaşık 12,99 MiB sınırsız özellik payı değildir.

CPU modeli: `A=atlasBytes`. Hazırlık typed buffer toplamı `8V+A+12C`, grid ile
allocation penceresi `8V+A+12C+grid` olur. Small/Medium/Large için yaklaşık
6,96/25,35/98,87 MiB; eski hazır Ocean eklenince Large yaklaşık 121,71 MiB'dir.
Native resident payload, I/O ara buffer'ları, JS, driver ve GC gecikmesi ayrıca
sayılır. Bu değer fiziksel heap/RSS tepe garantisi değildir. Worker'a taşıma,
snapshot Float64'ü kaldırma veya visited/queue sıkıştırma ilk teslim şartı değildir.

CPU hazırlık hedefi 2 ms task budget, kabul hedefi 4 ms dilim ve Ocean kaynaklı
>50 ms long-task olmamasıdır. Allocation, final constructor, texture storage,
upload, FFT init ve shader compile dahil ölçülür; yalnız generator onSlice
çıktısıyla kabul kapanmaz. GPU draw p95 farkı ve transient tepe, O6 protokolüne
göre hedef donanımda ayrıca doğrulanır.

| Kapı | Gerekli kanıt |
| --- | --- |
| Veri/atlas | Bütün 65536 word, row/word/domain sınırları, üç boyut; CPU ve gerçek GLSL sonuçları eşit; Float32 bed aynı |
| Kapsam | Dört Coast yönü, Island, kapalı çukur, ince boğaz, kısmen ıslak üçgen, farklı origin/Y, missing/sparse tile ve seam |
| Renderer | Beauty/refraction/normal/depth/caustics aynı bed/mask; 16-unit terrain varyantları ve mevcut cascade sayısı korunur |
| Yaşam döngüsü | Her CPU/upload aşamasında abort/delete/travel, terrain edit + Width Scale yarışı, başarısız replacement ve tekrar deneme; eski sahipler korunur |
| Kaynak | En çok dört tile read, residency değişmez, borrowed atlas tek dispose; 20 rebuild/quality/clear/reload döngüsünde kaynak büyümesi yok |
| Kullanıcı akışı | İzole smoke projesi; Small regresyonu; önce Medium Island/Coast, dar/geniş ağız, undo/redo, Save/Reload ve gerçek Play görüntüleri |
| Performans | Cold koşulu açık 10 örnek; 5 warm-up + 30 hazırlık; gerçek browser long-task/peak; GPU için O6 AB/BA protokolü |

## Sonraki uygulama dilimi

O9-B adım 3 önce atlas/helper, cooperative kurulum ve lifecycle'ı **Small
üzerinde** taşır. Sonra Medium için hücre tavanı 1.048.576 olacak şekilde
generator, endpoint request policy, builder ve UI aynı feature cap'i kullanır;
`Small only` hard-code/normalizer ve bilgi metinleri birlikte güncellenir.
Medium'un kapıları geçmeden Medium, Large'ın kapıları geçmeden 4.194.304 hücre
ve Large seçeneği açılmaz. Boyutların açılması varsayılanların değişmesi demek değildir.

Mevcut ölçüm aracı Small-only guard metnine ve RGBA buffer envanterine bilinçli
olarak bağlıdır. Uygulamada yeni cap/pipeline için bu varsayımlar güncellenir;
eski ölçüm `budget.json` dosyası tarihsel baseline olarak korunur. Atlas koşuları
ayrı çıktı alır; yalnız yeni kodu ölçüp eski RGBA baseline'ı yeniden ölçmüş gibi
raporlamak doğru değildir. Internal OceanSurface çağıran engine/browser
fixture'ları ve yardımcı probe'lar da hazır veri/sahiplik sözleşmesine taşınır.

İlk Medium dilimi Large'ı kapalı bırakabilir; Large sonraki kontrollü parçadır.
Standart TypeScript, ilgili engine grubu, uygun build ve browser kontrolleri
uygulama değişikliğine göre çalıştırılır. Ada'da nehir, sonsuz dünya, yeni
Ocean optik sistemi ve mevcut River/Ocean renk sınırını tam giderme kapsam dışıdır.

Bu tasarım adımında yalnız doküman ve matematik kontrol kaydı üretildi. Runtime,
TypeScript, kullanıcı sahnesi ve proje seçimi değiştirilmedi; bu nedenle yeniden
engine/build/browser test koşusu yapılmadı. Commit/push yok.
