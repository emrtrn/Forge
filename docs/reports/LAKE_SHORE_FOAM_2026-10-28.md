# Lake kıyı köpüğü — F1 ilk dilim, 2026-10-28

Plan ve araştırma `01b3f559` ile main'e gönderildikten sonra ilk uygulama yapıldı.
Bu dilim yalnız Lake kıyısı/ada köpüğüdür; taş proxy'leri, River temas maskesi,
yüzey görsel yenilemesi ve tekerlek dalgaları henüz yoktur.

## Kullanım

Lake seç → **Shore Foam → Enabled**. Opacity, Width (m), Pattern Size (m), Speed
alanları mevcut Lake edit/undo ve save yolunu kullanır. Eski kayıtlar kapalı
kalır. Kaynak/runtime ve save aynı allowlist'i kullanır. Mevcut River köpük
alanları ve kullanıcı sahneleri değiştirilmedi.

Köpük, hesap bounds'una değil `LakeGeometry.shore` içindeki gerçek kıyı ve ada
segmentlerine bağlıdır. Son yüzey yalnız bağlı su geometrisine çizildiğinden
kuru adada veya ayrı çukurda maske görüntülenmez. İki ölçekli hareketli parçalar
ve yakın görünümde gözenekler kullanır; ince ayrıntı uzakta filtrelenir.
Köpük premultiplied radiance üzerinden su/dip/yansıma ile karışıp straight alpha
çıktıya döner. Ambient ve güneş ışığına uyar; River'ın mevcut CSM alıcısını
kullanır. Emissive veya yeni reflection/shadow capture eklenmedi.

## Kaynak sınırı

Bant başına dört texel, eksen başına en çok 1024 texel, R8/lineer filtreli ve
mipmapsiz doku: en çok 1 MiB/göl. Yerel koordinatlarda üretildiğinden büyük
dünya origin'i distance maskesinin hassasiyetini değiştirmez. Her Lake yeniden
üretiminde yeni alan hesaplanır ve eski doku serbest bırakılır. Etkin olmayan
Lake için maske ayrılmaz. Büyük alan/dar bant kaynak sınırını aşarsa açık
`over-budget` sonucu oluşur; tüm su yüzeyi gizlenir, kaynak ayarlar korunur.
Genişliği artırmak veya hesap bounds'unu küçültmek yeniden üretimi mümkün kılar.

Segmentlerin yalnız yakın texel dikdörtgenleri gezilir; tüm texellerde bütün
kıyı segmentlerini sorgulayan tarama yoktur. Üretim halen senkrondur; worker/
zaman dilimleme, worst-case browser long task, toplam heap ve donanım GPU p95
kabulü bu ilk dilimde yapılmadı. Önceki caustics performans açıkları korunur.

## Doğrulama

Yeni engine regresyonları: dış/ada kıyısı, kıyı dışındaki derin bölge, büyük
origin eşitliği, eski varsayılanlar, hatalı alanların reddi, doku bütçesi ve
object dispose ile maske bırakma. Tarayıcı senaryosu gerçek shader derlemesi,
görünür köpük/animasyon, aynı draw sayısı, kuru bölge/adalar/ayrı çukur,
gece, UI kapatma/undo, bütçe reddi/düzeltme ve Save/Reload/runtime yolunu sınar.
Sonuçlar görev çıktısında ayrıca belirtilir; SwiftShader donanım performans
kanıtı değildir. Save/load alanları için Codex Security diff scan önerildi;
kullanıcı onayı olmadan çalıştırılmadı.

Son yerel doğrulama: `build:verify` çıkış 0, 1.962 engine kontrolü; köpük ve
caustics browser senaryoları birlikte 2/2 geçti. Son UI kapatma/undo ve bütçe
reddi/toparlanma ekleriyle köpük senaryosu tekrar 1/1 geçti; smoke TypeScript
kontrolü geçti. Yakın/genel/runtime görüntüleri incelendi. Bu bir ilk görsel
dilimdir; referans fotoğraflardaki taş/nehir/araç davranışlarının tamamı veya
nihai sanat/performance kabulü değildir. Kod henüz commit/push edilmedi.
