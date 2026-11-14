import * as THREE from "three";
import type { ReplaySegment } from "../../types";
import type { TrackPath } from "../cameras/automatic/track-path";
import { getTrackSurfaceMaterials, TRACK_TILE_METERS } from "../track-environment";
import { vectorFromPoint, type SceneTransform } from "../track-geometry";
import type { TrackCrossSection } from "./ribbon";

const ENTRY_AFTER_PORTIER = 36;
const EXIT_BEFORE_CHICANE = 181;
const CLEARANCE = 5;
const OPEN_GALLERY_LENGTH = 125;
const PORTAL_FASCIA_OVERHANG = 0.45;
const FIRST_FIXTURE = 3;
const FIXTURE_SPACING = 7.5;

type TunnelSection = {
  center: THREE.Vector3;
  across: THREE.Vector3;
  distance: number;
};

export interface MonacoTunnel {
  group: THREE.Group;
  contains: (trackDistance: number, margin?: number) => boolean;
  shadeRoad: (road: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>) => void;
  syncRoadMaterial: () => void;
  dispose: () => void;
}

function pointAt(section: TunnelSection, offset: number, height: number) {
  const point = section.center.clone().addScaledVector(section.across, offset);
  point.y += height;
  return point;
}

function createSlab(
  sections: TunnelSection[], left: number, right: number, bottom: number, top: number,
) {
  const profile = [[left, bottom], [right, bottom], [right, top], [left, top]];
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  for (let side = 0; side < profile.length; side++) {
    const [x0, y0] = profile[side];
    const [x1, y1] = profile[(side + 1) % profile.length];
    const span = Math.hypot(x1 - x0, y1 - y0);
    for (const [i, section] of sections.entries()) {
      const vertex = positions.length / 3;
      positions.push(...pointAt(section, x0, y0), ...pointAt(section, x1, y1));
      uv.push(section.distance, 0, section.distance, span);
      if (i) indices.push(vertex - 2, vertex, vertex - 1, vertex - 1, vertex, vertex + 1);
    }
  }
  for (const [end, section] of [sections[0], sections.at(-1)!].entries()) {
    const vertex = positions.length / 3;
    for (const [offset, height] of profile) {
      positions.push(...pointAt(section, offset, height));
      uv.push(offset, height);
    }
    if (end) indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
    else indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createTileMap() {
  const width = 128;
  const pixels = new Uint8Array(width * width * 4);
  for (let y = 0; y < width; y++) {
    const seamShift = Math.floor(y / 32) % 2 * 32;
    for (let x = 0; x < width; x++) {
      const joint = y % 32 === 0 || (x + seamShift) % 64 === 0;
      const tile = Math.floor((x + seamShift) / 64) + Math.floor(y / 32) * 3;
      const tone = joint ? 120 : 195 + (tile * 7 % 13) + ((x * 17 + y * 29) % 9);
      pixels.set([tone, tone - 4, tone - 12, 255], (y * width + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, width);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createMonacoTunnel(
  segment: ReplaySegment, transform: SceneTransform, track: TrackPath,
  crossSections: TrackCrossSection[], pavedWidth: number,
): MonacoTunnel | null {
  if (!/^(monte[\s-]*carlo|monaco)$/i.test(segment.sessionRef.circuitShortName.trim())) return null;

  const cornerDistance = (number: number) => {
    const corner = segment.circuit.corners.find((item) => item.number === number);
    if (!corner) return undefined;
    const position = vectorFromPoint({ x: corner.x, y: transform.baseY, z: corner.y }, transform);
    const projection = track.projectPointPlanar(position);
    if (!projection || Math.hypot(projection.point.x - position.x, projection.point.z - position.z) > 40) return undefined;
    return projection.distance;
  };
  const portier = cornerDistance(8);
  const bend = cornerDistance(9);
  const chicane = cornerDistance(10);
  if (portier === undefined || bend === undefined || chicane === undefined) return null;

  const towardChicane = track.signedDistance(portier, chicane);
  const direction = Math.sign(towardChicane);
  const length = Math.abs(towardChicane) - ENTRY_AFTER_PORTIER - EXIT_BEFORE_CHICANE;
  const entrance = portier + direction * ENTRY_AFTER_PORTIER;
  const bendOffset = direction * track.signedDistance(entrance, bend);
  if (length < 250 || length > 550 || bendOffset <= 0 || bendOffset >= length) return null;

  const sample = (distance: number): TunnelSection => {
    const arc = entrance + direction * distance;
    const { index, fraction } = track.segmentAt(arc);
    const from = crossSections[index];
    const to = crossSections[(index + 1) % crossSections.length];
    const across = from.lateral.clone().multiplyScalar(from.widthScale)
      .lerp(to.lateral.clone().multiplyScalar(to.widthScale), fraction).multiplyScalar(direction);
    return { center: track.pointAt(arc), across, distance };
  };
  const sectionsBetween = (start: number, end: number) => {
    const count = Math.ceil((end - start) / 2);
    return Array.from({ length: count + 1 }, (_, i) => sample(THREE.MathUtils.lerp(start, end, i / count)));
  };

  const group = new THREE.Group();
  group.name = "Túnel Louis II";
  const relativeDistance = (arc: number) => direction * track.signedDistance(entrance, arc);
  const tileMap = createTileMap();
  const concrete = new THREE.MeshStandardMaterial({ color: "#867e70", roughness: 0.96 });
  const fascia = new THREE.MeshStandardMaterial({ color: "#cbc0ac", roughness: 0.9 });
  const lining = new THREE.MeshStandardMaterial({ map: tileMap, roughness: 0.86 });
  const steel = new THREE.MeshStandardMaterial({ color: "#939896", metalness: 0.45, roughness: 0.48 });
  const recess = new THREE.MeshStandardMaterial({ color: "#555e60", roughness: 0.68 });
  const lamp = new THREE.MeshBasicMaterial({ color: "#ffdb9f", toneMapped: false });
  let roadMaterial: THREE.MeshStandardMaterial | undefined;

  const sections = sectionsBetween(0, length);
  const roadEdge = pavedWidth / 2;
  const wall = roadEdge + 0.85;
  const slab = (
    rows: TunnelSection[], left: number, right: number, bottom: number, top: number,
    material: THREE.Material, castShadow = false,
  ) => {
    const mesh = new THREE.Mesh(createSlab(rows, left, right, bottom, top), material);
    mesh.receiveShadow = true;
    mesh.castShadow = castShadow;
    group.add(mesh);
  };

  slab(sections, -wall - 0.75, wall + 0.65, CLEARANCE, CLEARANCE + 1.15, concrete, true);
  slab(sections, wall, wall + 0.58, -0.45, CLEARANCE, concrete, true);
  slab(sections, wall - 0.05, wall, -0.12, 2.75, lining);
  const closedWall = sectionsBetween(OPEN_GALLERY_LENGTH, length);
  slab(closedWall, -wall - 0.58, -wall, -0.45, CLEARANCE, concrete, true);
  slab(closedWall, -wall, -wall + 0.05, -0.12, 2.75, lining);
  const gallery = sectionsBetween(0, OPEN_GALLERY_LENGTH);
  slab(gallery, -wall - 0.58, -wall + 0.05, -0.45, 1.08, lining, true);
  const galleryFascia = [sample(-PORTAL_FASCIA_OVERHANG), ...gallery];
  slab(galleryFascia, -wall - 1, wall + 0.8,
    CLEARANCE + 0.87, CLEARANCE + 1.45, fascia, true);

  const barriers = sectionsBetween(-12, length + 15);
  for (const side of [-1, 1]) {
    const offset = side * (roadEdge + 0.14);
    slab(barriers, offset - 0.12, offset + 0.12, -0.2, 0.2, concrete);
    for (const height of [0.22, 0.48, 0.74]) {
      slab(barriers, offset - 0.09, offset + 0.09, height, height + 0.19, steel);
    }
  }

  const box = new THREE.BoxGeometry();
  const instance = new THREE.Object3D();
  const addBoxes = (
    material: THREE.Material, distances: number[], offset: number, height: number,
    width: number, boxHeight: number, depth: number, castShadow = false,
  ) => {
    const mesh = new THREE.InstancedMesh(box, material, distances.length);
    distances.forEach((distance, i) => {
      const section = sample(distance);
      instance.position.copy(pointAt(section, offset, height));
      instance.rotation.y = Math.atan2(section.across.z, -section.across.x);
      instance.scale.set(width, boxHeight, depth);
      instance.updateMatrix();
      mesh.setMatrixAt(i, instance.matrix);
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  const spaced = (start: number, end: number, spacing: number) =>
    Array.from({ length: Math.floor((end - start) / spacing) + 1 }, (_, i) => start + i * spacing);

  addBoxes(fascia, spaced(0.75, OPEN_GALLERY_LENGTH, 8), -wall - 0.22, 2.28, 0.86, 5.55, 0.9, true);
  addBoxes(concrete, spaced(0.5, length - 0.5, 16), 0, CLEARANCE - 0.14, 2 * wall, 0.28, 0.68);
  const fixtures = spaced(FIRST_FIXTURE, length - 2, FIXTURE_SPACING);
  for (const side of [-1, 1]) {
    addBoxes(recess, fixtures, side * 3.7, CLEARANCE - 0.08, 0.51, 0.16, 1.74);
    addBoxes(lamp, fixtures, side * 3.7, CLEARANCE - 0.17, 0.34, 0.045, 1.52);
  }

  const facadeEnd = 100;
  const upperFacade = sectionsBetween(0, facadeEnd);
  const balconySlabs = [
    sample(-PORTAL_FASCIA_OVERHANG), ...upperFacade, sample(facadeEnd + PORTAL_FASCIA_OVERHANG),
  ];
  slab(upperFacade, -wall - 2.1, wall + 0.55, CLEARANCE + 1.45, CLEARANCE + 8.6, recess, true);
  for (const height of [1.45, 3.85, 6.25, 8.6]) {
    slab(balconySlabs, -wall - 2.65, wall + 0.8, CLEARANCE + height, CLEARANCE + height + 0.32, fascia);
  }
  for (const height of [2.75, 5.15, 7.55]) {
    const bays = spaced(1, facadeEnd - 1, 3.5);
    addBoxes(fascia, bays, -wall - 2.12, CLEARANCE + height, 0.18, 2.2, 0.48);
  }

  return {
    group,
    contains: (trackDistance, margin = 0) => {
      const offset = relativeDistance(trackDistance);
      return offset >= -margin && offset <= length + margin;
    },
    shadeRoad: (road) => {
      const uv = road.geometry.getAttribute("uv");
      const colors = new Float32Array(uv.count * 3);
      for (let i = 0; i < uv.count; i += 2) {
        const distance = relativeDistance(uv.getY(i) * TRACK_TILE_METERS.road);
        const cover = THREE.MathUtils.smoothstep(Math.min(distance, length - distance), 0, 24);
        const enclosure = THREE.MathUtils.smoothstep(distance, OPEN_GALLERY_LENGTH - 15, OPEN_GALLERY_LENGTH + 15);
        const fixtureLight = 0.045 * Math.cos((distance - FIRST_FIXTURE) * (2 * Math.PI / FIXTURE_SPACING));
        const shadow = cover * (THREE.MathUtils.lerp(0.28, 0.56, enclosure) - fixtureLight);
        colors.set([1 - shadow * 0.88, 1 - shadow, 1 - shadow * 1.15], i * 3);
        colors.copyWithin((i + 1) * 3, i * 3, (i + 1) * 3);
      }
      road.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const original = road.material;
      roadMaterial = original.clone();
      roadMaterial.vertexColors = true;
      roadMaterial.onBeforeCompile = (shader, renderer) => {
        original.onBeforeCompile(shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", `
          #include <emissivemap_fragment>
          float tunnelShade = 1.0 - vColor.r;
          totalEmissiveRadiance += tunnelShade * vec3(0.083, 0.064, 0.046)
            * (0.55 + 0.45 * clamp(diffuseColor.r * 5.0, 0.0, 1.0));
        `);
      };
      roadMaterial.customProgramCacheKey = () => `${original.customProgramCacheKey()}-monaco`;
      road.material = roadMaterial;
    },
    syncRoadMaterial: () => {
      const road = getTrackSurfaceMaterials().road;
      if (!roadMaterial || roadMaterial.normalMap === road.normalMap) return;
      roadMaterial.normalMap = road.normalMap;
      roadMaterial.roughnessMap = road.roughnessMap;
      roadMaterial.aoMap = road.aoMap;
      roadMaterial.needsUpdate = true;
    },
    dispose: () => {
      roadMaterial?.dispose();
      tileMap.dispose();
      box.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        else if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of [concrete, fascia, lining, steel, recess, lamp]) material.dispose();
    },
  };
}
