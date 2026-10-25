import * as THREE from "three";
import { createXrPanel, panelBox, panelText } from "../xr/xr-panel";
import type { XrPlaybackState } from "../xr/xr-controls-panel";
import type { TabletopModel } from "./tabletop-model";

type Action = "play" | "back" | "forward" | "lower" | "higher" | "lock" | "recenter" | "exit";
type GrabInput = "select" | "squeeze";
type Grab = { distance: number; offset: THREE.Vector3; held: Set<GrabInput> };
const BUTTONS: { x: number; y: number; w: number; h: number; label: string; action: Action }[] = [
  { x: 24, y: 148, w: 160, h: 56, label: "−10 s", action: "back" },
  { x: 200, y: 148, w: 320, h: 56, label: "", action: "play" },
  { x: 536, y: 148, w: 160, h: 56, label: "+10 s", action: "forward" },
  { x: 24, y: 250, w: 328, h: 52, label: "Bajar 3 cm", action: "lower" },
  { x: 368, y: 250, w: 328, h: 52, label: "Subir 3 cm", action: "higher" },
  { x: 24, y: 318, w: 328, h: 56, label: "", action: "lock" },
  { x: 368, y: 318, w: 328, h: 56, label: "Traer delante", action: "recenter" },
  { x: 24, y: 566, w: 672, h: 48, label: "Salir de AR", action: "exit" },
];

export class TabletopXr {
  private readonly panel = createXrPanel(720, 640, .55, "ar-tabletop-controls");
  private readonly inputs: { ray: THREE.Group; grip: THREE.Group; pointer: THREE.Line; source: XRInputSource | null }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  private readonly point = new THREE.Vector3();
  private readonly hands = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly midpoint = new THREE.Vector3();
  private readonly separation = new THREE.Vector3();
  private readonly head = new THREE.PerspectiveCamera();
  private readonly yaw = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly grabs = new Map<number, Grab>();
  private twoHand: { midpoint: THREE.Vector3; separation: THREE.Vector3; position: THREE.Vector3; width: number; yaw: number } | null = null;
  private active = false;
  private placed = false;
  private locked = false;
  private menuPressed = false;
  private lastPaint = -Infinity;
  private lastUpdate = 0;
  private savedPlacement = { position: new THREE.Vector3(), yaw: 0, width: 1.2 };

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, private readonly model: TabletopModel,
    private readonly playback: {
      getState: () => XrPlaybackState; togglePlay: () => void; seek: (ratio: number) => void;
      jump: (seconds: number) => void; speed: (speed: number) => void; exit: () => void;
    }) {
    scene.add(this.panel.mesh);
    for (let index = 0; index < 2; index++) {
      const ray = renderer.xr.getController(index);
      const grip = renderer.xr.getControllerGrip(index);
      const pointer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: "#74e2eb", transparent: true, opacity: .7, depthTest: false, toneMapped: false }));
      pointer.visible = false;
      pointer.renderOrder = 1100;
      ray.add(pointer);
      this.inputs.push({ ray, grip, pointer, source: null });
      ray.addEventListener("connected", event => { this.inputs[index].source = event.data; });
      ray.addEventListener("disconnected", () => {
        this.inputs[index].source = null;
        this.endGrab(index);
      });
      ray.addEventListener("selectstart", () => this.select(index));
      ray.addEventListener("selectend", () => this.endGrab(index, "select"));
      ray.addEventListener("squeezestart", () => { if (this.active && this.placed) this.startGrab(index, "squeeze"); });
      ray.addEventListener("squeezeend", () => this.endGrab(index, "squeeze"));
    }
  }

  setActive(active: boolean, scene: THREE.Scene, viewerRoot: THREE.Group) {
    this.active = active;
    this.placed = false;
    this.clearGrabs();
    this.locked = false;
    this.menuPressed = false;
    this.lastUpdate = 0;
    this.panel.mesh.visible = active;
    if (active) {
      this.savedPlacement.position.copy(this.model.group.position);
      this.savedPlacement.yaw = this.model.group.rotation.y;
      this.savedPlacement.width = this.model.getWidth();
    } else {
      this.model.group.position.copy(this.savedPlacement.position);
      this.model.group.rotation.y = this.savedPlacement.yaw;
      this.model.setWidth(this.savedPlacement.width);
    }
    for (const { ray, grip, pointer } of this.inputs) {
      pointer.visible = active;
      (active ? scene : viewerRoot).add(ray, grip);
    }
  }

  update(head: THREE.Camera, now: number) {
    if (!this.active) return;
    this.head.position.copy(head.position);
    this.head.quaternion.copy(head.quaternion);
    if (!this.placed) {
      this.recenter();
      this.placed = true;
    }
    const dt = this.lastUpdate ? Math.min((now - this.lastUpdate) / 1000, .05) : 0;
    this.lastUpdate = now;
    const menu = this.inputs.some(({ source }) => source?.gamepad?.buttons[3]?.pressed);
    if (menu && !this.menuPressed) this.toggleMenu();
    this.menuPressed = menu;
    for (const index of this.grabs.keys()) {
      if (!this.isTracked(index)) this.endGrab(index);
    }
    if (this.grabs.size === 2) this.updateTwoHand();
    else if (this.grabs.size === 1) {
      const [index, grab] = this.grabs.entries().next().value!;
      this.setRay(index);
      this.raycaster.ray.at(grab.distance, this.point);
      this.model.group.position.copy(this.point).add(grab.offset);
    } else if (!this.locked) this.moveWithSticks(dt);
    for (let index = 0; index < this.inputs.length; index++) {
      const input = this.inputs[index];
      input.pointer.visible = input.ray.visible && input.source !== null;
      this.setRay(index);
      const hit = this.panel.mesh.visible ? this.raycaster.intersectObject(this.panel.mesh)[0] : null;
      input.pointer.scale.z = hit?.distance ?? this.boardDistance() ?? .8;
    }
    if (now - this.lastPaint > 150) this.paint(now);
  }

  private setRay(index: number) {
    const ray = this.inputs[index].ray;
    ray.updateWorldMatrix(true, false);
    this.raycaster.ray.origin.setFromMatrixPosition(ray.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(ray.matrixWorld);
    this.raycaster.far = 5;
    this.panel.mesh.updateMatrixWorld(true);
  }

  private boardDistance(): number | null {
    this.plane.constant = -this.model.group.position.y;
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.point);
    if (!hit) return null;
    const distance = this.raycaster.ray.origin.distanceTo(hit);
    if (distance > 5) return null;
    this.model.group.updateMatrixWorld(true);
    const local = this.model.group.worldToLocal(hit.clone());
    return Math.abs(local.x) <= .55 && Math.abs(local.z) <= .55 ? distance : null;
  }

  private startGrab(index: number, held: GrabInput) {
    if (this.locked || !this.isTracked(index)) return;
    const existing = this.grabs.get(index);
    if (existing) { existing.held.add(held); return; }
    this.setRay(index);
    const distance = this.boardDistance() ?? (this.grabs.size ? .8 : null);
    if (distance === null) return;
    this.raycaster.ray.at(distance, this.point);
    this.grabs.set(index, { distance, offset: this.model.group.position.clone().sub(this.point), held: new Set([held]) });
    if (this.grabs.size === 2) this.beginTwoHand();
  }

  private clearGrabs() {
    this.grabs.clear();
    this.twoHand = null;
  }

  private isTracked(index: number) {
    const { source, ray, grip } = this.inputs[index];
    return source !== null && ray.visible && (!source.gripSpace || grip.visible);
  }

  private endGrab(index: number, held?: GrabInput) {
    const grab = this.grabs.get(index);
    if (!grab) return;
    if (held) {
      grab.held.delete(held);
      if (grab.held.size) return;
    }
    this.grabs.delete(index);
    this.twoHand = null;
    for (const [remaining, single] of this.grabs) {
      this.setRay(remaining);
      this.raycaster.ray.at(single.distance, this.point);
      single.offset.copy(this.model.group.position).sub(this.point);
    }
  }

  private readHands() {
    for (let index = 0; index < 2; index++) {
      const input = this.inputs[index];
      const space = input.source?.gripSpace && input.grip.visible ? input.grip : input.ray;
      space.getWorldPosition(this.hands[index]);
    }
    this.midpoint.copy(this.hands[0]).add(this.hands[1]).multiplyScalar(.5);
    this.separation.copy(this.hands[1]).sub(this.hands[0]);
  }

  private beginTwoHand() {
    this.readHands();
    if (this.separation.length() < .08) { this.twoHand = null; return; }
    this.twoHand = { midpoint: this.midpoint.clone(), separation: this.separation.clone(),
      position: this.model.group.position.clone(), width: this.model.getWidth(), yaw: this.model.group.rotation.y };
  }

  private updateTwoHand() {
    if (!this.twoHand) { this.beginTwoHand(); return; }
    this.readHands();
    if (this.separation.length() < .08) { this.twoHand = null; return; }
    const initial = this.twoHand;
    const horizontal = Math.hypot(this.separation.x, this.separation.z);
    const initialHorizontal = Math.hypot(initial.separation.x, initial.separation.z);
    if (horizontal < .05 || initialHorizontal < .05) { this.twoHand = null; return; }
    const angle = Math.atan2(initial.separation.z * this.separation.x - initial.separation.x * this.separation.z,
      initial.separation.x * this.separation.x + initial.separation.z * this.separation.z);
    this.model.setWidth(initial.width * this.separation.length() / initial.separation.length());
    const scale = this.model.getWidth() / initial.width;
    this.point.copy(initial.position).sub(initial.midpoint);
    this.point.y = 0;
    this.point.multiplyScalar(scale).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
    this.model.group.position.copy(this.midpoint).add(this.point);
    this.model.group.position.y = initial.position.y + this.midpoint.y - initial.midpoint.y;
    this.model.group.rotation.y = initial.yaw + angle;
  }

  private select(index: number) {
    if (!this.active || !this.placed || !this.inputs[index].ray.visible) return;
    if (this.grabs.size) { this.startGrab(index, "select"); return; }
    this.setRay(index);
    const hit = this.panel.mesh.visible ? this.raycaster.intersectObject(this.panel.mesh)[0] : null;
    if (hit?.uv) {
      const x = hit.uv.x * 720, y = (1 - hit.uv.y) * 640;
      if (y >= 100 && y <= 135 && x >= 24 && x <= 696) this.playback.seek(THREE.MathUtils.clamp((x - 24) / 672, 0, 1));
      else if (y >= 516 && y <= 554 && x >= 24 && x <= 696) this.playback.speed([.5, 1, 1.5, 2][Math.min(3, Math.floor((x - 24) / 168))]);
      else {
        const button = BUTTONS.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        if (button) this.act(button.action);
      }
    } else {
      this.startGrab(index, "select");
      if (!this.grabs.size) this.toggleMenu();
    }
    this.lastPaint = -Infinity;
  }

  private act(action: Action) {
    const group = this.model.group;
    if (action === "play") this.playback.togglePlay();
    else if (action === "back" || action === "forward") this.playback.jump(action === "back" ? -10 : 10);
    else if (action === "lock") { this.locked = !this.locked; this.clearGrabs(); }
    else if (action === "exit") this.playback.exit();
    else if (!this.locked) {
      if (action === "recenter") this.recenter();
      else if (action === "higher" || action === "lower") group.position.y += action === "higher" ? .03 : -.03;
    }
  }

  private recenter() {
    this.clearGrabs();
    this.yaw.setFromQuaternion(this.head.quaternion, "YXZ");
    this.model.group.rotation.set(0, this.yaw.y, 0);
    this.model.group.position.set(0, -.55, -.85).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw.y).add(this.head.position);
    this.placeMenu();
  }

  private placeMenu() {
    this.yaw.setFromQuaternion(this.head.quaternion, "YXZ");
    this.panel.mesh.rotation.set(0, this.yaw.y - .35, 0);
    this.panel.mesh.position.set(.52, -.05, -.85).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw.y).add(this.head.position);
    this.lastPaint = -Infinity;
  }

  private toggleMenu() {
    this.panel.mesh.visible = !this.panel.mesh.visible;
    if (this.panel.mesh.visible) this.placeMenu();
  }

  private moveWithSticks(dt: number) {
    const deadzone = (v: number) => Math.abs(v) > .18 ? Math.sign(v) * (Math.abs(v) - .18) / .82 : 0;
    this.yaw.setFromQuaternion(this.head.quaternion, "YXZ");
    for (const { source } of this.inputs) {
      const axes = source?.gamepad?.axes;
      if (!axes) continue;
      const x = deadzone(axes.length >= 4 ? axes[2] : axes[0] ?? 0);
      const y = deadzone(axes.length >= 4 ? axes[3] : axes[1] ?? 0);
      if (source?.handedness === "left") {
        this.point.set(x, 0, y).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw.y);
        this.model.group.position.addScaledVector(this.point, dt * .35);
      } else {
        this.model.group.rotation.y -= x * dt;
        this.model.setWidth(this.model.getWidth() * Math.exp(-y * dt));
      }
    }
  }

  private paint(now: number) {
    if (!this.panel.mesh.visible) return;
    const state = this.playback.getState();
    const ctx = this.panel.context;
    ctx.clearRect(0, 0, 720, 640);
    ctx.fillStyle = "#08141d"; ctx.fillRect(0, 0, 720, 640);
    ctx.fillStyle = "#74e2eb"; ctx.fillRect(0, 0, 720, 3);
    panelText(ctx, "APEX · AR DE SOBREMESA", 24, 35, 26, "#e3fbff", 700);
    panelText(ctx, state.timeLabel, 24, 78, 20);
    ctx.fillStyle = "#294452"; ctx.fillRect(24, 114, 672, 5);
    ctx.fillStyle = "#74e2eb"; ctx.fillRect(24, 114, 672 * state.normalizedTime, 5);
    panelText(ctx, `TAMAÑO ${this.model.getWidth().toFixed(2)} m · ${this.locked ? "POSICIÓN FIJADA" : "AJUSTE MANUAL"}`, 24, 230, 18, "#74e2eb");
    for (const b of BUTTONS) {
      panelBox(ctx, b.x, b.y, b.w, b.h, b.action === "lock" && this.locked);
      ctx.textAlign = "center";
      ctx.font = "600 21px Inter, sans-serif";
      ctx.fillStyle = this.locked && ["lower", "higher", "recenter"].includes(b.action) ? "#65727b" : "#edf8fa";
      const label = b.action === "play" ? state.playing ? "Pausar" : "Reproducir"
        : b.action === "lock" ? this.locked ? "Desbloquear posición" : "Fijar posición" : b.label;
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
    }
    panelText(ctx, "Un agarre: mover · Dos agarres: separar / juntar y girar.", 24, 404, 17);
    panelText(ctx, "Mantén gatillos, agarres o pinzas con ambas manos.", 24, 431, 17, "#9cb2bf");
    panelText(ctx, "Stick izq.: mover · Der.: giro / tamaño · Vacío: menú", 24, 458, 17, "#9cb2bf");
    for (const [i, speed] of [.5, 1, 1.5, 2].entries()) {
      panelBox(ctx, 24 + i * 168, 516, 160, 38, state.speed === speed);
      panelText(ctx, `${speed}×`, 80 + i * 168, 535, 20);
    }
    this.panel.texture.needsUpdate = true;
    this.lastPaint = now;
  }
}
