# Level silme ve dünyaya ait veriler

8 Kasım 2026. Content Browser'da bir level silindiğinde yalnız level JSON'u değil,
aynı level adına ait dünya verileri de silinir. Level adına bağlı sahiplik, model
ve materyal referanslarını takip ederek silmeye dönüştürülmez.

## Silinen veri grubu

`assets/Levels/Ornek.level.json` için:

| Dosya / klasör | İçerik |
|---|---|
| `Ornek.landscapes/` | Terrain tanımları, tile'lar ve global haritalar |
| `Ornek.cells/` | World Partition, foliage hücreleri ve HLOD mesh'leri |
| `Ornek.foliage.json` | Level'ın foliage kuralları ve boyanmış bitkileri |
| `Ornek.meshpaint.json` | Level'a özgü mesh boyası |
| `Ornek.worldbrief.json` | Dünya özeti |
| `Ornek.worldrecipe.json` | Dünya üretim tarifi |
| `Ornek.hlod.json` | HLOD indeksi |
| `Ornek.foam/` | Level'a ait su köpüğü önbelleği |

Aynı sahiplik kuralı `.layout.json` ve eski düz `.json` level belgelerinde de
geçerlidir. Komşu `Ornek.regionprofile.json`, örtü profilleri, Foliage Type
dosyaları, model, materyal ve dokular bu listeye girmez; level onları kullanıyor
diye silinmezler. Başka klasördeki terrain referansları da kendiliğinden sahiplenilmez.

## Ortak kullanılanlar

Silme başlamadan önce projenin `public/` ağacındaki JSON belgeleri incelenir.
Başka bir belge silinecek veri grubuna referans veriyorsa o grup korunur. Ortak
terrain için `.landscapes/` bütünü korunur; böylece tanım kalırken tile veya global
haritanın silinmesi önlenir. Aynı koruma hücre ve köpük klasörleri için de geçerlidir.
Korunan JSON'un referansları da takip edilir; ortak foliage/HLOD indeksinin
örtük hücre bağımlılığı korunur. Aynı kökü kullanan alternatif level adları da
ortak yan dosya sahibi sayılır.

Ortak veri taşınmaz veya yeniden adlandırılmaz; yaşayan level'ın referansı
değişmez. Editörün sonuç mesajı silinen dosya sayısını ve korunan ortak veri
yollarını gösterir. Koruma klasör düzeyinde temkinlidir: ortak terrain klasöründeki
diğer veriler de kalabilir; işlem genel bir kullanılmayan dosya temizleyicisi değildir.

Bir klasörün tamamı silinirken içindeki level verilerini klasör dışındaki bir
belge kullanıyorsa silme reddedilir ve kullanılan yollar gösterilir. Böylece
klasör silme, tek level silmedeki ortak veri korumasını aşamaz. Aktif level'ın
tek başına silinmesi de sunucuda reddedilir; önce başka level varsayılan seçilir.

## Sınırlar ve doğrulama

Dosya taraması, yol sınırları, bağlantılı klasörler ve JSON okunabilirliği herhangi
bir dosya silinmeden kontrol edilir. Başka belgeyi incelemek mümkün değilse veri
sahipsiz kabul edilmez; işlem hata verir. Silme standart dosya sistemi işlemleridir;
işlem başladıktan sonraki disk hataları için çok dosyalı atomik geri alma yoktur.

Bu davranış Content Browser'ın `/__content-delete` işlemi içindir. Windows
Explorer, terminal veya Git ile yalnız level JSON'unu silmek bu işlemi tetiklemez;
önceden oluşmuş kalıntılar da yeni bir level silme işlemi olmadan otomatik temizlenmez.

Uygulama: `tools/levelContentDelete.ts`, `vite.config.ts`,
`src/project/ProjectAssetTree.ts`, `src/editor/EditorUi.ts`.
Regresyonlar: `tests/builder/project-roots.test.mjs`; gerçek yerel Vite sunucusu
ve izole geçici projelerle sahiplik, ortak/transitif bağımlılık, alternatif level,
aktif level, okunamayan JSON, bağlantılı klasör ve klasör silme senaryoları.

Doğrulama kaydı (8 Kasım 2026): `npx.cmd tsc --noEmit`, 10 proje/endpoint testi,
`npm.cmd run test:engine` ve tam `npm.cmd run build:verify` geçti. Tam koşuda
2571 motor kontrolü ile üretim çıktısı ve dünya verisi kontrolleri tamamlandı.
Editörde düğmeye basarak manuel tarayıcı kontrolü bu koşuda yapılmadı.
