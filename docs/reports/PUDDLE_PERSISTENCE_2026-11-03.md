# Kalıcı Puddle — 3 Kasım 2026

Durum: **Kaynak şeması, editör komutları ve native terrain runtime kurulumu
uygulandı.** Canlı deformasyon/tekerlek bağlantısı, insan görsel kabulü ve hedef
donanım performans kabulü ayrı açık işlerdir.
[Plan](../planned/PUDDLE_DEVELOPMENT_PLAN.md).

## Davranış ve kullanım

World Terrain → **Landscape Mode: Water** → **Puddle Preview** → çukura tıkla →
kot/çalışma alanını ayarla → **Create Puddle**. Hazır önizleme kalıcı Puddle
gövdesine dönüşür; Outliner ve Water Bodies listesinde görünür. Gövde seçilince
isim, kot, alan, renk, opacity, roughness ve ortam yansıması düzenlenir.
Hidden/Locked ve Delete desteklenir. Create/Edit/Delete normal undo/redo
geçmişine katılır. Save level kaynağını yazar; Reload ve Play aynı kaynaktan
terrain'e bağlı yüzeyi yeniden üretir.

Önizleme Create yapılmadan kaydedilmez. Lake ve River biçimleri değiştirilmedi.
Puddle eski bir Lake kaydı gibi etiketlenmez; ayrı `puddleWaters` koleksiyonudur.

## Kayıt sözleşmesi

```json
{
  "schema": 1,
  "kind": "puddle",
  "coordinateSpace": "world",
  "id": "puddle-1",
  "terrainRef": "terrain",
  "seed": [30, 0],
  "bounds": { "min": [24, -6], "max": [36, 6] },
  "surfaceLevel": 10.6,
  "appearance": { "color": "#504a35", "opacity": 0.65 }
}
```

`name`, `hidden`, `locked` ve appearance içindeki `roughness` / `reflectionStrength`
isteğe bağlıdır. Kaynak kimliği, world-space seed, kare sınır ve kot zorunludur.
Mesh, depth dizileri, geçici tile kopyaları ve renderer hedefleri kaydedilmez.
Ortak validator hem runtime read guard'ında hem `/__save-layout` allowlist'inde
kullanılır; sonlu/range kontrollü sayılar, hex renk, boolean ve benzersiz id
kontrol edilir. Eski level'lerde alanın bulunmaması davranışı değiştirmez.
World Partition gövdeleri persistent level'de tutar.

En fazla 16 gövde, gövde başına 128×128 native hücre / 128 m kare kenarı, toplam
65.536 hücre ve gövde hazırlığı başına en fazla 16 eksik tile okuması vardır.
Kaydedilmiş sınır native terrain grid'ine uymuyorsa çözünürlük sessizce değiştirilmez.

## Paylaşılan kurulum ve yaşam döngüsü

`terrainPuddlePreparation.ts` editör önizlemesi ve kalıcı renderer için aynı
native örnekleme/tile okuma/kırpma yolunu sağlar. `PuddleWaterController` editör
ve RuntimeSceneApp'te aynıdır. Her kare terrain taraması yapılmaz; aynı kaynak
yeniden kurulmaz, terrain patch/move olduğunda açık invalidation kullanılır.

Başarısız kot/alan veya eksik tile hazırlığı son geçerli yüzeyi korur ve hata
gösterir. Kaynağa geri Undo yapılınca eski hata durumu temizlenir. Gizlenen,
silinen veya terrain sahibi kaybolan gövdelerin render kaynakları bırakılır.
Yeni rebuild, dispose ve level travel bekleyen okumayı iptal eder; geç yanıt
silinmiş gövdeyi geri getiremez. Toplam hücre bütçesi aşımında kısmi kalite
düşürme yerine önceki geçerli yüzeyler korunur.

World Terrain taşındığında seed, sınırlar ve kot aynı delta ile taşınır;
yükseklik/paint tile verileri değiştirilmez. Yüzeyin collider veya navigation
sahipliği yoktur. Yeni planar capture, kırılma hedefi veya baked maske yoktur;
görünüm mevcut ortam yansımasını kullanır.

## Doğrulama

- `npm run build:verify`: geçti; **2239 engine kontrolü**, smoke/content/UI
  tür kontrolleri, builder kontrolleri, üretim derlemesi, strict dist ve world-data.
- Odaklı Puddle engine koşusu: **11 kontrol geçti**; tam suite yerine geçmez.
  Save/read/partition alan eşitliği ve dropped-field kontrolü, bozuk kaynakların
  reddi, editor/runtime geometri eşitliği, başarısız rebuild'den Undo dönüşü,
  hidden/delete/terrain kaybı, geç tile yanıtı, native/aggregate bütçe ve terrain
  taşıma/geri taşıma kapsanır.
- İlk uçtan uca kalıcı Puddle Playwright koşusu geçti. Create, undo/redo, appearance
  edit, lock, delete/undo, gerçek disk Save, Reload ve runtime source/geometri
  eşitliği; terrain dosyalarının değişmemesi ve konsol/WebGL hatasızlığı doğrulandı.
- Son birleşik önizleme + kalıcı kayıt tarayıcı koşusu: **2 geçti** (1,9 dakika).
  Gizle/göster ile kaynak bırakma ve tekrar kurma da kapsandı. Tarayıcı Low kalite
  ve yazılım WebGL kullanır; bu GPU performans kabulü değildir.
- Fixture tile'larında önceki koşularda görülen HTML yanıtını ayırmak için yalnız
  Puddle testlerinin bilinen ikili fixture yolları test tarafından açıkça sunulur.
  Layout Save endpoint'i, allowlist, diskteki level, reload ve runtime kodu gerçek
  uygulama yollarını kullanır. Üretim dosya sunucusu bu amaçla değiştirilmedi.

[Kalıcı gövde ve editör kontrolleri](evidence/puddle-persistence/puddle-saved-editor.png)
· [Aynı kayıtla runtime](evidence/puddle-persistence/puddle-saved-runtime.png).

## Açık işler

- Runtime `DeformationField` ile ortak deforme yatak ve yeterli yakın geometri
  detayı; canlı gerçek araç tekeri temas/dalga/çamur sıçraması.
- Runtime iz kalıcılığı, otomatik yağmurla dolma, miktar korunumu ve taşma yoktur.
- Gövdeler arası birleşim, Puddle su altı, fiziksel su hacmi ve yeni planar bütçesi
  bu dilimde yoktur. Mevcut terrain collider'ı deforme edilmez.
- Gerçek GPU/CPU dilim/transient bellek ölçümü ve kullanıcı görsel kabulü açık.
- Save doğrulaması değiştiği için Codex Security diff incelemesi önerildi; kullanıcı
  tarama istemediği için güvenlik taraması başlatılmadı.
