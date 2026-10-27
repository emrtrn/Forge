# Water surface v4 — QA envanteri

27 Ekim 2026. Görsel kabul, motor/browser testlerinden ayrı değerlendirilir.

| İddia / durum | Kontrol ve görsel kanıt |
|---|---|
| Planar yalnız gölde | Nehir GPU kadrajında capture sayısı; environment/probe optik testi; birikinti kalite testlerinde captures/groups=0 |
| Lake-1 havza etkisi azalır | Aynı kamerada v3/v4/off; baked-path ve scalar-loss karşı deneyleri; alçak kamera; PNG açılarak değerlendirme |
| Lake-3 sakin, dip görünür | Kıyı/alçak/üst kamera; t=12/14; kontrast ve derinlik optik testi |
| Derinlik gerçek ekrandaki dibe aittir | Geometrinin baked depth'i 0.1 m iken gerçek yatağı 5 m'ye taşıyan perspektif/ortografik regresyon |
| Nehir akışı/yerel köpük korunur | Dört kamera, t=12/14; akış/foam Save/Reload/Play testi; sığ kıyı glint fade incelemesi |
| Birikinti kahverengi ve sığdır | Gerçek GAZ-52 runtime ve wet-mud PNG'leri; wheel/ripple/shoreline kontrolleri |
| Göl kopyası ek sahne render'ı yapmaz | Gerçek SceneApp composer sınırında GPU timer; kare başına sceneCopies ve draw/capture sayaçları |
| Kaynaklar büyümez | Browser'da iki composer ısındıktan sonra exact texture-count eşitliği; hidden→visible kaynak bırakma/yeniden üretme |
| Authored veri korunur | Kaynak/kopya 19 SHA-256; review GET/HEAD dışını engeller; Git diff |
| Galeri kontrolleri | Önce/sonra/off/karşılaştır/slider/t=14 gerçek girdileri; tüm PNG yükleri; 600 px taşma kontrolü |

Keşif: kamera/Low/Medium/High ve hareket aç/kapat; su off→on döngüsü; düşük ve üstten bakış. Sınır durumları: gerçek dip ile baked depth uyuşmazlığı; gizleme ve tekrar oluşturma; doğrudan canvas ve MSAA composer için eski optik fallback. Reversed-Z ve karmaşık transparan çakışmalar bu turda tam görsel kabul değildir.
