import * as THREE from "three";
import type { ReplayFrame } from "../../types";
import { createXrPanel, panelText } from "./xr-panel";

export class XrWristTiming {
  readonly surface = createXrPanel(384, 640, .28, "xr-wrist-timing");
  private frame: ReplayFrame | null = null;
  private readonly drawnDrivers: number[] = [];
  private lastPaint = -Infinity;
  private signature = "";
  private wasVisible = false;
  private readonly normal = new THREE.Vector3();
  private readonly toHead = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly offset = new THREE.Vector3(-.055, .16, 0);
  private readonly lookAt = new THREE.Matrix4();

  setFrame(frame: ReplayFrame) { this.frame = frame; }
  invalidate() { this.signature = ""; this.wasVisible = false; }

  prepare(grip: THREE.Group | null, head: THREE.Camera, reference: THREE.Group, enabled: boolean) {
    const mesh = this.surface.mesh;
    if (!enabled || !grip?.visible) { mesh.visible = false; return; }
    grip.updateWorldMatrix(true, false);
    this.position.copy(this.offset).applyMatrix4(grip.matrixWorld);
    this.toHead.copy(head.position).applyMatrix4(reference.matrixWorld).sub(this.position);
    const distance = this.toHead.length();
    this.toHead.normalize();
    this.normal.set(-1, 0, 0).transformDirection(grip.matrixWorld);
    this.forward.set(0, 0, -1).applyQuaternion(head.quaternion).transformDirection(reference.matrixWorld);
    mesh.visible = distance > .18 && distance < 1.4 && this.normal.dot(this.toHead) > .25 && -this.forward.dot(this.toHead) > .55;
    if (mesh.parent !== reference) reference.add(mesh);
    mesh.position.copy(this.position);
    reference.worldToLocal(mesh.position);
    mesh.quaternion.setFromRotationMatrix(this.lookAt.lookAt(head.position, mesh.position, THREE.Object3D.DEFAULT_UP));
  }

  hit(u: number, v: number): number | null {
    const y = (1 - v) * 640;
    if (u < 0 || u > 1 || y < 79 || y >= 619) return null;
    return this.drawnDrivers[Math.floor((y - 79) / 27)] ?? null;
  }

  update(now: number) {
    if (!this.surface.mesh.visible) { this.wasVisible = false; return; }
    if (this.wasVisible && now - this.lastPaint < 500) return;
    const cars = this.frame?.cars.slice(0, 20) ?? [];
    const signature = cars.map(c => `${c.driver.driverNumber}:${c.sample.position}:${c.sample.intervalToAhead?.toFixed(2)}:${c.sample.compound}`).join("|");
    if (signature !== this.signature || !this.wasVisible) {
      const ctx = this.surface.context;
      ctx.clearRect(0, 0, 384, 640); ctx.fillStyle = "#08090b"; ctx.fillRect(0, 0, 384, 640);
      ctx.fillStyle = "#e50914"; ctx.fillRect(0, 0, 384, 3);
      panelText(ctx, "APEX", 16, 29, 23, "#fff", 800);
      panelText(ctx, "CLASIFICACIÓN", 110, 29, 18, "#e0e0e8", 700);
      ctx.strokeStyle = "#c5c6d0"; ctx.lineWidth = 2; ctx.beginPath();
      for (const y of [22, 29, 36]) { ctx.moveTo(344, y); ctx.lineTo(364, y); }
      ctx.stroke();
      panelText(ctx, "POS.   PILOTO                    INTERVALO", 16, 62, 13, "#92949f", 600);
      this.drawnDrivers.length = 0;
      cars.forEach((car, i) => {
        this.drawnDrivers.push(car.driver.driverNumber);
        const y = 79 + i * 27;
        ctx.fillStyle = i % 2 ? "#0d0e12" : "#18191f"; ctx.fillRect(10, y, 364, 26);
        ctx.fillStyle = car.driver.teamColor; ctx.fillRect(55, y + 5, 3, 16);
        panelText(ctx, String(car.sample.position ?? "—"), 17, y + 13, 18);
        panelText(ctx, car.driver.acronym, 72, y + 13, 20, "#f1f1f4", 700);
        const compound = car.sample.compound ?? "";
        panelText(ctx, compound.slice(0, 1) || "—", 177, y + 13, 16,
          compound === "SOFT" ? "#ff4855" : compound === "MEDIUM" ? "#f3d14c" : compound === "INTERMEDIATE" ? "#51d793" : "#ddd");
        const gap = car.sample.intervalToAhead;
        panelText(ctx, car.sample.position === 1 ? "LÍDER" : gap != null ? `+${gap.toFixed(2)}` : "—", 250, y + 13, 18, "#c0c1cb");
      });
      panelText(ctx, "Apunta a un piloto para verlo a bordo", 16, 632, 13, "#8e909c");
      this.surface.texture.needsUpdate = true;
      this.signature = signature;
    }
    this.wasVisible = true;
    this.lastPaint = now;
  }
}
