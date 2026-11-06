import * as THREE from "three";
import type { DriverInfo, FrameCarState, RaceMilestoneControls, TeamRadioControls } from "../../types";
import { RaceMilestoneHistory, isMilestoneHistoryButton } from "../xr/race-milestone-history";
import { createXrPanel, panelText } from "../xr/xr-panel";
import type { TabletopModel } from "./tabletop-model";
import { paintDriverPanel } from "../xr/driver-panel-content";
import { DriverRadioHistory, isRadioHistoryButton } from "../xr/driver-radio-history";

type Surface = ReturnType<typeof createXrPanel>;
type DriverWindow = { surface: Surface; bar: Surface | null; connector: THREE.Line | null; driver: DriverInfo; radio: DriverRadioHistory | null; milestones: RaceMilestoneHistory | null; detailed: boolean; following: boolean; height: number; lastPaint: number };
type GrabInput = "select" | "squeeze";
type PanelGrab = { window: DriverWindow; distance: number; localPoint: THREE.Vector3; held: Set<GrabInput> };
type Photo = { image: HTMLImageElement; ready: boolean };

export class TabletopDriverPanels {
  private readonly windows: DriverWindow[] = [];
  private readonly photos = new Map<string, Photo>();
  private readonly grabs = new Map<number, PanelGrab>();
  private readonly yaw = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly point = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly viewer = new THREE.Vector3();
  private readonly grabOffset = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, private readonly model: TabletopModel,
    private readonly radioControls: TeamRadioControls, private readonly milestoneControls: RaceMilestoneControls) {}

  showDriver(driverNumber: number, head: THREE.Camera) {
    const car = this.model.getDriverState(driverNumber);
    if (!car) return;
    this.model.setSelectedDriver(driverNumber);
    let summary = this.windows.find(window => !window.detailed);
    if (!summary) summary = this.create(car.driver, false);
    for (const [index, grab] of this.grabs) if (grab.window === summary) this.grabs.delete(index);
    summary.driver = car.driver;
    summary.following = true;
    summary.lastPaint = -Infinity;
    summary.surface.mesh.visible = true;
    this.followDriver(summary, head);
    this.loadPhoto(car.driver);
  }

  intersect(raycaster: THREE.Raycaster) {
    const surfaces = this.windows.filter(window => window.surface.mesh.visible)
      .flatMap(window => window.bar ? [window.surface.mesh, window.bar.mesh] : [window.surface.mesh]);
    for (const mesh of surfaces) mesh.updateWorldMatrix(true, false);
    return raycaster.intersectObjects(surfaces, false)[0] ?? null;
  }

  hold(index: number, input: GrabInput) {
    const grab = this.grabs.get(index);
    if (!grab) return false;
    grab.held.add(input);
    return true;
  }

  interact(index: number, hit: THREE.Intersection, head: THREE.Camera, input: GrabInput) {
    const window = this.windows.find(window => window.surface.mesh === hit.object || window.bar?.mesh === hit.object);
    if (!window || !hit.uv) return;
    this.viewer.copy(head.position);
    const x = hit.uv.x * 720, y = (1 - hit.uv.y) * window.height;
    if (hit.object === window.bar?.mesh && x >= 112 && x <= 708 && hit.uv.y >= .1 && hit.uv.y <= .9) {
      if ([...this.grabs.values()].some(grab => grab.window === window)) return;
      this.grabs.set(index, { window, distance: hit.distance,
        localPoint: window.surface.mesh.worldToLocal(hit.point.clone()), held: new Set([input]) });
    } else if (input === "select" && (hit.object === window.bar?.mesh && x >= 8 && x <= 88 && hit.uv.y >= .1 && hit.uv.y <= .9
      || !window.detailed && x >= 640 && x <= 704 && y >= 12 && y <= 64)) {
      this.close(window);
    } else if (input === "select" && hit.object === window.surface.mesh && window.milestones?.open) {
      window.milestones.select(x, y);
      window.lastPaint = -Infinity;
    } else if (input === "select" && hit.object === window.surface.mesh && window.milestones && !window.radio?.open && isMilestoneHistoryButton(x, y)) {
      window.milestones.open = true;
      window.lastPaint = -Infinity;
    } else if (input === "select" && hit.object === window.surface.mesh && window.radio && !window.radio.open && isRadioHistoryButton(x, y)) {
      window.radio.open = true;
      window.lastPaint = -Infinity;
    } else if (input === "select" && !window.detailed && x >= 24 && x <= 696 && y >= 330 && y <= 390) {
      let details = this.windows.find(candidate => candidate.detailed && candidate.driver.driverNumber === window.driver.driverNumber);
      if (!details) {
        details = this.create(window.driver, true);
        const count = this.windows.filter(candidate => candidate.detailed && candidate.surface.mesh.visible).length;
        this.place(details, head, count % 2 === 0 ? -.38 - Math.floor(count / 2) * .07 : .38 + Math.floor(count / 2) * .07);
      } else if (!details.surface.mesh.visible) this.place(details, head, -.38);
      details.surface.mesh.visible = true;
      details.lastPaint = -Infinity;
      this.close(window);
    }
  }

  selectRadio(hit: THREE.Intersection) {
    const window = this.windows.find(window => window.surface.mesh === hit.object);
    if (!hit.uv || !window?.radio?.open) return;
    window.radio.select(hit.uv.x * 720, (1 - hit.uv.y) * window.height);
    window.lastPaint = -Infinity;
  }

  updateGrab(index: number, ray: THREE.Ray) {
    const grab = this.grabs.get(index);
    if (!grab) return;
    const mesh = grab.window.surface.mesh;
    for (let step = 0; step < 3; step++) {
      mesh.lookAt(this.viewer);
      this.grabOffset.copy(grab.localPoint).applyQuaternion(mesh.quaternion);
      ray.at(grab.distance, this.point);
      mesh.position.copy(this.point).sub(this.grabOffset);
    }
    mesh.lookAt(this.viewer);
  }

  endGrab(index: number, input?: GrabInput) {
    const grab = this.grabs.get(index);
    if (!grab) return;
    if (input) {
      grab.held.delete(input);
      if (grab.held.size) return;
    }
    this.grabs.delete(index);
  }

  update(now: number, head: THREE.Camera) {
    this.viewer.copy(head.position);
    for (const window of this.windows) {
      if (window.following) this.followDriver(window, head);
      else if (window.detailed && window.surface.mesh.visible) window.surface.mesh.lookAt(head.position);
      if (!window.surface.mesh.visible || now - window.lastPaint < 200) continue;
      this.paint(window, this.model.getDriverState(window.driver.driverNumber));
      window.lastPaint = now;
    }
  }

  reset() {
    this.grabs.clear();
    for (const { surface, bar, connector, radio } of this.windows) {
      radio?.close();
      surface.mesh.removeFromParent();
      surface.mesh.geometry.dispose();
      surface.mesh.material.dispose();
      surface.texture.dispose();
      if (bar) {
        bar.mesh.geometry.dispose();
        bar.mesh.material.dispose();
        bar.texture.dispose();
      }
      if (connector) {
        connector.removeFromParent();
        connector.geometry.dispose();
        (connector.material as THREE.Material).dispose();
      }
    }
    this.windows.length = 0;
    this.photos.clear();
    this.model.setSelectedDriver(null);
  }

  private create(driver: DriverInfo, detailed: boolean) {
    const height = detailed ? 888 : 410;
    const surface = createXrPanel(720, height, detailed ? .56 : .30, `ar-driver-${detailed ? "details" : "summary"}-${driver.driverNumber}`);
    surface.mesh.renderOrder = detailed ? 1002 : 1003;
    const bar = detailed ? createXrPanel(720, 88, .36, `ar-driver-handle-${driver.driverNumber}`) : null;
    if (bar) {
      bar.mesh.position.y = -(.56 * height / 720) / 2 - .018 - (.36 * 88 / 720) / 2;
      bar.mesh.renderOrder = 1003;
      bar.mesh.visible = true;
      surface.mesh.add(bar.mesh);
      const ctx = bar.context;
      ctx.fillStyle = "rgba(43, 48, 58, .96)";
      ctx.beginPath(); ctx.roundRect(112, 8, 596, 72, 36); ctx.fill();
      ctx.fillStyle = "rgba(255, 84, 94, .18)";
      ctx.beginPath(); ctx.roundRect(8, 8, 80, 72, 36); ctx.fill();
      panelText(ctx, "×", 31, 44, 40, "#ff545e");
      ctx.fillStyle = "#d5dce7";
      ctx.beginPath(); ctx.roundRect(250, 25, 316, 6, 3); ctx.fill();
      panelText(ctx, "Mantén para mover", 282, 57, 19, "#d5dce7");
      bar.texture.needsUpdate = true;
    }
    const connector = detailed ? null : new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: driver.teamColor, transparent: true, opacity: .7, depthWrite: false, toneMapped: false }));
    if (connector) { connector.visible = false; this.scene.add(connector); }
    const radio = detailed ? new DriverRadioHistory(this.radioControls, driver) : null;
    const milestones = detailed ? new RaceMilestoneHistory(this.milestoneControls, driver) : null;
    const window = { surface, bar, connector, driver, radio, milestones, detailed, following: false, height, lastPaint: -Infinity };
    this.windows.push(window);
    this.scene.add(surface.mesh);
    return window;
  }

  private followDriver(window: DriverWindow, head: THREE.Camera) {
    const present = this.model.getDriverWorldPosition(window.driver.driverNumber, this.anchor);
    window.surface.mesh.visible = present;
    if (window.connector) window.connector.visible = present;
    if (!present) return;
    const mesh = window.surface.mesh;
    mesh.position.copy(this.anchor);
    mesh.position.y += .12 + .30 * window.height / 720 / 2;
    if (head.position.distanceToSquared(mesh.position) > 1e-8) mesh.lookAt(head.position);
    if (window.connector) {
      const positions = window.connector.geometry.getAttribute("position") as THREE.BufferAttribute;
      positions.setXYZ(0, this.anchor.x, this.anchor.y + .012, this.anchor.z);
      this.point.set(0, -.30 * window.height / 720 / 2, 0).applyQuaternion(mesh.quaternion).add(mesh.position);
      positions.setXYZ(1, this.point.x, this.point.y, this.point.z);
      positions.needsUpdate = true;
      window.connector.geometry.computeBoundingSphere();
      (window.connector.material as THREE.LineBasicMaterial).color.set(window.driver.teamColor);
    }
  }

  private place(window: DriverWindow, head: THREE.Camera, offset: number) {
    this.yaw.setFromQuaternion(head.quaternion, "YXZ");
    const mesh = window.surface.mesh;
    mesh.rotation.set(0, this.yaw.y, 0);
    mesh.position.set(offset, -.02, -.9).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw.y).add(head.position);
    mesh.lookAt(head.position);
  }

  private close(window: DriverWindow) {
    window.radio?.close();
    window.milestones?.close();
    window.surface.mesh.visible = false;
    window.following = false;
    if (window.connector) window.connector.visible = false;
    for (const [index, grab] of this.grabs) if (grab.window === window) this.grabs.delete(index);
    if (!this.windows.some(candidate => candidate.surface.mesh.visible)) this.model.setSelectedDriver(null);
  }

  private loadPhoto(driver: DriverInfo) {
    if (!driver.headshotUrl || this.photos.has(driver.headshotUrl)) return;
    const image = new Image();
    const photo = { image, ready: false };
    this.photos.set(driver.headshotUrl, photo);
    image.crossOrigin = "anonymous";
    image.onload = () => {
      photo.ready = image.naturalWidth > 0 && image.naturalHeight > 0;
      for (const window of this.windows) if (window.driver.headshotUrl === driver.headshotUrl) window.lastPaint = -Infinity;
    };
    image.onerror = () => { photo.ready = false; };
    image.src = driver.headshotUrl;
  }

  private paint(window: DriverWindow, car: FrameCarState | null) {
    if (window.milestones?.open) window.milestones.paint(window.surface);
    else if (window.radio?.open) window.radio.paint(window.surface);
    else paintDriverPanel(window.surface, window.driver, car, this.photos.get(window.driver.headshotUrl), window.detailed, false, window.milestones?.summary());
  }
}
