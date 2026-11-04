import * as THREE from "three";
import type { DriverInfo, ReplayFrame } from "../../types";
import type { XrControllers } from "./xr-controllers";
import { XrControlsPanel, type XrControlsState, type XrUiAction } from "./xr-controls-panel";
import { XrWristTiming } from "./xr-wrist-timing";
import { XrDriverWindows } from "./xr-driver-windows";
import { XrFloatingWindow } from "./xr-floating-window";

export class XrInterface {
  readonly controls = new XrControlsPanel();
  readonly wrist = new XrWristTiming();
  readonly wall = new XrWristTiming(.38, "wall");
  readonly driverWindows: XrDriverWindows;
  private readonly worldPanels = new THREE.Group();
  private readonly wallWindow: XrFloatingWindow;
  private readonly worldHeadCamera = new THREE.PerspectiveCamera();
  private exported = false;
  private wristEnabled: boolean;
  private readonly ray = new THREE.Raycaster();
  private readonly targets: THREE.Object3D[] = [];
  private readonly intersections: THREE.Intersection[] = [];
  private readonly rotation = new THREE.Matrix4();
  private readonly pointer: THREE.Line;
  private readonly dot: THREE.Mesh;
  private rightSpace: THREE.Group | null = null;
  private drivers: DriverInfo[] = [];
  private head: THREE.Camera | null = null;
  private rightSource: XRInputSource | null = null;
  private readonly worldHead = new THREE.Vector3();
  private readonly dragPoint = new THREE.Vector3();
  private readonly dragOffset = new THREE.Vector3();
  private drag: { mesh: THREE.Mesh; distance: number; localPoint: THREE.Vector3; held: Set<"select" | "squeeze"> } | null = null;

  constructor(private readonly reference: THREE.Group, wristVisible: boolean,
    private readonly getState: () => Omit<XrControlsState, "wristVisible" | "driverLabel"> & { followDriver: number | null },
    private readonly action: (action: XrUiAction | { type: "follow"; driver: number }) => void,
    private readonly onWrist: (enabled: boolean) => void) {
    this.wristEnabled = wristVisible;
    this.wallWindow = new XrFloatingWindow(this.worldPanels, 384, 640, .38, "xr-wall-timing", this.wall.surface);
    this.driverWindows = new XrDriverWindows(this.worldPanels, driver => this.action({ type: "follow", driver }));
    reference.add(this.controls.surface.mesh, this.worldPanels);
    this.pointer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xe50914, transparent: true, opacity: .85, depthTest: false, depthWrite: false, toneMapped: false }));
    this.pointer.renderOrder = 1010;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(.004, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
    this.dot.renderOrder = 1011;
    this.pointer.visible = false; this.dot.visible = false;
  }

  isOpen() { return this.controls.surface.mesh.visible; }
  isInteracting() { return this.isOpen() || this.driverWindows.gallery.surface.mesh.visible || this.drag !== null; }
  isDragging() { return this.drag !== null; }
  setDrivers(drivers: DriverInfo[]) {
    this.drivers = drivers; this.controls.invalidate(); this.wrist.invalidate();
    this.driverWindows.setDrivers(drivers); this.wall.invalidate();
    this.wallWindow.close(); this.exported = false; this.drag = null;
  }
  setFrame(frame: ReplayFrame) { this.wrist.setFrame(frame); this.wall.setFrame(frame); this.driverWindows.setFrame(frame); }

  toggle(head: THREE.Camera) {
    this.drag = null;
    if (!this.isOpen()) this.controls.place(head);
    this.controls.surface.mesh.visible = !this.isOpen();
    this.controls.invalidate();
  }

  close() {
    this.head = null;
    this.drag = null;
    this.rightSource = null;
    this.controls.surface.mesh.visible = false;
    this.wrist.surface.mesh.visible = false;
    this.wallWindow.close();
    this.exported = false;
    this.driverWindows.reset();
    this.worldPanels.removeFromParent();
    this.pointer.visible = false; this.dot.visible = false;
  }

  prepare(head: THREE.Camera, input: XrControllers) {
    this.head = head;
    this.reference.updateWorldMatrix(true, false);
    this.worldHead.copy(head.position).applyMatrix4(this.reference.matrixWorld);
    this.worldHeadCamera.position.copy(this.worldHead);
    this.reference.getWorldQuaternion(this.worldHeadCamera.quaternion).multiply(head.quaternion);
    if (this.worldPanels.parent !== this.reference) this.reference.add(this.worldPanels);
    if (this.isOpen()) this.controls.surface.mesh.lookAt(this.worldHead);
    this.wrist.prepare(input.getGrip("left"), head, this.reference, this.wristEnabled && !this.exported);
    const right = input.getTargetRay("right");
    this.rightSource = input.getInputSources().find(source => source?.handedness === "right") ?? null;
    if (this.drag) {
      const buttons = this.rightSource?.gamepad?.buttons;
      if (!buttons?.[0]?.pressed) this.drag.held.delete("select");
      if (!buttons?.[1]?.pressed) this.drag.held.delete("squeeze");
      if (!right || !this.drag.held.size || !this.drag.mesh.visible) this.drag = null;
    }
    if (right && this.rightSpace !== right) { right.add(this.pointer, this.dot); this.rightSpace = right; }
    if (!right) { this.rightSpace = null; this.pointer.visible = false; this.dot.visible = false; }
  }

  update(now: number) {
    this.updateDrag();
    this.driverWindows.update(now, this.worldHeadCamera);
    if (this.controls.needsUpdate(now)) {
      const state = this.getState();
      const driver = this.drivers.find(d => d.driverNumber === state.followDriver);
      this.controls.update({ ...state, wristVisible: this.wristEnabled, driverLabel: driver ? `${driver.acronym} · ${driver.fullName}` : "Elige un piloto" }, now);
    }
    this.wrist.update(now);
    this.wall.update(now);
    const hit = this.intersect();
    const visible = this.rightSpace !== null && (this.isInteracting() || this.wall.surface.mesh.visible || Boolean(hit));
    this.pointer.visible = visible;
    this.dot.visible = visible && Boolean(hit);
    const distance = hit?.distance ?? 1.3;
    this.pointer.scale.z = distance;
    this.dot.position.set(0, 0, -distance);
  }

  select(): boolean {
    if (this.drag) { this.drag.held.add("select"); return true; }
    const hit = this.intersect();
    if (!hit?.uv) return this.isInteracting() || this.driverWindows.hasOpen();
    const floating = this.floatingWindows().find(window => window.owns(hit.object));
    const bar = hit.object === this.controls.bar.mesh || hit.object === floating?.bar.mesh;
    if (bar) {
      if (hit.uv.y >= .1 && hit.uv.y <= .9) {
        const x = hit.uv.x * 720;
        if (x >= 8 && x <= 88) {
          if (floating === this.wallWindow) this.attachWrist();
          else if (floating) floating.close();
          else this.controls.surface.mesh.visible = false;
          this.drag = null;
        } else if (x >= 112 && x <= 708) this.startDrag(hit, "select", floating?.surface.mesh ?? this.controls.surface.mesh);
      }
    } else if (hit.object === this.wrist.surface.mesh || hit.object === this.wall.surface.mesh) {
      const timing = hit.object === this.wrist.surface.mesh ? this.wrist : this.wall;
      const action = timing.hit(hit.uv.x, hit.uv.y);
      if (action?.type === "driver") this.driverWindows.showDetails(action.driver, this.worldHeadCamera);
      else if (action?.type === "export") this.exportWrist();
      else if (action?.type === "attach") this.attachWrist();
      else if (action?.type === "menu" && this.head) this.toggle(this.head);
    } else if (hit.object === this.controls.surface.mesh) {
      const action = this.controls.hit(hit.uv.x, hit.uv.y);
      if (action?.type === "close") this.controls.surface.mesh.visible = false;
      else if (action?.type === "wrist") {
        if (this.exported) { this.attachWrist(); this.wristEnabled = true; }
        else this.wristEnabled = !this.wristEnabled;
        this.onWrist(this.wristEnabled);
      } else if (action?.type === "drivers") this.driverWindows.showGallery(this.worldHeadCamera);
      else if (action) this.action(action);
    } else this.driverWindows.select(hit, this.worldHeadCamera);
    this.controls.invalidate();
    return true;
  }

  squeeze() {
    if (this.drag) { this.drag.held.add("squeeze"); return; }
    const hit = this.intersect();
    const floating = hit ? this.floatingWindows().find(window => hit.object === window.bar.mesh) : null;
    if (hit && (hit.object === this.controls.bar.mesh || floating) && hit.uv && hit.uv.x * 720 >= 112 && hit.uv.x * 720 <= 708
      && hit.uv.y >= .1 && hit.uv.y <= .9) this.startDrag(hit, "squeeze", floating?.surface.mesh ?? this.controls.surface.mesh);
  }

  private floatingWindows() { return [this.wallWindow, ...this.driverWindows.windows()]; }

  private exportWrist() {
    this.exported = true;
    this.wrist.surface.mesh.visible = false;
    this.wallWindow.place(this.worldHeadCamera, -.65);
    this.wall.invalidate();
  }

  private attachWrist() {
    this.exported = false;
    this.wallWindow.close();
    this.wrist.invalidate();
    this.drag = null;
  }

  private startDrag(hit: THREE.Intersection, input: "select" | "squeeze", mesh: THREE.Mesh) {
    this.drag = { mesh, distance: hit.distance, localPoint: mesh.worldToLocal(hit.point.clone()), held: new Set([input]) };
  }

  private updateDrag() {
    if (!this.drag || !this.setRay() || !this.drag.mesh.visible) return;
    const mesh = this.drag.mesh;
    this.ray.ray.at(this.drag.distance, this.dragPoint);
    mesh.parent?.worldToLocal(this.dragPoint);
    for (let step = 0; step < 3; step++) {
      mesh.lookAt(this.worldHead);
      this.dragOffset.copy(this.drag.localPoint).applyQuaternion(mesh.quaternion);
      mesh.position.copy(this.dragPoint).sub(this.dragOffset);
    }
    mesh.lookAt(this.worldHead);
  }

  private setRay() {
    if (!this.rightSpace?.visible) return false;
    this.rightSpace.updateWorldMatrix(true, false);
    this.rotation.extractRotation(this.rightSpace.matrixWorld);
    this.ray.ray.origin.setFromMatrixPosition(this.rightSpace.matrixWorld);
    this.ray.ray.direction.set(0, 0, -1).transformDirection(this.rotation);
    this.ray.far = 2;
    return true;
  }

  private intersect(): THREE.Intersection | null {
    this.targets.length = 0;
    if (this.isOpen()) this.targets.push(this.controls.surface.mesh, this.controls.bar.mesh);
    for (const window of this.floatingWindows()) this.targets.push(...window.targets());
    if (this.wrist.surface.mesh.visible) this.targets.push(this.wrist.surface.mesh);
    if (this.targets.length === 0 || !this.setRay()) return null;
    for (const target of this.targets) target.updateWorldMatrix(true, false);
    this.intersections.length = 0;
    this.ray.intersectObjects(this.targets, false, this.intersections);
    return this.intersections[0] ?? null;
  }
}
