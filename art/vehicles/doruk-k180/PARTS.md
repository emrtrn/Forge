# Doruk K-180: düğüm listesi

Düğüm adları `doruk-k180_greybox.py` ile aynıdır. `partId` değerleri sonraki oturumda
`*.deformable.json` içine yazılır; bu greybox'ta `dent`/`detach` bağlı değildir.

Sınıf: **A** = ilk dalgada göçer ve kopar. **B** = yalnız kopar. **C** = yalnız göçer.
**D** = sonra (fracture, kıymık, P2/P3). **–** = kopmaz.

```text
DorukK180
├── CHASSIS
│   ├── Chassis_Frame        – şasi, travers, aks, makas, şaft
│   ├── Cabin_Shell          – taban, tavan, direkler, arka duvar, torpido duvarı
│   ├── Cabin_Interior       – koltuk, torpido, direksiyon, pedal, vites
│   ├── Engine_Block         – motor ve radyatör kutusu
│   ├── Tow_Hook_L/R         – şasiye bağlı, tampon kopunca yerinde kalır
│   ├── Fuel_Tank            C  sol, iki aks arası
│   ├── Rear_Bumper          D
│   ├── Cab_Step_L/R         D
│   └── Mudflap_FL/FR/RL/RR  D
├── PARTS
│   ├── Front_Bumper         A  P0 demonstratör, pivot: arka yüz ortası
│   ├── Hood                 A  pivot: arka menteşe hattı
│   ├── Fender_FL/FR         A  pivot: üst bağlantı
│   ├── Door_L/R             A  pivot: ön menteşe hattı
│   │   └── SideGlass_L/R    D  kapının çocuğu, kapıyla kopar
│   ├── Mirror_L/R           B  pivot: kol bağlantısı
│   ├── Grille_Panel         D  far yuvalarını içerir
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
| `Fender_FL/FR` | ön tekerlek, motor bölmesi |
| `Door_L/R` | kapı boşluğu, `Cabin_Shell` eşiği, `Cabin_Interior` |
| `Windshield`, `Rear_Window` | `Cabin_Interior` |
| `Wood_Side_Panel_L/R`, `Tailgate` | kasa tabanı, dikmeler |
