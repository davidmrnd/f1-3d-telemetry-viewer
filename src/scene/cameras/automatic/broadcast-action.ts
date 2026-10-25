import * as THREE from "three";
import type { BroadcastCarInput } from "./types";

export interface BroadcastAction {
  car: BroadcastCarInput;
  score: number;
  battle: number;
  attacking: boolean;
  group: BroadcastCarInput[];
}

export function rankBroadcastAction(
  cars: BroadcastCarInput[],
  eventDrivers: readonly number[],
  exposure: ReadonlyMap<number, number>,
  previousSubject: number | null,
): BroadcastAction[] {
  return cars.map((car) => {
    const forward = new THREE.Vector3(Math.cos(car.heading), 0, Math.sin(car.heading));
    let battle = 0;
    let attacking = false;
    const group = cars.filter((other) => {
      if (car === other || Math.cos(other.heading - car.heading) < 0.5) return false;
      if (car.racePosition !== null && other.racePosition !== null &&
        Math.abs(car.racePosition - other.racePosition) > 3) return false;
      const offset = other.position.clone().sub(car.position);
      const distance = offset.length();
      if (distance > 100) return false;
      const along = offset.dot(forward);
      const proximity = 1 - THREE.MathUtils.smoothstep(distance, 8, 100);
      const sideBySide = distance < 14 && Math.abs(along) < 8 ? 2.5 : 0;
      const closing = distance > 1
        ? Math.max(0, car.velocity.clone().sub(other.velocity).dot(offset) / distance)
        : 0;
      const pressure = proximity * 6 + sideBySide + Math.min(2, closing * 0.12);
      if (pressure > battle) {
        battle = pressure;
        attacking = along > 3 && along < 90;
      }
      return distance < 75;
    }).sort((a, b) => a.position.distanceToSquared(car.position) - b.position.distanceToSquared(car.position));
    const interval = car.intervalToAhead;
    const closeInterval = interval !== null && interval > 0 && interval < 1.2 && group.length > 0
      ? (1 - interval / 1.2) * 1.5 : 0;
    const shown = exposure.get(car.driverNumber) ?? 0;
    const score = 1 + battle + closeInterval + (car.racePosition === 1 ? 0.3 : 0) +
      (eventDrivers.includes(car.driverNumber) ? 5 : 0) -
      shown * 0.7 - (car.driverNumber === previousSubject ? 1.5 : 0);
    return { car, score, battle, attacking, group: [car, ...group.slice(0, 5)] };
  }).sort((a, b) => b.score - a.score ||
    (a.car.racePosition ?? 99) - (b.car.racePosition ?? 99) || a.car.driverNumber - b.car.driverNumber);
}
