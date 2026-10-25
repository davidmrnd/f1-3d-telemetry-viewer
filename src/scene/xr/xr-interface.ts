import * as THREE from "three";
import type { DriverInfo, ReplayFrame } from "../../types";
import type { XrControllers } from "./xr-controllers";
import { XrControlsPanel, type XrControlsState, type XrUiAction } from "./xr-controls-panel";
import { XrWristTiming } from "./xr-wrist-timing";

export class XrInterface {
  readonly controls = new XrControlsPanel();
  readonly wrist = new XrWristTiming();
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

  constructor(private readonly reference: THREE.Group, wristVisible: boolean,
    private readonly getState: () => Omit<XrControlsState, "wristVisible" | "driverLabel"> & { followDriver: number | null },
    private readonly action: (action: XrUiAction | { type: "follow"; driver: number }) => void,
    private readonly onWrist: (enabled: boolean) => void) {
    this.wristEnabled = wristVisible;
    reference.add(this.controls.surface.mesh);
    this.pointer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xe50914, transparent: true, opacity: .85, depthTest: false, depthWrite: false, toneMapped: false }));
    this.pointer.renderOrder = 1010;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(.004, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
    this.dot.renderOrder = 1011;
    this.pointer.visible = false; this.dot.visible = false;
  }

  isOpen() { return this.controls.surface.mesh.visible; }
  setDrivers(drivers: DriverInfo[]) { this.drivers = drivers; this.controls.invalidate(); this.wrist.invalidate(); }
  setFrame(frame: ReplayFrame) { this.wrist.setFrame(frame); }

  toggle(head: THREE.Camera) {
    if (!this.isOpen()) this.controls.place(head);
    this.controls.surface.mesh.visible = !this.isOpen();
    this.controls.invalidate();
  }

  close() {
    this.head = null;
    this.controls.surface.mesh.visible = false;
    this.wrist.surface.mesh.visible = false;
    this.pointer.visible = false; this.dot.visible = false;
  }

  prepare(head: THREE.Camera, input: XrControllers) {
    this.head = head;
    this.reference.updateWorldMatrix(true, false);
    this.wrist.prepare(input.getGrip("left"), head, this.reference, this.wristEnabled && !this.isOpen());
    const right = input.getTargetRay("right");
    if (right && this.rightSpace !== right) { right.add(this.pointer, this.dot); this.rightSpace = right; }
    if (!right) { this.rightSpace = null; this.pointer.visible = false; this.dot.visible = false; }
  }

  update(now: number) {
    if (this.controls.needsUpdate(now)) {
      const state = this.getState();
      const driver = this.drivers.find(d => d.driverNumber === state.followDriver);
      this.controls.update({ ...state, wristVisible: this.wristEnabled, driverLabel: driver ? `${driver.acronym} · ${driver.fullName}` : "Elige un piloto" }, now);
    }
    this.wrist.update(now);
    const hit = this.intersect();
    const visible = this.rightSpace !== null && (this.isOpen() || Boolean(hit));
    this.pointer.visible = visible;
    this.dot.visible = visible && Boolean(hit);
    const distance = hit?.distance ?? 1.3;
    this.pointer.scale.z = distance;
    this.dot.position.set(0, 0, -distance);
  }

  select(): boolean {
    const hit = this.intersect();
    if (!hit?.uv) return this.isOpen();
    if (hit.object === this.wrist.surface.mesh) {
      const driver = this.wrist.hit(hit.uv.x, hit.uv.y);
      if (driver != null) this.action({ type: "follow", driver });
      else if (hit.uv.y > 1 - 79 / 640 && this.head) this.toggle(this.head);
    } else {
      const action = this.controls.hit(hit.uv.x, hit.uv.y);
      if (action?.type === "close") this.controls.surface.mesh.visible = false;
      else if (action?.type === "wrist") {
        this.wristEnabled = !this.wristEnabled;
        this.onWrist(this.wristEnabled);
      } else if (action) this.action(action);
    }
    this.controls.invalidate();
    return true;
  }

  private intersect(): THREE.Intersection | null {
    this.targets.length = 0;
    if (this.isOpen()) this.targets.push(this.controls.surface.mesh);
    if (this.wrist.surface.mesh.visible) this.targets.push(this.wrist.surface.mesh);
    if (!this.rightSpace?.visible || this.targets.length === 0) return null;
    this.rightSpace.updateWorldMatrix(true, false);
    for (const target of this.targets) target.updateWorldMatrix(true, false);
    this.rotation.extractRotation(this.rightSpace.matrixWorld);
    this.ray.ray.origin.setFromMatrixPosition(this.rightSpace.matrixWorld);
    this.ray.ray.direction.set(0, 0, -1).transformDirection(this.rotation);
    this.ray.far = 2;
    this.intersections.length = 0;
    this.ray.intersectObjects(this.targets, false, this.intersections);
    return this.intersections[0] ?? null;
  }
}
