import * as THREE from "three";
import type { CarSample, ReplayFrame, ReplaySegment } from "../types";
import { TrackPath } from "./cameras/automatic/track-path";
import { metersToScene, type SceneTransform, vectorFromPoint } from "./track-geometry";

const LINE_AHEAD_OF_FRONT_CAR_METERS = 10;
const LINE_DEPTH_METERS = 1.1;
const GANTRY_CLEARANCE_METERS = 1.8;
const GANTRY_HEIGHT_METERS = 6.2;
const PILLAR_SIZE_METERS = 0.35;
const BEAM_DEPTH_METERS = 0.55;
const BEAM_HEIGHT_METERS = 0.7;
const LIGHT_COUNT = 5;
const LIGHT_RADIUS_METERS = 0.28;
const LIGHT_SPACING_METERS = 0.85;
const LIGHTS_ALL_RED_MS = 1100;
const LIGHTS_OFF_STEP_MS = 700;
const LIGHTS_GREEN_MS = 900;
const LAUNCH_SPEED_KMH = 8;

type LightMode = "off" | "red" | "green";

export interface LaunchHoldPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
}

export interface StartFinishDecor {
  group: THREE.Group;
  greenAt: number | null;
  launchHoldPoses: Map<number, LaunchHoldPose>;
  update(now: number): void;
}

interface StartFinishPose {
  origin: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
}

export function createStartFinishDecor(
  segment: ReplaySegment,
  pathPoints: THREE.Vector3[],
  transform: SceneTransform,
  trackWidth: number,
): StartFinishDecor | null {
  if (pathPoints.length < 2) {
    return null;
  }

  const pose = resolveStartFinishPose(segment, pathPoints, transform);
  if (!pose) {
    return null;
  }

  const group = new THREE.Group();
  group.name = "start-finish";

  const lineDepth = metersToScene(LINE_DEPTH_METERS, transform);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(trackWidth * 0.98, lineDepth),
    new THREE.MeshStandardMaterial({
      map: createCheckeredTexture(),
      roughness: 0.92,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
  );
  placeOnTrack(line, pose.origin.clone().setY(pose.origin.y + 0.045), pose);
  line.receiveShadow = true;
  line.renderOrder = 4;
  group.add(line);

  const whiteStripe = new THREE.Mesh(
    new THREE.PlaneGeometry(trackWidth * 0.98, metersToScene(0.22, transform)),
    new THREE.MeshStandardMaterial({
      color: "#f4f4f4",
      roughness: 0.85,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -7,
      polygonOffsetUnits: -7,
    }),
  );
  const stripeOrigin = pose.origin.clone().addScaledVector(pose.tangent, lineDepth * 0.42);
  stripeOrigin.y += 0.048;
  placeOnTrack(whiteStripe, stripeOrigin, pose);
  whiteStripe.receiveShadow = true;
  whiteStripe.renderOrder = 5;
  group.add(whiteStripe);

  const lights = buildGantry(pose, transform, trackWidth);
  group.add(lights.group);

  const greenAt = resolveRaceGoTime(segment);
  const launchHoldPoses = buildLaunchHoldPoses(segment, greenAt);

  return {
    group,
    greenAt,
    launchHoldPoses,
    update(now) {
      lights.setModes(resolveLightModes(now, greenAt));
    },
  };
}

export function applyLaunchHoldToFrame(
  frame: ReplayFrame,
  greenAt: number | null,
  poses: Map<number, LaunchHoldPose>,
): ReplayFrame {
  if (greenAt === null || frame.now >= greenAt || poses.size === 0) {
    return frame;
  }

  return {
    ...frame,
    cars: frame.cars.map((car) => {
      const pose = poses.get(car.driver.driverNumber);
      if (!pose) {
        return car;
      }
      return {
        ...car,
        sample: {
          ...car.sample,
          x: pose.x,
          y: pose.y,
          z: pose.z,
          speed: 0,
        },
        heading: pose.heading,
        pitch: pose.pitch,
      };
    }),
  };
}

function resolveRaceGoTime(segment: ReplaySegment): number | null {
  const standing = segment.trackStatus?.find((interval) => interval.phase === "standing_start");
  if (!standing) {
    return null;
  }

  let launchAt: number | null = null;
  const windowStart = standing.start - 2500;
  const windowEnd = standing.end + 2500;

  for (const samples of Object.values(segment.samples)) {
    for (const sample of samples) {
      if (sample.t < windowStart || sample.t > windowEnd) {
        continue;
      }
      if (sample.speed >= LAUNCH_SPEED_KMH) {
        if (launchAt === null || sample.t < launchAt) {
          launchAt = sample.t;
        }
        break;
      }
    }
  }

  return launchAt ?? standing.end;
}

function buildLaunchHoldPoses(
  segment: ReplaySegment,
  greenAt: number | null,
): Map<number, LaunchHoldPose> {
  const poses = new Map<number, LaunchHoldPose>();
  if (greenAt === null) {
    return poses;
  }

  const freezeAt = greenAt - 1;
  for (const [driverKey, samples] of Object.entries(segment.samples)) {
    if (samples.length === 0) {
      continue;
    }
    const driverNumber = Number(driverKey);
    const sample = nearestSample(samples, freezeAt);
    if (!sample) {
      continue;
    }

    let heading = 0;
    let pitch = 0;
    const index = samples.findIndex((entry) => entry.t === sample.t);
    const prev = index > 0 ? samples[index - 1] : null;
    const next = samples.find((entry) => entry.t > sample.t && entry.speed >= LAUNCH_SPEED_KMH);
    if (next) {
      heading = openf1Heading(sample, next);
      pitch = openf1Pitch(sample, next);
    } else if (prev) {
      heading = openf1Heading(prev, sample);
      pitch = openf1Pitch(prev, sample);
    }

    poses.set(driverNumber, {
      x: sample.x,
      y: sample.y,
      z: sample.z,
      heading,
      pitch,
    });
  }

  return poses;
}

function openf1Heading(from: CarSample, to: CarSample): number {
  const dx = to.x - from.x;
  const dz = from.z - to.z;
  if (dx * dx + dz * dz < 1e-6) {
    return 0;
  }
  return Math.atan2(dz, dx);
}

function openf1Pitch(from: CarSample, to: CarSample): number {
  const horizontal = Math.hypot(to.x - from.x, to.z - from.z);
  if (horizontal * horizontal < 1e-6) {
    return 0;
  }
  return Math.atan2(to.y - from.y, horizontal);
}

function resolveLightModes(now: number, goTime: number | null): LightMode[] {
  const modes: LightMode[] = Array.from({ length: LIGHT_COUNT }, () => "off");
  if (goTime === null) {
    return modes;
  }

  const extinguishStart = goTime - LIGHT_COUNT * LIGHTS_OFF_STEP_MS;
  const allRedStart = extinguishStart - LIGHTS_ALL_RED_MS;
  const greenEnd = goTime + LIGHTS_GREEN_MS;

  if (now < allRedStart || now >= greenEnd) {
    return modes;
  }

  if (now >= goTime) {
    return modes.map(() => "green" as const);
  }

  if (now < extinguishStart) {
    return modes.map(() => "red" as const);
  }

  const extinguished = Math.floor((now - extinguishStart) / LIGHTS_OFF_STEP_MS);
  for (let i = 0; i < LIGHT_COUNT; i += 1) {
    modes[i] = i < extinguished ? "off" : "red";
  }
  return modes;
}

function resolveStartFinishPose(
  segment: ReplaySegment,
  pathPoints: THREE.Vector3[],
  transform: SceneTransform,
): StartFinishPose | null {
  const path = new TrackPath(pathPoints);
  if (path.totalLength < 1) {
    return null;
  }

  const reference = pickGridReferenceSample(segment);
  let projection =
    reference !== null
      ? path.projectPointPlanar(vectorFromPoint(reference, transform))
      : path.projectPointPlanar(pathPoints[0]);

  if (!projection) {
    return null;
  }

  const tangent = path.tangentAt(projection);
  if (reference !== null) {
    const launch = pickLaunchSample(segment, reference.driverNumber, reference.t);
    if (launch) {
      const launchPoint = vectorFromPoint(launch, transform);
      const travel = launchPoint.clone().sub(projection.point);
      travel.y = 0;
      if (travel.dot(tangent) < 0) {
        tangent.negate();
      }
    }
  }

  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const ahead = metersToScene(LINE_AHEAD_OF_FRONT_CAR_METERS, transform);
  const origin = projection.point.clone().addScaledVector(tangent, ahead);
  origin.y = projection.point.y;

  return { origin, tangent, normal };
}

function pickGridReferenceSample(
  segment: ReplaySegment,
): (CarSample & { driverNumber: number }) | null {
  const standing = segment.trackStatus?.find((interval) => interval.phase === "standing_start");
  const probeTime = standing?.start ?? segment.timeRange.start;
  const ranked = [...(segment.startingGrid ?? [])]
    .filter((slot) => (segment.samples[slot.driverNumber]?.length ?? 0) > 0)
    .sort((a, b) => a.position - b.position);

  const candidates =
    ranked.length > 0
      ? ranked.map((slot) => slot.driverNumber)
      : Object.keys(segment.samples).map(Number);

  let best: (CarSample & { driverNumber: number }) | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const driverNumber of candidates) {
    const sample = nearestSample(segment.samples[driverNumber] ?? [], probeTime);
    if (!sample) {
      continue;
    }
    const gridRank = ranked.find((slot) => slot.driverNumber === driverNumber)?.position ?? 99;
    const score = Math.abs(sample.t - probeTime) + gridRank * 1e-3;
    if (score < bestScore) {
      bestScore = score;
      best = { ...sample, driverNumber };
    }
  }

  return best;
}

function pickLaunchSample(
  segment: ReplaySegment,
  driverNumber: number,
  fromTime: number,
): CarSample | null {
  const samples = segment.samples[driverNumber] ?? [];
  for (const sample of samples) {
    if (sample.t > fromTime + 1500 && sample.speed > 60) {
      return sample;
    }
  }
  return nearestSample(samples, fromTime + 4000);
}

function nearestSample(samples: CarSample[], t: number): CarSample | null {
  if (samples.length === 0) {
    return null;
  }
  let best = samples[0];
  let bestDelta = Math.abs(best.t - t);
  for (let i = 1; i < samples.length; i += 1) {
    const delta = Math.abs(samples[i].t - t);
    if (delta < bestDelta) {
      best = samples[i];
      bestDelta = delta;
    }
  }
  return best;
}

function placeOnTrack(mesh: THREE.Mesh, origin: THREE.Vector3, pose: StartFinishPose) {
  const up = new THREE.Vector3(0, 1, 0);
  mesh.position.copy(origin);
  mesh.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(pose.normal, pose.tangent, up),
  );
}

function applyLightMode(mat: THREE.MeshStandardMaterial, mode: LightMode) {
  if (mode === "red") {
    mat.color.set("#ff1a1a");
    mat.emissive.set("#ff2200");
    mat.emissiveIntensity = 2.4;
  } else if (mode === "green") {
    mat.color.set("#1aff66");
    mat.emissive.set("#00ff55");
    mat.emissiveIntensity = 2.6;
  } else {
    mat.color.set("#2a2a2a");
    mat.emissive.set("#000000");
    mat.emissiveIntensity = 1;
  }
  mat.needsUpdate = true;
}

function buildGantry(
  pose: StartFinishPose,
  transform: SceneTransform,
  trackWidth: number,
): { group: THREE.Group; setModes: (modes: LightMode[]) => void } {
  const group = new THREE.Group();
  const pillarSize = metersToScene(PILLAR_SIZE_METERS, transform);
  const height = metersToScene(GANTRY_HEIGHT_METERS, transform);
  const clearance = metersToScene(GANTRY_CLEARANCE_METERS, transform);
  const beamDepth = metersToScene(BEAM_DEPTH_METERS, transform);
  const beamHeight = metersToScene(BEAM_HEIGHT_METERS, transform);
  const span = trackWidth + clearance * 2;
  const halfSpan = span / 2;

  const structureMaterial = new THREE.MeshStandardMaterial({
    color: "#1a1a1a",
    roughness: 0.55,
    metalness: 0.35,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: "#c8ccd2",
    roughness: 0.4,
    metalness: 0.55,
  });

  const pillarGeo = new THREE.BoxGeometry(pillarSize, height, pillarSize);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, structureMaterial);
    pillar.position
      .copy(pose.origin)
      .addScaledVector(pose.normal, side * halfSpan)
      .addScaledVector(pose.tangent, metersToScene(0.4, transform));
    pillar.position.y = pose.origin.y + height / 2;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);
  }

  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(span + pillarSize, beamHeight, beamDepth),
    structureMaterial,
  );
  beam.position.copy(pose.origin).addScaledVector(pose.tangent, metersToScene(0.4, transform));
  beam.position.y = pose.origin.y + height - beamHeight / 2;
  const beamYaw = Math.atan2(pose.tangent.x, pose.tangent.z);
  beam.rotation.y = beamYaw;
  beam.castShadow = true;
  group.add(beam);

  const panelWidth = metersToScene(LIGHT_SPACING_METERS * (LIGHT_COUNT - 1) + 1.6, transform);
  const panelHeight = metersToScene(1.15, transform);
  const panelDepth = metersToScene(0.18, transform);
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(panelWidth, panelHeight, panelDepth),
    structureMaterial,
  );
  panel.position.copy(beam.position);
  panel.position.y -= metersToScene(0.15, transform);
  panel.position.addScaledVector(pose.tangent, -beamDepth * 0.55);
  panel.rotation.y = beamYaw;
  panel.castShadow = true;
  group.add(panel);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(panelWidth * 1.02, metersToScene(0.08, transform), panelDepth * 1.1),
    accentMaterial,
  );
  trim.position.copy(panel.position);
  trim.position.y += panelHeight * 0.42;
  trim.rotation.y = beamYaw;
  group.add(trim);

  const lightMats: THREE.MeshStandardMaterial[] = [];
  const lightRadius = metersToScene(LIGHT_RADIUS_METERS, transform);
  const lightSpacing = metersToScene(LIGHT_SPACING_METERS, transform);
  const lightGeo = new THREE.CircleGeometry(lightRadius, 24);
  const startX = -((LIGHT_COUNT - 1) * lightSpacing) / 2;

  for (let i = 0; i < LIGHT_COUNT; i += 1) {
    const mat = new THREE.MeshStandardMaterial({
      color: "#2a2a2a",
      emissive: "#000000",
      emissiveIntensity: 1,
      roughness: 0.35,
      metalness: 0.1,
    });
    lightMats.push(mat);

    const light = new THREE.Mesh(lightGeo, mat);
    const localX = startX + i * lightSpacing;
    light.position
      .copy(panel.position)
      .addScaledVector(pose.normal, localX)
      .addScaledVector(pose.tangent, -panelDepth * 0.55 - 0.01);
    light.position.y -= metersToScene(0.05, transform);
    light.rotation.y = beamYaw + Math.PI;
    light.renderOrder = 6;
    group.add(light);

    const bezel = new THREE.Mesh(
      new THREE.RingGeometry(lightRadius * 0.92, lightRadius * 1.18, 24),
      accentMaterial,
    );
    bezel.position.copy(light.position);
    bezel.position.addScaledVector(pose.tangent, 0.005);
    bezel.rotation.y = beamYaw + Math.PI;
    group.add(bezel);
  }

  let lastKey = "";

  return {
    group,
    setModes(modes) {
      const key = modes.join(",");
      if (key === lastKey) {
        return;
      }
      lastKey = key;
      for (let i = 0; i < lightMats.length; i += 1) {
        applyLightMode(lightMats[i], modes[i] ?? "off");
      }
    },
  };
}

function createCheckeredTexture(): THREE.CanvasTexture {
  const size = 128;
  const cells = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    return fallback;
  }

  const cell = size / cells;
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f5f5f5" : "#111111";
      ctx.fillRect(x * cell, y * cell, cell + 1, cell + 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
