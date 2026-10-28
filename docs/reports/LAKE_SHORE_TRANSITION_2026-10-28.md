# Lake kıyı geçişi — 2026-10-28

Kullanıcının onayladığı ilk uygulama, mevcut Lake geometrisini değiştirmeden
kıyıdaki su/zemin çizgisini yumuşatır. Islak zemin boyası, taş proxy'leri ve
tekerlek dalgaları bu değişikliğe dahil değildir.

- Appearance → **Shore Blend Depth (m)**: varsayılan 0,25 m; aralık 0–2 m.
  0 geçişi kapatır. Bu düşey derinliktir; aynı ayar sığ kıyıda daha geniş,
  dik kıyıda daha dar yatay geçiş verir.
- Kıyıdaki katsayı, kaynak geometri derinliği ve varsa görünür dip derinliğinin
  küçüğünden çıkar. Dünya koordinatında yavaş noise genişliği ±%15 çeşitlendirir.
  Su düzlemi/kıyı vertex'leri oynamaz; ayrı çukur veya kuru adaya yüzey eklenmez.
- Yüzey normalleri kıyıya yaklaşırken sakinleşir. Son su ışığı, yansıma,
  parlama ve köpük birlikte söner; köpük sert beyaz bir kenar oluşturmaz.
- Snapshot yolunda son kompozit gerçek dip rengine karıştırılır; fallback'te
  straight alpha azaltılır. Salt opaklık değişimiyle snapshot dip rengini iki
  kere harmanlama sorunu önlenir. Yeni capture/draw/mesafe dokusu yoktur.
- Parametre ortak runtime/save validator ve mevcut undo/Save/Reload yolundadır.

Test yaklaşımı: aynı sabit zamanda açık/kapalı geçiş, köpük açık/kapalı;
postprocess snapshot ve snapshot içermeyen offscreen fallback pixel readback;
sığ/dik kıyı, kuru ada/ayrı çukur ve geçiş dışındaki derin bölge; gerçek kayıt ve
runtime. Offscreen readback gerçek bir MSAA cihaz/driver kabulü sayılmaz.

İlk görsel sonuç ve yerel doğrulama görev çıktısında kaydedilir. Donanım GPU
p95, en kötü büyük dünya maliyeti ve ıslak kıyı bandı açık kalır. Kaynak
sahneler değiştirilmez; kod henüz commit/push edilmedi.

Son kaynakla yerel sonuç: `build:verify` çıkış 0; TypeScript, **1.962 engine
kontrolü**, production build, strict dist ve world-data geçti. Caustics,
köpük/kayıt/runtime ve dik kıyı senaryoları tek koşuda **3/3 geçti (1,4 dakika)**.
Snapshot ve lineer RGB8 offscreen fallback farklı renk uzaylarına uygun piksel
ölçümleriyle karşılaştırıldı; fallback'te derin probe değişmedi, kıyı probe'u
geçişe tepki verdi. Sığ/dik yakın kıyı görüntüleri incelendi. Donanım GPU veya
MSAA cihaz kabulü olarak sayılmaz. Smoke TypeScript ve diff whitespace kontrolü
geçti. Önceki tanı koşuları başarı olarak sayılmadı.
