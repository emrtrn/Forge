const descriptions: Record<string, string> = {
  surfaceLevel: "Su yüzeyinin yüksekliği (metre). Gölde kıyı araziyle kesişimde oluşur. Nehirde ilk spline noktasının su yüksekliğini belirler; nehir boyunca yükseklik farkları korunur.",
  widthScale: "Spline genişliğine uygulanan çarpan. Nehir yüzeyini genişletir veya daraltır.",
  deepColor: "Derin bölgelerde suyun alacağı renk.", shallowColor: "Kıyıya yakın ve sığ bölgelerde suyun alacağı renk.",
  opacity: "Suyun opaklığı. 0 saydam, 1 opaktır.",
  bedVisibility: "Su altındaki tabanın görünürlüğü. 0 tabanı gizler, 1 görünür kılar.",
  absorptionDistance: "Işığın suda soğurulma mesafesi (metre). Küçük değerlerde derin su daha çabuk opaklaşır.",
  normalScale: "Yüzeydeki küçük dalga deseninin ölçeği.",
  "surface-waves": "Göl geometrisinin hafif yükselip alçalmasını açar/kapatır. Ortalama su seviyesi ve gerçek kıyı korunur.",
  surfaceWaveHeight: "Ortalama seviyeden azami düşey sapma (santimetre). 2 değeri en fazla ±2 cm harekettir; 0 düz yüzeydir. Sığ kıyıda daha küçüktür.",
  surfaceWaveLength: "Baskın geometrik dalganın boyu (metre). Arazi örnek aralığına göre uzun dalgalar daha düzgün görünür.",
  surfaceWavePeriod: "Baskın dalganın bir salınım süresi (saniye). Büyük değer daha yavaş harekettir.",
  surfaceWaveDirection: "Baskın dalganın dünya XZ düzlemindeki ilerleme yönü (derece). 0 = +X, 90 = +Z.",
  surfaceWaveShoreDepth: "Hareketin tam şiddete ulaştığı su derinliği (metre). Daha sığ bölgelerde yükselme/alçalma yumuşakça söner.",
  "reset-surface-waves": "Yalnız geometrik yüzey dalgalarını varsayılan ±2 cm, 12 m, 5 s değerlerine döndürür. Geri alınabilir.",
  "wheel-ripples": "Play modunda tekerlek su yüzeyini kestiğinde yayılan dalgaları açar/kapatır. Gölün doğal yüzey dalgalarını değiştirmez.",
  wheelRippleStrength: "Tekerlek dalgalarının görünürlük çarpanı. 0 dalgayı kapatır; daha büyük değer daha belirgin yansıma ve yüzey kırılması üretir.",
  wheelRippleSpeed: "Halkanın temas noktasından dışarı yayılma hızı (metre/saniye). Araç hızını değiştirmez.",
  wheelRippleWidth: "Yayılan dalga paketinin kalınlığı (metre). Daha büyük değer geniş bir alana yayılan halkalar oluşturur.",
  wheelRippleWavelength: "Dalga paketi içindeki ardışık halkalar arasındaki mesafe (metre). Küçük değer daha sık halkalar verir.",
  wheelRippleLifetime: "Her dalganın sönerek kaybolma süresi (saniye). Daha uzun ömür dalganın daha uzağa ulaşmasını sağlar.",
  wheelRippleInterval: "Hareketli teker başına iki dalga üretimi arasındaki en kısa süre (saniye). Küçük değer daha sık üretir; göl başına 24 dalga sınırı korunur.",
  "reset-wheel-ripples": "Yalnız tekerlek dalgası ayarlarını varsayılan değerlere döndürür. Bu işlem geri alınabilir.",
  flowSpeed: "Nehir akış deseninin ilerleme hızı.", rippleSpeed: "Göl yüzeyindeki dalga deseninin hareket hızı.",
  waveAmplitude: "Dalganın yüzey yüksekliğine etkisi.", waveLength: "Dalga tepeleri arasındaki mesafe.",
  foamColor: "Kıyı ve dairesel köpüklerin rengi.", foamOpacity: "Kıyı ve dairesel köpüklerin görünürlük düzeyi.",
  shoreWaveSpacing: "Kıyı ve dairesel köpük dalgalarının bantları arasındaki mesafe.",
  shoreWaveSpeed: "Köpük dalgalarının kıyıya doğru ilerleme hızı.",
  shoreWaveReach: "Köpük dalgalarının kıyıdan suya doğru kapladığı alan.",
  shoreWaveBreakupScale: "Köpük desenini parçalayan düzensizliğin ölçeği.",
  reflectionMode: "Yansımayı kapatır veya ortak düzlemsel yansımayı etkinleştirir.",
  reflectionQuality: "Yansımanın çözünürlüğünü ve güncelleme sıklığını belirler.",
  reflectionGroup: "Aynı gruptaki uyumlu su yüzeyleri bir yansıma görüntüsünü paylaşır.",
  reflectionStrength: "Yansımanın görünürlük gücü. Sığ su ve köpük yansımayı azaltabilir.",
  width: "Hesaplama alanının X eksenindeki genişliği (metre). Kıyıyı değil, su aramasının sınırını belirler.",
  length: "Hesaplama alanının Z eksenindeki uzunluğu (metre). Kıyıyı değil, su aramasının sınırını belirler.",
  minX: "Hesaplama alanının en küçük dünya X koordinatı.", minZ: "Hesaplama alanının en küçük dünya Z koordinatı.",
  maxX: "Hesaplama alanının en büyük dünya X koordinatı.", maxZ: "Hesaplama alanının en büyük dünya Z koordinatı.",
  seedX: "Suyun doldurulmaya başlandığı noktanın dünya X koordinatı.", seedZ: "Suyun doldurulmaya başlandığı noktanın dünya Z koordinatı.",
  name: "Gölün listelerde görünen adı.", hidden: "Gölün görünürlüğünü kapatır.", locked: "Göl ayarlarını ve düzenleme tutamaçlarını kilitler.",
  reseed: "Arazide yeni bir dolum başlangıç noktası seçer.", retry: "Mevcut seviye ve hesaplama alanıyla su yüzeyini yeniden hesaplar.",
  delete: "Seçili su kütlesini siler. Arazi şeklini değiştirmez.", terrain: "Bu su kütlesinin bağlı olduğu araziyi seçer.",
  begin: "Arazideki çukura tıklayarak yeni bir göl taslağı başlatır.",
  create: "Önizlemedeki gölü sahneye ekler.", cancel: "Henüz oluşturulmamış göl taslağını siler.",
  finish: "Göl düzenleme akışından çıkar. Taslak varsa önce oluşturma veya silme kararı istenir.", resume: "Bekleyen göl taslağını düzenlemeye döner.",
  "stop-pick": "Arazide nokta seçimini sonlandırır.",
};

/** Native tooltips work on both the field label and the actual control. */
export function applyWaterTooltips(body: HTMLElement): void {
  body.querySelectorAll<HTMLElement>("input, select, button").forEach((control) => {
    let key = control.dataset.lakeNumber ?? control.dataset.lakeColor ?? control.dataset.riverWaterNumber
      ?? control.dataset.riverWaterColor ?? control.dataset.riverWaterReflection;
    if (!key) {
      const attr = control.getAttributeNames().find((name) => name.startsWith("data-lake-"));
      key = attr?.slice("data-lake-".length);
      if (key === "reflection") key = "reflectionMode";
      if (key === "quality") key = "reflectionQuality";
      if (key === "group") key = "reflectionGroup";
    }
    let description = descriptions[key ?? ""];
    if (control.dataset.riverWaterReflection === "reflectionMode") description = "Nehirde mevcut sky light ve sphere capture haritalarından soluk çevre yansıması kullanır. Ek planar çizimi oluşturmaz.";
    if (control.dataset.riverWaterReflection === "reflectionQuality") description = "Çevre yansımasının yumuşaklığını ve normal katmanı ayrıntısını belirler. Nehir için yeni yansıma hedefi oluşturulmaz.";
    if (control.hasAttribute("data-river-water-delete")) description = descriptions.delete;
    if (control.hasAttribute("data-river-water-foam-number")) description = control.dataset.riverWaterFoamNumber?.endsWith(":radius") ? "Dairesel köpüğün yarıçapı (metre)." : "Dairesel köpüğün yoğunluğu. 0 görünmez, 1 tam yoğunluktur.";
    if (control.hasAttribute("data-river-water-foam-add")) description = "Suya veya araziye tıklayarak kaya ve iskele çevresi için dairesel köpük ekler.";
    if (control.hasAttribute("data-river-water-foam-select")) description = "Köpük noktasını taşıma aracıyla düzenlemek için seçer.";
    if (control.hasAttribute("data-river-water-foam-delete")) description = "Bu dairesel köpük noktasını siler.";
    if (control.hasAttribute("data-river-water-create-spline")) description = "Nehir yüzeyinin izleyeceği, en az iki bağlı noktası olan spline. Her spline bir su kütlesine bağlanabilir.";
    if (control.hasAttribute("data-river-water-create")) description = "Seçili spline'ın genişliğini ve ilk noktasının yüksekliğini kullanarak nehir ekler.";
    if (!description) return;
    control.title = description;
    const label = control.closest("label");
    if (label) label.title = description;
  });
}
