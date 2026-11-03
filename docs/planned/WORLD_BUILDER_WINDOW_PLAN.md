# World Builder Penceresi Planı

> Durum: **D1 + D2 tamam** (2026-11-03); sırada D3 (yerleşim cilası). §6
> varsayılanlarıyla gidildi.
>
> Sorun (kullanıcı): World Builder paneli çok sıkışık.
>
> Karar (kullanıcı onayı, 2026-11-02): panel outliner sekmesinden çıkar.
> Yerine **modal olmayan, sürüklenip boyutlandırılabilen, içi sekmeli bir
> pencere** gelir. Pencere Add Actor → Terrain → **World Builder…** ile açılır.
> Landscape'teki gibi modal bir diyalog seçilmedi (gerekçe §1).
>
> Kapsam: yalnız editör yüzeyi. `WorldBuilderSession`, recipe şeması, aşamalar,
> overlay'ler ve kayıt sırası değişmez.

---

## 1. Neden modal diyalog değil

`worldTerrainDialog.ts` (New Landscape) tek seferlik bir form. Tam ekran
`parent-class-overlay` açar, Escape'i `keydown` capture ile yakalar, bir
Promise döndürür ve Create ile kapanır. Viewport'a ihtiyacı yoktur.

World Builder ise süren bir çalışma oturumu. Panelin yarısı viewport'la
birlikte çalışıyor:

- **Edit in Viewport:** plan noktaları zeminde sürüklenir. Delete ve Escape
  seçili plan öğesine aittir (`EditorUi.ts`, "World Builder's Edit Plan owns
  Escape/Delete"). Modal overlay hem işaretçiyi hem Escape'i alırdı.
- **Dry Run önizlemesi** viewport'ta çizilir. Satırlar ve Focus kamerayı
  nesneye götürür.
- **Viewport Layers:** altlık opaklığı ve katman aç/kapa canlı izlenerek
  ayarlanır.
- **Apply tek undo adımı.** Uygula → bak → Ctrl+Z → düzelt döngüsü viewport
  açıkken döner.

Sıkışıklığın asıl kaynağı dar sütun değil, yedi bölümün (recipe, layers,
import, plan corrections, stages, report, preview) alt alta yığılması. Pencere
ikisini birden çözer: alan büyür ve bölümler sekmelere ayrılır.

---

## 2. Hedef davranış

### 2.1 Giriş noktası

- Add Actor menüsü → **Terrain** kategorisi → **World Builder…** (Landscape'in
  yanında). Aktör eklemez; pencereyi açar, açıksa öne getirir.
- `singleton()` yardımcısı zaten düz bir `entries.push` olduğu için
  kullanılabilir. Anahtar `worldBuilder`, ikon `terrain`.
- Outliner'daki **World Builder** sekmesi ve `#world-builder-pane` kalkar.
  Outliner'da yalnız Scene Outliner ve World Partition kalır.

### 2.2 Pencere

- Modal değil: arka plan karartması yok, viewport ve diğer paneller
  kullanılabilir kalır.
- Başlık çubuğu: "World Builder" + **recipe kimliği** + kaydedilmemişse
  **unsaved** etiketi + kapat (×). Bunlar her sekmede görünür. Bugün bu bilgi
  yalnız panelin tepesinde.
- Başlıktan sürüklenir, sağ alt köşeden boyutlandırılır.
  - En küçük boyut 380 × 320 px.
  - Varsayılan boyut 520 × 640 px, viewport'un sağ üstüne, Details panelinin
    soluna yaslı.
  - Konum her zaman editör kökünün içine kıstırılır, başlık ekran dışına
    çıkamaz. Tarayıcı penceresi küçülünce yeniden kıstırılır.
- Konum, boyut ve son sekme izleyici ayarıdır: `localStorage`
  (`forge.worldBuilder.window`), try/catch içinde; mevcut
  `forge.worldBuilder.layers` ile aynı desen. Recipe'ye girmez, undo değildir.
- Escape pencereyi **kapatmaz**, çünkü plan seçimine ait. Yalnız × kapatır.
- z-index viewport overlay'lerinin üstünde, modal diyalogların (New Landscape,
  parent-class) ve toast'ların altında olur. Değeri CSS'teki mevcut katmanlara
  bakarak seç.
- Kapatmak oturumu bitirmez: önizleme, katmanlar ve viewport tutamaçları olduğu
  gibi kalır (bugün de sekme değiştirmek bunları düşürmüyor). Yalnız panel
  çizimi durur.
- Level değişince pencere açık kalır, yeni level'ın recipe'sini gösterir.

### 2.3 Sekmeler

Bugünkü render fonksiyonları sekmelere şöyle dağılır:

| Sekme | İçerik (mevcut fonksiyon) |
|---|---|
| **Setup** | `renderRecipe` (durum, yol, profil, plan sayıları, Create Recipe, Reload From Disk), `renderReferenceForm`, `renderReferenceImport` |
| **Plan** | `renderPlanEdit` + `renderPlanSelection` (öğe listesi, Add, seçili öğenin alanları, Edit in Viewport) |
| **Stages** | `renderStages` (aşamalar, Building pads), `renderPlan` (son çalışmanın raporu, stranded düğümler) |
| **Preview** | `renderPreview` (değişiklik listesi, Focus, Clear Preview) |
| **Layers** | `renderLayers` (aç/kapa, opaklık, lejant). Referans formu Setup'a geçer |

Kurallar:

- Recipe yoksa ya da geçersizse yalnız **Setup** etkin. Diğer sekmeler
  pasif görünür, ipucu: "Önce bir recipe oluştur".
- **Preview** sekmesinde, önizleme varken çizilen öğe sayısı rozet olarak
  görünür.
- **Dry Run** pencereyi **Stages** sekmesinde bırakır (rapor aşamaların
  hemen altında). Preview rozeti yanar, otomatik sekme değişimi yok.
- Viewport'ta bir plan tutamacı tıklanıp seçim değişirse pencere **Plan**
  sekmesine geçer, çünkü seçili öğenin alanları orada.
- Import önizlemesi bekliyorken Stages ve Plan sekmelerinde tek satırlık bir
  uyarı görünür: "Import preview pending — Apply or Clear in Setup". Bugün
  düğmeler sebebi söylenmeden pasif kalıyor.
- Geniş pencerede form satırları iki sütuna yayılır (x/z çiftleri, Population
  + Search radius). Dar pencerede bugünkü tek sütun korunur. Sadece CSS
  (container query ya da `grid-template-columns: repeat(auto-fill, …)`).
  Etiketler İngilizce, ipuçları Türkçe kalır ([[editor-param-ui-rules]]).

---

## 3. Teknik tasarım

### 3.1 Dosyalar

- **Yeni `src/editor/panels/world/worldBuilderWindow.ts`:** genel çerçeve.
  Başlık, sürükleme, boyutlandırma, kıstırma, kapatma, sekme şeridi ve
  `localStorage` geometrisi burada. World Builder'a özgü bilgi içermez,
  başlık içeriğini ve sekmeleri dışarıdan alır.
  - Sürükleme ve boyutlandırma `pointerdown` / `setPointerCapture` ile yapılır.
    HTML5 `draggable` kullanılmaz.
  - Bilinçli olarak genel tutuluyor: Persona, Material ve benzeri sıkışık
    paneller de sonra aynı çerçeveye taşınabilir. Bu plan onları taşımaz.
- **`worldBuilderPanel.ts`:**
  - `renderView` sekme başına bir fonksiyona bölünür. Mevcut `render*`
    fonksiyonları ve `data-testid`'ler **aynen** kalır.
  - Olay dinleyicileri (`click` / `change` / `input`) sekme gövdesi yeniden
    çizilse de çalışsın diye gövdeye delege edilmiş hâlde kalır.
  - Panel aktif sekmeyi tutar. `update()` başlığı ve aktif sekmeyi çizer.
  - `analysisText` gibi sekme dışı durum korunur: Setup'tan çıkıp dönünce
    yapıştırılan JSON kaybolmamalı.
- **`EditorUi.ts`:**
  - Outliner sekme düğmesi, pane ve `setOutlinerTab`'deki `"worldBuilder"`
    dalı silinir. Tip `"scene" | "worldPartition"`'a iner.
  - Sekme tıklama dinleyicisindeki koşul da güncellenir.
  - `refreshWorldBuilderPanel` `#world-builder-pane.hidden` yerine "pencere
    açık mı" sorusuna bakar. Çağıldığı yerler (save durumu, `renderHistory`)
    aynı kalır.
  - Add Actor girişi `openWorldBuilderWindow()` çağırır. Pencere ilk açılışta
    tembel kurulur: `WorldBuilderPanel` bugün de `??=` ile kuruluyor.
- **`editorUi.css`:** `.world-builder-*` kuralları korunur. Pencere
  çerçevesi (`.forge-window*`) ve sekme şeridi için yeni kurallar eklenir.
  Var olan `.inspector-tab` görünümü yeniden kullanılır.

### 3.2 Klavye ve odak

- `isEditableTarget` zaten input içindeki tuşları kısayollardan ayırıyor.
  Pencerede yazarken Delete plan öğesini silmez. Bunu smoke ile doğrula.
- Pencereye tıklamak viewport seçimini değiştirmemeli. Pencere kökünde
  `pointerdown` viewport'a sızmamalı. Pencere viewport'un DOM kardeşi
  olduğu için büyük ihtimalle zaten sızmıyor, doğrula.
- Plan tutamacı sürüklemesi pencerenin altından geçerse sürükleme
  bozulmamalı (pointer capture viewport'ta).

### 3.3 Dokunulmayacaklar

`WorldBuilderSession` API'si, `worldBuilderLayer` / `worldBuilderPreview` /
`worldBuilderPlanEdit`, recipe overlay'leri, `/__save-worldrecipe`,
`editorSaveCoordinator` sırası. Pencere yalnız bir görünüm değişikliği.
`verify:dist --strict`: yeni dosya `src/editor/` altında, `?editor` arkasında.

---

## 4. Dilimler

Her dilim kendi başına yeşil kapıyla (`npx tsc --noEmit`,
`npm run test:engine`, ilgili smoke) commit'lenir ve `main`'e push edilir.

### D1 — Pencere + giriş, içerik aynen

- [x] `worldBuilderWindow.ts` çerçevesi: başlık, sürükle, boyutlandır,
      kıstır, kapat, geometri `localStorage`.
- [x] Add Actor → Terrain → World Builder… girişi.
- [x] Panel pencerenin gövdesine taşınır, henüz sekme yok (tek kaydırmalı
      gövde, bugünkü sıra).
- [x] Outliner sekmesi ve pane'i silinir; `setOutlinerTab` ve
      `refreshWorldBuilderPanel` güncellenir.
- [x] Smoke: `tests/smoke/world-builder.spec.ts` (9 test) ve
      `tests/smoke/ridgebound-spatial.spec.ts` içindeki
      `getByTestId("world-builder-tab").click()` çağrıları ortak bir
      `openWorldBuilder(page)` yardımcısına çevrilir (Add Actor → Terrain →
      World Builder…). Diğer testid'ler değişmez.

Kabul: bütün World Builder smoke'ları ve ridgebound-spatial yeşil (10/10,
2026-11-03).

Uygulamada öğrenilenler:

- Üst bar (z-index 50) pencerenin üstünde ve yüksekliği ekran genişliğiyle
  değişiyor (44 / 80 / 116 px). Çerçeve sabit ölçü kullanmaz; sahibinden
  `area()` (viewport host) alır, varsayılan konum ve üst sınır oradan gelir.
- Add Actor hover menüsü kapanma gecikmesiyle pencerenin üstünde kalıyordu;
  World Builder… tıklanınca `force-closed` alır, geri girişte açılır.
- Viewport'ta tutamaç sürükleyen smoke'lar pencereyi `parkWorldBuilder(page)`
  ile sağa (Details'in üstüne) taşır.


### D2 — Sekmeler

- [x] Sekme şeridi; içerik §2.3 tablosuna göre dağıtılır.
- [x] Başlıkta recipe kimliği + unsaved.
- [x] Recipe yokken yalnız Setup etkin; Preview rozeti; import bekliyor
      uyarısı; viewport'tan plan seçimi → Plan sekmesi.
- [x] Son sekme `localStorage`'da.
- [x] Smoke yardımcısına `openWorldBuilder(page, tab)` parametresi. Her test
      kullandığı öğeden önce doğru sekmeye geçer.

Kabul: smoke'lar yeşil. Pencere 520 × 640'ta hiçbir sekmede yatay kaydırma
göstermiyor. (17/17 world-builder + ridgebound + add-actor-menu, 2026-11-03;
`expectNoSidewaysOverflow` her sekmeyi ve 15c'nin nokta satırlarını ölçer.)

Uygulamada:

- Sekme şeridi çerçevede (`ForgeWindow.setTabs`, `storedTab`); son sekme
  geometriyle aynı `localStorage` kaydında. Testid'ler
  `world-builder-window-tab-<id>` ve `…-preview-badge`.
- `world-builder-recipe` testid'i başlığa taşındı (her sekmede görünür).
  `world-builder-panel` yalnız aktif sekmenin içeriği, `data-tab` taşır.
- Plan sekmesine geçiş yalnız oturumun `onChange`'inde (viewport tutamacı,
  klavye); panelin kendi eylemleri ve undo/redo sekmeyi değiştirmez.

### D3 — Yerleşim cilası

- [ ] Geniş pencerede iki sütunlu form satırları, dar pencerede tek sütun.
- [ ] Uzun listeler (plan öğeleri, değişiklikler) sekme içinde kendi
      kaydırmasına sahip. Pencere başlığı ve sekme şeridi sabit kalır.
- [ ] Tarayıcı penceresi küçülünce kıstırma.

### D4 — Yeni smoke + belgeler

- [ ] Yeni smoke `world-builder-window`:
  - pencere Add Actor'dan açılır;
  - başlıktan sürüklenince yer değiştirir; reload sonrası aynı yerde ve
    aynı sekmede açılır;
  - pencere açıkken viewport'ta plan tutamacı sürüklenir;
  - Apply sonrası Ctrl+Z panelde görünür;
  - input içinde Delete plan öğesini silmez;
  - × ile kapatıp açınca önizleme hâlâ çizili.
- [ ] `CLAUDE.md`: "The editor's World Builder tab" ifadesi "World Builder
      window (Add Actor → Terrain)" olarak güncellenir.
- [ ] `docs/planned/WES/FORGE_WORLD_BUILDER_TASARIM_VE_TEKNIK_PLAN_v0.4.md`:
      Stage Runner satırındaki "Outliner'da World Builder sekmesi" ifadesi
      güncellenir, bu plana bağlantı eklenir.
- [ ] Plan kapanınca `Forge-Archive`'e taşınır ve
      `docs/COMPLETED_WORK_INDEX.md`'ye eklenir.

---

## 5. Kapsam dışı

- Pencereyi bir panele yeniden yamama (dock) ya da birden fazla World Builder
  penceresi açma.
- Diğer panelleri (Persona, Material, Foliage) aynı çerçeveye taşıma. Çerçeve
  buna hazır, iş ayrı.
- World Builder'a yeni özellik eklemek: region profile editörü, OSM import
  (T37) gibi.

---

## 6. Yarın başlamadan teyit edilecekler

Varsayılanlar yukarıda seçildi. Kullanıcı aksini söylemezse bunlarla gidilir:

1. Varsayılan konum: viewport'un sağ üstü, Details'in solu.
2. Dry Run'dan sonra otomatik sekme değişimi yok, yalnız Preview rozeti var.
3. Viewport'tan plan seçimi pencereyi Plan sekmesine geçirir.
4. Escape pencereyi kapatmaz.
