# River R2 — Dip optiği, renk ve kıyı geçişi

**Güncel karar:** Kullanıcı isteğiyle stil ayrımı kaldırıldı; bu optik yol artık
bütün nehirlerde varsayılandır. Aşağıdaki profil geçişi kanıtları sadeleştirmeden
önceki R2 teslimine aittir. Yeni kontroller
[tek yüzey raporunda](RIVER_SURFACE_UNIFIED_2026-10-30.md) izlenir.

Tarih: 30 Ekim 2026. Ana plan: [§7.1 R2](../planned/WATER_SYSTEM_DEVELOPMENT_PLAN.md).

Durum: İlk uygulama Lake-like profiline eklendi. Teknik doğrulama sonuçları
aşağıda izlenir; kullanıcı görsel kabulü ve gerçek GPU performans kabulü açık.
R3 ekran kırılması bu teslimde uygulanmadı.

## Kullanım ve değişen davranış

Landscape → Water → River → Flow & Waves → **Surface Style: Lake-like**.
Yeni kalıcı alan veya ayrı kontrol yoktur. Bed Visibility, Absorption Distance,
Opacity, sığ/derin renkler ve mevcut yüzey kontrolleri kullanılır. Legacy
profili eski optik yolu korur; kullanıcı sahnesine profil otomatik yazılmaz.

- River-only sahnelerde de ortak `WaterSceneSnapshot` renk/depth kopyası
  kullanılır. Snapshot desteklenmiyorsa şeffaf dip birleşimine dönülür.
- Görünür dip ile çizilen yüzey arasındaki görüş ışını uzunluğu kanal bazlı
  üstel soğurmayı belirler. Yerel geometrik normal üzerindeki kalınlık, normalin
  Y bileşeniyle düşey derinliğe çevrilir; kıyı bantlarında bu değer kullanılır.
  Lake'in sabit su kotu taşınmaz. Perspektif ve orthographic kamera desteklenir.
- Sığ/derin renk saçılması su sütunu boyunca bütünleştirilir. Lake-like
  profilinde eski 0.84–1.16 renk türbülansı kaldırılır; akış normallerde ve
  köpükte devam eder. Geometrik dalga ve CPU su sorgusu değişmez.
- Su hacminin doğrudan güneş katkısı mevcut single/CSM gölge görünürlüğüyle
  azaltılır; ortam katkısı ayrı kalır.
- Kaynak mesh derinliği ve görünür dip derinliğinin küçüğü kıyı geçişini belirler.
  Mikro normal sönümlenir; köpük dahil son renk gerçek dibe bağlanır. Su kapsamı
  genişletilmez; mevcut kuru dip/eksik terrain discard davranışı korunur.
- Snapshot birleşimi alpha 1 üretir: önceden birleştirilmiş dip ikinci kez alpha
  ile karıştırılmaz. AO için mevcut `compositedWaterSurface` sözleşmesi kullanılır.
- Lake shader'ı, görünüm ayarları, terrain, ışıklar ve köpük bake akışı değişmez.

## Çizim sırası ve kaynak sahipliği

Su yüzeylerinin mevcut render sırası korunur. Snapshot sahibinin boş geometrili
şeffaf işaretçisi opaque çizimden sonra, şeffaf yüzeylerden önce renk/depth'i
bir kez kopyalar. İşaretçi GPU draw üretmez; derinlik/normal override geçişinde
kopya almaz. Bütün Lake/River tüketicileri aynı opaque girdiyi okur; su veya camın
önce çizilmesi snapshot'a sızmaz. Ayrı sahne render'ı eklenmez.

Üst üste gelen şeffaf su yüzeylerinde son çizim kazanır; aralarındaki hacimleri
birleştiren yeni bir Water Body/derinlik çözümü eklenmez. Her yüzey aynı su öncesi
girdiyi okur; önceki Lake/River görüntüsüne geri besleme yoktur. Kırılma olmadığı
için komşu UV veya başka su kotundan kaydırılmış renk örneklenmez.

River kendi render target'ını oluşturmaz. Post-process pipeline ortak snapshot'ın
sahibidir; görünür son tüketici ayrıldığında mevcut `begin()` temizliği kaynakları
bırakır. Direct, depth texture olmayan, çözümlenmemiş MSAA ve başka kamera
yollarında snapshot kapalıdır. Global River kalite politikası R4 kapsamındadır;
bu teslim global Lake kalite tavanlarının River'a bağlandığını iddia etmez.

## Doğrulama

- `npx.cmd tsc --noEmit`: geçti; son kaynak `build:verify` içinde de denetlendi.
- `npm.cmd run test:engine`: 2167 kontrol geçti. Son `build:verify` koşusunda
  slow engine dahil 2167 kontrol tekrar geçti.
- `npm.cmd run build:verify`: geçti, çıkış kodu 0; strict runtime-only dist ve
  dünya verisi denetimi dahil.
- Optik Playwright suite: **20/20 geçti**; Lake ve Legacy regresyonları dahil.
- Gerçek editör Save/Reload/runtime testi: **1/1 geçti**; stil seçimi, undo/redo,
  sayısal kontroller, sculpt/undo, kayıt ve runtime aktarımı dahil. Son birleşik
  tarayıcı koşusu **21/21 geçti**.

Yeni Playwright kontrolleri:

- Eğimli ve taşınmış/döndürülmüş River'da görünür dip derinliği ve kanal bazlı renk.
- Perspektif/orthographic sığ kıyı; derin kaynak mesh'e rağmen dipte yumuşak geçiş.
- Lake/River öncesi Legacy çizimi, ters sıra ve kare başına tek kopya.
- Erken çizilen şeffaf kırmızı camın opaque dip kopyasına sızmaması.
- Single/CSM gölgede su hacminin güneş katkısının azalması, gölgesiz fallback.
- 20 Legacy/Lake-like geçişinde snapshot bırakma/yeniden kurma; direct fallback.

Sistem Chromium/ANGLE Vulkan **SwiftShader** kullanıldı; GPU timer yok.
Tek nehir fixture'ında snapshot kare başına 1 kopya ve toplam 3 GPU draw
(dip, su, output) üretti; boş işaretçi draw eklemedi. Her iki composer eki
serbest bırakılıp yeniden kurularak 20 profil geçişinde kaynak sayısının
kararlı kaldığı doğrulandı. Bunlar byte veya donanım maliyeti ölçümü değildir.

Kanıtlar:

- [Görünür dip ve dönüşüm](evidence/river-bed-optics-r2/river-r2-depth.json),
  [perspektif görüntü](evidence/river-bed-optics-r2/river-r2-depth-false.png).
- [Kıyı/normal/köpük geçişi](evidence/river-bed-optics-r2/river-r2-shore.json).
- [Single/CSM gölgeleri](evidence/river-bed-optics-r2/river-r2-shadow.json).
- [Ortak kopya, erken cam, çizim sırası ve kaynaklar](evidence/river-bed-optics-r2/river-r2-shared-copy.json).
- [Editör/runtime kayıt karşılaştırması](evidence/river-bed-optics-r2/world-river.json),
  [editör](evidence/river-bed-optics-r2/world-river-editor.png) ve
  [runtime](evidence/river-bed-optics-r2/world-river-runtime.png) görüntüleri.

Gerçek GPU AB/BA süresi, transient byte tepesi, production tarayıcı koşusu ve
kullanıcı sahnesinin gündüz/gölge/gece görsel kabulü ayrıca açıktır. Texture sayısı
ve yazılım WebGL kontrolü bu kabul katmanlarının yerine geçmez.
