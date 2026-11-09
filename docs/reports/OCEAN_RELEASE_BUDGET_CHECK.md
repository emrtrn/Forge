# Production paket boyutu — Ocean öncesi/sonrası

`smoke:production` sunucusu starter paketini üretirken boyut kapısında duruyor;
bu aşama browser testlerinden öncedir. Aynı kurulu bağımlılıklar ve builder
ile Ocean öncesi `62962e8` izole worktree'de ve son kaynak main'de ölçüldü.
Her ikisinde de strict runtime/dist sınır kontrolü başarılıdır.

| Ölçü (byte) | Ocean öncesi `62962e8` | Son kaynak `d390a91` | Profil sınırı |
|---|---:|---:|---:|
| Toplam | 7.112.089 | 7.146.829 | 6.500.000 |
| JavaScript | 5.532.895 | 5.567.635 | 4.500.000 |
| Asset | 995.592 | 995.592 | 1.000.000 |

Root pakette JavaScript farkı 34.740 byte. Boyut kapısı Ocean öncesinde de
başarısız; sınırlar değiştirilmedi. Bu nedenle tam production kapısı/CI yeşil
olarak raporlanamaz. Ayrı paket küçültme çalışması veya gerekçeli bütçe kararı
gereklidir.

Browser davranışı için standart builder'ın aynı root/subpath çıktıları,
yeniden build/bütçe kontrolü yapmayan geçici yerel static sunucuda sınanır.
Bu kontrol, boyut kapısını geçtiği anlamına gelmez; yalnız üretilen paketlerin
runtime davranışını ayırır. Geçici sunucu ve Playwright ayarları repoya eklenmez.
