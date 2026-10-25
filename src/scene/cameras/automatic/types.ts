import type * as THREE from "three";

export interface CornerCameraDefinition {
  id: number;
  label: string;
  position: THREE.Vector3;
  trackDistance: number;
  coverageRadius: number;
  corner: boolean;
}

export interface BroadcastCarInput {
  driverNumber: number;
  position: THREE.Vector3;
  racePosition: number | null;
  velocity: THREE.Vector3;
  heading: number;
  intervalToAhead: number | null;
}

export type BroadcastShotKind = "trackside" | "aerial" | "onboard";

export type BroadcastShot = {
  id: number;
  subjectNumber: number;
  groupDriverNumbers: number[];
  duration: number;
} & (
  | { kind: "trackside"; camera: CornerCameraDefinition }
  | { kind: "aerial"; position: THREE.Vector3; lookAt: THREE.Vector3; radius: number }
  | { kind: "onboard" }
);

export type BroadcastCameraSelection = BroadcastShot & {
  subject: BroadcastCarInput;
};
