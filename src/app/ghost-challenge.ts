import { findGateTime } from "../driving/lap-timing";
import { createGhostReplay } from "../replay/ghost-replay";
import type { DrivingTrack } from "../scene/driving-track";
import type { GhostCapture, GhostLap } from "../types";

export function createGhostChallenge(track: DrivingTrack, capture: GhostCapture, lap: GhostLap) {
  const replay = createGhostReplay(capture, lap);
  const rawPose = (time: number) => track.recordedPose(replay.sample(time));
  const duration = lap.durationMs;
  const gates = track.lapGates(rawPose(0));
  const finish = gates.at(-1)!;
  const start = findGateTime(finish, rawPose, replay.firstTime, Math.min(8000, replay.lastTime), 0);
  const end = findGateTime(finish, rawPose, Math.max(replay.firstTime, duration - 8000), replay.lastTime, duration);
  if (start === null || end === null || end <= start) {
    throw new Error("No se pudo alinear esta vuelta fantasma con la salida y la meta.");
  }
  const poseAt = (time: number) => rawPose(start + (end - start) * Math.min(time / duration, 1));
  let previous = 0;
  const referenceTimes = gates.map((gate, index) => {
    if (index === gates.length - 1) return duration;
    const time = findGateTime(gate, poseAt, previous, duration);
    if (time !== null) previous = time;
    return time;
  });

  const { origin, heading, halfWidth } = finish;
  const ghost = poseAt(0);
  const dx = Math.cos(heading);
  const dz = Math.sin(heading);
  const lateral = (ghost.z - origin.z) * dx - (ghost.x - origin.x) * dz;
  const offset = Math.max(-halfWidth + 1.5, Math.min(halfWidth - 1.5, lateral + (lateral > 0 ? -2.8 : 2.8)));
  const x = origin.x - dz * offset;
  const z = origin.z + dx * offset;
  const spawn = { x, y: track.surface(x, z, origin.y).height + 0.035, z, heading, pitch: ghost.pitch };
  return { lap, gates, referenceTimes, poseAt, spawn, car: replay.sample(start) };
}

export type GhostChallenge = ReturnType<typeof createGhostChallenge>;
