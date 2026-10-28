import * as THREE from "three";
import { createXrPanel, panelText } from "../xr/xr-panel";
import type { XrPlaybackState } from "../xr/xr-controls-panel";

export type TabletopAction = { type: "play" | "back" | "forward" | "lower" | "higher" | "lock" | "recenter" | "hide" | "exit" }
  | { type: "seek" | "speed"; value: number };
type Button = { x: number; y: number; w: number; h: number; label: string; type: Exclude<TabletopAction["type"], "seek" | "speed"> };

const BUTTONS: Button[] = [
  { x: 24, y: 212, w: 672, h: 76, label: "", type: "lock" },
  { x: 24, y: 304, w: 328, h: 48, label: "Bajar 3 cm", type: "lower" },
  { x: 368, y: 304, w: 328, h: 48, label: "Subir 3 cm", type: "higher" },
  { x: 24, y: 366, w: 672, h: 44, label: "Traer circuito delante", type: "recenter" },
  { x: 24, y: 524, w: 160, h: 56, label: "−10 s", type: "back" },
  { x: 200, y: 524, w: 320, h: 56, label: "", type: "play" },
  { x: 536, y: 524, w: 160, h: 56, label: "+10 s", type: "forward" },
  { x: 24, y: 744, w: 672, h: 44, label: "Salir de AR", type: "exit" },
];

export class TabletopControlsPanel {
  readonly surface = createXrPanel(720, 800, .55, "ar-tabletop-controls");
  readonly bar = createXrPanel(720, 88, .36, "ar-tabletop-handle");
  private grab: { index: number; distance: number; offset: THREE.Vector3; held: Set<string> } | null = null;
  private readonly point = new THREE.Vector3();

  constructor() {
    this.bar.mesh.position.y = -(.55 * 800 / 720) / 2 - .018 - (.36 * 88 / 720) / 2;
    this.bar.mesh.visible = true;
    this.bar.mesh.renderOrder = 1001;
    this.surface.mesh.add(this.bar.mesh);
  }

  intersect(raycaster: THREE.Raycaster) {
    if (!this.surface.mesh.visible) return null;
    this.surface.mesh.updateWorldMatrix(true, true);
    return raycaster.intersectObjects([this.surface.mesh, this.bar.mesh], false)[0] ?? null;
  }

  isDragging() { return this.grab !== null; }

  hold(index: number, input: string) {
    if (this.grab?.index !== index) return false;
    this.grab.held.add(input);
    return true;
  }

  interact(index: number, hit: THREE.Intersection, input: string, locked: boolean): TabletopAction | null {
    if (!hit.uv) return null;
    const x = hit.uv.x * 720;
    if (hit.uv.y < .1 || hit.uv.y > .9) return null;
    if (x >= 8 && x <= 88 && input === "select" && locked) return { type: "hide" };
    if (x >= 112 && x <= 708 && !this.grab) {
      this.grab = { index, distance: hit.distance, offset: this.surface.mesh.position.clone().sub(hit.point), held: new Set([input]) };
    }
    return null;
  }

  updateGrab(index: number, ray: THREE.Ray) {
    if (this.grab?.index !== index) return;
    ray.at(this.grab.distance, this.point);
    this.surface.mesh.position.copy(this.point).add(this.grab.offset);
  }

  endGrab(index: number, input?: string) {
    if (this.grab?.index !== index) return;
    if (input) { this.grab.held.delete(input); if (this.grab.held.size) return; }
    this.grab = null;
  }

  release() { this.grab = null; }

  private box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, active = false) {
    ctx.fillStyle = active ? "rgba(255, 255, 255, .15)" : "rgba(0, 0, 0, .19)";
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill();
  }

  hit(u: number, v: number, locked: boolean): TabletopAction | null {
    const x = u * 720, y = (1 - v) * 800;
    if (x < 24 || x > 696) return null;
    if (y >= 474 && y <= 510) return { type: "seek", value: THREE.MathUtils.clamp((x - 24) / 672, 0, 1) };
    if (y >= 612 && y <= 656) return { type: "speed", value: [.5, 1, 1.5, 2][Math.min(3, Math.floor((x - 24) / 168))] };
    if (locked && y >= 366 && y <= 410) return { type: "hide" };
    const button = BUTTONS.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (!button || locked && ["lower", "higher", "recenter"].includes(button.type)) return null;
    return { type: button.type };
  }

  paint(state: XrPlaybackState, locked: boolean, width: number) {
    const ctx = this.surface.context;
    ctx.clearRect(0, 0, 720, 800);
    const background = ctx.createLinearGradient(0, 0, 720, 800);
    background.addColorStop(0, "rgba(54, 59, 68, .97)");
    background.addColorStop(1, "rgba(22, 26, 33, .95)");
    ctx.fillStyle = background; ctx.beginPath(); ctx.roundRect(0, 0, 720, 800, 28); ctx.fill();
    ctx.strokeStyle = "rgba(224, 234, 249, .18)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(1, 1, 718, 798, 27); ctx.stroke();
    ctx.fillStyle = locked ? "#63e5b2" : "#e50914";
    ctx.beginPath(); ctx.roundRect(24, 17, 5, 34, 2); ctx.fill();
    panelText(ctx, "APEX", 40, 34, 30, "#fff", 800);
    panelText(ctx, "TU CARRERA EN AR", 156, 34, 17, "#c4cdd9", 600);
    for (const [i, label] of ["1  Coloca y fija", "2  Explora los pilotos"].entries()) {
      const active = locked ? i === 1 : i === 0;
      ctx.fillStyle = active ? "rgba(99, 229, 178, .16)" : "rgba(0, 0, 0, .19)";
      ctx.beginPath(); ctx.roundRect(24 + i * 344, 66, 328, 38, 12); ctx.fill();
      panelText(ctx, label, 40 + i * 344, 85, 18, active ? "#84f4c8" : "#8e9bac", 700);
    }
    panelText(ctx, locked ? "Circuito fijado. Elige un piloto." : "Coloca el circuito en tu espacio", 24, 134, 27, "#fff", 700);
    panelText(ctx, locked ? "Apunta a una bolita o a sus siglas con el láser." : "Un agarre mueve; dos agarres giran y cambian el tamaño.", 24, 169, 19, "#b3c0ce");
    panelText(ctx, locked ? "Pulsa el gatillo para abrir su ficha." : `Ajusta la altura y fija para activar las fichas. · ${width.toFixed(2)} m`, 24, 194, 18, "#b3c0ce");
    for (const b of BUTTONS) {
      if (locked && ["lower", "higher", "recenter"].includes(b.type)) continue;
      this.box(ctx, b.x, b.y, b.w, b.h);
      if (b.type === "lock" && !locked) { ctx.fillStyle = "#e50914"; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 18); ctx.fill(); }
      const label = b.type === "play" ? state.playing ? "Pausar" : "Reproducir"
        : b.type === "lock" ? locked ? "Recolocar circuito" : "FIJAR CIRCUITO Y CONTINUAR" : b.label;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `700 ${b.type === "lock" ? 24 : 21}px Inter, sans-serif`;
      ctx.fillStyle = "#f0f0f5";
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2, b.w - 24);
    }
    if (locked) {
      panelText(ctx, "Ver más detalles abre una pantalla independiente.", 24, 320, 19, "#b3c0ce");
      panelText(ctx, "Muévela y ciérrala desde la barra flotante inferior.", 24, 348, 19, "#b3c0ce");
      this.box(ctx, 24, 366, 672, 44, true);
      panelText(ctx, "Entendido · ver circuito", 220, 388, 21, "#fff", 700);
    }
    panelText(ctx, state.playing ? "REPRODUCIENDO" : "EN PAUSA", 24, 450, 17, state.playing ? "#63e5b2" : "#b7b8c3", 700);
    panelText(ctx, state.timeLabel, 400, 450, 20, "#e1e1e8", 500, 296);
    ctx.fillStyle = "#2b3440"; ctx.fillRect(24, 490, 672, 4);
    ctx.fillStyle = "#e50914"; ctx.fillRect(24, 490, 672 * state.normalizedTime, 4);
    ctx.beginPath(); ctx.arc(24 + 672 * state.normalizedTime, 492, 6, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    panelText(ctx, "VELOCIDAD", 24, 600, 14, "#929eaf", 600);
    for (const [i, speed] of [.5, 1, 1.5, 2].entries()) {
      this.box(ctx, 24 + i * 168, 612, 160, 44, state.speed === speed);
      panelText(ctx, `${speed}×`, 84 + i * 168, 634, 21);
    }
    panelText(ctx, locked ? "Stick pulsado: mostrar / ocultar este menú" : "Stick izq.: mover · Stick der.: giro / tamaño", 24, 692, 18, "#929eaf");
    panelText(ctx, locked ? "Puedes abrir detalles de varios pilotos a la vez." : "Paso necesario: fija el circuito para seleccionar pilotos.", 24, 720, 17, "#b3c0ce");
    this.surface.texture.needsUpdate = true;
    const bar = this.bar.context;
    bar.clearRect(0, 0, 720, 88);
    bar.fillStyle = "rgba(43, 48, 58, .96)";
    bar.beginPath(); bar.roundRect(8, 8, 80, 72, 36); bar.fill();
    bar.beginPath(); bar.roundRect(112, 8, 596, 72, 36); bar.fill();
    panelText(bar, locked ? "×" : "1", locked ? 31 : 36, 44, locked ? 40 : 28, locked ? "#f5f7fa" : "#84f4c8");
    bar.fillStyle = "#d5dce7"; bar.beginPath(); bar.roundRect(250, 25, 316, 6, 3); bar.fill();
    panelText(bar, "Mantén para mover", 282, 57, 19, "#d5dce7");
    this.bar.texture.needsUpdate = true;
  }
}
