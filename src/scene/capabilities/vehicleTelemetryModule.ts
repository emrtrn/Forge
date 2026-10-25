/** Optional, read-only recording overlay for the possessed vehicle. No physics or camera writes. */
import type { VehicleState } from "@engine/physics/vehicle/vehicleTypes";
import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import { vehicleHostService, type VehicleHost } from "./runtimeServiceKeys";

const CSS = `
.forge-vehicle-telemetry{position:fixed;right:12px;top:12px;width:min(352px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;z-index:30;padding:14px 16px;border:1px solid #58677b;border-radius:12px;background:rgba(10,18,28,.94);color:#f2f5fa;font:13px/1.45 system-ui,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none;box-shadow:0 6px 20px #0005}
.forge-vehicle-telemetry[hidden]{display:none}
.forge-vehicle-telemetry header{display:flex;justify-content:space-between;align-items:center;color:#bdcbe0;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.forge-vehicle-telemetry .vt-speed{font-size:38px;font-weight:700;line-height:1.2;margin:8px 0 2px;color:#fff}
.forge-vehicle-telemetry .vt-speed small{font-size:14px;font-weight:400;color:#bdcbe0}
.forge-vehicle-telemetry .vt-drivetrain{display:flex;gap:18px;margin:0 0 10px;color:#dce7f7}
.forge-vehicle-telemetry .vt-inputs{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;padding:8px 0;border-top:1px solid #354256;border-bottom:1px solid #354256}
.forge-vehicle-telemetry .vt-row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}
.forge-vehicle-telemetry .vt-row span:first-child{color:#bdcbe0}
.forge-vehicle-telemetry .vt-row strong{font-weight:600;white-space:nowrap}
.forge-vehicle-telemetry .vt-forces{padding:7px 0}
.forge-vehicle-telemetry table{border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed}
.forge-vehicle-telemetry th{color:#bdcbe0;font-weight:500;border-bottom:1px solid #354256;padding:4px 0;text-align:right}
.forge-vehicle-telemetry td{text-align:right;padding:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.forge-vehicle-telemetry th:first-child,.forge-vehicle-telemetry td:first-child{text-align:left;width:32%}
.forge-vehicle-telemetry footer{font-size:10px;color:#b7c4d6;margin-top:8px}
@media(max-height:580px){.forge-vehicle-telemetry{padding:8px 12px;font-size:11px}.forge-vehicle-telemetry .vt-speed{font-size:28px;margin-top:3px}.forge-vehicle-telemetry .vt-forces{padding:3px 0}.forge-vehicle-telemetry .vt-row{margin:1px 0}.forge-vehicle-telemetry .vt-inputs{padding:4px 0}.forge-vehicle-telemetry table{font-size:10px}}
`;

const number = (value: number | undefined, digits = 0): string =>
  value === undefined || !Number.isFinite(value) ? "—" : Number(value.toFixed(digits)).toFixed(digits);
const percent = (value: number | undefined): string => value === undefined ? "—" : `${number(value * 100)}%`;
const force = (value: number | undefined): string => value === undefined ? "—" : `${number(value / 1000, 2)} kN`;

/** Units and distinctions stay explicit so video readback cannot confuse grip with engine demand. */
export function vehicleTelemetryValues(state: VehicleState): Record<string, string> {
  const t = state.telemetry;
  const gear = state.drivetrain?.gear;
  return {
    speed: number(state.forwardSpeed * 3.6, 1),
    movement: Math.abs(state.forwardSpeed) < 0.03 ? "Duruş" : state.forwardSpeed > 0 ? "İleri hareket" : "Geri hareket",
    gear: gear === undefined ? "—" : gear === -1 ? "R" : gear === 0 ? "N" : String(gear),
    rpm: number(state.drivetrain?.engineRpm),
    shift: state.drivetrain ? state.drivetrain.shiftTimeRemaining > 0 ? "Vites değişiyor" : "Bağlı" : "Vites modeli yok",
    throttle: percent(t?.input.throttle), brake: percent(t?.input.brake),
    steer: percent(t?.input.steer), handbrake: t ? t.input.handbrake ? "Çekili" : "Serbest" : "—",
    requested: force(t?.requestedDriveForce), transmitted: force(t?.appliedDriveForce),
    resistance: force(t?.appliedGroundResistanceForce),
    capacity: force(state.wheels.reduce((sum, wheel) => sum + (wheel.groundResistanceForce ?? 0), 0)),
    belly: force(t?.bellyResistanceForce), gravity: force(t?.gravityForwardForce),
    pitch: t ? `${number(t.pitchDeg, 1)}°` : "—",
  };
}

export function createVehicleTelemetryModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  let root: HTMLElement | null = null;
  let style: HTMLStyleElement | null = null;
  let cells = new Map<string, HTMLElement>();
  let rows: HTMLTableRowElement[] = [];
  let enabled = true;
  let elapsed = 0;

  const set = (key: string, value: string): void => {
    const cell = cells.get(key);
    if (cell && cell.textContent !== value) cell.textContent = value;
  };
  const keydown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (event.code !== "F8" || event.repeat || (target instanceof HTMLElement
      && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))) return;
    enabled = !enabled;
    if (root) root.hidden = !enabled;
    elapsed = 1;
    event.preventDefault();
  };
  const mount = (): void => {
    if (root || typeof document === "undefined" || !document.body) return;
    style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    root = document.createElement("section");
    root.className = "forge-vehicle-telemetry";
    root.setAttribute("aria-label", "Araç sürüş ölçümleri");
    // Static markup only; live material ids and all numbers are assigned with textContent.
    root.innerHTML = `<header><b>Sürüş ölçümleri</b><span data-vt="movement"></span></header>
      <div class="vt-speed"><span data-vt="speed">0.0</span> <small>km/sa</small></div>
      <div class="vt-drivetrain"><span>Vites <b data-vt="gear"></b></span><span><b data-vt="rpm"></b> d/d</span><span data-vt="shift"></span></div>
      <div class="vt-inputs">
        <div class="vt-row"><span>Gaz</span><strong data-vt="throttle"></strong></div>
        <div class="vt-row"><span>Fren / geri</span><strong data-vt="brake"></strong></div>
        <div class="vt-row"><span>Direksiyon</span><strong data-vt="steer"></strong></div>
        <div class="vt-row"><span>El freni</span><strong data-vt="handbrake"></strong></div>
      </div><div class="vt-forces">
        <div class="vt-row"><span>Motor isteği</span><strong data-vt="requested"></strong></div>
        <div class="vt-row"><span>Aktarılan motor itkisi</span><strong data-vt="transmitted"></strong></div>
        <div class="vt-row"><span>Teker direnci · uygulanan</span><strong data-vt="resistance"></strong></div>
        <div class="vt-row"><span>Teker direnci · kapasite</span><strong data-vt="capacity"></strong></div>
        <div class="vt-row"><span>Gövde sürtünmesi</span><strong data-vt="belly"></strong></div>
        <div class="vt-row"><span>Yerçekimi · ileri eksen</span><strong data-vt="gravity"></strong></div>
        <div class="vt-row"><span>Gövde eğimi · burun yukarı +</span><strong data-vt="pitch"></strong></div>
      </div><table><thead><tr><th>Teker / zemin</th><th>Batma</th><th>Patinaj</th><th>Yük</th></tr></thead><tbody></tbody></table>
      <footer>F8: göster / gizle · 10 Hz<br>İtki ve yerçekimi işaretlidir; dirençler büyüklüktür.<br>Devir: şanzıman modeli · Batma: fiziksel süspansiyon ofseti</footer>`;
    cells = new Map(Array.from(root.querySelectorAll<HTMLElement>("[data-vt]")).map((cell) => [cell.dataset.vt!, cell]));
    document.body.append(root);
  };
  const render = (host: VehicleHost, id: string, state: VehicleState): void => {
    mount();
    if (!root) return;
    root.hidden = !enabled;
    for (const [key, value] of Object.entries(vehicleTelemetryValues(state))) set(key, value);
    const body = root.querySelector("tbody")!;
    if (rows.length !== state.wheels.length) {
      body.replaceChildren();
      rows = state.wheels.map(() => {
        const row = document.createElement("tr");
        for (let index = 0; index < 4; index++) row.append(document.createElement("td"));
        body.append(row);
        return row;
      });
    }
    const definition = host.vehicleDefinition(id);
    state.wheels.forEach((wheel, index) => {
      const authored = definition?.wheels[index];
      const axle = authored?.axle === "front" ? "Ö" : authored?.axle === "rear" ? "A" : `${index + 1}`;
      // Forge's model +X is left; authoring coordinates are used directly.
      const label = `${axle} ${wheel.position[0] > 0 ? "Sol" : "Sağ"}`;
      const surface = wheel.inContact ? host.surfaceIdForWheel?.(id, wheel) ?? "?" : "air";
      const values = [`${label} · ${surface}`, `${number((wheel.sinkDepth ?? 0) * 100, 1)} cm`, percent(wheel.tractionSlip ?? 0), force(wheel.suspensionForce)];
      values.forEach((value, cell) => { rows[index]!.cells[cell]!.textContent = value; });
      rows[index]!.cells[0]!.title = `${label} · ${surface}`;
    });
  };
  return {
    id: "vehicle-telemetry",
    onRuntimeStart(host) {
      services = host;
      if (typeof window !== "undefined") window.addEventListener("keydown", keydown);
    },
    update(dt) {
      elapsed += dt;
      const host = services?.resolve(vehicleHostService);
      const id = host?.possessedEntityId();
      if (!enabled || !id || !host) { if (root) root.hidden = true; return; }
      if (elapsed < 0.1) return;
      elapsed %= 0.1;
      const state = host.vehicleState(id);
      if (!state) { if (root) root.hidden = true; return; }
      render(host, id, state);
    },
    onLevelUnloaded() { if (root) root.hidden = true; elapsed = 1; },
    dispose() {
      if (typeof window !== "undefined") window.removeEventListener("keydown", keydown);
      root?.remove(); style?.remove(); root = null; style = null; rows = []; cells.clear(); services = null;
    },
  };
}
