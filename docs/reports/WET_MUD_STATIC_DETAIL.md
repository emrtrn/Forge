# Sabit çamur izleri

`lt-wet-mud.material.json` artık izsiz çamur normalini (`lt-wet-mud-base-normal`)
ve dört iz çeşidini (`lt-wet-mud-track-atlas`) ayrı kullanır. Materyalin mevcut
`uvTiling: { x: 2, y: 2 }` değeri korunur. Ek detay UV'si bu tekrarın çarpanıdır;
temel çamuru değiştirmeden izleri ayrıca küçültmek için artırılabilir.

Materyal editöründeki **Terrain Detail** bölümü Landscape üzerinde uygulanır.
Küre önizlemesi temel materyali gösterir. Değişiklikleri kaydedince Landscape
materyali yeniden yüklenir; editor ve runtime aynı yükleme yolunu kullanır.

| Ayar | Başlangıç | Etki |
| --- | --- | --- |
| Detail UV X / Y | 1 / 1 | Artırıldığında izler ilgili eksende küçülür. |
| Strength | 1.2 | İz normalinin belirginliği; 0 kapatır. |
| Base Normal Strength | 0.35 | Çamur normali korunur; izleri bastırmasını azaltır. |
| Coverage | 0.75 | Uzun iz bölgelerinin seçilme olasılığı; tam kaplı alan yüzdesi değildir. |
| Patch Size (m) | 6 | Dağılım bölgelerinin enine ölçeği; boyuna ölçek bunun üç katıdır. |
| Direction | 0° | Terrain yerel Z ekseni boyunca ana yön. |
| Direction Variation | 12° | Ana yönden iki tarafa sapma sınırı. |
| Seed | 37 | Sabit dağılımı değiştirir; yeniden açılışta aynı kalır. |
| Detail Roughness | 0.4 | İz detayının belirgin olduğu kısımlardaki pürüzlülük hedefi. |

**Base Normal Map** alanında `LT Wet Mud Base Normal`, **Terrain Detail →
Detail Normal** alanında `LT Wet Mud Track Variants` seçili kalır. İz atlası
ana normal alanına taşınmaz.

Uzun, yumuşak kenarlı bölgeler örtüşür. Piksel başına baskın tek bölge seçilir;
farklı fazdaki diş normalleri ortalanarak silinmez. Her bölgenin deseni, fazı, yönü,
küçük ölçek farkı ve aşınması konum/seed ile belirlenir. Dağılım tile slotuna,
kamera veya zamana bağlı değildir. UV ile birlikte normal yönleri de döner.
Atlasın dört bölümü yüklenirken ayrı texture-array dilimlerine ayrılır;
varyantlar mip/filtreleme sırasında birbirine karışmaz. Temel ve detay normal
aynı sampler'ı paylaşır; ek sampler gerekmez. Ek örnekleme yalnız detay atanmış,
boyama ağırlığı olan katmanlarda çalışır. Dinamik iz sistemi ayrı kalır.

## Doğrulama sınırı

Regresyonlar ayarların save/normalize turunu, hatalı değerleri, çevrilmiş atlasın
dilimlerini, Landscape bağlamasını, materyal UV'sinin korunmasını ve sampler
bütçesini kapsar. `terrain-static-detail.spec.ts` gerçek dokuların yüklenmesini,
base ve detail dilimlerinin birlikte kalmasını, GPU shader derlemesini,
izler açık/kapalı piksel farkını, yalnız normal katkısını ve aynı seed ile
çıktının aynı kalmasını kontrol eder. Görsel tekrar/ölçek/ışık kabulü ve
performans ölçümü kullanıcı kontrolündedir.

## Görsel üretim kaydı

Built-in Imagegen kullanıldı. Proje çıktıları:

- `public/assets/starter-content/Textures/LT_Wet_Mud_Base_Normal.png`
- `public/assets/starter-content/Textures/LT_Wet_Mud_Track_Atlas.png`

İzsiz çamur için referans `LT_Wet_Mud_BC.webp`; kullanılan istem:

> Create a production game texture: OpenGL +Y tangent-space normal map of ONLY the wet mud reference. Match clumps, grooves, fine soil detail spatially with the reference. Remove any suggestion of tire tracks, tread marks, wheel paths. Seamlessly tileable square, 2048x2048. Flat normals are RGB 128,128,255; purple blue technical normal data, red/green encode surface orientation, blue positive hemisphere. Moderate fine detail strength, no broad steep ridges. No lighting, no shadows baked, no brown color, no labels, no border. This is a technical normal-map conversion of the reference, NOT a rendered scene.

İz atlası için kullanılan istem:

> Production technical game texture, 2048x2048 square OpenGL +Y tangent space NORMAL MAP ATLAS. Exact 2 by 2 grid of four equally sized square texture variants filling the canvas, NO visible grid lines or padding, no labels. Each quadrant is an individually seamless tile showing TWO slim parallel offroad tire tread tracks running continuously vertically, centered at 25% and 75% of that quadrant width, each track 15% of quadrant width. The marks are depressions pressed into wet soil, NOT protruding rubber. Outside the tracks perfectly flat uniform RGB(128,128,255) normal background, NO general mud noise; no lighting, no ambient occlusion, no color texture, only purple-blue tangent normal direction data. Top left: chunky diagonal chevron tread impressions, well defined. Top right: staggered rectangular tread blocks, worn. Bottom left: chevron tread with several blocks partly erased and smoother edges. Bottom right: narrower ribbed tread, very worn, discontinuous impressions. Shallow smooth rut floors and small displaced mud lips, softened wet edges, readable moderate relief. All four quadrants must tile seamlessly individually top to bottom. The atlas itself is technical normal-map data with positive blue normal hemisphere, no white lines, no text, no perspective.

Üretici çıktıları 1254 × 1254 pikseldir. İstemlerdeki kesintisiz döşeme hedefi
görsel kabul yerine geçmez; tekrar sınırları Landscape üzerinde kontrol edilmelidir.
