import * as THREE from "three";
import { createTrackRibbon, type TrackCrossSection } from "./ribbon";
import { createGrassTerrainGeometry } from "./terrain";
import {
  getTrackSurfaceMaterials,
  GROUND_PLANE_SIZE_METERS,
  TRACK_GROUND_PADDING_METERS,
  TRACK_TILE_METERS,
} from "../track-environment";

export interface TerrainSnapshot {
  index: Uint16Array | Uint32Array;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
}

export function buildRaceTerrain(
  centerline: THREE.Vector3[], closed: boolean, edge: number, crossSections: TrackCrossSection[],
): THREE.BufferGeometry {
  return createGrassTerrainGeometry({
    outerPaddingMeters: TRACK_GROUND_PADDING_METERS,
    gridSpacingMeters: 12,
    grassTileMeters: TRACK_TILE_METERS.grass,
    centerline,
    centerlineClosed: closed,
    trackHalfWidthMeters: edge,
    crossSections,
    outerClearanceMeters: 0.12,
    clearanceFadeMeters: 28,
  });
}

export function snapshotTerrain(geometry: THREE.BufferGeometry): TerrainSnapshot {
  return {
    index: geometry.getIndex()!.array as Uint16Array | Uint32Array,
    positions: geometry.getAttribute("position").array as Float32Array,
    normals: geometry.getAttribute("normal").array as Float32Array,
    uvs: geometry.getAttribute("uv").array as Float32Array,
    colors: geometry.getAttribute("color").array as Float32Array,
  };
}

function restoreTerrain(snapshot: TerrainSnapshot): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(snapshot.index, 1));
  geometry.setAttribute("position", new THREE.BufferAttribute(snapshot.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(snapshot.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(snapshot.uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(snapshot.colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export class RaceTerrain {
  private readonly ground: THREE.Mesh;
  private readonly groundBase: THREE.Mesh;

  get geometry(): THREE.BufferGeometry {
    return this.ground.geometry;
  }

  constructor(worldRoot: THREE.Group) {
    const fallbackGroundMaterial = new THREE.MeshStandardMaterial({
      color: "#3d5a40",
      roughness: 0.92,
      metalness: 0.02,
    });

    this.groundBase = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_PLANE_SIZE_METERS, GROUND_PLANE_SIZE_METERS),
      new THREE.MeshStandardMaterial({
        color: "#2d4a30",
        roughness: 0.95,
        metalness: 0,
      }),
    );
    this.groundBase.rotation.x = -Math.PI / 2;
    this.groundBase.position.y = -3;
    this.groundBase.receiveShadow = true;
    this.groundBase.renderOrder = -1;
    worldRoot.add(this.groundBase);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fallbackGroundMaterial.clone());
    this.ground.receiveShadow = true;
    this.ground.renderOrder = 0;
    worldRoot.add(this.ground);
  }

  applyMaterials() {
    const grass = getTrackSurfaceMaterials().grass;
    grass.polygonOffset = true;
    grass.polygonOffsetFactor = 1;
    grass.polygonOffsetUnits = 1;
    this.ground.material = grass;
    this.configureGrassTextureRepeat();
  }

  private configureGrassTextureRepeat() {
    const grass = getTrackSurfaceMaterials().grass;
    const maps = [grass.map, grass.normalMap, grass.roughnessMap, grass.aoMap];
    for (const map of maps) {
      if (map) {
        map.repeat.set(1, 1);
        map.needsUpdate = true;
      }
    }
  }

  rebuild(
    pathPoints: THREE.Vector3[],
    closed: boolean,
    trackWidth: number,
    kerbWidth: number,
    crossSections: TrackCrossSection[],
    snapshot?: TerrainSnapshot,
  ) {
    this.ground.geometry.dispose();
    this.ground.geometry = snapshot
      ? restoreTerrain(snapshot)
      : buildRaceTerrain(pathPoints, closed, trackWidth / 2 + kerbWidth, crossSections);
    this.groundBase.visible = false;
  }
}

export function addTrackRoad(
  root: THREE.Group,
  pathPoints: THREE.Vector3[],
  closed: boolean,
  trackWidth: number,
  crossSections: TrackCrossSection[],
) {
  const materials = getTrackSurfaceMaterials();
  const ribbonOptions = { closed, crossSections };

  const roadMesh = new THREE.Mesh(
    createTrackRibbon(pathPoints, trackWidth, {
      ...ribbonOptions,
      tileSizeMeters: TRACK_TILE_METERS.road,
    }),
    materials.road,
  );
  roadMesh.receiveShadow = true;
  roadMesh.renderOrder = 2;
  root.add(roadMesh);
  return roadMesh;
}

export function addTrackKerbs(
  root: THREE.Group, pathPoints: THREE.Vector3[], closed: boolean, trackWidth: number,
  kerbWidth: number, crossSections: TrackCrossSection[], pitOpening?: (side: number, index: number) => boolean,
) {
  const materials = getTrackSurfaceMaterials();
  const kerbOffset = trackWidth / 2 + kerbWidth / 2;
  for (const offset of [kerbOffset, -kerbOffset]) {
    const kerbMesh = new THREE.Mesh(
      createTrackRibbon(pathPoints, kerbWidth, {
        closed,
        crossSections,
        skipSegment: (index) => pitOpening?.(Math.sign(offset), index) ?? false,
        offsetMeters: offset,
        tileSizeMeters: TRACK_TILE_METERS.kerb,
      }),
      materials.kerb,
    );
    kerbMesh.receiveShadow = true;
    kerbMesh.renderOrder = 3;
    root.add(kerbMesh);
  }
}
