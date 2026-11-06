import type { DriverInfo, RaceMilestone, RaceMilestoneControls } from "../../types";
import { createXrPanel, panelRoundedBox, panelText, panelWindowBackground } from "./xr-panel";

const PAGE_SIZE = 5;
const FILTERS = [["all", "Todos"], ["finish", "Meta"], ["overtake", "Adelant."], ["off_track", "Fuera"], ["pit_entry", "Boxes"]];
const DRIVER_FILTERS = [["all", "Todos"], ["made", "Realizados"], ["received", "Recibidos"]];

export class RaceMilestoneHistory {
  open = false;
  private page = 0;
  private filter = "all";

  constructor(private readonly controls: RaceMilestoneControls, private readonly driver?: DriverInfo) {}

  close() { this.open = false; this.page = 0; this.filter = "all"; }

  private items() {
    return this.controls.getMilestones().filter(item => this.driver
      ? item.kind === "overtake" && item.drivers.includes(this.driver.driverNumber)
        && (this.filter === "all" || (this.filter === "made" ? item.drivers[0] === this.driver.driverNumber : item.drivers[1] === this.driver.driverNumber))
      : this.filter === "all" || item.kind === this.filter);
  }

  select(x: number, y: number) {
    if (x < 24 || x > 696) return false;
    const filters = this.driver ? DRIVER_FILTERS : FILTERS;
    if (y >= 132 && y <= 174) {
      this.filter = filters[Math.min(filters.length - 1, Math.floor((x - 24) / (672 / filters.length)))][0];
      this.page = 0;
    }
    const items = this.items();
    const row = y - 188;
    if (row >= 0 && row < PAGE_SIZE * 94 && row % 94 < 84) {
      const item = items[this.page * PAGE_SIZE + Math.floor(row / 94)];
      if (item) { this.controls.jumpTo(item, this.driver?.driverNumber); return true; }
    } else if (y >= 670 && y <= 718) {
      if (x <= 164 && this.page > 0) this.page--;
      if (x >= 556 && (this.page + 1) * PAGE_SIZE < items.length) this.page++;
    } else if (y >= 736 && y <= 784) this.close();
    return false;
  }

  paint(surface: ReturnType<typeof createXrPanel>) {
    const { context: ctx, texture, canvas } = surface;
    panelWindowBackground(ctx, 720, canvas.height);
    panelText(ctx, this.driver ? "HISTORIAL DE ADELANTAMIENTOS" : "HITOS DEL CIRCUITO", 24, 34, 25, "#fff", 800);
    panelText(ctx, this.driver?.fullName ?? "Elige un instante para revivirlo", 24, 78, 27, this.driver?.teamColor ?? "#84f4c8", 700, 672);
    panelText(ctx, this.driver ? this.summary() : "Meta · adelantamientos · salidas de pista · boxes", 24, 110, 18, "#b3c0ce", 500, 672);
    const filters = this.driver ? DRIVER_FILTERS : FILTERS;
    const width = 672 / filters.length;
    filters.forEach(([value, label], index) => {
      panelRoundedBox(ctx, 24 + index * width, 132, width - 6, 42, value === this.filter);
      panelText(ctx, label, 34 + index * width, 153, 18, "#fff", 600, width - 20);
    });
    const items = this.items();
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    if (!items.length) panelText(ctx, "Sin hitos registrados para este filtro en el tramo.", 24, 220, 23, "#b3c0ce", 500, 672);
    items.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE).forEach((item, index) => {
      const y = 188 + index * 94;
      panelRoundedBox(ctx, 24, y, 672, 84);
      const role = this.driver ? item.drivers[0] === this.driver.driverNumber ? "Realizado · " : "Recibido · " : "";
      panelText(ctx, role + item.label, 38, y + 22, 22, "#fff", 700, 644);
      panelText(ctx, `${this.time(item)}${item.approximate ? " · aprox." : ""} · ${item.detail}`, 38, y + 47, 16, "#b3c0ce", 500, 644);
      panelText(ctx, this.driver ? "Revivir a bordo ›" : "Revivir instante ›", 38, y + 69, 18, "#84f4c8", 700);
    });
    if (this.page > 0) {
      panelRoundedBox(ctx, 24, 670, 140, 48);
      panelText(ctx, "Anterior", 44, 694, 21);
    }
    if (this.page + 1 < pages) {
      panelRoundedBox(ctx, 556, 670, 140, 48);
      panelText(ctx, "Siguiente", 572, 694, 21);
    }
    panelText(ctx, `${this.page + 1} / ${pages}`, 326, 694, 22);
    panelRoundedBox(ctx, 24, 736, 672, 48);
    panelText(ctx, this.driver ? "Volver a los detalles" : "Volver al circuito", 240, 760, 23, "#fff", 600);
    texture.needsUpdate = true;
  }

  summary() {
    const items = this.controls.getMilestones().filter(item => item.kind === "overtake" && item.drivers.includes(this.driver?.driverNumber ?? -1));
    const made = items.filter(item => item.drivers[0] === this.driver?.driverNumber).length;
    return `${made} realizados · ${items.length - made} recibidos en este tramo`;
  }

  private time(item: RaceMilestone) {
    const seconds = Math.floor(item.time / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
}

export function isMilestoneHistoryButton(x: number, y: number) {
  return x >= 24 && x <= 696 && y >= 810 && y <= 866;
}
