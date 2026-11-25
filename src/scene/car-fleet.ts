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
import { CarWheelAnimation } from "./car-wheels";
import type { GraphicsSettings } from "./graphics-settings";
import type { TrafficTimeline } from "./traffic/traffic-timeline";

const MAX_ANIMATED_CARS = 3;
const STEERING_SAMPLE_MS = 125;

type FleetCar = CarVisualParts & { wheels?: CarWheelAnimation | null };
type PlayerWheelState = { driverNumber: number; steeringAngle: number; cockpit: boolean };

export class CarFleet {
  private readonly carVisuals = new Map<number, FleetCar>();
  private animatedCars: FleetCar[] = [];
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
    time: number,
    traffic: TrafficTimeline | null,
    player?: PlayerWheelState,
  ) {
    const zoomDetailScale = xrPresenting ? 1 : Math.max(1,
      Math.tan(THREE.MathUtils.degToRad(30)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
    );
    const forceLowPoly = carDistance === "lowpoly";
    const distance = (forceLowPoly ? 0 : carDistance) * zoomDetailScale;
    const candidates: { driverNumber: number; visual: FleetCar; distanceSq: number }[] = [];
    for (const [driverNumber, visual] of this.carVisuals) {
      if (!visual.group.visible) continue;
      const distanceSq = visual.group.position.distanceToSquared(camera.position);
      const useDetailed = (player?.cockpit && player.driverNumber === driverNumber)
        || (!forceLowPoly && distanceSq < distance * distance * (visual.detailed.visible ? 1.21 : 0.81));
      visual.detailed.visible = useDetailed;
      visual.lowpoly.visible = !useDetailed;
      if (useDetailed) candidates.push({ driverNumber, visual, distanceSq });
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    const animatedCars: FleetCar[] = [];
    for (const { driverNumber, visual } of candidates.slice(0, MAX_ANIMATED_CARS)) {
      if (visual.wheels === undefined) visual.wheels = CarWheelAnimation.create(visual.detailed);
      const wheels = visual.wheels;
      if (!wheels) continue;
      const steering = player?.driverNumber === driverNumber ? player.steeringAngle : wheels.estimateSteering(
        traffic?.poseAt(driverNumber, time - STEERING_SAMPLE_MS) ?? null,
        traffic?.poseAt(driverNumber, time + STEERING_SAMPLE_MS) ?? null,
      );
      const { position, rotation } = visual.group;
      wheels.update(time, position, rotation.y, -rotation.x, steering);
      animatedCars.push(visual);
    }
    for (const visual of this.animatedCars) {
      if (!animatedCars.includes(visual)) visual.wheels?.hide();
    }
    this.animatedCars = animatedCars;
  }

  resetWheelMotion() {
    for (const visual of this.animatedCars) visual.wheels?.resetMotion();
  }

  dispose() {
    for (const visual of this.carVisuals.values()) {
      this.root.remove(visual.group);
      disposeCarVisual(visual.group);
    }
    this.carVisuals.clear();
    this.animatedCars = [];
    if (this.contactShadows) {
      this.root.remove(this.contactShadows.mesh);
      this.contactShadows.dispose();
      this.contactShadows = null;
    }
  }
}
