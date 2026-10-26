# FORGE WORLD ENVIRONMENT — CODEX K0 / WES-001
## Güncel kod incelemesi ve ilk uygulama yolunun doğrulanması

**Tarih:** 26 Ekim 2026  
**Kaynak tasarım:** `FORGE_WORLD_ENVIRONMENT_MEVSIM_HAVA_ZAMAN_TEKNIK_TASARIM_VE_UYGULAMA_PLANI_v0.2.md`  
**İlişkili plan:** `FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.1.md`  
**İş türü:** **YALNIZ ANALİZ, KOD DEĞİŞTİRME**  
**Çıktı:** `WES_K0_KAPASITE_VE_ENTEGRASYON_RAPORU.md` (önerilen ad)

## Görev tanımı — Codex'e doğrudan verilebilir

Forge'un ortak motor + editör kaynak kodunda, mevsimler/hava/gün–gece sisteminin en küçük güvenli entegrasyonunu analiz et. Bu turda kod, proje konfigürasyonu, level/asset, Git geçmişi veya bağımlılıklar üzerinde değişiklik yapma. Repo içindeki geçerli `AGENTS.md` ve talimatları öncelikle oku. Aktif branch/HEAD ve `git status` bilgilerini kaydet; kullanıcı değişikliklerini koru.

### Kesinleşmiş ürün kararları

1. **Kademeli kapsam:** İlk etap manuel `Spring/Summer/Autumn/Winter` + manuel hava (`clear/cloudy/rain/snow/fog`) + çalışan gün–gece ve editör preview. Kışın terrain, uygun ağaç/kaya/çatı ve gökyüzü görsel dönüşümü ilk kullanılabilir teslimde görülmeli. Otomatik hava/annual cycle sonraki aşamada.
2. **Varlık aileleri:** Aynı ağacın mevsime göre materyali ve **gerektiğinde** geometry/mesh'i değişir; her tür için dört farklı GLB zorunlu değildir. `stableId`, yerleşim, collider ve kullanıcı override'ları korunur.
3. **Kar önce görsel:** Authored grass/dirt/rock paint'ini değiştirmeyen render overlay; fizik veri sağlayıcısı için gelecekte açık sözleşme. Kar shader'ı araç lastiğinin tutuşunu gizlice değiştiremez.
4. **İlk hedef masaüstü WebGL2:** Bugünkü renderer'ı koruyarak küçük doğrulama sahnesi; WebGPU migration, mobil eşdeğer performans ve dev dünya ölçümü ilk görevin parçası değildir.
5. **Ürün konumu:** WES genel Forge Engine/Editor capability'si olacak, World Builder'a gömülü veya yalnız Offroad oyununa ait olmayacak.

### İncelenecek modüller

- Renderer / `Three.js WebGLRenderer` sürümü, shader extensibility, material cache, skylight/sun/sky/fog/cloud, exposure ve scene lighting.
- Frame update, varsa mevcut time clock, paused editor preview, Play runtime update.
- Landscape authored paint/weights, terrain surface query, multi-tile renderer, material patch ve shader state.
- Foliage instancing, chunk/LOD, per-family variant swap, scene actor stable ID, collision references.
- Asset manifest, glTF model cache, material/mesh variation, missing asset fallback, preload/dispose.
- Editor UI ve Scene serialization; level/sidecar validator/save coordinator; editor preview vs Apply vs Play.
- Runtime game save/load, vehicle wheel surface contact ve World Builder stage giriş noktaları.
- Performans ölçüm araçları ve TypeScript/engine/Playwright testleri.

### İstenen rapor başlıkları

1. **Repo Snapshot:** HEAD SHA/branch/status, versiyonlar, test komutları, bilinen uyarılar.
2. **Capability Matrix:** Her yetenek için `MEVCUT VE TESTLİ / KISMİ / YENİ / BELİRSİZ`; kanıt dosya yolu + test.
3. **Reuse Plan:** Mevcut sky/material/foliage/save altyapısını yeniden kullanmanın en küçük yolu; kaçınılacak refactor'lar.
4. **Environment Schema Alternatives:** Existing level JSON namespaced alan mı `*.environment.json` sidecar mı? Validator, migration, preview/apply ve backwards-compatibility açısından karşılaştır; yalnız öneri sun.
5. **K1–K3 Work Breakdown:** Dosya bazlı öneri, TypeScript arayüzleri, kabiliyet kapısı, editor panel ve render adapter entegrasyon sırası; geçiş riskleri.
6. **Acceptance Fixtures:** Bir küçük vadi test sahnesi: grass/dirt/rock, yol, kaya, çatı, yaprak döken ve iğne yapraklı ağaç. Kullanıcı level'ını değiştirmeden nasıl izole fixture kurulacağını yaz.
7. **Tests & Benchmark:** ENV-00/01/02/03/06/15 için çalıştırılacak/eklenecek test planı; desktop WebGL2 baz çizgisi için browser, GPU, çözünürlük, FPS/frame, draw calls, RAM/VRAM ve shader compile ölçümleri. Ölçmediğin değerleri başarı gibi gösterme.
8. **Open Engineering Decisions:** Repo kanıtıyla gerekçelendir; ürünün onaylanmış dört tercihini tekrar açma.

### Sonraki adıma geçiş koşulu

K0 raporu tamamlandığında şu soruları net yanıtla: WES'in mevcut renderer ve scene update'e en küçük güvenli bağlanacağı yer nedir? Authored terrain paint'i silmeden snow overlay nasıl yapılacak? Asset family varyantları stable ID/instancing'i nasıl koruyacak? Level default ve editor preview/Apply nasıl ayrılacak? İlk K1 biletini hangi mevcut dosyalar ve testlerle başlatabiliriz?

**Bu turdaki yasaklar:** büyük refactor, otomatik iklim kodu, fizik katsayısı değiştirme, pipeline/WebGPU migration, dependency upgrade, kullanıcı sahnesi veya asset overwrite, zorunlu migration, Git branch history rewriting, paket release. Gerekli kod değişikliği görürsen uygulama değil görev olarak raporla.
