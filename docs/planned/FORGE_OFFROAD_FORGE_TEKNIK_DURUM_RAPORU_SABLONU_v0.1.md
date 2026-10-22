# Forge Offroad — Forge Teknik Yetenek ve Mevcut Durum Raporu

**Sürüm:** 0.1 (rapor şablonu)  
**İlgili proje:** Forge Offroad  
**Ana oyun deneyimi:** Lojistik ve taşımacılık  
**Dünya:** İzole dağ yerleşimleri  
**Rapor tarihi:** _(inceleme sırasında doldur)_  
**İncelenen repo / branch / commit:** _(inceleme sırasında doldur)_  

> **Amaç:** Forge'un mevcut yeteneklerini oyun tasarımına bağlamak; mevcut, test edilmiş özelliklerle henüz yalnız plan veya prototip olan özellikleri kesin biçimde ayırmak. Bu dosya GDD değil, GDD'ye dayanak sağlayan teknik envanterdir.

## 0. Kullanım talimatı

- Bu şablonu Forge repo erişimi olan kod asistanına ver.
- **Kod değiştirmeden**, mevcut uygulama, test ve belgeleri inceleyerek doldurmasını iste.
- Her özellik için şu durumlardan birini yaz: **Çalışıyor ve test edildi / Uygulandı fakat doğrulanmadı / Kısmen çalışıyor / Planlandı / Yok / Belirsiz**.
- Her teknik iddiayı mümkünse **dosya yolu + ilgili fonksiyon/sınıf + test adı** ile destekle.
- Belgelerde yazan bir özelliği kodda bulamadıysa “belgede var, kodda doğrulanmadı” olarak belirt.
- Uygulanmış özellik ile yeni öneriyi asla aynı başlıkta sunma.
- Uygulama sırasında hiçbir refactor, dependency kurulumu veya kod değişikliği yapma.
- Güvenlik anahtarları, erişim token'ları, .env değerleri, kullanıcı verileri ve büyük ikili assetleri rapora kopyalama.

## 1. Genel motor ve editör mimarisi

| Başlık | Mevcut teknoloji / açıklama | Durum | Kod / test kanıtı |
|---|---|---|---|
| Dil ve framework |  |  |  |
| Renderer ve API (ör. Three.js/WebGL/WebGPU) |  |  |  |
| Fizik altyapısı / kütüphane |  |  |  |
| Editör-runtime ayrımı |  |  |  |
| Actor / component mimarisi |  |  |  |
| Sahnelerin ve assetlerin kayıt biçimi |  |  |  |
| Asset loading ve streaming |  |  |  |
| Performans ölçümü ve debug araçları |  |  |  |

## 2. Landscape / arazi sistemleri

Aşağıdakiler için durum, ilgili dosyalar, veri modeli, runtime sınırlamaları ve mümkünse ekran görüntüsü/test referansı yaz:

- Landscape heightfield: çözünürlük, world scale, chunk/tile yapısı, veri tipi.
- Landscape oluşturma: manuel sculpt, paint, splines, heightmap import/export, procedural generation.
- Terrain collision: runtime temsili, collider güncelleme maliyeti.
- Yüzey bilgisi: dirt/mud/rock/grass gibi katmanlar; sürtünme ve fiziksel malzeme ilişkileri var mı?
- Editör değişiklikleri ile **oyun sırasında** gerçekleşen değişiklikler arasında ayrım.
- Araç geçişiyle deformasyon: **yalnızca iz/decal mı**, görsel mesh değişimi mi, yoksa collision/fiziksel yüzey de değişiyor mu?
- Deformasyonda güncelleme bölgesi, çözünürlük, kalıcılık ve save/reload davranışı.
- Büyük haritalarda chunk streaming, LOD, culling ve bellek yönetimi.
- Su, nehir, bataklık ve yol sistemleri.

### Kritik teknik ayrım

| Deformasyon düzeyi | Durum | Kanıt / açıklama |
|---|---|---|
| Tekerlek izi / görsel decal |  |  |
| Shader tabanlı yer değiştirme |  |  |
| Runtime render geometry değişimi |  |  |
| Runtime collision geometry değişimi |  |  |
| Zeminin batma / çekiş direnci hesabı |  |  |
| Deformasyonun kaydedilmesi |  |  |

## 3. Araç simülasyonu

| Sistem | Var mı? Durum | Nasıl çalışıyor? | Kod / test kanıtı |
|---|---|---|---|
| Sürülebilir araç, giriş kontrolleri |  |  |  |
| Rigid-body kütle ve ağırlık merkezi |  |  |  |
| Tekerlek collider / raycast yaklaşımı |  |  |  |
| Süspansiyon yay-sönümleme |  |  |  |
| Motor torku, vites, şanzıman |  |  |  |
| AWD/4WD ve diferansiyel kilidi |  |  |  |
| Yüzeye göre tutuş / kayma |  |  |  |
| Eğim / devrilme / çekiş limitleri |  |  |  |
| Yük kütlesi ve ağırlık merkezi etkisi |  |  |  |
| Römork / bağlantı sistemi |  |  |  |
| Vinç / halat / fizik kısıtları |  |  |  |
| Araç hasarı / yakıt |  |  |  |

## 4. Gameplay temel altyapısı

- Görev sistemi ve hedef işaretçileri mevcut mu?
- Yük alma, yük bağlama, yük bırakma, teslimat doğrulama mevcut mu?
- Harita, mini harita, waypoint ve navigasyon sistemleri mevcut mu?
- Oyun durumunu kaydetme / yükleme destekleniyor mu?
- Input (klavye/fare, gamepad, dokunmatik) durumları nedir?
- Kamera: üçüncü şahıs, kabin, serbest kamera vb.
- Debug HUD: hız, tork, tekerlek kuvveti, yüzey türü, fizik adım süresi.
- Ses, VFX ve UI üretim altyapısı.

## 5. Performans ve platform sınırları

Aşağıdaki değerler gerçek testte ölçülebiliyorsa gir; ölçülmediyse **Ölçülmedi** yaz.

| Ölçüm | Sahne / koşullar | Donanım / tarayıcı | Sonuç |
|---|---|---|---|
| FPS ortalama / düşüş |  |  |  |
| Physics step süresi |  |  |  |
| Terrain deformasyon güncelleme süresi |  |  |  |
| Draw call / triangle sayısı |  |  |  |
| RAM / VRAM tahmini |  |  |  |
| Büyük haritada sahne yükleme süresi |  |  |  |

Ayrıca hedef platformları belirt: masaüstü web, mobil web, paketlenmiş masaüstü vb. Bunları varsayma.

## 6. Gerçek test senaryoları — varsa

**T01 — Boş / yüklü araç karşılaştırması:** Aynı rota, aynı araç, iki yük kütlesi. Çekiş ve frenleme değişiyor mu?

**T02 — Çamur geçişi:** Araç çamura girince hız/çekiş/batma değişiyor mu? Ayrıntılı deformasyon düzeyi nedir?

**T03 — Taşlık eğim:** Çıkış kabiliyeti, tekerlek teması, devrilme ve sürüş hissi.

**T04 — Deformasyon kalıcılığı:** Aynı yerden ikinci kez geçince önceki iz / zemin tepkisi korunuyor mu? Save/reload sonrası ne oluyor?

**T05 — Uzun süre stabilite:** 10–15 dakika tekrarlı sürüşte FPS ve bellek davranışı.

Her test için: **sürüm, kullanılan sahne, araç, ayarlar, beklenen, gerçekleşen, bilinen hata, kısa yorum** yaz.

## 7. Eksikler, riskler ve tasarım etkisi

En fazla 10 önemli bulgu içeren tablo:

| Risk / eksik | Kanıt | Oyun tasarımına etkisi | Önerilen öncelik |
|---|---|---|---|
|  |  |  |  |

Öncelik: P0 = çekirdek oynanışı engelliyor, P1 = ilk oynanabilir sürüm için önemli, P2 = sonraya bırakılabilir.

## 8. Karar için kısa yönetici özeti

- **Bugün güvenle tasarlayabileceğimiz mekanikler:**
- **Prototiple doğrulamamız gereken mekanikler:**
- **Şimdilik kapsam dışı tutulması gerekenler:**
- **Bir sonraki en değerli üç teknik test:**

---

## Kod asistanına gönderilecek tek parça talimat

Aşağıdaki görevi FORGE_OFFROAD_FORGE_TEKNIK_DURUM_RAPORU_SABLONU_v0.1.md şablonuna göre gerçekleştir:

“Forge Offroad adlı yeni bir lojistik ve arazi taşımacılığı oyunu geliştiriyoruz. Oyun dünyası izole dağ yerleşimleri. Mevcut Forge editör ve motor kod deposunu **yalnızca incele**; hiçbir kodu veya bağımlılığı değiştirme. Hedefim Forge'un gerçekte hangi teknik yeteneklere sahip olduğunu, hangilerinin test edildiğini, hangilerinin yalnız belge veya prototip düzeyinde olduğunu öğrenmek. Özellikle Three.js/render altyapısı, kullanılan fizik kütüphanesi, Landscape/heightfield veri akışı, editör arazi üretimi ile runtime deformasyon farkı, dinamik collision güncellemesi, lastik-zemin etkileşimi, araç fiziği, yük kütlesinin fizik etkileri, görev sistemleri, büyük dünya optimizasyonu ve performans testleri üzerine odaklan. Raporu bu şablonun tüm bölümlerini doldurarak Markdown olarak üret. Her doğrulanabilir bulguya dosya yolu ve mümkünse sınıf/fonksiyon/test referansı ekle. Belgede anlatılan ancak kodda doğrulanamayan yetenekleri kesinlikle çalışıyor diye yazma. Bilmediğin noktaları 'Belirsiz' olarak işaretle, önerilerini mevcut sistemlerden açıkça ayır. Sonuna en fazla 10 maddelik teknik risk listesi ile en değerli üç sonraki testi ekle.”
