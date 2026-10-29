import * as THREE from "three";
import type { DriverInfo, ReplayFrame } from "../../types";
import { paintDriverPanel, type DriverPhoto } from "./driver-panel-content";
import { panelRoundedBox, panelText, panelWindowBackground } from "./xr-panel";
import { XrFloatingWindow } from "./xr-floating-window";

export class XrDriverWindows {
  readonly gallery: XrFloatingWindow;
  private readonly details = new Map<number, XrFloatingWindow>();
  private readonly photos = new Map<string, DriverPhoto>();
  private drivers: DriverInfo[] = [];
  private frame: ReplayFrame | null = null;
  private dirty = true;
  private lastPaint = -Infinity;

  constructor(private readonly parent: THREE.Object3D, private readonly onboard: (driver: number) => void) {
    this.gallery = new XrFloatingWindow(parent, 960, 880, .76, "xr-driver-gallery");
  }

  setDrivers(drivers: DriverInfo[]) {
    this.reset();
    this.drivers = drivers;
    this.photos.clear();
    this.frame = null;
  }

  setFrame(frame: ReplayFrame) { this.frame = frame; }

  showGallery(head: THREE.Camera) {
    this.gallery.place(head, -.86);
    for (const driver of this.drivers) this.loadPhoto(driver);
    this.dirty = true;
  }

  showDetails(driverNumber: number, head: THREE.Camera) {
    const driver = this.drivers.find(driver => driver.driverNumber === driverNumber);
    if (!driver) return;
    let window = this.details.get(driverNumber);
    if (!window) {
      window = new XrFloatingWindow(this.parent, 720, 824, .56, `xr-driver-details-${driverNumber}`);
      this.details.set(driverNumber, window);
    }
    if (!window.surface.mesh.visible) window.place(head, .76);
    this.loadPhoto(driver);
    this.lastPaint = -Infinity;
  }

  windows() { return [this.gallery, ...this.details.values()]; }

  hasOpen() { return this.windows().some(window => window.surface.mesh.visible); }

  select(hit: THREE.Intersection, head: THREE.Camera) {
    if (!hit.uv) return;
    if (hit.object === this.gallery.surface.mesh) {
      const x = hit.uv.x * 960, y = (1 - hit.uv.y) * 880;
      if (x >= 24 && y >= 96) {
        const col = Math.floor((x - 24) / 184), row = Math.floor((y - 96) / 190);
        if (col < 5 && row < 4 && (x - 24) % 184 <= 176 && (y - 96) % 190 <= 180) {
          const driver = this.drivers[row * 5 + col];
          if (driver) this.showDetails(driver.driverNumber, head);
        }
      }
    } else {
      for (const [number, window] of this.details) {
        if (hit.object === window.surface.mesh && hit.uv.x * 720 >= 24 && hit.uv.x * 720 <= 696
          && (1 - hit.uv.y) * 824 >= 742 && (1 - hit.uv.y) * 824 <= 802) this.onboard(number);
      }
    }
  }

  update(now: number, head: THREE.Camera) {
    for (const window of this.windows()) if (window.surface.mesh.visible) window.surface.mesh.lookAt(head.position);
    if (this.gallery.surface.mesh.visible && this.dirty) this.paintGallery();
    if (now - this.lastPaint < 200) return;
    for (const [number, window] of this.details) {
      if (!window.surface.mesh.visible) continue;
      const driver = this.drivers.find(driver => driver.driverNumber === number);
      if (driver) paintDriverPanel(window.surface, driver, this.frame?.cars.find(car => car.driver.driverNumber === number) ?? null,
        this.photos.get(driver.headshotUrl), true, true);
    }
    this.lastPaint = now;
  }

  reset() {
    this.gallery.close();
    for (const window of this.details.values()) window.dispose();
    this.details.clear();
    this.dirty = true;
  }

  private loadPhoto(driver: DriverInfo) {
    if (!driver.headshotUrl || this.photos.has(driver.headshotUrl)) return;
    const image = new Image();
    const photo = { image, ready: false };
    this.photos.set(driver.headshotUrl, photo);
    image.crossOrigin = "anonymous";
    image.onload = () => {
      photo.ready = image.naturalWidth > 0 && image.naturalHeight > 0;
      this.dirty = true; this.lastPaint = -Infinity;
    };
    image.onerror = () => { photo.ready = false; };
    image.src = driver.headshotUrl;
  }

  private paintGallery() {
    const { context: ctx, texture } = this.gallery.surface;
    panelWindowBackground(ctx, 960, 880);
    panelText(ctx, "PILOTOS", 24, 36, 30, "#fff", 800);
    panelText(ctx, "Elige un piloto para consultar sus detalles", 24, 70, 19, "#a7b4c6");
    this.drivers.forEach((driver, i) => {
      const x = 24 + i % 5 * 184, y = 96 + Math.floor(i / 5) * 190;
      panelRoundedBox(ctx, x, y, 176, 180);
      const photo = this.photos.get(driver.headshotUrl);
      if (photo?.ready) {
        const scale = Math.min(150 / photo.image.naturalWidth, 122 / photo.image.naturalHeight);
        const w = photo.image.naturalWidth * scale, h = photo.image.naturalHeight * scale;
        ctx.drawImage(photo.image, x + (176 - w) / 2, y + 8 + 122 - h, w, h);
      } else panelText(ctx, driver.acronym, x + 35, y + 70, 40, driver.teamColor, 800, 120);
      panelText(ctx, driver.fullName, x + 10, y + 146, 18, "#fff", 600, 156);
      panelText(ctx, `#${driver.driverNumber} · ${driver.teamName}`, x + 10, y + 168, 14, driver.teamColor, 500, 156);
    });
    texture.needsUpdate = true;
    this.dirty = false;
  }
}
