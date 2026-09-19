import * as THREE from "three";
import type { CameraMode } from "../cameras/types";

export type VrMenuDriverOption = {
  driverNumber: number;
  label: string;
};

export type VrMenuState = {
  playing: boolean;
  normalizedTime: number;
  timeLabel: string;
  speed: number;
  cameraMode: CameraMode;
  followDriver: number | null;
  drivers: VrMenuDriverOption[];
};

export type VrMenuActions = {
  onTogglePlay: () => void;
  onReset: () => void;
  onSeek: (ratio: number) => void;
  onSetSpeed: (speed: number) => void;
  onSetCameraMode: (mode: CameraMode) => void;
  onSetFollowDriver: (driverNumber: number) => void;
  onClose: () => void;
};

type HitZone =
  | { id: "play" }
  | { id: "reset" }
  | { id: "close" }
  | { id: "seek"; ratio: number }
  | { id: "speed"; value: number }
  | { id: "camera"; mode: CameraMode }
  | { id: "driver"; driverNumber: number };

type LayoutRect = { x: number; y: number; w: number; h: number; zone: HitZone };

const PANEL_WIDTH_M = 1.15;
const PANEL_HEIGHT_M = 0.92;
const CANVAS_W = 1024;
const CANVAS_H = 820;
const SPEEDS = [0.5, 1, 1.5, 2];
const CAMERA_OPTIONS: { mode: CameraMode; label: string }[] = [
  { mode: "broadcast", label: "Retransmisión" },
  { mode: "onboard", label: "On-board" },
  { mode: "orbit", label: "Libre" },
];

export class VrMenu {
  readonly group = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly panel: THREE.Mesh;
  private readonly hitMesh: THREE.Mesh;
  private readonly actions: VrMenuActions;
  private state: VrMenuState;
  private layout: LayoutRect[] = [];
  private open = false;
  private needsRedraw = true;

  constructor(actions: VrMenuActions, initial: VrMenuState) {
    this.actions = actions;
    this.state = { ...initial, drivers: [...initial.drivers] };

    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No se pudo crear el contexto 2D del menú VR.");
    }
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: false,
    });
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH_M, PANEL_HEIGHT_M),
      material,
    );
    this.panel.name = "vr-menu-panel";

    this.hitMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH_M, PANEL_HEIGHT_M),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.FrontSide }),
    );
    this.hitMesh.name = "vr-menu-hit";

    this.group.add(this.panel);
    this.group.add(this.hitMesh);
    this.group.visible = false;
    this.group.name = "vr-menu";
    this.rebuildLayout();
    this.draw();
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean) {
    this.open = open;
    this.group.visible = open;
  }

  toggle(): boolean {
    this.setOpen(!this.open);
    return this.open;
  }

  placeInFrontOf(camera: THREE.Camera, distance = 1.4) {
    camera.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    const position = origin.clone().addScaledVector(forward, distance);
    position.y -= 0.15;

    this.group.position.copy(position);
    camera.getWorldQuaternion(this.group.quaternion);
  }

  setState(partial: Partial<VrMenuState>) {
    const nextDrivers = partial.drivers ? [...partial.drivers] : this.state.drivers;
    const next: VrMenuState = {
      ...this.state,
      ...partial,
      drivers: nextDrivers,
    };
    const changed =
      next.playing !== this.state.playing ||
      next.normalizedTime !== this.state.normalizedTime ||
      next.timeLabel !== this.state.timeLabel ||
      next.speed !== this.state.speed ||
      next.cameraMode !== this.state.cameraMode ||
      next.followDriver !== this.state.followDriver ||
      next.drivers !== this.state.drivers;
    this.state = next;
    if (partial.drivers || partial.cameraMode !== undefined) {
      this.rebuildLayout();
    }
    if (changed) {
      this.needsRedraw = true;
    }
  }

  update() {
    if (this.open && this.needsRedraw) {
      this.draw();
      this.needsRedraw = false;
    }
  }

  getHitTargets(): THREE.Object3D[] {
    return [this.hitMesh];
  }

  handleRaycast(raycaster: THREE.Raycaster): boolean {
    if (!this.open) {
      return false;
    }
    const hits = raycaster.intersectObject(this.hitMesh, false);
    if (hits.length === 0) {
      return false;
    }
    const uv = hits[0].uv;
    if (!uv) {
      return false;
    }
    const px = uv.x * CANVAS_W;
    const py = (1 - uv.y) * CANVAS_H;
    const zone = this.hitTest(px, py);
    if (!zone) {
      return false;
    }
    this.activateZone(zone);
    return true;
  }

  handleRaycastHold(raycaster: THREE.Raycaster): boolean {
    if (!this.open) {
      return false;
    }
    const hits = raycaster.intersectObject(this.hitMesh, false);
    if (hits.length === 0) {
      return false;
    }
    const uv = hits[0].uv;
    if (!uv) {
      return false;
    }
    const px = uv.x * CANVAS_W;
    const py = (1 - uv.y) * CANVAS_H;
    const zone = this.hitTest(px, py);
    if (zone?.id === "seek") {
      this.actions.onSeek(zone.ratio);
      this.setState({ normalizedTime: zone.ratio });
      return true;
    }
    return false;
  }

  private activateZone(zone: HitZone) {
    switch (zone.id) {
      case "play":
        this.actions.onTogglePlay();
        break;
      case "reset":
        this.actions.onReset();
        break;
      case "close":
        this.actions.onClose();
        break;
      case "seek":
        this.actions.onSeek(zone.ratio);
        this.setState({ normalizedTime: zone.ratio });
        break;
      case "speed":
        this.actions.onSetSpeed(zone.value);
        this.setState({ speed: zone.value });
        break;
      case "camera":
        this.actions.onSetCameraMode(zone.mode);
        this.setState({ cameraMode: zone.mode });
        break;
      case "driver":
        this.actions.onSetFollowDriver(zone.driverNumber);
        this.setState({ followDriver: zone.driverNumber });
        break;
      default:
        break;
    }
  }

  private hitTest(px: number, py: number): HitZone | null {
    for (const rect of this.layout) {
      if (px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h) {
        if (rect.zone.id === "seek") {
          const ratio = Math.max(0, Math.min(1, (px - rect.x) / rect.w));
          return { id: "seek", ratio };
        }
        return rect.zone;
      }
    }
    return null;
  }

  private rebuildLayout() {
    const layout: LayoutRect[] = [];
    const pad = 36;
    let y = 90;

    layout.push({ x: pad, y, w: 280, h: 64, zone: { id: "play" } });
    layout.push({ x: pad + 300, y, w: 220, h: 64, zone: { id: "reset" } });
    layout.push({ x: CANVAS_W - pad - 160, y, w: 160, h: 64, zone: { id: "close" } });
    y += 100;

    layout.push({ x: pad, y, w: CANVAS_W - pad * 2, h: 56, zone: { id: "seek", ratio: 0 } });
    y += 100;

    SPEEDS.forEach((value, index) => {
      layout.push({
        x: pad + index * 180,
        y,
        w: 160,
        h: 56,
        zone: { id: "speed", value },
      });
    });
    y += 100;

    CAMERA_OPTIONS.forEach((option, index) => {
      layout.push({
        x: pad + index * 240,
        y,
        w: 220,
        h: 56,
        zone: { id: "camera", mode: option.mode },
      });
    });
    y += 100;

    if (this.state.cameraMode === "onboard") {
      this.state.drivers.slice(0, 8).forEach((driver, index) => {
        const col = index % 4;
        const row = Math.floor(index / 4);
        layout.push({
          x: pad + col * 240,
          y: y + row * 70,
          w: 220,
          h: 56,
          zone: { id: "driver", driverNumber: driver.driverNumber },
        });
      });
    }

    this.layout = layout;
  }

  private draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = "rgba(12, 18, 28, 0.92)";
    this.roundRect(20, 20, CANVAS_W - 40, CANVAS_H - 40, 28);
    ctx.fill();

    ctx.strokeStyle = "rgba(120, 160, 200, 0.45)";
    ctx.lineWidth = 3;
    this.roundRect(20, 20, CANVAS_W - 40, CANVAS_H - 40, 28);
    ctx.stroke();

    ctx.fillStyle = "#e8eef5";
    ctx.font = "700 42px Segoe UI, sans-serif";
    ctx.fillText("Menú VR", 48, 70);

    ctx.font = "500 28px Segoe UI, sans-serif";
    ctx.fillStyle = "#9db0c4";
    ctx.fillText(this.state.timeLabel, 280, 68);

    for (const rect of this.layout) {
      this.drawZone(rect);
    }

    this.texture.needsUpdate = true;
  }

  private drawZone(rect: LayoutRect) {
    const { ctx, state } = this;
    const zone = rect.zone;
    let label = "";
    let active = false;

    switch (zone.id) {
      case "play":
        label = state.playing ? "Pausar" : "Reproducir";
        active = state.playing;
        break;
      case "reset":
        label = "Reiniciar";
        break;
      case "close":
        label = "Cerrar";
        break;
      case "seek":
        this.drawSeekBar(rect);
        return;
      case "speed":
        label = `${zone.value}x`;
        active = state.speed === zone.value;
        break;
      case "camera":
        label = CAMERA_OPTIONS.find((o) => o.mode === zone.mode)?.label ?? zone.mode;
        active = state.cameraMode === zone.mode;
        break;
      case "driver": {
        const driver = state.drivers.find((d) => d.driverNumber === zone.driverNumber);
        label = driver?.label ?? `#${zone.driverNumber}`;
        active = state.followDriver === zone.driverNumber;
        break;
      }
      default:
        break;
    }

    ctx.fillStyle = active ? "rgba(56, 120, 190, 0.95)" : "rgba(40, 54, 70, 0.95)";
    this.roundRect(rect.x, rect.y, rect.w, rect.h, 14);
    ctx.fill();

    ctx.fillStyle = "#f2f6fb";
    ctx.font = "600 28px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  private drawSeekBar(rect: LayoutRect) {
    const { ctx, state } = this;
    ctx.fillStyle = "rgba(30, 40, 52, 0.95)";
    this.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
    ctx.fill();

    const fillW = Math.max(8, rect.w * state.normalizedTime);
    ctx.fillStyle = "rgba(80, 160, 230, 0.95)";
    this.roundRect(rect.x, rect.y, fillW, rect.h, 12);
    ctx.fill();

    ctx.fillStyle = "#c5d4e4";
    ctx.font = "600 24px Segoe UI, sans-serif";
    ctx.fillText("Tiempo", rect.x + 16, rect.y - 12);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this;
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}
