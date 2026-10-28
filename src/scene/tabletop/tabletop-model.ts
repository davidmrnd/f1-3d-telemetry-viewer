import * as THREE from "three";
import type { DriverInfo, FrameCarState } from "../../types";
import type { BaseCarPlacement } from "../car-placement";
import { createTrackRibbon, type TrackCrossSection } from "../track-geometry";

const TRAIL_SAMPLES = 64;
const TRAIL_DURATION_MS = 2400;

type TrailPoint = { position: THREE.Vector3; time: number };
type Marker = { label: THREE.Sprite; color: THREE.Color; history: TrailPoint[]; position: THREE.Vector3; car: FrameCarState | null };

export class TabletopModel {
  readonly group = new THREE.Group();
  private readonly content = new THREE.Group();
  private readonly markers = new Map<number, Marker>();
  private readonly center = new THREE.Vector3();
  private extent = 1;
  private dots: THREE.InstancedMesh | null = null;
  private halos: THREE.InstancedMesh | null = null;
  private trails: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private lastTime: number | null = null;
  private readonly matrix = new THREE.Object3D();
  private readonly point = new THREE.Vector3();
  private readonly pickSphere = new THREE.Sphere();
  private readonly pickPoint = new THREE.Vector3();
  private readonly hoverColor = new THREE.Color("#ffffff");
  private selectedDriver: number | null = null;
  private hoveredDrivers = new Set<number>();
  private width = 1.2;

  constructor() {
    this.group.name = "tabletop-circuit";
    this.group.add(this.content);
    this.setWidth(this.width);
  }

  getWidth() { return this.width; }

  getDriverState(driverNumber: number) { return this.markers.get(driverNumber)?.car ?? null; }

  getDriverWorldPosition(driverNumber: number, target: THREE.Vector3) {
    const marker = this.markers.get(driverNumber);
    if (!marker?.car || !marker.label.visible) return false;
    this.content.updateWorldMatrix(true, false);
    target.copy(marker.position).applyMatrix4(this.content.matrixWorld);
    return true;
  }

  setSelectedDriver(driverNumber: number | null) { this.selectedDriver = driverNumber; }

  setHoveredDrivers(drivers: Set<number>) { this.hoveredDrivers = drivers; }

  pickDriver(raycaster: THREE.Raycaster): { driverNumber: number; distance: number } | null {
    this.group.updateWorldMatrix(true, true);
    let closest: { driverNumber: number; distance: number } | null = null;
    let closestOffset = Infinity;
    for (const [driverNumber, marker] of this.markers) {
      if (!marker.label.visible || !marker.car) continue;
      this.pickSphere.center.copy(marker.position).applyMatrix4(this.content.matrixWorld);
      this.pickSphere.radius = Math.max(.012, this.width * .008);
      const point = raycaster.ray.intersectSphere(this.pickSphere, this.pickPoint);
      if (!point) continue;
      const distance = raycaster.ray.origin.distanceTo(point);
      const offset = raycaster.ray.distanceSqToPoint(this.pickSphere.center);
      if (distance < raycaster.near || distance > raycaster.far || offset >= closestOffset) continue;
      closest = { driverNumber, distance };
      closestOffset = offset;
    }
    if (closest) return closest;
    for (const [driverNumber, marker] of this.markers) {
      if (!marker.label.visible || !marker.car) continue;
      const hit = raycaster.intersectObject(marker.label)[0];
      if (hit && (!closest || hit.distance < closest.distance)) closest = { driverNumber, distance: hit.distance };
    }
    return closest;
  }

  setWidth(width: number) {
    if (!Number.isFinite(width)) return;
    this.width = THREE.MathUtils.clamp(width, .35, 3);
    this.group.scale.setScalar(this.width);
  }

  normalizePoint(source: THREE.Vector3, target = new THREE.Vector3()) {
    return target.copy(source).sub(this.center).divideScalar(this.extent);
  }

  load(drivers: DriverInfo[], path: THREE.Vector3[], closed: boolean, trackWidth: number, sections: TrackCrossSection[]) {
    this.dispose();
    if (path.length < 2) return;
    const bounds = new THREE.Box3().setFromPoints(path);
    const size = bounds.getSize(new THREE.Vector3());
    bounds.getCenter(this.center);
    this.center.y = bounds.min.y;
    this.extent = Math.max(size.x, size.z, 1) + trackWidth * 8;
    const points = path.map(point => this.normalizePoint(point));
    const crossSections = sections.map(section => ({ ...section, center: this.normalizePoint(section.center) }));
    const width = Math.max(trackWidth / this.extent, .007);
    const ribbon = (ribbonWidth: number, color: string, height: number, offsetMeters = 0) => {
      const mesh = new THREE.Mesh(createTrackRibbon(points, ribbonWidth, { closed, crossSections, offsetMeters }),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }));
      mesh.position.y = height;
      this.content.add(mesh);
    };
    ribbon(width * 4, "#102735", 0);
    ribbon(width, "#325261", .0003);
    for (const side of [-1, 1]) ribbon(.001, "#b4e6ec", .0006, side * width * .56);

    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(.0035, 12, 8),
      new THREE.MeshBasicMaterial({ toneMapped: false }), drivers.length);
    this.halos = new THREE.InstancedMesh(new THREE.CircleGeometry(.008, 16),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: .24, depthWrite: false, toneMapped: false }), drivers.length);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.frustumCulled = this.halos.frustumCulled = false;
    this.dots.count = this.halos.count = 0;
    this.content.add(this.halos, this.dots);
    const geometry = new THREE.BufferGeometry();
    const vertices = drivers.length * (TRAIL_SAMPLES - 1) * 6;
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.trails = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: .85, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.trails.frustumCulled = false;
    this.content.add(this.trails);
    for (const driver of drivers) {
      const color = new THREE.Color(driver.teamColor);
      const canvas = document.createElement("canvas");
      canvas.width = 192; canvas.height = 112;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "rgba(5, 14, 22, .86)";
      ctx.roundRect(8, 4, 176, 66, 12); ctx.fill();
      ctx.font = "700 48px Inter, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = `#${color.getHexString()}`;
      ctx.fillText(driver.acronym, 96, 39);
      ctx.beginPath(); ctx.moveTo(84, 77); ctx.lineTo(108, 77); ctx.lineTo(96, 104); ctx.fill();
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false }));
      label.scale.set(.048, .028, 1);
      label.center.set(.5, 0);
      label.visible = false;
      this.content.add(label);
      this.markers.set(driver.driverNumber, { label, color, history: [], position: new THREE.Vector3(), car: null });
    }
  }

  update(placements: BaseCarPlacement[], now: number) {
    if (!this.dots || !this.halos || !this.trails) return;
    const reset = this.lastTime !== null && (now < this.lastTime || now - this.lastTime > 500);
    this.lastTime = now;
    for (const marker of this.markers.values()) {
      marker.label.visible = false;
      marker.car = null;
      if (reset) marker.history.length = 0;
    }
    const positions = this.trails.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = this.trails.geometry.getAttribute("color") as THREE.BufferAttribute;
    let vertex = 0;
    let index = 0;
    for (const { car, position } of placements) {
      const marker = this.markers.get(car.driver.driverNumber);
      if (!marker) continue;
      this.normalizePoint(position, this.point);
      this.point.y += .004;
      marker.position.copy(this.point);
      marker.car = car;
      const highlighted = this.selectedDriver === car.driver.driverNumber || this.hoveredDrivers.has(car.driver.driverNumber);
      this.matrix.position.copy(this.point);
      this.matrix.rotation.set(0, 0, 0);
      this.matrix.scale.setScalar(highlighted ? 1.6 : 1);
      this.matrix.updateMatrix();
      this.dots.setMatrixAt(index, this.matrix.matrix);
      this.dots.setColorAt(index, marker.color);
      this.matrix.rotation.x = -Math.PI / 2;
      this.matrix.scale.setScalar(highlighted ? 2 : 1);
      this.matrix.position.y -= .002;
      this.matrix.updateMatrix();
      this.halos.setMatrixAt(index, this.matrix.matrix);
      this.halos.setColorAt(index++, highlighted ? this.hoverColor : marker.color);
      marker.label.position.copy(this.point).y += .012;
      marker.label.visible = true;
      const history = marker.history;
      while (history.length && now - history[0].time > TRAIL_DURATION_MS) history.shift();
      const last = history[history.length - 1];
      if (!last || (now - last.time >= 40 && last.position.distanceToSquared(this.point) > 1e-10)) {
        history.push({ position: this.point.clone(), time: now });
        if (history.length >= TRAIL_SAMPLES) history.shift();
      }
      for (let i = 0; i < history.length; i++) {
        const a = history[i];
        const b = history[i + 1] ?? { position: this.point, time: now };
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-7) continue;
        const fadeA = Math.max(0, 1 - (now - a.time) / TRAIL_DURATION_MS);
        const fadeB = Math.max(0, 1 - (now - b.time) / TRAIL_DURATION_MS);
        const nx = -dz / length * .002, nz = dx / length * .002;
        for (const [p, sign, fade] of [[a.position, -1, fadeA], [b.position, -1, fadeB], [a.position, 1, fadeA],
          [b.position, -1, fadeB], [b.position, 1, fadeB], [a.position, 1, fadeA]] as const) {
          positions.setXYZ(vertex, p.x + nx * sign * fade, p.y - .001, p.z + nz * sign * fade);
          colors.setXYZ(vertex++, marker.color.r * fade, marker.color.g * fade, marker.color.b * fade);
        }
      }
    }
    this.dots.count = this.halos.count = index;
    this.dots.instanceMatrix.needsUpdate = this.halos.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
    positions.needsUpdate = colors.needsUpdate = true;
    this.trails.geometry.setDrawRange(0, vertex);
  }

  resetTrails() {
    this.lastTime = null;
    for (const marker of this.markers.values()) marker.history.length = 0;
    this.trails?.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.content.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
          material.dispose();
        }
        if (object instanceof THREE.InstancedMesh) object.dispose();
      }
    });
    this.content.clear();
    this.markers.clear();
    this.dots = this.halos = null;
    this.trails = null;
    this.lastTime = null;
    this.selectedDriver = null;
    this.hoveredDrivers.clear();
  }
}
