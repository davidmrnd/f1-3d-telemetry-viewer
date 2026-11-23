import { LapTiming } from "../driving/lap-timing";
import { DRIVE_STEP_MS, automaticGear, drivingTelemetry, groundVehicle, stepVehicle, type DrivingInput } from "../driving/vehicle";
import type { ReplayController } from "../replay/replay-controller";
import type { DrivingTrack } from "../scene/driving-track";
import type { RaceScene } from "../scene/race-scene";
import { resolveDrivingCollisions } from "../scene/traffic/driving-collisions";
import type { DrivingRaceOrder } from "../scene/traffic/driving-race-order";
import type { TrafficTimeline } from "../scene/traffic/traffic-timeline";
import type { FrameCarState, PlayerVehicle, ReplaySegment, VehiclePose } from "../types";
import type { GhostChallenge } from "./ghost-challenge";

export type DrivingMode = "race" | "ghost";
type DrivePhase = "ready" | "running" | "paused" | "finished";
type DrivingSource = {
  mode: "race"; replay: ReplayController; traffic: TrafficTimeline; start: number;
} | { mode: "ghost"; challenge: GhostChallenge };

export function takeoverTime(segment: ReplaySegment) {
  return segment.trackStatus.find(interval => interval.phase === "racing")?.start ?? segment.timeRange.start;
}

export class DrivingSession {
  private phase: DrivePhase = "ready";
  private elapsed = 0;
  private accumulator = 0;
  private contactUntil = 0;
  private asphalt = true;
  private showRaceGhost = false;
  private snapCamera = true;
  private player: PlayerVehicle;
  private gear = 1;
  private lap: LapTiming | null = null;
  private readonly raceOrder: DrivingRaceOrder | null;
  private readonly opponents: number[];
  private readonly startVehicle: PlayerVehicle;
  private readonly startCar: FrameCarState;

  constructor(private readonly source: DrivingSource, private readonly track: DrivingTrack, driverNumber: number) {
    let pose: VehiclePose;
    if (source.mode === "ghost") {
      this.startCar = source.challenge.car;
      pose = source.challenge.spawn;
      this.opponents = [];
      this.raceOrder = null;
    } else {
      const frame = source.replay.getFrame(source.start);
      const placements = source.traffic.sample(frame);
      const placement = placements.find(({ car }) => car.driver.driverNumber === driverNumber);
      if (!placement || placement.car.retirement) throw new Error("Este piloto no está disponible al empezar el tramo.");
      this.startCar = placement.car;
      pose = { x: placement.position.x, y: placement.position.y, z: placement.position.z,
        heading: placement.heading, pitch: placement.car.pitch };
      this.opponents = frame.cars.map(car => car.driver.driverNumber).filter(number => number !== driverNumber);
      this.raceOrder = track.createRaceOrder(source.replay.getSegment(), source.start, placements, driverNumber);
    }
    this.startVehicle = { ...pose, speed: this.startCar.sample.speed / 3.6, lateralSpeed: 0, steering: 0 };
    this.player = { ...this.startVehicle };
    this.reset();
  }

  get mode() { return this.source.mode; }
  get driver() { return this.startCar.driver; }
  get reference() { return this.source.mode === "ghost" ? this.source.challenge.lap : null; }
  get isRunning() { return this.phase === "running"; }

  reset() {
    this.phase = "ready";
    this.elapsed = 0;
    this.accumulator = 0;
    this.contactUntil = 0;
    this.asphalt = true;
    this.snapCamera = true;
    this.player = { ...this.startVehicle };
    this.gear = automaticGear(this.player.speed);
    this.raceOrder?.reset();
    const challenge = this.source.mode === "ghost" ? this.source.challenge : null;
    this.lap = challenge ? new LapTiming(challenge.gates, challenge.referenceTimes) : null;
  }

  start() {
    if (this.phase === "ready" || this.phase === "paused") this.phase = "running";
  }

  pause() {
    if (this.isRunning) {
      this.phase = "paused";
      this.accumulator = 0;
    }
  }

  setRaceGhost(visible: boolean) { this.showRaceGhost = visible; }

  tick(deltaMs: number, input: DrivingInput) {
    if (!this.isRunning) return;
    this.accumulator += Math.max(0, Math.min(deltaMs, 250));
    while (this.accumulator >= DRIVE_STEP_MS && this.isRunning) {
      this.advance(input);
      this.accumulator -= DRIVE_STEP_MS;
    }
  }

  private advance(input: DrivingInput) {
    const { source, player } = this;
    const before = source.mode === "race" ? source.start + this.elapsed : 0;
    const step = source.mode === "race" ? Math.min(DRIVE_STEP_MS, source.replay.getDuration() - before) : DRIVE_STEP_MS;
    if (step <= 0) {
      this.phase = "finished";
      return;
    }
    const dt = step / 1000;
    const surface = this.track.surface(player.x, player.z, player.y);
    const next = stepVehicle(player, input, dt, surface);
    groundVehicle(next, this.track.surface, dt);
    if (source.mode === "race" && resolveDrivingCollisions(player, next, source.traffic, this.opponents, before, before + step)) {
      groundVehicle(next, this.track.surface, dt);
      this.contactUntil = this.elapsed + 900;
    }
    this.player = next;
    this.gear = automaticGear(next.speed, this.gear);
    const nextSurface = this.track.surface(next.x, next.z, next.y);
    this.asphalt = nextSurface.asphalt;
    this.lap?.advance(player, next, this.elapsed, step, nextSurface.mainTrack);
    this.elapsed = this.lap?.finishMs ?? this.elapsed + step;
    if (this.lap?.finishMs != null || (source.mode === "race" && before + step >= source.replay.getDuration())) {
      this.phase = "finished";
    }
  }

  render(scene: RaceScene, input: DrivingInput, cockpit: boolean) {
    const { player, source, driver } = this;
    const time = source.mode === "race" ? source.start + this.elapsed : this.elapsed;
    const recorded = source.mode === "race" ? source.traffic.sample(source.replay.getFrame(time)) : [];
    const others = recorded.filter(({ car: opponent }) => opponent.driver.driverNumber !== driver.driverNumber);
    const position = this.raceOrder?.update(time, player, others) ?? null;
    const car: FrameCarState = { driver, heading: player.heading, pitch: player.pitch,
      sample: { ...this.startCar.sample, ...drivingTelemetry(player, input, this.gear), t: time,
        position: position?.rank ?? null, gapToLeader: null, intervalToAhead: null } };
    const ghostInRace = this.showRaceGhost ? recorded.find(entry => entry.car.driver.driverNumber === driver.driverNumber) : null;
    const ghost = source.mode === "ghost" && time <= source.challenge.lap.durationMs ? source.challenge.poseAt(time)
      : ghostInRace ? { ...ghostInRace.position, heading: ghostInRace.heading, pitch: ghostInRace.car.pitch } : null;
    scene.updateDriving(others, car, player, ghost, time, this.snapCamera, cockpit);
    this.snapCamera = false;
    return {
      phase: this.phase, speed: car.sample.speed, gear: car.sample.gear, elapsed: this.elapsed,
      position,
      duration: source.mode === "race" ? source.replay.getDuration() - source.start : null,
      passed: this.lap?.passed ?? 0, checkpoints: this.lap?.gates.length ?? 0,
      valid: this.lap?.valid ?? true, delta: this.lap?.deltaMs ?? null,
      contact: this.contactUntil > this.elapsed, asphalt: this.asphalt,
    };
  }
}

export type DrivingReadout = ReturnType<DrivingSession["render"]>;
