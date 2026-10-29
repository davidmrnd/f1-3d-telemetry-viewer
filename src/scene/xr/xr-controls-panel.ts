import * as THREE from "three";
import type { CameraMode } from "../cameras/types";
import { createXrPanel, createXrWindowBar, panelRoundedBox, panelText, panelWindowBackground } from "./xr-panel";

export type XrPlaybackState = { playing: boolean; normalizedTime: number; timeLabel: string; speed: number };
export type XrControlsState = XrPlaybackState & { cameraMode: CameraMode; driverLabel: string; wristVisible: boolean };
export type XrUiAction = { type: "play" | "close" | "wrist" | "exit" | "drivers" } | { type: "jump"; seconds: number }
  | { type: "seek"; ratio: number } | { type: "camera"; mode: CameraMode }
  | { type: "driver"; step: number } | { type: "speed"; value: number };
type Button = { x: number; y: number; w: number; h: number; label: string; action: XrUiAction };

const PANEL_W = 768;
const PANEL_H = 580;

const BUTTONS: Button[] = [
  { x: 24, y: 154, w: 120, h: 56, label: "−30 s", action: { type: "jump", seconds: -30 } },
  { x: 160, y: 154, w: 120, h: 56, label: "−10 s", action: { type: "jump", seconds: -10 } },
  { x: 296, y: 154, w: 176, h: 56, label: "", action: { type: "play" } },
  { x: 488, y: 154, w: 120, h: 56, label: "+10 s", action: { type: "jump", seconds: 10 } },
  { x: 624, y: 154, w: 120, h: 56, label: "+30 s", action: { type: "jump", seconds: 30 } },
  ...(["broadcast", "onboard", "orbit"] as CameraMode[]).map((mode, i) => ({ x: 24 + i * 245, y: 258, w: 230, h: 52,
    label: ["Automática", "A bordo", "Libre"][i], action: { type: "camera" as const, mode } })),
  { x: 24, y: 326, w: 720, h: 52, label: "Elegir piloto · fotos y detalles", action: { type: "drivers" } },
  ...[.5, 1, 1.5, 2].map((value, i) => ({ x: 24 + i * 104, y: 412, w: 92, h: 44,
    label: `${value}×`, action: { type: "speed" as const, value } })),
  { x: 464, y: 412, w: 280, h: 44, label: "", action: { type: "wrist" } },
  { x: 24, y: 508, w: 720, h: 48, label: "Salir de VR", action: { type: "exit" } },
];

export class XrControlsPanel {
  readonly surface = createXrPanel(PANEL_W, PANEL_H, .76, "xr-replay-controls");
  readonly bar = createXrWindowBar(this.surface, PANEL_W, PANEL_H, .76, "xr-replay-handle");
  private signature = "";
  private lastPaint = -Infinity;
  private dirty = true;
  private readonly yaw = new THREE.Euler(0, 0, 0, "YXZ");

  place(head: Pick<THREE.Camera, "position" | "quaternion">) {
    this.yaw.setFromQuaternion(head.quaternion, "YXZ");
    const mesh = this.surface.mesh;
    this.yaw.x = THREE.MathUtils.clamp(this.yaw.x, -.9, .7);
    this.yaw.z = 0;
    mesh.quaternion.setFromEuler(this.yaw);
    mesh.position.set(0, -.04, -.95).applyQuaternion(mesh.quaternion).add(head.position);
  }

  invalidate() { this.dirty = true; }
  needsUpdate(now: number) { return this.surface.mesh.visible && (this.dirty || now - this.lastPaint >= 500); }

  hit(u: number, v: number): XrUiAction | null {
    const x = u * PANEL_W, y = (1 - v) * PANEL_H;
    if (x >= 24 && x <= 744 && y >= 100 && y <= 138) return { type: "seek", ratio: THREE.MathUtils.clamp((x - 24) / 720, 0, 1) };
    return BUTTONS.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.action ?? null;
  }

  update(state: XrControlsState, now: number) {
    if (!this.needsUpdate(now)) return;
    const signature = `${state.playing}|${state.timeLabel}|${Math.round(state.normalizedTime * 500)}|${state.speed}|${state.cameraMode}|${state.driverLabel}|${state.wristVisible}`;
    if (this.dirty || signature !== this.signature) {
      this.paint(state);
      this.surface.texture.needsUpdate = true;
      this.signature = signature;
    }
    this.lastPaint = now;
    this.dirty = false;
  }

  private paint(state: XrControlsState) {
    const { context: ctx } = this.surface;
    panelWindowBackground(ctx, PANEL_W, PANEL_H);
    ctx.fillStyle = "#63e5b2"; ctx.beginPath(); ctx.roundRect(24, 18, 5, 34, 2); ctx.fill();
    panelText(ctx, "APEX", 40, 35, 30, "#fff", 800);
    panelText(ctx, "CONTROL DE CARRERA · VR", 156, 35, 16, "#c4cdd9", 600);
    panelText(ctx, state.playing ? "REPRODUCIENDO" : "EN PAUSA", 24, 80, 17, state.playing ? "#63e5b2" : "#b7b8c3", 700);
    panelText(ctx, state.timeLabel, 450, 80, 20, "#e1e1e8", 500, 294);
    ctx.fillStyle = "#2b2c33"; ctx.fillRect(24, 115, 720, 4);
    ctx.fillStyle = "#e50914"; ctx.fillRect(24, 115, 720 * state.normalizedTime, 4);
    ctx.beginPath(); ctx.arc(24 + 720 * state.normalizedTime, 117, 6, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    panelText(ctx, "PUNTO DE VISTA", 24, 238, 15, "#92949f", 600);
    panelText(ctx, "VELOCIDAD", 24, 398, 14, "#92949f", 600);
    panelText(ctx, "OPCIONES", 464, 398, 14, "#92949f", 600);
    for (const b of BUTTONS) {
      const a = b.action;
      const active = a.type === "camera" && a.mode === state.cameraMode || a.type === "speed" && a.value === state.speed || a.type === "wrist" && state.wristVisible;
      panelRoundedBox(ctx, b.x, b.y, b.w, b.h, active);
      const label = a.type === "play" ? state.playing ? "Pausar" : "Reproducir" : a.type === "wrist" ? `Clasificación · ${state.wristVisible ? "SÍ" : "NO"}` : b.label;
      ctx.font = `600 ${a.type === "wrist" ? 17 : 22}px Inter, sans-serif`;
      ctx.fillStyle = "#f0f0f5"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2, b.w - 12);
    }
    panelText(ctx, "Menú / X izq.: ajustes · A: piloto · B: cámara · Gatillo: seleccionar", 24, 478, 16, "#a7b4c6");
  }
}
