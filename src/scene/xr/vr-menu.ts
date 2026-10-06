import * as THREE from "three";
import type { CameraMode } from "../cameras/types";
import {
  CAR_MATERIAL_LABELS,
  DEFAULT_GRAPHICS_SETTINGS,
  GRAPHICS_PRESET_LABELS,
  PIXEL_RATIO_OPTIONS,
  settingsFromPreset,
  SHADOW_QUALITY_LABELS,
  withDetectedPreset,
  XR_SCALE_OPTIONS,
  type CarMaterialQuality,
  type GraphicsPreset,
  type GraphicsSettings,
  type ShadowQuality,
} from "../graphics-settings";

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
  graphics: GraphicsSettings;
};

export type VrMenuActions = {
  onTogglePlay: () => void;
  onReset: () => void;
  onSeek: (ratio: number) => void;
  onSetSpeed: (speed: number) => void;
  onSetCameraMode: (mode: CameraMode) => void;
  onSetFollowDriver: (driverNumber: number) => void;
  onSetGraphicsSettings: (settings: GraphicsSettings) => void;
  onClose: () => void;
};

type MenuPage = "main" | "graphics";

type HitZone =
  | { id: "play" }
  | { id: "reset" }
  | { id: "close" }
  | { id: "seek"; ratio: number }
  | { id: "speed"; value: number }
  | { id: "camera"; mode: CameraMode }
  | { id: "driver"; driverNumber: number }
  | { id: "openGraphics" }
  | { id: "back" }
  | { id: "preset"; preset: GraphicsPreset }
  | { id: "pixelRatio"; value: number }
  | { id: "shadows"; value: ShadowQuality }
  | { id: "environment"; value: boolean }
  | { id: "fog"; value: boolean }
  | { id: "xrScale"; value: number }
  | { id: "carMaterials"; value: CarMaterialQuality }
  | { id: "carShadows"; value: boolean };

type LayoutRect = { x: number; y: number; w: number; h: number; zone: HitZone };

const PANEL_WIDTH_M = 1.25;
const PANEL_HEIGHT_M = 1.4;
const CANVAS_W = 1024;
const CANVAS_H = 1280;
const SPEEDS = [0.5, 1, 1.5, 2];
const CAMERA_OPTIONS: { mode: CameraMode; label: string }[] = [
  { mode: "broadcast", label: "Retransmisión" },
  { mode: "onboard", label: "On-board" },
  { mode: "orbit", label: "Libre" },
];
const PRESETS: GraphicsPreset[] = ["low", "medium", "high"];
const SHADOWS: ShadowQuality[] = ["off", "low", "high"];
const CAR_MATERIALS: CarMaterialQuality[] = ["pbr", "simple"];

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
  private scrubbing = false;
  private page: MenuPage = "main";

  constructor(actions: VrMenuActions, initial: VrMenuState) {
    this.actions = actions;
    this.state = {
      ...initial,
      drivers: [...initial.drivers],
      graphics: { ...(initial.graphics ?? DEFAULT_GRAPHICS_SETTINGS) },
    };

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
    if (!open) {
      this.scrubbing = false;
      this.page = "main";
      this.rebuildLayout();
      this.needsRedraw = true;
    }
  }

  endPointer() {
    this.scrubbing = false;
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
    const nextGraphics = partial.graphics
      ? { ...partial.graphics }
      : this.state.graphics;
    const next: VrMenuState = {
      ...this.state,
      ...partial,
      drivers: nextDrivers,
      graphics: nextGraphics,
    };
    const graphicsChanged =
      next.graphics.preset !== this.state.graphics.preset ||
      next.graphics.maxPixelRatio !== this.state.graphics.maxPixelRatio ||
      next.graphics.shadows !== this.state.graphics.shadows ||
      next.graphics.environment !== this.state.graphics.environment ||
      next.graphics.fog !== this.state.graphics.fog ||
      next.graphics.xrScale !== this.state.graphics.xrScale ||
      next.graphics.carMaterials !== this.state.graphics.carMaterials ||
      next.graphics.carShadows !== this.state.graphics.carShadows;
    const changed =
      next.playing !== this.state.playing ||
      next.normalizedTime !== this.state.normalizedTime ||
      next.timeLabel !== this.state.timeLabel ||
      next.speed !== this.state.speed ||
      next.cameraMode !== this.state.cameraMode ||
      next.followDriver !== this.state.followDriver ||
      next.drivers !== this.state.drivers ||
      graphicsChanged;
    this.state = next;
    if (partial.drivers || partial.cameraMode !== undefined || graphicsChanged) {
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
    if (!this.open) return false;
    const uv = raycaster.intersectObject(this.hitMesh, false)[0]?.uv;
    if (!uv) return false;
    const zone = this.hitTest(uv.x * CANVAS_W, (1 - uv.y) * CANVAS_H);
    if (!zone) return false;
    this.scrubbing = zone.id === "seek";
    this.activateZone(zone);
    return true;
  }

  handleRaycastHold(raycaster: THREE.Raycaster): boolean {
    if (!this.open || !this.scrubbing) return false;
    const uv = raycaster.intersectObject(this.hitMesh, false)[0]?.uv;
    if (!uv) return false;
    const bar = this.layout.find((r) => r.zone.id === "seek");
    if (!bar) return false;
    const ratio = Math.max(0, Math.min(1, (uv.x * CANVAS_W - bar.x) / bar.w));
    this.setState({ normalizedTime: ratio });
    this.actions.onSeek(ratio);
    return true;
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
      case "openGraphics":
        this.page = "graphics";
        this.rebuildLayout();
        this.needsRedraw = true;
        break;
      case "back":
        this.page = "main";
        this.rebuildLayout();
        this.needsRedraw = true;
        break;
      case "preset": {
        const settings = settingsFromPreset(zone.preset);
        this.actions.onSetGraphicsSettings(settings);
        this.setState({ graphics: settings });
        break;
      }
      case "pixelRatio": {
        const settings = withDetectedPreset({
          ...this.state.graphics,
          maxPixelRatio: zone.value,
        });
        this.actions.onSetGraphicsSettings(settings);
        this.setState({ graphics: settings });
        break;
      }
      case "shadows": {
        const settings = withDetectedPreset({
          ...this.state.graphics,
          shadows: zone.value,
        });
        this.actions.onSetGraphicsSettings(settings);
        this.setState({ graphics: settings });
        break;
      }
      case "environment": {
        const settings = withDetectedPreset({
          ...this.state.graphics,
          environment: zone.value,
        });
        this.actions.onSetGraphicsSettings(settings);
        this.setState({ graphics: settings });
        break;
      }
      case "fog": {
        const settings = withDetectedPreset({
          ...this.state.graphics,
          fog: zone.value,
        });
        this.actions.onSetGraphicsSettings(settings);
        this.setState({ graphics: settings });
        break;
      }
      case "xrScale": {
        const settings = withDetectedPreset({
          ...this.state.graphics,
          xrScale: zone.value,
        });
        this.actions.onSetGraphicsSettings(settings);
        this.setState({ graphics: settings });
        break;
      }
      case "carMaterials": {
        const settings = withDetectedPreset({
          ...this.state.graphics,
          carMaterials: zone.value,
        });
        this.actions.onSetGraphicsSettings(settings);
        this.setState({ graphics: settings });
        break;
      }
      case "carShadows": {
        const settings = withDetectedPreset({
          ...this.state.graphics,
          carShadows: zone.value,
        });
        this.actions.onSetGraphicsSettings(settings);
        this.setState({ graphics: settings });
        break;
      }
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
    this.layout = this.page === "graphics" ? this.buildGraphicsLayout() : this.buildMainLayout();
  }

  private buildMainLayout(): LayoutRect[] {
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

    layout.push({
      x: pad,
      y,
      w: 280,
      h: 56,
      zone: { id: "openGraphics" },
    });
    y += 80;

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

    return layout;
  }

  private buildGraphicsLayout(): LayoutRect[] {
    const layout: LayoutRect[] = [];
    const pad = 36;
    const rowH = 48;
    const rowGap = 78;
    let y = 90;

    layout.push({ x: pad, y, w: 200, h: 52, zone: { id: "back" } });
    layout.push({ x: CANVAS_W - pad - 160, y, w: 160, h: 52, zone: { id: "close" } });
    y += 84;

    PRESETS.forEach((preset, index) => {
      layout.push({
        x: pad + index * 240,
        y,
        w: 220,
        h: rowH,
        zone: { id: "preset", preset },
      });
    });
    y += rowGap;

    PIXEL_RATIO_OPTIONS.forEach((value, index) => {
      layout.push({
        x: pad + (index % 5) * 190,
        y,
        w: 170,
        h: rowH,
        zone: { id: "pixelRatio", value },
      });
    });
    y += rowGap;

    XR_SCALE_OPTIONS.forEach((value, index) => {
      layout.push({
        x: pad + index * 240,
        y,
        w: 220,
        h: rowH,
        zone: { id: "xrScale", value },
      });
    });
    y += rowGap;

    SHADOWS.forEach((value, index) => {
      layout.push({
        x: pad + index * 240,
        y,
        w: 220,
        h: rowH,
        zone: { id: "shadows", value },
      });
    });
    y += rowGap;

    layout.push({ x: pad, y, w: 220, h: rowH, zone: { id: "carShadows", value: true } });
    layout.push({ x: pad + 240, y, w: 220, h: rowH, zone: { id: "carShadows", value: false } });
    y += rowGap;

    CAR_MATERIALS.forEach((value, index) => {
      layout.push({
        x: pad + index * 240,
        y,
        w: 220,
        h: rowH,
        zone: { id: "carMaterials", value },
      });
    });
    y += rowGap;

    layout.push({ x: pad, y, w: 220, h: rowH, zone: { id: "environment", value: true } });
    layout.push({ x: pad + 240, y, w: 220, h: rowH, zone: { id: "environment", value: false } });
    y += rowGap;

    layout.push({ x: pad, y, w: 220, h: rowH, zone: { id: "fog", value: true } });
    layout.push({ x: pad + 240, y, w: 220, h: rowH, zone: { id: "fog", value: false } });

    return layout;
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

    if (this.page === "graphics") {
      this.drawGraphicsLabels();
    } else {
      ctx.fillStyle = "#e8eef5";
      ctx.font = "700 42px Segoe UI, sans-serif";
      ctx.fillText("Menú VR", 48, 70);

      ctx.font = "500 28px Segoe UI, sans-serif";
      ctx.fillStyle = "#9db0c4";
      ctx.fillText(this.state.timeLabel, 280, 68);
    }

    for (const rect of this.layout) {
      this.drawZone(rect);
    }

    this.texture.needsUpdate = true;
  }

  private drawGraphicsLabels() {
    const { ctx, state } = this;
    ctx.fillStyle = "#e8eef5";
    ctx.font = "700 42px Segoe UI, sans-serif";
    ctx.fillText("Gráficos", 260, 70);

    ctx.fillStyle = "#9db0c4";
    ctx.font = "600 20px Segoe UI, sans-serif";
    ctx.fillText("Preset", 48, 160);
    ctx.fillText("Resolución", 48, 238);
    ctx.fillText("Escala VR", 48, 316);
    ctx.fillText("Sombras", 48, 394);
    ctx.fillText("Sombras coches", 48, 472);
    ctx.fillText("Materiales coches", 48, 550);
    ctx.fillText("Entorno HDRI", 48, 628);
    ctx.fillText("Niebla", 48, 706);

    ctx.fillStyle = "#7aa2c8";
    ctx.font = "500 22px Segoe UI, sans-serif";
    ctx.fillText(GRAPHICS_PRESET_LABELS[state.graphics.preset], 780, 70);
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
      case "openGraphics":
        label = "Gráficos";
        break;
      case "back":
        label = "Volver";
        break;
      case "preset":
        label = GRAPHICS_PRESET_LABELS[zone.preset];
        active = state.graphics.preset === zone.preset;
        break;
      case "pixelRatio":
        label = `${zone.value}x`;
        active = state.graphics.maxPixelRatio === zone.value;
        break;
      case "shadows":
        label = SHADOW_QUALITY_LABELS[zone.value];
        active = state.graphics.shadows === zone.value;
        break;
      case "environment":
        label = zone.value ? "On" : "Off";
        active = state.graphics.environment === zone.value;
        break;
      case "fog":
        label = zone.value ? "On" : "Off";
        active = state.graphics.fog === zone.value;
        break;
      case "xrScale":
        label = `${zone.value}x`;
        active = state.graphics.xrScale === zone.value;
        break;
      case "carMaterials":
        label = CAR_MATERIAL_LABELS[zone.value];
        active = state.graphics.carMaterials === zone.value;
        break;
      case "carShadows":
        label = zone.value ? "On" : "Off";
        active = state.graphics.carShadows === zone.value;
        break;
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
