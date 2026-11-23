import type { PlayerVehicle } from "../../types";
import { carMotion, interpolatePose, motionsConflict, separatingContact, type TrafficPose } from "./car-footprint";
import type { TrafficTimeline } from "./traffic-timeline";

interface MovingCar {
  from: TrafficPose;
  to: TrafficPose;
}

function blockVelocity(player: PlayerVehicle, opponent: MovingCar, normal: { x: number; z: number }, dt: number) {
  const forwardX = Math.cos(player.heading);
  const forwardZ = Math.sin(player.heading);
  const vx = player.speed * forwardX - player.lateralSpeed * forwardZ;
  const vz = player.speed * forwardZ + player.lateralSpeed * forwardX;
  const opponentX = (opponent.to.x - opponent.from.x) / dt;
  const opponentZ = (opponent.to.z - opponent.from.z) / dt;
  const closing = (vx - opponentX) * normal.x + (vz - opponentZ) * normal.z;
  if (closing >= 0) return;
  const nextX = vx - closing * normal.x;
  const nextZ = vz - closing * normal.z;
  player.speed = (nextX * forwardX + nextZ * forwardZ) * 0.96;
  player.lateralSpeed = -nextX * forwardZ + nextZ * forwardX;
}

export function resolveDrivingCollisions(
  from: PlayerVehicle, player: PlayerVehicle, timeline: TrafficTimeline, opponents: number[],
  before: number, after: number,
) {
  const dt = (after - before) / 1000;
  if (dt <= 0) return false;
  const nearby: MovingCar[] = [];
  for (const driver of opponents) {
    const to = timeline.poseAt(driver, after);
    if (!to || Math.abs(player.x - to.x) > 12 || Math.abs(player.z - to.z) > 12) continue;
    const start = timeline.poseAt(driver, before) ?? to;
    nearby.push({ from: start, to });
  }
  let collision = false;
  for (const opponent of nearby) {
    if (separatingContact(from, opponent.from)) continue;
    if (!motionsConflict(carMotion(from, player), carMotion(opponent.from, opponent.to))) continue;
    let safe = 0;
    let hit = 1;
    for (let index = 0; index < 8; index++) {
      const middle = (safe + hit) / 2;
      const ours = interpolatePose(from, player, middle);
      const theirs = interpolatePose(opponent.from, opponent.to, middle);
      if (motionsConflict(carMotion(from, ours), carMotion(opponent.from, theirs))) hit = middle;
      else safe = middle;
    }
    const theirs = interpolatePose(opponent.from, opponent.to, hit);
    const touch = interpolatePose(from, player, hit);
    const normal = separatingContact(touch, theirs);
    const clear = interpolatePose(from, player, safe);
    Object.assign(player, clear);
    if (normal) blockVelocity(player, opponent, normal, dt);
    else player.speed *= 0.9;
    collision = true;
  }
  for (let pass = 0; pass < 4; pass++) {
    let separated = true;
    for (const opponent of nearby) {
      const contact = separatingContact(player, opponent.to);
      if (!contact) continue;
      player.x += contact.x * (contact.depth + 0.015);
      player.z += contact.z * (contact.depth + 0.015);
      blockVelocity(player, opponent, contact, dt);
      collision = true;
      separated = false;
    }
    if (separated) break;
  }
  return collision;
}
