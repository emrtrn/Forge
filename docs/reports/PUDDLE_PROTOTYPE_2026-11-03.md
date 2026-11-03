# Puddle avlu prototipi — 3 Kasım 2026

Durum: **İzole prototip uygulandı ve teknik doğrulandı.** Kullanıcının görsel
kabulü, production entegrasyonu ve hedef donanım performans kabulü açık.
[Uygulama planı ve sonraki dilimler](../planned/PUDDLE_DEVELOPMENT_PLAN.md).

## Sonuç

Mevcut CPU-otoriter tekerlek iz alanı, gerçek çamur geometrisi ve ayrı yatay
Puddle yüzeyi birlikte çalışıyor. Yatak vertex'leri çöker ve iz kenarı yükselir;
aynı yatak üçgenleri su seviyesinde kırpılır. Başlangıç noktasına bağlı çukur
dolar; ada ve ayrı çukur birbirine bağlanmaz. Örnekte iki ayrı çukur seçilidir.

Kontrollü geçişte iz derinliği 15 cm'ye ulaşır. Su seviyesi −2 cm'de kalırken
toplam kaplanan alan yaklaşık 8,48 m²'den 12,57 m²'ye çıkar. Suyu gizlemek
geometrik oyukları kaldırmaz. Su seviyesini −6 cm'ye indirmek alanı azaltır,
zemindeki iz derinliğini değiştirmez.

Görünüm temel teknik gösterimdir; referanstaki depo sahnesinin materyal/asset
kalitesi, yağmur ve nihai su optiği teslim edilmiş değildir. Araç kontrollü bir
temas kaynağıdır; bu sayfa Rapier sürüş/fizik entegrasyonu değildir.

## Deneme

Repo kökünde `npm run dev:local`, ardından:
`http://127.0.0.1:5173/tests/smoke/pages/terrain-puddle.html`.

Çukura sol tıklama su ekler; sağ fare kamerayı döndürür, fare tekeri yakınlaştırır.
**Aracı geçir**, su seviyesi, suyu göster/gizle ve **Sıfırla** kontrolleri vardır.
Demo sayfası test/dev kapsamındadır; oyun başlangıç seviyesi değiştirilmedi.

## Kanıt

- [Başlangıç](evidence/puddle-prototype/puddle-before.png)
- [Geçiş sonrası su ve oyuklar](evidence/puddle-prototype/puddle-ruts.png)
- [Su gizliyken gerçek zemin geometrisi](evidence/puddle-prototype/puddle-ruts-water-off.png)

## Doğrulama

- `npx tsc --noEmit`: geçti; ayrıca `build:verify` üretim derlemesinin parçası.
- `npm run build:verify`: geçti; **2232 engine kontrolü**, smoke fixture/content/UI
  tür kontrolleri, builder kontrolleri, üretim derlemesi, strict dist ve world-data.
- `npx playwright test terrain-puddle.spec.ts`: **1 geçti** (38 s test süresi).
  Gerçek WebGL ile alan/derinlik değişimi, sabit seviye, seviye değişirken izlerin
  korunması, konsol/WebGL hataları ve 12 reset sonrası geometri sayısı doğrulandı.
- Yeni engine kapsamı: bağlı çukur ve ada, yatay su, eksik terrain ve açık sınır,
  geçerli geometriyi başarısız rebuild'de koruma, hücre bütçesi ve gerçek
  `DeformationField.stampWheel` ile genişleyen su alanı.
- Bulut tarayıcısı yazılım WebGL kullanıyor. Test süresi GPU kare süresi değildir;
  hedef GPU, transient bellek ve CPU dilim bütçesi henüz ölçülmedi.

## Mimari ve açık sınırlar

Çekirdek en fazla 128×128 hücre kabul eder; fixture 96×96 hücre, 12,5 cm aralıklı
12 m avludur. Su seviyesine erişen açık çalışma sınırı ve eksik terrain açık
sonuç üretir; önceki geçerli yüzey korunur. Geometri revizyonları fixture'da
100 ms aralıklarla birleştirilir, senkron rebuild hâlâ production bütçesi ister.

Yansıma için aynı seviyedeki bütün birikintiler mevcut tek Medium planar kaynağı
paylaşır; gövde başına capture yoktur. Ortam yansıması fallback'i ve kıyı alpha
geçişi vardır. En fazla 12 kısa ömürlü analitik dalga tutulur. Dalga yayılımının
kuru adalarda kesilmesi ve Lake/River ile ortak fizik temas aboneliği sonraki iştir.

Collider sabittir. Mevcut araç sistemindeki süspansiyon/kuvvet tabanlı gömülme
yaklaşımı değişmez; her rigid body için deforme collider sağlanmış değildir.
Su miktarı korunumu, çukurda kendiliğinden su oluşması, taşma, buharlaşma ve yağmur
simülasyonu yoktur. Runtime izler authored terrain'e yazılmaz.

Landscape Puddle modu, Paint/physical material bağlantısı, kalıcı Water Body
şeması, undo/redo, disk save/load, gerçek World Terrain/CDLOD/streaming ve canlı
araç bağlantısı henüz yapılmadı. W3 tamamlandı olarak işaretlenmedi. Sonraki
uygulama dilimleri Puddle planında listelenir.
