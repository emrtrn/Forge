# World Builder — Coast alan dağılımı, sığ kıyı ve ada biçimi

9 Kasım 2026; A1/A2/A3 güncellemesi 10 Kasım 2026. Kullanıcıyla netleştirilen plan.
**Durum: A1/A2/A3 uygulandı. A3 engine/browser geçti; birleşik kapının proje-root
kapanış sınırı raporda. A4 bekliyor.** Small/Medium Island ve Coast tesliminin devamıdır;
Large desteği veya Ocean'ın tam performans kabulü değildir.

Dayanak: [Ocean ana planı](OCEAN_DEVELOPMENT_PLAN.md),
[Medium uygulama raporu](../reports/OCEAN_MEDIUM_WORLD_BUILDER.md),
[Random World planı](../world-builder/RANDOM_WORLD_PLAN.md).

## Onaylanan hedefler

- **Coast:** harita içindeki alanın yaklaşık %70'i iç kara/oyun alanı,
  %30'u **kuru kumsal + sığ deniz + derin deniz** olacak. Kumsal bu %30'un
  içindedir; %70 iç karaya sonradan eklenerek oyun alanını azaltmaz.
  Harita dışında devam eden Ocean hesaba katılmaz. Nehir/göl alanları kıyı
  dağılımından ayrı raporlanır. %70, bütün arazinin düz/sürüşe uygun olacağı
  garantisi değildir; mevcut relief ve güvenlik kuralları sürer.
- Coast'un görünen kuru kum şeridi mevcut genişliğinin **2–3 katı** olacak;
  başlangıç hedefi yaklaşık **2,5 kat**. Ölçü, boyanmış kuru kumsalın gerçek
  genişliğidir; `shoreWidth` parametresini çarpmak tek başına kabul değildir.
- **Island ve Coast:** kıyıdan bir süre sığ ilerleyen, ardından kesintisiz
  derinleşen su altı profili. İlk görsel ayar önerisi: kıyıdan 30–40 m açıkta
  yaklaşık 2 m derinlik; 120–180 m açıkta mevcut derin deniz seviyesine yaklaşma.
  Bunlar Small/Medium görüntüleriyle ayarlanacak başlangıç değerleridir.
  Coast'ta bu profil de %30'luk bölüm içinde kalır.
- **Island:** kumsal dahil toplam kara/deniz oranı korunacak. Roll Dice,
  benzer yumuşak oval şekiller yerine farklı ana biçim, yön, büyük koylar,
  burunlar ve yarımadalar üretecek. Kullanıcının kırmızı çizgili referansındaki
  gibi bazı uzantılar harita kenarlarına yaklaşarak çerçeveyi daha iyi dolduracak;
  içeri giren koylar toplam kara alanını dengeleyecek. Çerçeveye yayılma, toplam
  kara miktarını artırma anlamına gelmez. Küçük kıyı ayrıntıları ana biçimin
  üzerine eklenecek; aynı seed aynı sonucu verecek.
- Kıyıya vurup kırılan dalgalar sonraki ayrı çalışmadır. Sığlık, mevcut
  derinliğe bağlı sakinleşmeden yararlanır; tek başına tam köpük/kırılma teslimi
  olarak değerlendirilmez.

## Mevcut nedenler ve başlangıç noktaları

Plan kaydı sırasında kaynak incelemesi:

- `engine/worldbuilder/randomWorld.ts`: Coast merkezi `[0,0]`; bu, doğal kıyı
  salınımlarıyla yaklaşık yarı yarıya kara/deniz üretir. Island yarıçapı dünya
  kenarının `0.37` katıdır. İkisinde `shoreWidth: 60`, derin deniz 40 m'dir.
- `engine/worldbuilder/island.ts`: Island iki düşük frekanslı radyal sinüsle
  şekillenir; seed fazı değiştirir. Coast çizgisi ve tüm ortak kıyı sorgusu da
  buradadır. Deniz tabanı mevcut üstel eğriyle hızlı derinleşir; kıyıdan 10 m
  açıkta yaklaşık 6,1 m derinlik olur.
- `engine/worldbuilder/groundCover.ts` ve
  `tools/world/worldBriefTemporarySteps.ts`: kıyı boyası mesafe eşikleri içerir.
  Kumsal genişletilirken bu yolların uyumu ve foliage dışlama sınırları incelenir.
- `engine/worldbuilder/randomWorldPreview.ts`, `briefTerrain.ts`, `masks.ts`,
  `randomWater.ts`, `siteSelection.ts`: önizleme, gerçek taban, kara güvenliği
  ve drenaj aynı kıyıyı izlemeli.
- `engine/render-three/ocean/oceanSurface.ts`: dalga deplasmanı 0–5 m;
  `oceanOptics.ts`: yüzey normali 0–4 m derinlik bandında yumuşar. Hızlı
  derinleşme yüzünden mevcut sakin kıyı bandı yatayda dar kalır.

## Uygulama dilimleri

### A1 — Coast alan oranı ve kuru kumsal (uygulandı)

[Ölçüm, uygulama ve kanıt raporu](../reports/WORLD_BUILDER_COAST_A1.md).
Small/Medium × dört yön × seed 4/11/29 için native tile ölçümünde iç kara
%69,994–70,032; kıyıya dik ortalama kuru kumsal 23,61–23,82 m'den
60,32–60,82 m'ye çıktı (aynı senaryoda 2,548–2,555 kat). Boya eşiği %50'dir;
kumsal %30'un içindedir. Nehir/göl içermeyen oran matrisi, iç su testlerinden
ayrı tutulur. Kaynak alanı, gerçek tile boyası/yüksekliği, legacy brief ve
Small/Medium Create–Save–Reload–Play/dar–geniş ağız kanıtları rapordadır.
Yeni `coast.beachWidth` yalnız yeni üretimde yazılır; eski açık `shoreWidth`,
Island ve su altı eğrisi korunur. A1'de bulunan harita kenarı inlet kesilmesi,
yeni Coast drenajında canlı şeridin 10× genişliğini de içeride tutarak giderildi.

Oran ve kumsal aynı sınırlı teslimde yapılır; böylece oran ayarlandıktan sonra
kumsalı büyütmek %70 iç araziyi tekrar daraltmaz.

1. Small/Medium, dört deniz yönü ve birden fazla sabit seed için mevcut kıyı,
   kuru kumsal genişliği ve iç kara alanını ölç. Kumsal sınırının ölçüm tanımını
   açıkça kaydet; yumuşak boya geçişinde kullanılan eşik raporda belirtilecek.
2. Coast'un yeni varsayılanını %70 iç arazi / %30 kumsal+deniz olarak kur.
   Deniz yönüne göre kıyıyı kaydır; doğal girintileri koru. Kumsal genişliği
   başlangıçta yaklaşık 2,5 kat, kabul aralığı 2–3 kat olsun. İç kara oranı
   için başlangıç toleransı ±2 yüzde puandır; seed ve boyut sonuçları raporlanır.
3. Önizleme, üretim, kıyı boyası, foliage ve yerleşim/yol güvenliğini tutarlı
   tut. Nehir ağzı konumu yeni kıyıyı izlesin; canlı Width Scale ve inlet
   sahipliğinde boşluk veya çift yüzey oluşmasın.
4. Önceki kayıtlardaki açık parametrelerin anlamını sessizce değiştirmekten
   kaçın; yeni varsayılanları yeni World Builder üretimine uygula. Mevcut
   kullanıcı sahnesini yeniden üretme veya kayıt verisini dönüştürme.
5. İlgili engine/TypeScript kontrolleri ve izole browser görüntüleriyle doğrula;
   sonuç, ölçüm yöntemi ve kalan sınırları rapora işle.

**A1 dışında:** sığ su taban eğrisini değiştirmek, Island biçimini/kumsalını
değiştirmek, yeni dalga veya köpük sistemi. Bunlar sonraki dilimlerdir.

### A2 — Island/Coast sığ kıyı profili (uygulandı)

[Ölçüm ve kabul raporu](../reports/WORLD_BUILDER_SHORE_A2.md).
Yeni Island/Coast üretiminde su altı profili, kuru rampadan bağımsız olarak
35 m / 2 m sığlık ve 150 m / 40 m derin taban noktalarıyla kurulur. İki eğri
parçası kıyıda, sığ bandın sonunda ve derin tabanda sürekli eğimle birleşir.
30 kaynak senaryosunda kıyı çizgisi ve örneklenen kuru yükseklik farkı sıfır;
Coast iç kara oranı %69,994–70,032 olarak korunur. Dört native çiftte 35 m
açıkta yaklaşık 2 m derinlik doğrulandı. Small Island'ın bazı normal kesitleri
150 m'de native domain dışındadır; mevcut offshore devamıyla 36,54–40 m,
180 m'de 39,67–40 m ölçülür. Bu sınır raporda ayrıca tutulur.
Mevcut renderer kullanıldı; GPU probe ve yakın editör/Play görüntüleriyle
sakinleşme doğrulandı. Yeni kırılan dalga/köpük sistemi eklenmedi. Eski brief'ler
`shoreProfile` yoksa üstel eğrisini korur; kullanıcı sahnesi dönüştürülmez.

- Kuru kıyı eğiminden bağımsız, sığ bant ve ardından yumuşak derinleşme kur.
  Ani basamak, su deliği veya dalga altında açılan kuru taban oluşmasın.
- Small/Medium'da önerilen fiziksel genişlikleri değerlendir; Coast %70/%30
  dağılımı, Island kıyı çizgisi/toplam kara alanı ve Ocean bağlantısı korunsun.
- Önce mevcut renderer'ın derinlik tepkisini kullan ve yakın görüntülerle
  sakinleşmeyi doğrula. Yetersiz kalırsa bulguyu raporla; kıyıya vuran dalga
  sistemini bu işin içine genişletme.

### A3 — Island ana biçim ve seed çeşitliliği (uygulandı)

[Uygulama, aynı-seed ölçümler ve yan yana görseller](../reports/WORLD_BUILDER_ISLAND_A3.md).
Yeni adalar, seed'den ana yön/asimetri ve büyük koy/burun/yarımadalarla üretilen
128 örnekli açık bir kıyı biçimi saklar. Alan, eski adanın analitik alanına
kalibre edilir. Small/Medium × altı seed kaynak matrisinde yaklaşık %43,153 kara
korundu; dört native karşılaştırmada 8 m alan örneklemesinin farkı en fazla
0,0855 yüzde puan. En yakın kıyı uzantıları Small'da 32–41 m, Medium'da 62–80 m
kenar payı bırakır. 40 m kıyı payı çıkarılan çekirdek 12 örnekte tek bağlı
parçadır. Gerçek yerleşim/yol/foliage, iç Lake/Ocean ayrımı ve S/R/Play
doğrulandı; eski `radius` kayıtları değişmez. A2 profili ve Coast yolu korunur.
2610 tam engine kontrolü ve browser senaryoları geçti. Birleşik `build:verify`
ilgili olmayan `project-roots` dosyasının kontroller sonrası kapanmamasıyla
kesildi; henüz çalışmamış kalan kapılar ayrıca başarılı tamamlandı.

- Önce mevcut aynı-seed kara alanlarını ölç ve karşılaştırma baseline'ı kaydet.
- Seed'den ana biçim, yön/asimetri, büyük koy/burun/yarımada ve daha küçük
  girintileri türet. Yalnız küçük radyal titreşim veya faz değişimiyle yetinme.
- Alanı baseline'a göre dengele; kenarda deniz bandı, bağlantı ve kullanılabilir
  kara geçitleri korunsun. Çok ince uzantı veya harita kenarına taşan kara üretme.
- Farklı seed'leri yan yana göster; önizleme ve gerçek terrain aynı şekli izlesin.
  Yerleşim/yol/göl güvenliği yeniden doğrulansın. Ada'da nehir eklenmesin.

### A4 — Birleşik görsel ve regresyon kabulü (bekliyor)

Her dilim kendi kontrolleriyle teslim edilir; bu son aşama birleşik sonucu kapsar.

- Small/Medium; Island/Coast; Coast West/East/North/South; farklı seed ve Roll Dice.
- Ölçülen Coast iç kara/kumsal/deniz alanları, kuru kumsal genişliği ve kıyıya
  uzaklığa göre derinlik örnekleri. Island toplam kara oranı ve biçim çeşitliliği.
- Editör ve gerçek Play'de kuşbakışı ve yakın kıyı görüntüleri; Coast dar/geniş
  nehir ağzı, width undo/redo, Save/Reload; console/shader hataları.
- TypeScript değişikliklerinden sonra `npx.cmd tsc --noEmit`; ilgili engine
  kontrolleri ve uygun build/browser kapıları. Önceden geçmiş kontroller yalnız
  yeni değişikliğin gerektirdiği ölçüde tekrarlanır.

## Korunacak çalışmalar ve kapsam

- Mevcut Small/Medium atlas, cooperative hazırlık, revision/atomik yayın,
  River Width Scale ve inlet geçişi korunur. Large kapalı kalır.
- Gerçek kullanıcı projesi yerine `.playwright-smoke/run-*` izole projesi kullanılır.
  `public/project.3dgame.json`, manifest, `Levels/S1*` ve diğer eşzamanlı kullanıcı
  verilerine dokunulmaz; güncel Git durumuyla sahiplik yeniden kontrol edilir.
  `docs/planned/FORGE_WEBGPU_EDITION_MASTER_PLAN.md` kapsam dışıdır.
- Commit/push yapılmaz. İlk plan kaydı yalnız dokümandı; A1/A2/A3 kod, ölçüm ve
  doğrulama sonuçları bağlantılı uygulama raporunda ayrıca kaydedilir.
