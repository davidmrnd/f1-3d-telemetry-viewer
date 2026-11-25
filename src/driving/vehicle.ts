import type { DrivingSurface, PlayerVehicle } from "../types";

export interface DrivingInput {
  throttle: number;
  brake: number;
  steer: number;
}

export type SampleDrivingSurface = (x: number, z: number, fallbackY: number) => DrivingSurface;

export const DRIVE_STEP_MS = 1000 / 120;
const WHEELBASE = 3.6;
const CLEARANCE = 0.035;
const LOW_SPEED_STEERING_LIMIT = 25;
const MEDIUM_SPEED_STEERING_PEAK = 32;
const MEDIUM_SPEED_STEERING_RANGE = 18;
const STEERING_BOOST = 0.55;
const STEERING_FADE_START_KMH = 190;
const STEERING_FADE_END_KMH = 250;
const SHIFT_SPEEDS = [0, 97, 133, 172, 214, 253, 289, 320, 355];
const DOWNSHIFT_MARGIN_KMH = 8;
const IDLE_RPM = 3800;
const UPSHIFT_RPM = 13000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function smoothstep(value: number) {
  const u = clamp(value, 0, 1);
  return u * u * (3 - 2 * u);
}

export function stepVehicle(car: PlayerVehicle, input: DrivingInput, dt: number, surface: DrivingSurface): PlayerVehicle {
  const speed = Math.abs(car.speed);
  const asphalt = surface.asphalt;
  const braking = input.brake > 0 && (car.speed > 0 || input.throttle > 0);
  const lowSpeed = smoothstep(1 - speed / LOW_SPEED_STEERING_LIMIT);
  const mediumSpeed = asphalt
    ? smoothstep(1 - Math.abs(speed - MEDIUM_SPEED_STEERING_PEAK) / MEDIUM_SPEED_STEERING_RANGE)
    : 0;
  const steering = car.steering + (input.steer - car.steering) * (1 - Math.exp(-dt * (9 + 4 * lowSpeed)));
  const drag = (asphalt ? 0.16 : 2.8) + (asphalt ? 0.00038 : 0.0024) * speed ** 2;
  let forwardSpeed = Math.sign(car.speed) * Math.max(0, speed - drag * dt);
  if (braking) {
    forwardSpeed = Math.max(0, forwardSpeed - (asphalt ? 15 + speed * 0.33 : 10) * dt * input.brake);
  } else if (input.throttle > 0) {
    forwardSpeed += (asphalt ? 12.8 : 7) * (1 - (Math.max(0, forwardSpeed) / 103) ** 2) * dt * input.throttle;
  } else if (input.brake > 0) {
    forwardSpeed = Math.max(-8, forwardSpeed - 4.2 * dt * input.brake);
  }

  const grip = asphalt ? 12.5 + 0.0027 * speed ** 2 + 4.8 * lowSpeed + 4.5 * mediumSpeed
    : 5 + 0.0006 * speed ** 2 + 2.5 * lowSpeed;
  const steerAngle = steering * (0.48 + 0.34 * lowSpeed + 0.12 * mediumSpeed) / (1 + speed / 19);
  const yawLimit = grip / Math.max(4, speed);
  const fade = smoothstep((speed * 3.6 - STEERING_FADE_START_KMH) / (STEERING_FADE_END_KMH - STEERING_FADE_START_KMH));
  const yaw = clamp(forwardSpeed * Math.tan(steerAngle) / WHEELBASE, -yawLimit, yawLimit) * dt * (1 + STEERING_BOOST * (1 - fade));
  const heading = car.heading + yaw;
  const lateralSpeed = (car.lateralSpeed * Math.cos(yaw) - forwardSpeed * Math.sin(yaw))
    * Math.exp(-dt * (asphalt ? 13 : 6));
  return {
    ...car,
    speed: forwardSpeed,
    lateralSpeed,
    steering,
    steeringAngle: steerAngle,
    heading,
    x: car.x + (forwardSpeed * Math.cos(heading) - lateralSpeed * Math.sin(heading)) * dt,
    z: car.z + (forwardSpeed * Math.sin(heading) + lateralSpeed * Math.cos(heading)) * dt,
  };
}

export function groundVehicle(car: PlayerVehicle, surface: SampleDrivingSurface, dt: number) {
  car.y = surface(car.x, car.z, car.y - CLEARANCE).height + CLEARANCE;
  const dx = Math.cos(car.heading) * 1.7;
  const dz = Math.sin(car.heading) * 1.7;
  const front = surface(car.x + dx, car.z + dz, car.y - CLEARANCE).height;
  const rear = surface(car.x - dx, car.z - dz, car.y - CLEARANCE).height;
  const pitch = Math.atan2(clamp(front - rear, -1, 1), 3.4);
  car.pitch += (pitch - car.pitch) * (1 - Math.exp(-dt * 16));
}

export function automaticGear(speed: number, previous = 1) {
  const kmh = speed * 3.6;
  let gear = Math.max(1, previous);
  while (gear < 8 && kmh >= SHIFT_SPEEDS[gear]) gear++;
  while (gear > 1 && kmh < SHIFT_SPEEDS[gear - 1] - DOWNSHIFT_MARGIN_KMH) gear--;
  return kmh < -0.7 ? -1 : gear;
}

export function drivingTelemetry(car: PlayerVehicle, input: DrivingInput, gear: number) {
  const speed = Math.abs(car.speed) * 3.6;
  const reverse = gear < 0;
  const load = reverse ? input.brake : input.brake > 0 ? 0 : input.throttle;
  const connectedRpm = clamp(speed * UPSHIFT_RPM / (reverse ? 46 : SHIFT_SPEEDS[gear]), IDLE_RPM, UPSHIFT_RPM);
  const clutchSlip = gear <= 1 ? Math.max(0, 1 - speed / (reverse ? 18 : 50)) : 0;
  const freeRpm = IDLE_RPM + load * 5600;
  return {
    speed,
    gear,
    rpm: connectedRpm + (freeRpm - connectedRpm) * clutchSlip,
    throttle: load * 100,
    brake: reverse ? 0 : input.brake * 100,
    drs: 0,
  };
}
