import * as THREE from "three";
import type { TrackPath } from "../cameras/automatic/track-path";
import type { PitLane } from "./pit-lane";
import { crossSectionPoint } from "./ribbon";

export function createPitMarkings(lane: PitLane, main: TrackPath, white: THREE.Material) {
  const positions: number[] = [];
  const indices: number[] = [];
  const length = lane.path.totalLength;
  const sampleDistance = Math.max(0, length - 40);
  const position = lane.path.pointAt(sampleDistance);
  const tangent = lane.path.pointAt(sampleDistance + 3).sub(lane.path.pointAt(sampleDistance - 3));
  const road = main.projectPointPlanar(position);
  const mergeSide = road && road.point.sub(position).dot(new THREE.Vector3(-tangent.z, 0, tangent.x)) < 0 ? -1 : 1;

  const stripe = (from: number, to: number, offset: number) => {
    if (from >= to) return;
    const steps = Math.ceil((to - from) / 0.85);
    let previous = -1;
    for (let i = 0; i <= steps; i++) {
      const { index, fraction } = lane.path.segmentAt(THREE.MathUtils.lerp(from, to, i / steps));
      const edge = (side: number) => {
        const lateral = offset + side * 0.075;
        const point = crossSectionPoint(lane.sections[index], lateral)
          .lerp(crossSectionPoint(lane.sections[index + 1], lateral), fraction);
        point.y = lane.heightAt(point.x, point.z, NaN) + 0.018;
        return point;
      };
      const left = edge(-1);
      const right = edge(1);
      if (!Number.isFinite(left.y) || !Number.isFinite(right.y)) {
        previous = -1;
        continue;
      }
      const row = positions.length / 3;
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      if (previous >= 0) indices.push(previous, previous + 1, row, row, previous + 1, row + 1);
      previous = row;
    }
  };

  const inset = lane.width / 2 - 0.36;
  const dashedStart = Math.max(14, length - 28);
  stripe(14, length - 10, -mergeSide * inset);
  stripe(14, dashedStart, mergeSide * inset);
  for (let start = dashedStart; start < length - 7; start += 4.3) {
    stripe(start, Math.min(start + 2.4, length - 7), mergeSide * inset);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, white);
  mesh.name = "pit-lane-markings";
  mesh.receiveShadow = true;
  mesh.renderOrder = 4;
  return mesh;
}
