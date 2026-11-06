import type { DriverInfo, FrameCarState } from "../../types";
import { createXrPanel, panelBox, panelText, panelRoundedBox } from "./xr-panel";

export type DriverPhoto = { image: HTMLImageElement; ready: boolean };

const COMPOUNDS: Record<string, string> = { SOFT: "Blando", MEDIUM: "Medio", HARD: "Duro", INTERMEDIATE: "Intermedio", INTER: "Intermedio", WET: "Lluvia" };
const COMPOUND_COLORS: Record<string, string> = { SOFT: "#ff545e", MEDIUM: "#f3d14c", HARD: "#f1f5fc", INTERMEDIATE: "#63e5b2", INTER: "#63e5b2", WET: "#64aaff" };
const value = (number: number | null | undefined, suffix = "", digits = 0) =>
  number != null && Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : "—";

export function paintDriverPanel(surface: ReturnType<typeof createXrPanel>, driver: DriverInfo, car: FrameCarState | null, photo: DriverPhoto | undefined, detailed: boolean, onboard = false, overtakes = "") {
  const { context: ctx, texture } = surface;
  const height = surface.canvas.height;
  const sample = car?.sample;
  ctx.clearRect(0, 0, 720, height);
  const background = ctx.createLinearGradient(0, 0, 720, height);
  background.addColorStop(0, "rgba(54, 59, 68, .97)");
  background.addColorStop(1, "rgba(22, 26, 33, .95)");
  ctx.fillStyle = background; ctx.beginPath(); ctx.roundRect(0, 0, 720, height, 28); ctx.fill();
  ctx.strokeStyle = "rgba(224, 234, 249, .18)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(1, 1, 718, height - 2, 27); ctx.stroke();
  ctx.fillStyle = driver.teamColor; ctx.beginPath(); ctx.roundRect(24, 15, 5, 34, 2); ctx.fill();
  panelText(ctx, detailed ? "PILOTO · DETALLES" : "PILOTO SELECCIONADO", 40, 32, 17, "#c4cdd9", 700);
  if (!detailed) panelText(ctx, "×", 659, 38, 34, "#ff545e");
  panelBox(ctx, 24, 60, 132, 150);
  if (photo?.ready) {
    const scale = Math.min(132 / photo.image.naturalWidth, 150 / photo.image.naturalHeight);
    const w = photo.image.naturalWidth * scale, h = photo.image.naturalHeight * scale;
    ctx.drawImage(photo.image, 24 + (132 - w) / 2, 60 + 150 - h, w, h);
  } else panelText(ctx, driver.acronym, 39, 134, 38, driver.teamColor, 800);
  panelText(ctx, `#${driver.driverNumber} · ${driver.acronym}`, 180, 78, 22, driver.teamColor, 700);
  panelText(ctx, driver.fullName, 180, 120, 31, "#fff", 700, 510);
  panelText(ctx, driver.teamName, 180, 160, 23, driver.teamColor, 500, 510);
  if (!car) panelText(ctx, "Sin datos en este instante", 180, 194, 17, "#93a1b4");
  metric(ctx, 24, 234, 212, "POSICIÓN", sample?.position != null ? `P${sample.position}` : "—");
  metric(ctx, 254, 234, 212, "VELOCIDAD", value(sample?.speed, " km/h"));
  const compound = sample?.compound?.toUpperCase() ?? "";
  metric(ctx, 484, 234, 212, "NEUMÁTICO", COMPOUNDS[compound] ?? "—", COMPOUND_COLORS[compound]);
  if (detailed) {
    metric(ctx, 24, 338, 328, "DIFERENCIA AL LÍDER", sample?.position === 1 ? "Líder" : value(sample?.gapToLeader, " s", 2));
    metric(ctx, 368, 338, 328, "INTERVALO AL DE DELANTE", sample?.position === 1 ? "—" : value(sample?.intervalToAhead, " s", 2));
    metric(ctx, 24, 442, 212, "MARCHA", value(sample?.gear));
    metric(ctx, 254, 442, 212, "REVOLUCIONES", value(sample?.rpm, " rpm"));
    const drs = sample?.drs;
    const open = drs != null && [10, 12, 14].includes(drs);
    const closed = drs != null && [0, 1, 2, 3, 8, 9].includes(drs);
    metric(ctx, 484, 442, 212, "DRS", open ? "Abierto" : closed ? "Cerrado" : "—", open ? "#63e5b2" : closed ? "#ff545e" : undefined);
    metric(ctx, 24, 546, 212, "ACELERADOR", value(sample?.throttle, " %"));
    metric(ctx, 254, 546, 212, "FRENO", value(sample?.brake, " %"));
    metric(ctx, 484, 546, 212, "EDAD NEUMÁTICO", value(sample?.tyreAge, " vueltas"));
    panelRoundedBox(ctx, 24, 668, 672, 56, true);
    panelText(ctx, "Historial de radios", 48, 696, 24, "#fff", 700);
    panelText(ctx, "›", 650, 696, 32, driver.teamColor, 800);
  } else {
    ctx.fillStyle = "rgba(255, 255, 255, .12)";
    ctx.beginPath(); ctx.roundRect(24, 330, 672, 60, 18); ctx.fill();
    panelText(ctx, "Ver más detalles", 252, 360, 24, "#fff", 700);
  }
  if (onboard) {
    panelRoundedBox(ctx, 24, 742, 672, 60, true);
    panelText(ctx, "Ver cámara a bordo", 238, 772, 24, "#fff", 700);
  }
  if (detailed && overtakes) {
    panelRoundedBox(ctx, 24, 810, 672, 56, true);
    panelText(ctx, "Adelantamientos ›", 40, 830, 22, "#fff", 700);
    panelText(ctx, overtakes, 40, 853, 18, "#84f4c8", 600, 640);
  }
  texture.needsUpdate = true;
}

function metric(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, label: string, text: string, color = "#f1f5fc") {
  ctx.fillStyle = "rgba(0, 0, 0, .19)";
  ctx.beginPath(); ctx.roundRect(x, y, width, 88, 14); ctx.fill();
  panelText(ctx, label, x + 14, y + 23, 14, "#9facbf", 600, width - 28);
  panelText(ctx, text, x + 14, y + 59, 27, color, 700, width - 28);
}
