# Skeletal Facing Override Backlog

> Durum: Bilincli backlog
> Kaynak: `RUNTIME_GAMEPLAY_REMAINING_CHECKLIST.md` (2026-07-14'te `e107f11` ile repodan kaldirildi, arsive tasinmadi; icerigi git gecmisinde) P4
> Ilgili tamamlanmis is: `AI_SYSTEM_RESEARCH_AND_PLAN.md`
> (bkz. `docs/COMPLETED_WORK_INDEX.md`)

## Mevcut Sozlesme

Forge'un karakter-facing matematigi, meshlerin local **`+z`** eksenine baktigini
kabul eder. `engine/movement/planarMovement.ts` icindeki `facingYawFromMove(dx, dz)` bu
kabule gore yaw uretir; hem player hem AI tarafindan kullanilan
`CharacterMovementSubsystem` hareket sonucunda ayni yaw'i uygular.

Bu bugun kabul edilmis bir asset sozlesmesidir. `-z`, `+x` veya baska bir local
forward ekseniyle author edilen skeletal mesh, ekstra bir duzeltme olmadan ters
bakabilir. Runtime'a gizli mesh-ozel rotation eklemek veya layout placement
rotation'ini bu amacla bozmak cozum degildir: assetin authored facing bilgisi,
asset metadata'si olarak kalmalidir.

## AI Hareketi: Kapanmis On Kosul

AI/NPC hareketi artik bu backlog'u bloklamaz:

- `CharacterMovementSubsystemOptions.getMoveIntent(...)`, player olmayan
  karakterler icin ajan-basina world-space `{ direction, speed, jump? }`
  girisi alir; mevcut collision, step, gravity ve locomotion hattini yeniden
  kullanir.
- `src/scene/capabilities/aiModule.ts`, `AISubsystem`i `decision` asamasinda,
  CharacterMovement'in `movement` asamasindan once tick eder.
  `aiCommandsService.moveIntentFor(...)` path-following sonucunu ayni frame'de
  hareket resolver'ina verir.
- Tamamlanmis AI plani arsivdedir; aktif AI feature planini yeniden acmak bu
  backlog'un amaci degildir.

## Gelecek Uygulama Siniri

Ters-forward bir skeletal asset ilk kez desteklenmek istendiginde, override
`*.skeleton.json` sidecar'inda acik bir alan olarak tasarlanir. Alan adi ve
deger kumesi o dilimde kesinlestirilir; ilk varsayim `+z` geriye donuk uyumu
korumali, belirsiz veya gecersiz deger ise sessizce yeni bir davranis
uydurmamalidir.

Tek dilimde birlikte yapilacak isler:

1. `src/scene/assetSkeletonLoader.ts`: `AssetSkeletonDef`, default ve normalize
   sozlesmesine facing metadata'sini ekle.
2. `tools/saveValidator.ts`: eslesik `validateSkeleton*` yolunda ayni alanin
   allowlist/validate/serialize kurallarini ekle. Loader ve validator farkli
   sema kabul etmemelidir.
3. Karakter render/facing katmani: override'i sadece mesh local-forward
   duzeltmesine uygula; gameplay world hareketi, nav intent'i, save-game yaw'i
   ve authored placement transform'u degismeden kalir.
4. Headless normalizer/validator regresyonu ile `+z` varsayimi, gecersiz deger
   reddi ve ters-forward assetin gorunur facing sonucu kapsanir; browser
   smoke, gercek ters-forward skeletal fixture ile eklenir.

## Aktivasyon Kriterleri

Bu backlog ancak asagidakilerden biri olursa aktif implementasyon isine doner:

- ilk gercek oyun forkunda ters-forward skeletal asset kullanilmasi;
- animatorun asset-basina authored facing metadata istemesi;
- yeni bir character import akisinin `+z` sozlesmesine donusturme yapmadan
  korunmasinin gerekmesi.

Bunlar yokken `+z` asset authoring sozlesmesi korunur; yeni sidecar semasi,
save endpoint'i veya runtime dali eklenmez.
