import * as THREE from "three";
import type { RaceMilestoneControls, TeamRadioControls } from "../../types";
import { RaceMilestoneHistory } from "../xr/race-milestone-history";
import type { XrPlaybackState } from "../xr/xr-controls-panel";
import type { TabletopModel } from "./tabletop-model";
import { TabletopControlsPanel, type TabletopAction } from "./tabletop-controls-panel";
import { TabletopDriverPanels } from "./tabletop-driver-panels";

type GrabInput = "select" | "squeeze";
type Grab = { distance: number; offset: THREE.Vector3; held: Set<GrabInput> };

export class TabletopXr {
  private readonly controls = new TabletopControlsPanel();
  private readonly panel = this.controls.surface;
  private readonly driverPanels: TabletopDriverPanels;
  private readonly circuitHistory: RaceMilestoneHistory;
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
    }, radio: TeamRadioControls, milestones: RaceMilestoneControls) {
    scene.add(this.panel.mesh);
    this.driverPanels = new TabletopDriverPanels(scene, model, radio, milestones);
    this.circuitHistory = new RaceMilestoneHistory(milestones);
    this.raycaster.camera = this.head;
    for (let index = 0; index < 2; index++) {
      const ray = renderer.xr.getController(index);
      const grip = renderer.xr.getControllerGrip(index);
      const pointer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: "#e50914", transparent: true, opacity: .85, depthTest: false, depthWrite: false, toneMapped: false }));
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
      ray.addEventListener("select", () => this.selectRadio(index));
      ray.addEventListener("selectend", () => this.endGrab(index, "select"));
      ray.addEventListener("squeezestart", () => this.squeeze(index));
      ray.addEventListener("squeezeend", () => this.endGrab(index, "squeeze"));
    }
  }

  setActive(active: boolean, scene: THREE.Scene, viewerRoot: THREE.Group) {
    this.active = active;
    this.placed = false;
    this.resetInteraction();
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

  resetInteraction() {
    this.circuitHistory.close();
    this.locked = false;
    this.clearGrabs();
    this.controls.release();
    this.driverPanels.reset();
    this.model.setHoveredDrivers(new Set());
    this.panel.mesh.visible = this.active;
    this.lastPaint = -Infinity;
  }

  update(head: THREE.Camera, now: number) {
    if (!this.active) return;
    this.head.position.copy(head.position);
    this.head.quaternion.copy(head.quaternion);
    this.head.updateMatrixWorld(true);
    if (!this.placed) {
      this.recenter();
      this.placed = true;
    }
    const dt = this.lastUpdate ? Math.min((now - this.lastUpdate) / 1000, .05) : 0;
    this.lastUpdate = now;
    const left = this.inputs.find(({ source }) => source?.handedness === "left");
    const buttons = left?.source?.gamepad?.buttons;
    const menu = Boolean(buttons?.[7]?.pressed || buttons?.[4]?.pressed);
    if (menu && !this.menuPressed) this.toggleMenu();
    this.menuPressed = menu;
    for (let index = 0; index < this.inputs.length; index++) {
      if (!this.isTracked(index)) this.endGrab(index);
    }
    if (this.grabs.size === 2) this.updateTwoHand();
    else if (this.grabs.size === 1) {
      const [index, grab] = this.grabs.entries().next().value!;
      this.setRay(index);
      this.raycaster.ray.at(grab.distance, this.point);
      this.model.group.position.copy(this.point).add(grab.offset);
    } else if (!this.locked && !this.controls.isDragging()) this.moveWithSticks(dt);
    this.driverPanels.update(now, this.head);
    const hovered = new Set<number>();
    for (let index = 0; index < this.inputs.length; index++) {
      const input = this.inputs[index];
      input.pointer.visible = this.isTracked(index);
      if (!input.pointer.visible) continue;
      this.setRay(index);
      this.controls.updateGrab(index, this.raycaster.ray, this.head);
      this.driverPanels.updateGrab(index, this.raycaster.ray);
      const hit = this.intersectUi();
      const driver = this.locked && !hit ? this.model.pickDriver(this.raycaster) : null;
      if (driver) hovered.add(driver.driverNumber);
      input.pointer.scale.z = hit?.distance ?? driver?.distance ?? this.boardDistance() ?? .8;
      (input.pointer.material as THREE.LineBasicMaterial).color.set(driver ? "#84f4c8" : hit ? "#ffffff" : "#e50914");
    }
    this.model.setHoveredDrivers(hovered);
    if (this.panel.mesh.visible && now - this.lastPaint > 150) {
      if (this.circuitHistory.open) this.circuitHistory.paint(this.panel);
      else this.controls.paint(this.playback.getState(), this.locked, this.model.getWidth());
      this.lastPaint = now;
    }
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
    this.controls.endGrab(index, held);
    this.driverPanels.endGrab(index, held);
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
    if (!this.active || !this.placed || !this.isTracked(index)) return;
    if (this.controls.hold(index, "select")) return;
    if (this.driverPanels.hold(index, "select")) return;
    if (this.grabs.size) { this.startGrab(index, "select"); return; }
    this.setRay(index);
    const hit = this.intersectUi();
    if (hit?.uv) {
      if (hit.object === this.controls.bar.mesh) {
        const action = this.controls.interact(index, hit, "select", this.locked);
        if (action) this.act(action);
      } else if (hit.object === this.panel.mesh) {
        if (this.circuitHistory.open) this.circuitHistory.select(hit.uv.x * 720, (1 - hit.uv.y) * 800);
        else {
          const action = this.controls.hit(hit.uv.x, hit.uv.y, this.locked);
          if (action) this.act(action);
        }
      } else this.driverPanels.interact(index, hit, this.head, "select");
    } else if (this.locked) {
      const driver = this.model.pickDriver(this.raycaster);
      if (driver) {
        this.driverPanels.showDriver(driver.driverNumber, this.head);
        this.panel.mesh.visible = false;
      } else if (!this.panel.mesh.visible && this.inputs[index].source?.hand) {
        this.panel.mesh.visible = true;
        this.placeMenu();
      }
    } else this.startGrab(index, "select");
    this.lastPaint = -Infinity;
  }

  private selectRadio(index: number) {
    if (!this.active || !this.placed || !this.isTracked(index) || this.grabs.size) return;
    this.setRay(index);
    const hit = this.intersectUi();
    if (hit) this.driverPanels.selectRadio(hit);
  }

  private squeeze(index: number) {
    if (!this.active || !this.placed || !this.isTracked(index)) return;
    if (this.controls.hold(index, "squeeze")) return;
    if (this.driverPanels.hold(index, "squeeze")) return;
    this.setRay(index);
    const hit = this.intersectUi();
    if (hit) {
      if (hit.object === this.controls.bar.mesh) this.controls.interact(index, hit, "squeeze", this.locked);
      else if (hit.object !== this.panel.mesh) this.driverPanels.interact(index, hit, this.head, "squeeze");
    } else this.startGrab(index, "squeeze");
  }

  private intersectUi() {
    const controls = this.controls.intersect(this.raycaster);
    const driver = this.driverPanels.intersect(this.raycaster);
    return controls && (!driver || controls.distance <= driver.distance) ? controls : driver;
  }

  private act(action: TabletopAction) {
    const group = this.model.group;
    if (action.type === "play") this.playback.togglePlay();
    else if (action.type === "back" || action.type === "forward") this.playback.jump(action.type === "back" ? -10 : 10);
    else if (action.type === "seek") this.playback.seek(action.value);
    else if (action.type === "speed") this.playback.speed(action.value);
    else if (action.type === "milestones") this.circuitHistory.open = true;
    else if (action.type === "lock") {
      this.controls.release();
      this.locked = !this.locked;
      this.clearGrabs();
      this.driverPanels.reset();
      this.model.setHoveredDrivers(new Set());
    } else if (action.type === "hide" && this.locked) { this.panel.mesh.visible = false; this.controls.release(); }
    else if (action.type === "exit") this.playback.exit();
    else if (!this.locked) {
      if (action.type === "recenter") this.recenter();
      else if (action.type === "higher" || action.type === "lower") group.position.y += action.type === "higher" ? .03 : -.03;
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
    this.controls.release();
    this.yaw.setFromQuaternion(this.head.quaternion, "YXZ");
    this.panel.mesh.rotation.set(0, this.yaw.y - .35, 0);
    this.panel.mesh.position.set(.52, -.02, -.95).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw.y).add(this.head.position);
    this.lastPaint = -Infinity;
  }

  private toggleMenu() {
    this.controls.release();
    this.panel.mesh.visible = !this.locked || !this.panel.mesh.visible;
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
}
