import type * as THREE from "three";

/** Cámara fija en una curva del circuito (estilo trackside F1 TV). */
export interface CornerCameraDefinition {
  id: number;
  label: string;
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  trackDistance: number;
  coverageRadius: number;
}

export interface BroadcastCarInput {
  driverNumber: number;
  position: THREE.Vector3;
  racePosition: number | null;
}

export interface BroadcastCameraSelection {
  camera: CornerCameraDefinition;
  score: number;
}
