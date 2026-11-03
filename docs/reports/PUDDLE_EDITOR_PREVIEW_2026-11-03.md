# Landscape Puddle önizlemesi — 3 Kasım 2026

Durum: **Uygulandı ve teknik doğrulandı.** Kalıcı W3 veri modeli, runtime
entegrasyonu, insan görsel kabulü ve donanım performans kabulü ayrı açık işlerdir.
[Plan](../planned/PUDDLE_DEVELOPMENT_PLAN.md).

## Kullanım ve davranış

World Terrain seç → **Landscape Mode: Water** → **Puddle Preview** →
**Preview Puddle** → mevcut çukura tıkla. **Water Level (World Y)** su kotunu,
**Working Area (m)** kare çalışma alanını değiştirir. Kot ilk tıklanan tabandan
5 cm yukarıdadır. Kare terrain grid'ine hizalanır; sınırı ince bir çerçeve gösterir.

Su yalnız seed'e bağlı gerçek terrain üçgenlerinde oluşur. Native örnekleme
aralığı panelde yazılıdır; örneğin 1 m grid, 12,5 cm terrain ayrıntısı varmış gibi
sunulmaz. Küçük oyuk ayrıntısı için ilerideki CDLOD/deformasyon bağlantısı gerekir.

Kuru başlangıç, çalışma sınırına erişen su ve eksik terrain ayrı belirtilir.
Başarısız rebuild önceki geçerli su yüzeyini korur; uyarı bunu açıklar. Kuru sonuç
yüzeyi kaldırır. **Clear Preview**, Esc (alan odaktayken de), mod/seçim değişimi
ve level rebuild önizlemeyi temizler. Bekleyen tile okumasının geç tamamlanması
temizlenen yüzeyi yeniden oluşturamaz.

Bu akış geçicidir; panel **Save/Play içine alınmadığını** belirtir. Layout'a Water
Body eklenmez, terrain yükseklik/paint verileri değiştirilmez. Kalıcı kayıt ve
undo/redo sonraki dilimdir. Oyun başlangıç sahnesi değiştirilmedi.

## Teknik kapsam

- `src/editor/puddlePreview.ts`: tek geçici yüzey/alan çerçevesi, native terrain
  örnekleri ve iptal/revizyon kontrollü tile okumaları; en fazla 128×128 hücre ve
  16 eksik tile okuması. Okunan tile'lar canlı terrain dokümanına eklenmez.
- `SceneApp`: mevcut terrain raycast/nokta seçimi yolundan Puddle seçimi;
  terrain undo/redo patch'inde refresh ve selection/mode/level/dispose temizliği.
- `puddlePreviewDetails.ts`: geçici araç kontrolleri, durum ve örnekleme sınırı.
- Yansıma renderer'ın mevcut ortamını kullanır. Bu önizleme için yeni planar
  target/capture açılmaz. Canlı araç temasları veya runtime iz alanı bağlı değildir.
- Lake nokta seçimi kendi panelinde kalır; Puddle seçimi Landscape panelinde
  sürer. Esc yalnız ilgili su panelinin alan odağına genişletilmiştir.

## Doğrulama

- `npm run build:verify`: geçti; **2235 engine kontrolü**, smoke/content/UI tür
  kontrolleri, builder kontrolleri, üretim derlemesi, strict dist ve world-data.
- Puddle için gerçek editör Playwright testi: **1 geçti** (yaklaşık 1,6 dakika).
  Tıklama, kot/çalışma alanı, açık sınırda önceki geometriyi koruma, alan odağında
  Esc, Clear ve Sculpt'a geçerken temizleme; level/terrain dosyalarının değişmemesi
  ve konsol/WebGL hatasızlığı doğrulandı. Koşu Low kalite ve yazılım WebGL kullanır.
- Üç yeni engine testi: native örnekleme ve authored veri değişmezliği; iptal
  sonrası geç tile yanıtı; okuma hatası/terrain deliğinde son yüzeyi koruma.
- Ek Lake taslak/Escape tarayıcı regresyonu **tamamlanmadı**. Geniş senaryo
  yazılım WebGL'de çok yavaş ilerlediği için durduruldu. Küçük havzayla ayrıca
  denenen UI kontrolü, Lake/Puddle etkileşimlerine ulaşmadan fixture kurulumu
  sırasında durdu: hata görüntüsünde `Level failed to load: [terrain-tile] bad
  magic "<!do"` görülüyor; tile isteği ikili veri yerine HTML aldı. Terrain
  Outliner'a gelmediği için seçim adımı 240 s zaman aşımına uğradı. Bu katman
  geçti sayılmaz; fixture servis sorunu giderilerek yeniden doğrulanmalıdır.
  Geçici tanı testi teslim edilen test listesine eklenmedi; mevcut Lake testleri korundu.
  Bu rapor bir hedef GPU performans ölçümü değildir.

## Görüntüler

- [Editörde hazır önizleme ve kontroller](evidence/puddle-editor/puddle-editor-ready.png)
- [Sınır aşımı uyarısı ve korunan yüzey](evidence/puddle-editor/puddle-editor-overflow.png)

## Sıradaki iş

Kalıcı Puddle kimliği/terrain referansı/seed/alan/kot/appearance şemasını,
validator, layout read/write, seçim ve undo/redo ile birlikte eklemek. Ardından
Save/Reload/Play ve gerçek World Terrain/CDLOD/deformasyon/araç bağlantısı ayrı
dilimlerle ilerler. Bu teslim W3'ün tamamını kapatmaz.
