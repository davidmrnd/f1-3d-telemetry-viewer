import type { DriverInfo, TeamRadioControls } from "../../types";
import { createXrPanel, panelRoundedBox, panelText, panelWindowBackground } from "./xr-panel";

const PAGE_SIZE = 5;
const ROW_TOP = 120;
const ROW_STEP = 82;
const ROW_HEIGHT = 72;
const ACTION_TOP = 12;
const ACTION_HEIGHT = 48;
const JUMP_LEFT = 488;
const JUMP_WIDTH = 190;
const PAGE_TOP = 544;
const BACK_TOP = 610;
const BUTTON_HEIGHT = 48;

export function isRadioHistoryButton(x: number, y: number) {
  return x >= 24 && x <= 696 && y >= 668 && y <= 724;
}

export class DriverRadioHistory {
  open = false;
  private page = 0;

  constructor(private readonly controls: TeamRadioControls, private readonly driver: DriverInfo) {}

  close() {
    if (this.open) this.controls.stop(this.driver.driverNumber);
    this.open = false;
    this.page = 0;
  }

  select(x: number, y: number) {
    if (x < 24 || x > 696) return;
    const clips = this.controls.getClips(this.driver.driverNumber);
    const row = y - ROW_TOP;
    if (row >= 0 && row < PAGE_SIZE * ROW_STEP && row % ROW_STEP < ROW_HEIGHT) {
      const clip = clips[this.page * PAGE_SIZE + Math.floor(row / ROW_STEP)];
      const rowY = row % ROW_STEP;
      if (!clip || rowY < ACTION_TOP || rowY > ACTION_TOP + ACTION_HEIGHT) return;
      if (x >= 38 && x <= 86) this.controls.toggle(clip);
      else if (x >= JUMP_LEFT && x <= JUMP_LEFT + JUMP_WIDTH) this.controls.jumpTo(clip);
    } else if (y >= PAGE_TOP && y <= PAGE_TOP + BUTTON_HEIGHT) {
      if (x <= 144 && this.page > 0) this.page--;
      if (x >= 576 && (this.page + 1) * PAGE_SIZE < clips.length) this.page++;
    } else if (y >= BACK_TOP && y <= BACK_TOP + BUTTON_HEIGHT) {
      this.close();
    }
  }

  paint(surface: ReturnType<typeof createXrPanel>) {
    const { context: ctx, texture, canvas } = surface;
    const clips = this.controls.getClips(this.driver.driverNumber);
    const first = this.page * PAGE_SIZE;
    panelWindowBackground(ctx, 720, canvas.height);
    panelText(ctx, "HISTORIAL DE RADIOS", 24, 34, 22, "#a7b4c6", 700);
    panelText(ctx, this.driver.fullName, 24, 78, 30, this.driver.teamColor, 700, 672);
    if (!clips.length) panelText(ctx, "Sin radios disponibles en este tramo.", 24, 155, 23, "#d0dbe9");

    clips.slice(first, first + PAGE_SIZE).forEach((clip, index) => {
      const y = ROW_TOP + index * ROW_STEP;
      const action = this.controls.getAction(clip);
      const seconds = Math.floor(clip.time / 1000);
      const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      panelRoundedBox(ctx, 24, y, 672, ROW_HEIGHT, action === "Pausar");
      panelRoundedBox(ctx, 38, y + ACTION_TOP, 48, ACTION_HEIGHT, true);
      panelText(ctx, action === "Pausar" ? "Ⅱ" : action === "Reintentar" ? "↻" : "▶", 51, y + 36, 23, this.driver.teamColor, 800);
      panelText(ctx, `Radio ${String(first + index + 1).padStart(2, "0")}`, 104, y + 24, 22, "#fff", 700);
      panelText(ctx, time, 104, y + 49, 17, "#b3bdcd");
      panelRoundedBox(ctx, JUMP_LEFT, y + ACTION_TOP, JUMP_WIDTH, ACTION_HEIGHT, true);
      panelText(ctx, "Ir al instante ›", JUMP_LEFT + 18, y + ROW_HEIGHT / 2, 21, "#edf2fa", 600);
    });

    const pages = Math.ceil(clips.length / PAGE_SIZE);
    if (pages > 1) {
      if (this.page > 0) {
        panelRoundedBox(ctx, 24, PAGE_TOP, 120, BUTTON_HEIGHT);
        panelText(ctx, "Anterior", 44, PAGE_TOP + BUTTON_HEIGHT / 2, 19);
      }
      if (this.page + 1 < pages) {
        panelRoundedBox(ctx, 576, PAGE_TOP, 120, BUTTON_HEIGHT);
        panelText(ctx, "Siguiente", 594, PAGE_TOP + BUTTON_HEIGHT / 2, 19);
      }
      panelText(ctx, `${this.page + 1} / ${pages}`, 332, PAGE_TOP + BUTTON_HEIGHT / 2, 22);
    }
    panelRoundedBox(ctx, 24, BACK_TOP, 672, BUTTON_HEIGHT);
    panelText(ctx, "Volver a los detalles", 245, BACK_TOP + BUTTON_HEIGHT / 2, 23, "#fff", 600);
    texture.needsUpdate = true;
  }
}
