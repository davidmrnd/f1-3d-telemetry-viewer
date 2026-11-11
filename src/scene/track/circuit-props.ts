import * as THREE from "three";
import { TrackPath } from "../cameras/automatic/track-path";
import type { PitLane } from "./pit-lane";
import { createPitApron } from "./pit-apron";
import { instanceTrackModel, type TrackModel, type TrackModelPlacement } from "./track-models";
import type { createTerrainHeightSampler } from "./terrain-height";

function pathFrame(path: TrackPath, distance: number) {
  const position = path.pointAt(distance);
  const tangent = path.pointAt(distance + 4).sub(path.pointAt(distance - 4)).setY(0).normalize();
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
  return { position, tangent, normal };
}

function planarDistance(path: TrackPath, point: THREE.Vector3) {
  const nearest = path.projectPointPlanar(point);
  return nearest ? Math.hypot(nearest.point.x - point.x, nearest.point.z - point.z) : Infinity;
}

export function createCircuitProps(
  main: TrackPath, width: number, pit: PitLane | null,
  heightAt: ReturnType<typeof createTerrainHeightSampler>, urban: boolean, concrete: THREE.Material,
) {
  const group = new THREE.Group();
  group.name = "kenney-circuit-props";
  const placements = new Map<TrackModel, TrackModelPlacement[]>();
  const occupied: { position: THREE.Vector3; radius: number }[] = [];
  const size = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const add = (model: TrackModel, placement: TrackModelPlacement, radius = 0) => {
    const list = placements.get(model) ?? [];
    list.push(placement);
    placements.set(model, list);
    if (radius) occupied.push({ position: placement.position, radius });
  };

  const fit = (position: THREE.Vector3, facing: THREE.Vector3, dimensions: THREE.Vector3, maxSlope: number) => {
    const across = new THREE.Vector3(-facing.z, 0, facing.x);
    let low = Infinity;
    let high = -Infinity;
    for (const [x, z] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const p = position.clone().addScaledVector(across, x * dimensions.x / 2).addScaledVector(facing, z * dimensions.z / 2);
      if (planarDistance(main, p) < width / 2 + 0.9 || (pit && planarDistance(pit.path, p) < pit.width / 2 + 0.8)) return null;
      const y = heightAt(p.x, p.z, position.y);
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
    if (high - low > maxSlope) return null;
    position.y = low - 0.04;
    return { position, facing, size: dimensions };
  };

  const clearOfProps = (position: THREE.Vector3, radius: number) => !occupied.some((other) =>
    Math.hypot(other.position.x - position.x, other.position.z - position.z) < other.radius + radius);

  if (pit) {
    const garageSize = size(7.8, 4.7, 8.8);
    const apronDepth = 2.9;
    const offset = pit.width / 2 + garageSize.z / 2 + apronDepth;
    let best: { placement: TrackModelPlacement; distance: number }[] = [];
    let bestScore = 0;
    let bestSide = 1;
    for (const side of [-1, 1]) {
      let row: typeof best = [];
      for (let d = Math.max(34, pit.path.totalLength * 0.17); d < pit.path.totalLength - 55; d += 8.2) {
        const { position, normal, tangent } = pathFrame(pit.path, d);
        const after = pathFrame(pit.path, d + 8).tangent;
        const placement = tangent.dot(after) > 0.995
          ? fit(position.addScaledVector(normal, side * offset), normal.multiplyScalar(-side), garageSize, 1.2) : null;
        if (!placement || (row.length && row.at(-1)!.placement.facing.dot(placement.facing) < 0.995)) row = [];
        if (!placement) continue;
        row.push({ placement, distance: d });
        if (row.length > 12) row.shift();
        const score = row.length - Math.abs(d - (row.length - 1) * 4.1 - pit.path.totalLength * 0.52) / pit.path.totalLength;
        if (score > bestScore) {
          best = [...row];
          bestSide = side;
          bestScore = score;
        }
      }
    }
    if (best.length) {
      group.add(createPitApron(pit, best[0].distance - 4, best.at(-1)!.distance + 4, bestSide, apronDepth + 0.45, heightAt, concrete));
    }
    for (const [i, { placement: garage }] of best.entries()) {
      add("garage", garage, 6);
      const officePosition = garage.position.clone().addScaledVector(garage.facing, -0.3);
      officePosition.y += garage.size.y - 0.08;
      add("office", { ...garage, position: officePosition, size: size(7.8, 3.2, 7.9) });
      if (i % 3 !== 1) continue;
      const lampPosition = garage.position.clone().addScaledVector(garage.facing, garageSize.z / 2 + 1.1);
      const lamp = fit(lampPosition, garage.facing, size(0.35, 7.8, 1.5), 0.8);
      if (lamp) add("lamp", lamp, 0.8);
    }
  }

  const mainSide = width / 2;
  const standSize = size(19, 8.2, 9);
  const standDistances: number[] = [];
  const placeStand = (distance: number) => {
    if (!main.closed && (distance < 12 || distance > main.totalLength - 12)) return false;
    const { position, tangent, normal } = pathFrame(main, distance);
    if (tangent.dot(pathFrame(main, distance + 10).tangent) < 0.985) return false;
    for (const side of [-1, 1]) {
      const point = position.clone().addScaledVector(normal, side * (mainSide + (urban ? 9.5 : 15)));
      if (!clearOfProps(point, 10)) continue;
      const stand = fit(point, normal.clone().multiplyScalar(-side), standSize, 1.4);
      if (!stand) continue;
      add("stand", stand, 10);
      standDistances.push(distance);
      return true;
    }
    return false;
  };

  const grandstandZone = pit ? main.projectPointPlanar(pit.path.pointAt(pit.path.totalLength / 2))?.distance : undefined;
  const standZones = [grandstandZone ?? main.totalLength * 0.12, main.totalLength * 0.43, main.totalLength * 0.72];
  for (const [zoneIndex, zone] of standZones.entries()) {
    for (const shift of zoneIndex === 0 ? [-42, -20, 2, 24, 46] : [-11, 11]) {
      placeStand(zone + shift);
    }
  }

  const extraZones = Math.floor(main.totalLength / 240);
  for (let zone = 0; zone < extraZones; zone++) {
    const center = (zone + 0.5) * main.totalLength / extraZones;
    for (const shift of [0, -25, 25, -50, 50, -75, 75]) {
      const distance = center + shift;
      if (standDistances.some(other => main.linearDistance(distance, other) < 105)) continue;
      if (placeStand(distance)) break;
    }
  }

  const plantSpacing = Math.max(57, main.totalLength / 75);
  const treeTints = [new THREE.Color("#789775"), new THREE.Color("#9aa989"), new THREE.Color("#789886")];
  for (let i = 0, distance = 25; distance < main.totalLength - 25; i++, distance += plantSpacing) {
    const { position, normal } = pathFrame(main, distance);
    const side = i % 2 === 0 ? 1 : -1;
    const point = position.addScaledVector(normal, side * (mainSide + 14 + (i * 13 % 25)));
    if (!clearOfProps(point, 2.5)) continue;
    if (urban && i % 3 !== 0) continue;
    const height = 6 + i * 7 % 6;
    const prop = fit(point, normal.multiplyScalar(-side), urban ? size(0.5, 8, 1.8) : size(height * 0.34, height, height * 0.34), 1.6);
    if (prop) add(urban ? "lamp" : "tree", urban ? prop : { ...prop, tint: treeTints[i % treeTints.length] }, 2.5);
  }

  const red = new THREE.Color("#d96353");
  for (let i = 0; i < 8; i++) {
    const zone = main.totalLength * (i + 0.4) / 8;
    const side = i % 2 ? -1 : 1;
    for (let j = 0; j < 6; j++) {
      const { position, normal } = pathFrame(main, zone + j * 3.15);
      position.addScaledVector(normal, side * (mainSide + (urban ? 2.2 : 4.8)));
      if (!clearOfProps(position, 1.5)) continue;
      const barrier = fit(position, normal.multiplyScalar(-side), size(3.05, 0.85, 0.72), 0.8);
      if (barrier) add("barrier", { ...barrier, tint: j % 2 ? red : undefined });
    }
  }

  const grandstands: THREE.Vector3[] = [];
  for (const [model, list] of placements) {
    const mesh = instanceTrackModel(model, list);
    if (!mesh) continue;
    group.add(mesh);
    if (model === "stand") {
      for (const { position, size } of list) {
        grandstands.push(position.clone().setY(position.y + size.y * 0.55));
      }
    }
  }
  return { group, grandstands };
}
