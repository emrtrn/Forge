# Arazi deformasyonu: iz kenarları ve parlamalar

Görsel düzeltme `engine/render-three/terrain/terrainDeformation.ts` içindedir.
Tekerlek/fizik hesapları, kayıt biçimi ve yazılmış sahne verileri değiştirilmedi.

- GPU'ya gönderilen derinlik ve disturbance kanalları bir hücre yarıçaplı
  3×3 tent filtresinden geçer. Bu yalnızca görsel kopyadır. Dirty bölgeler,
  komşuların güncel kalması için bir hücre genişletilir ve toroidal doku
  sınırlarında bölünür.
- Işık normali, vertex shader'ın kullandığı çökme + kenar kabarması + pencere
  sönümlemesi fonksiyonunun merkezî farklarından hesaplanır. Önceki üçgen
  başına sabit kabarma türevi kaldırıldı; taban eğimiyle deformasyon eğimi
  birleştirilir.
- Su maskesi deforme olmuş yüzeyin dünya eğimini kullanır. Dik iz duvarları
  ve yükselmiş kenarlar su maskesinden çıkarılır. Islak çamurda pürüzlülük
  düşüşü azaltıldı ve yumuşak bir alt sınır eklendi. Su roughness hedefi
  0.035 yerine 0.16; ortam haritası bulunmayan durumda analitik gökyüzü
  yansımasının etkisi azaltıldı.

Geometri detay ayarları korunur. Bu aşama 25 cm'lik geometrinin bütün
siluet köşelerini ortadan kaldırmayı hedeflemez; daha sık geometri ayrı bir
GPU maliyeti değerlendirmesi gerektirir. Dar izlerin görsel derinliği filtre
nedeniyle fizik derinliğinden biraz daha az olabilir.

## Doğrulama

Engine regresyonu fizik dizilerinin değişmediğini, filtre komşularının iki
doku sınırında da güncellendiğini ve kısmi kopyanın tam kopyayla eşitliğini
kontrol eder. Çapraz iz, decay, küçük recentre ve pencere dışına büyük
recentre senaryoları kapsanır.

`wet-mud.spec.ts` gerçek WebGL çıktısında taban, duvar ve kenar için su
maskesi/pürüzlülük/normal değerlerini okur; su kapalı durumda maskenin
sıfırlanmasını ve roughness haritasının etkisini kontrol eder. İki kamera
açısına ek olarak 25 cm geometride çapraz ve dar iz görüntüleri alınır.

Karşılaştırma çıktıları `test-results/deformation-before/` ve
`test-results/deformation-after/` altındadır. Bu kontrollü test sahnesi,
kullanıcının mevcut LandscapeTest ışığında GAZ-52 ile sürüş kabulünün
yerini tutmaz. Donanımda CPU/GPU performans karşılaştırması yapılmadı;
normal hesabının doku örneklemeleri arttı, CPU filtreleme komşu hücreleri okur.

Son koşular:

- `npx.cmd tsc --noEmit`: geçti. Smoke TypeScript kontrolü de geçti.
- `npm.cmd run build:verify`: geçti; 1.917 engine kontrolü, build, strict dist
  ve world-data doğrulaması dahil. Log: `test-results/deformation-build-verify.log`.
- Playwright `wet-mud.spec.ts --grep 'fifth layer renders'`: 1/1 geçti;
  sayfa/console hatası yok. Önce/sonra görüntüleri ve son çapraz/dar iz
  görüntüleri görsel olarak incelendi.
- Son WebGL profilinde taban su maskesi 1, roughness yaklaşık 0.161;
  iki duvarın su maskesi 0, roughness yaklaşık 0.322 ve 0.463 ölçüldü.
- `git diff --check`: geçti.

İlk esbuild/Playwright denemeleri sandbox dosya erişimi nedeniyle engellendi;
raporlanan başarılı koşular izin verilen sandbox dışı çalıştırmalardır.
