# İçerik JSON istekleri — SPA fallback düzeltmesi

İlk Ocean push'inin CI koşusunda motor/build kapısı başarılıydı; asset baseline
ve `content-loading.spec.ts` içindeki bozuk collision sidecar testi başarısızdı.
İncelenen koşu: https://github.com/emrtrn/Forge/actions/runs/42562432282.

Trace, collision dışındaki bulunmayan `Floor_400x400.deformable.json`,
`Floor_400x400.fracture.json` ve `CommonTree.materials.json` dosyaları için de
`invalid-json` uyarıları gösteriyordu. İsteklerin varsayılan `Accept: */*`
değeri Vite'ın SPA fallback'ine giriyor, eksik JSON yerine HTTP 200 ile
`index.html` dönüyordu. Böylece isteğe bağlı dosyaların sessiz varsayılan yolu
çalışmıyor, bozuk collision testi de başka dosyaların uyarılarını görüyordu.

`readContentJson` artık `Accept: application/json` gönderir. Vite eksik dosyaya
gerçek 404 verir; mevcut optional loader varsayılana döner. Bozuk JSON hâlâ
`invalid-json` üretir; zorunlu içerikte HTTP/network/schema hataları ve Retry
davranışı korunur. Endpoint veya save/load şeması değiştirilmedi.

Chromium eksik optional dosyanın 404 yanıtını ayrıca network-console satırı
olarak raporlar. Native Ocean smoke yalnız gerçekten 404 döndüğü kaydedilen
optional sidecar URL'lerinin bu satırlarını ayırır. Page errors, shader ve diğer
console hataları başarısızlık olmaya devam eder; content uyarıları gizlenmez.

Doğrulama: gerçek Vite sunucusunda yedi `content-loading.spec.ts` testi geçti;
bozuk collision tanısı dahil mevcut test beklentileri zayıflatılmadı. Son tam
build ve native Ocean koşuları ana teslim raporuyla birlikte kaydedilir.
