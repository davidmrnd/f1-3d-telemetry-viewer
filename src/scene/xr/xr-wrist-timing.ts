import * as THREE from "three";
import type { ReplayFrame } from "../../types";
import { createXrPanel, panelText, panelWindowBackground } from "./xr-panel";

export class XrWristTiming {
  readonly surface: ReturnType<typeof createXrPanel>;
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

  constructor(meters = .18, private readonly mode: "wrist" | "wall" = "wrist") {
    this.surface = createXrPanel(384, 640, meters, `xr-${mode}-timing`);
  }

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

  hit(u: number, v: number): { type: "driver"; driver: number } | { type: "export" | "attach" | "menu" } | null {
    const y = (1 - v) * 640;
    if (u >= 318 / 384 && u <= 376 / 384 && y >= 8 && y <= 50) return { type: this.mode === "wrist" ? "export" : "attach" };
    if (u >= 0 && u <= 1 && y >= 8 && y < 50) return { type: "menu" };
    if (u < 0 || u > 1 || y < 79 || y >= 619) return null;
    const driver = this.drawnDrivers[Math.floor((y - 79) / 27)];
    return driver === undefined ? null : { type: "driver", driver };
  }

  update(now: number) {
    if (!this.surface.mesh.visible) { this.wasVisible = false; return; }
    if (this.wasVisible && now - this.lastPaint < 500) return;
    const cars = this.frame?.cars.slice(0, 20) ?? [];
    const signature = cars.map(c => `${c.driver.driverNumber}:${c.sample.position}:${c.sample.intervalToAhead?.toFixed(2)}:${c.sample.compound}`).join("|");
    if (signature !== this.signature || !this.wasVisible) {
      const ctx = this.surface.context;
      panelWindowBackground(ctx, 384, 640);
      panelText(ctx, "APEX", 16, 29, 23, "#fff", 800);
      panelText(ctx, "CLASIFICACIÓN", 88, 29, 16, "#e0e0e8", 700);
      ctx.strokeStyle = "#c5c6d0"; ctx.lineWidth = 2; ctx.beginPath();
      ctx.roundRect(321, 13, 49, 34, 8); ctx.stroke(); ctx.beginPath();
      if (this.mode === "wrist") {
        ctx.moveTo(334, 36); ctx.lineTo(356, 21); ctx.lineTo(346, 21);
        ctx.moveTo(356, 21); ctx.lineTo(356, 31);
      } else {
        ctx.moveTo(356, 21); ctx.lineTo(334, 36); ctx.lineTo(344, 36);
        ctx.moveTo(334, 36); ctx.lineTo(334, 26);
      }
      ctx.stroke();
      panelText(ctx, "POS.   PILOTO                    INTERVALO", 16, 62, 13, "#92949f", 600);
      this.drawnDrivers.length = 0;
      cars.forEach((car, i) => {
        this.drawnDrivers.push(car.driver.driverNumber);
        const y = 79 + i * 27;
        ctx.fillStyle = i % 2 ? "rgba(0, 0, 0, .1)" : "rgba(0, 0, 0, .22)";
        ctx.beginPath(); ctx.roundRect(10, y, 364, 26, 6); ctx.fill();
        ctx.fillStyle = car.driver.teamColor; ctx.fillRect(55, y + 5, 3, 16);
        panelText(ctx, String(car.sample.position ?? "—"), 17, y + 13, 18);
        panelText(ctx, car.driver.acronym, 72, y + 13, 20, car.driver.teamColor, 700);
        const compound = car.sample.compound ?? "";
        panelText(ctx, compound.slice(0, 1) || "—", 177, y + 13, 16,
          compound === "SOFT" ? "#ff545e" : compound === "MEDIUM" ? "#f3d14c" : ["INTERMEDIATE", "INTER"].includes(compound) ? "#63e5b2" : compound === "WET" ? "#64aaff" : "#f1f5fc");
        const gap = car.sample.intervalToAhead;
        panelText(ctx, car.sample.position === 1 ? "LÍDER" : gap != null ? `+${gap.toFixed(2)}` : "—", 250, y + 13, 18, "#c0c1cb");
      });
      this.surface.texture.needsUpdate = true;
      this.signature = signature;
    }
    this.wasVisible = true;
    this.lastPaint = now;
  }
}
