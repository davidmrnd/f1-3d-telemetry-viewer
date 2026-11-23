import type { Camera, Group } from "three";
import { createXrPanel, panelText, panelWindowBackground } from "./xr-panel";

export interface DrivingVrReadout {
  speed: number;
  gear: string;
  time: string;
  comparison: string;
  note: string;
  overlay: { title: string; detail: string; action: string } | null;
}

const WIDTH = 760;
const HEIGHT = 230;

export class DrivingVrHud {
  private readonly panel = createXrPanel(WIDTH, HEIGHT, .77, "xr-driving-hud");
  private lastPaint = -Infinity;
  private lastOverlay = "";

  constructor(root: Group) {
    root.add(this.panel.mesh);
  }

  update(readout: DrivingVrReadout, head: Camera | null, now: number) {
    const { mesh, context, texture } = this.panel;
    mesh.visible = head !== null;
    if (!head) return;
    const { speed, gear, time, comparison, note, overlay } = readout;
    mesh.position.set(0, overlay ? -.26 : -.42, -1.45).applyQuaternion(head.quaternion).add(head.position);
    mesh.quaternion.copy(head.quaternion);
    const title = overlay?.title ?? "";
    if (this.lastOverlay === title && now - this.lastPaint < 60) return;
    this.lastPaint = now;
    this.lastOverlay = title;
    panelWindowBackground(context, WIDTH, HEIGHT);
    if (overlay) {
      panelText(context, title, 28, 38, 34, "#fff", 700, WIDTH - 56);
      panelText(context, overlay.detail, 28, 83, 23, "#d9dce6", 500, WIDTH - 56);
      panelText(context, overlay.action, 28, 127, 25, "#ff8589", 650, WIDTH - 56);
      panelText(context, "Gatillo dcho. acelera · Izq. frena · Stick gira", 28, 171, 22, "#d9dce6", 500, WIDTH - 56);
      panelText(context, "B reinicia · X recentra la vista", 28, 204, 20, "#aeb6c7", 500, WIDTH - 56);
    } else {
      panelText(context, String(Math.round(speed)), 26, 59, 57, "#fff", 700);
      panelText(context, "KM/H", 28, 108, 19, "#c6ccda", 600);
      panelText(context, gear, 246, 59, 57, "#fff", 700);
      panelText(context, "MARCHA", 247, 108, 19, "#c6ccda", 600);
      panelText(context, time, 393, 62, 47, "#fff", 700, 340);
      panelText(context, comparison, 28, 155, 23, "#d9dce6", 500, WIDTH - 56);
      panelText(context, note || "A / clic del stick para pausar", 28, 198, 21, note ? "#ffcb89" : "#aeb6c7", 500, WIDTH - 56);
    }
    texture.needsUpdate = true;
  }

  hide() { this.panel.mesh.visible = false; }
}
