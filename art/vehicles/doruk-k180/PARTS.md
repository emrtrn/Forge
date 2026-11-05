# Doruk K-180: düğüm listesi

Düğüm adları `doruk-k180_model.py` ile aynıdır. `partId` değerleri `*.deformable.json` içinde tutulur.
Bağlı olanlar, `dent` + `detach`: `Front_Bumper` → `front_bumper`, `Door_L/R` → `door_left/right` (cam ve ayna kapıyla gider), `Mirror_L/R` → `mirror_left/right` (kapının çocuğu, tek başına da kopar), `Hood` → `hood`, `Fender_FL/FR` → `fender_left/right`.
`dent` + `detach`, `alsoDents` ile: `Headlight_L/R` → `headlight_left/right`, `Turn_Signal_L/R` → `turn_signal_left/right`.
Aynı şekilde: `Tail_Lamp_L/R` → `tail_lamp_left/right`, `Rear_Bumper` → `rear_bumper`, `Tailgate` + `Cargo_Latch_L/R` → `tailgate`, `Wood_Side_Panel_L/R` + dört `Cargo_Stake` → `bed_side_left/right`.
Yalnız `dent`: `Grille_Panel` + `Grille_Panel_Back` → `front_grille` (far yuvası bu meshtedir), `Fuel_Tank` → `fuel_tank`.
Hiç göçmez: `Cabin_Interior`, `Engine_Block`, `Chassis_Frame`, `Windshield`, `Rear_Window`, `Bed_Base`, `Inner_Fender_L/R` → `rigid_core` (bölgesi modelin dışında).
Kalan her mesh gövdedir. Aşağıdaki sınıflar ilk plandır; güncel durum bu listedir.
Yeni parça bağlarken sözleşme §7'deki Doruk K-180 ölçüm kurallarına bak.

Sınıf: **A** = ilk dalgada göçer ve kopar. **B** = yalnız kopar. **C** = yalnız göçer.
**D** = sonra (fracture, kıymık, P2/P3). **–** = kopmaz.

```text
DorukK180
├── CHASSIS
│   ├── Chassis_Frame        – şasi, travers, aks, makas, şaft
│   ├── Cabin_Shell          – taban, tavan, direkler, arka duvar, torpido duvarı
│   │   └── Cabin_Trim       – cam kauçukları, ön cam orta dikmesi, yağmur oluğu, kapı fitili
│   ├── Cabin_Interior       – koltuk, torpido, direksiyon, pedal, vites
│   ├── Engine_Block         – motor ve radyatör kutusu
│   ├── Inner_Fender_L/R     – kapalı iç davlumbaz: kemerden motor görünmez, çamurluk kopunca açığa çıkar
│   ├── Tow_Hook_L/R         – şasiye bağlı, tampon kopunca yerinde kalır
│   ├── Fuel_Tank            C  sol, iki aks arası
│   ├── Rear_Bumper          D
│   ├── Cab_Step_L/R         D
│   └── Mudflap_FL/FR/RL/RR  D  önler torpido duvarına bağlı, arkalar şasiye gergili
├── PARTS
│   ├── Front_Bumper         A  P0 demonstratör, pivot: arka yüz ortası
│   ├── Hood                 A  pivot: arka menteşe hattı
│   ├── Fender_FL/FR         A  pivot: üst bağlantı
│   │   └── Fender_FL/FR_Marker  yan işaret lambası, çamurlukla kopar
│   ├── Door_L/R             A  pivot: ön menteşe hattı
│   │   ├── SideGlass_L/R    D  kapının çocuğu, kapıyla kopar
│   │   ├── Door_L/R_Trim    –  cam kauçuğu, havalandırma dikmesi, kol, menteşe; kapıyla kopar
│   │   └── Mirror_L/R       B  iki ayağı kapıda, pivot: alt ayak; kapıyla kopar, tek başına da kopar
│   ├── Grille_Panel         D  far yuvalarını içerir
│   │   └── Grille_Panel_Back    koyu arka plan, far çerçeveleri, sinyal yuvaları
│   ├── Windshield           D  fracture, R-11 bekler
│   ├── Rear_Window          D
│   ├── Headlight_L/R        D
│   ├── Turn_Signal_L/R      D
│   ├── Tail_Lamp_L/R        D
│   └── Wiper_L/R            D
├── CARGO
│   ├── Bed_Base             – taban, kirişler, kenar rayı
│   ├── Bed_Front_Panel      D
│   ├── Wood_Side_Panel_L/R  D  kıymık kırılması
│   ├── Tailgate             D  pivot: alt menteşe hattı
│   ├── Cargo_Stake_L1-4/R1-4 D
│   ├── Cargo_Latch_L/R      D
│   └── Cab_Guard            D  §4 tablosunda yok, görselde var
├── VEHICLE_WHEELS
│   ├── Wheel_FL/FR          wheel_visual, pivot aks merkezi
│   │   └── Wheel_FL/FR_Rim
│   └── Wheel_RL/RR          ikiz lastik tek düğümde
│       └── Wheel_RL/RR_Rim
└── SOCKETS
    ├── Socket_CargoAnchor
    ├── Socket_DriverSeat
    └── Socket_CameraAnchor
```

Her mesh tek malzeme taşır; böylece glTF düğümü tek primitive olur ve Static Mesh Editor
`Parts` listesinde kendi adıyla görünür. Hasar alacak parçalar ayrı mesh'tir, vertex paylaşmaz.

Parça kopunca açığa çıkanlar:

| Kopan | Görünen |
|---|---|
| `Front_Bumper` | şasi uçları, çeki kancaları, radyatör altı |
| `Hood` | `Engine_Block`, kaportanın içi |
| `Grille_Panel` | radyatör kutusu |
| `Fender_FL/FR` | ön tekerlek, `Inner_Fender_L/R` |
| `Door_L/R` | kapı boşluğu, `Cabin_Shell` eşiği, `Cabin_Interior` |
| `Windshield`, `Rear_Window` | `Cabin_Interior` |
| `Wood_Side_Panel_L/R`, `Tailgate` | kasa tabanı, dikmeler |
