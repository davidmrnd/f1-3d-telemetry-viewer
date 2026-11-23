import * as THREE from "three";
import type { DriverInfo } from "../types";
import {
  applyCarVisualQuality,
  carHeadingToRotationY,
  createCarVisual,
  disposeCarVisual,
  type CarVisualParts,
} from "./car-models";
import { CarContactShadows } from "./car-contact-shadows";
import type { BaseCarPlacement } from "./car-placement";
import type { GraphicsSettings } from "./graphics-settings";

export class CarFleet {
  private readonly carVisuals = new Map<number, CarVisualParts>();
  private contactShadows: CarContactShadows | null = null;

  constructor(private readonly root: THREE.Group) {}

  load(drivers: DriverInfo[], sceneLength: number) {
    for (const driver of drivers) {
      const visual = createCarVisual(driver, sceneLength);
      this.carVisuals.set(driver.driverNumber, visual);
      this.root.add(visual.group);
    }
    this.contactShadows = new CarContactShadows(drivers.length);
    this.root.add(this.contactShadows.mesh);
  }

  applyGraphicsSettings(settings: GraphicsSettings) {
    const castShadows = settings.carShadows && settings.shadows !== "off";
    for (const visual of this.carVisuals.values()) {
      applyCarVisualQuality(visual.group, {
        materials: settings.carMaterials,
        castShadows,
      });
    }
  }

  setContactShadowsVisible(visible: boolean) {
    if (this.contactShadows) this.contactShadows.mesh.visible = visible;
  }

  update(visualPlacements: BaseCarPlacement[]) {
    const activeDrivers = new Set<number>();
    visualPlacements.forEach(({ car, position, heading }, index) => {
      const visual = this.carVisuals.get(car.driver.driverNumber);
      if (!visual) {
        return;
      }

      activeDrivers.add(car.driver.driverNumber);
      visual.group.position.copy(position);
      visual.group.rotation.y = carHeadingToRotationY(heading);
      visual.group.rotation.x = -car.pitch;
      visual.label.visible = false;
      this.contactShadows?.setCar(index, position, heading, car.pitch);
    });
    for (const [driverNumber, visual] of this.carVisuals) {
      visual.group.visible = activeDrivers.has(driverNumber);
    }
    this.contactShadows?.finish(visualPlacements.length);
  }

  updateDetail(
    camera: THREE.PerspectiveCamera,
    xrPresenting: boolean,
    carDistance: GraphicsSettings["detailedCarDistance"],
    cockpitDriver?: number,
  ) {
    const zoomDetailScale = xrPresenting ? 1 : Math.max(1,
      Math.tan(THREE.MathUtils.degToRad(30)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
    );
    const forceLowPoly = carDistance === "lowpoly";
    const distance = (forceLowPoly ? 0 : carDistance) * zoomDetailScale;
    for (const [driverNumber, visual] of this.carVisuals) {
      if (!visual.group.visible) continue;
      const useDetailed = driverNumber === cockpitDriver || (!forceLowPoly && visual.group.position.distanceToSquared(camera.position)
        < distance * distance * (visual.detailed.visible ? 1.21 : 0.81));
      visual.detailed.visible = useDetailed;
      visual.lowpoly.visible = !useDetailed;
    }
  }

  dispose() {
    for (const visual of this.carVisuals.values()) {
      this.root.remove(visual.group);
      disposeCarVisual(visual.group);
    }
    this.carVisuals.clear();
    if (this.contactShadows) {
      this.root.remove(this.contactShadows.mesh);
      this.contactShadows.dispose();
      this.contactShadows = null;
    }
  }
}
