import { DISTANCE_COMPONENT, type ProgressMeasurement, SPEED_COMPONENT } from "./progress-measurements";
import type { TimeInterval } from "./telemetry-speed-profile";
import { msToSeconds } from "./units";

const JERK_SPECTRAL_DENSITY = 1200;
const STATIONARY_PROCESS_FACTOR = 1e-6;
const MAX_STEP_MS = 50;
const ROBUST_PASSES = 4;
const HUBER_THRESHOLD = 2;
const INITIAL_DISTANCE_VARIANCE = 100;
const INITIAL_SPEED_VARIANCE = 25;
const INITIAL_ACCELERATION_VARIANCE = 400;
const STATE_SIZE = 3;
const COVARIANCE_SIZE = 6;

export interface ProgressKnots {
  times: Float64Array;
  distances: Float64Array;
  speeds: Float64Array;
}

interface StepPlan {
  times: Float64Array;
  measurementSteps: Int32Array;
  stationarySteps: Uint8Array;
}

interface FilterPass {
  predictedStates: Float64Array;
  predictedCovariances: Float64Array;
  filteredStates: Float64Array;
  filteredCovariances: Float64Array;
}

function markStationarySteps(times: Float64Array, intervals: TimeInterval[]): Uint8Array {
  const flags = new Uint8Array(times.length);
  let intervalIndex = 0;

  for (let step = 1; step < times.length; step += 1) {
    const from = times[step - 1];
    const to = times[step];
    while (intervalIndex < intervals.length && intervals[intervalIndex].end < from) {
      intervalIndex += 1;
    }
    const interval = intervals[intervalIndex];
    flags[step] = interval && from >= interval.start && to <= interval.end ? 1 : 0;
  }

  return flags;
}

function planSteps(measurements: ProgressMeasurement[], stationary: TimeInterval[]): StepPlan {
  const times: number[] = [];
  const measurementSteps = new Int32Array(measurements.length);

  measurements.forEach((measurement, index) => {
    const lastTime = times[times.length - 1];
    if (times.length === 0 || measurement.t > lastTime) {
      if (times.length > 0) {
        const gap = measurement.t - lastTime;
        const fillers = Math.ceil(gap / MAX_STEP_MS) - 1;
        for (let filler = 1; filler <= fillers; filler += 1) {
          times.push(lastTime + (gap * filler) / (fillers + 1));
        }
      }
      times.push(measurement.t);
    }
    measurementSteps[index] = times.length - 1;
  });

  const stepTimes = Float64Array.from(times);
  return {
    times: stepTimes,
    measurementSteps,
    stationarySteps: markStationarySteps(stepTimes, stationary),
  };
}

function initialState(measurements: ProgressMeasurement[]): [number, number, number] {
  const firstDistance = measurements.find((measurement) => measurement.component === DISTANCE_COMPONENT);
  const firstSpeed = measurements.find((measurement) => measurement.component === SPEED_COMPONENT);
  return [firstDistance?.value ?? 0, firstSpeed?.value ?? 0, 0];
}

function runFilter(
  plan: StepPlan,
  measurements: ProgressMeasurement[],
  weights: Float64Array,
  initial: [number, number, number],
): FilterPass {
  const stepCount = plan.times.length;
  const predictedStates = new Float64Array(stepCount * STATE_SIZE);
  const predictedCovariances = new Float64Array(stepCount * COVARIANCE_SIZE);
  const filteredStates = new Float64Array(stepCount * STATE_SIZE);
  const filteredCovariances = new Float64Array(stepCount * COVARIANCE_SIZE);

  let [distance, speed, acceleration] = initial;
  let p00 = INITIAL_DISTANCE_VARIANCE;
  let p01 = 0;
  let p02 = 0;
  let p11 = INITIAL_SPEED_VARIANCE;
  let p12 = 0;
  let p22 = INITIAL_ACCELERATION_VARIANCE;
  let cursor = 0;

  for (let step = 0; step < stepCount; step += 1) {
    if (step > 0) {
      const h = msToSeconds(plan.times[step] - plan.times[step - 1]);
      const g = (h * h) / 2;
      distance += h * speed + g * acceleration;
      speed += h * acceleration;

      const r00 = p00 + h * p01 + g * p02;
      const r01 = p01 + h * p11 + g * p12;
      const r02 = p02 + h * p12 + g * p22;
      const r11 = p11 + h * p12;
      const r12 = p12 + h * p22;
      const q = JERK_SPECTRAL_DENSITY * (plan.stationarySteps[step] ? STATIONARY_PROCESS_FACTOR : 1);
      const h2 = h * h;
      const h3 = h2 * h;
      const h4 = h3 * h;
      const h5 = h4 * h;
      p00 = r00 + h * r01 + g * r02 + (q * h5) / 20;
      p01 = r01 + h * r02 + (q * h4) / 8;
      p02 = r02 + (q * h3) / 6;
      p11 = r11 + h * r12 + (q * h3) / 3;
      p12 = r12 + (q * h2) / 2;
      p22 = p22 + q * h;
    }

    const stateOffset = step * STATE_SIZE;
    const covarianceOffset = step * COVARIANCE_SIZE;
    predictedStates.set([distance, speed, acceleration], stateOffset);
    predictedCovariances.set([p00, p01, p02, p11, p12, p22], covarianceOffset);

    while (cursor < measurements.length && plan.measurementSteps[cursor] === step) {
      const measurement = measurements[cursor];
      const variance = measurement.variance / weights[cursor];
      cursor += 1;

      let column0: number;
      let column1: number;
      let column2: number;
      let estimate: number;
      let ownVariance: number;
      if (measurement.component === DISTANCE_COMPONENT) {
        column0 = p00;
        column1 = p01;
        column2 = p02;
        estimate = distance;
        ownVariance = p00;
      } else if (measurement.component === SPEED_COMPONENT) {
        column0 = p01;
        column1 = p11;
        column2 = p12;
        estimate = speed;
        ownVariance = p11;
      } else {
        column0 = p02;
        column1 = p12;
        column2 = p22;
        estimate = acceleration;
        ownVariance = p22;
      }

      const innovationVariance = ownVariance + variance;
      const gain0 = column0 / innovationVariance;
      const gain1 = column1 / innovationVariance;
      const gain2 = column2 / innovationVariance;
      const innovation = measurement.value - estimate;
      distance += gain0 * innovation;
      speed += gain1 * innovation;
      acceleration += gain2 * innovation;
      p00 -= gain0 * column0;
      p01 -= gain0 * column1;
      p02 -= gain0 * column2;
      p11 -= gain1 * column1;
      p12 -= gain1 * column2;
      p22 -= gain2 * column2;
    }

    filteredStates.set([distance, speed, acceleration], stateOffset);
    filteredCovariances.set([p00, p01, p02, p11, p12, p22], covarianceOffset);
  }

  return { predictedStates, predictedCovariances, filteredStates, filteredCovariances };
}

function smoothBackward(plan: StepPlan, pass: FilterPass): Float64Array {
  const stepCount = plan.times.length;
  const smoothed = new Float64Array(stepCount * STATE_SIZE);
  const lastOffset = (stepCount - 1) * STATE_SIZE;
  smoothed.set(pass.filteredStates.subarray(lastOffset, lastOffset + STATE_SIZE), lastOffset);

  for (let step = stepCount - 2; step >= 0; step -= 1) {
    const h = msToSeconds(plan.times[step + 1] - plan.times[step]);
    const g = (h * h) / 2;
    const f = step * COVARIANCE_SIZE;
    const f00 = pass.filteredCovariances[f];
    const f01 = pass.filteredCovariances[f + 1];
    const f02 = pass.filteredCovariances[f + 2];
    const f11 = pass.filteredCovariances[f + 3];
    const f12 = pass.filteredCovariances[f + 4];
    const f22 = pass.filteredCovariances[f + 5];

    const a00 = f00 + h * f01 + g * f02;
    const a01 = f01 + h * f02;
    const a02 = f02;
    const a10 = f01 + h * f11 + g * f12;
    const a11 = f11 + h * f12;
    const a12 = f12;
    const a20 = f02 + h * f12 + g * f22;
    const a21 = f12 + h * f22;
    const a22 = f22;

    const p = (step + 1) * COVARIANCE_SIZE;
    const q00 = pass.predictedCovariances[p];
    const q01 = pass.predictedCovariances[p + 1];
    const q02 = pass.predictedCovariances[p + 2];
    const q11 = pass.predictedCovariances[p + 3];
    const q12 = pass.predictedCovariances[p + 4];
    const q22 = pass.predictedCovariances[p + 5];
    const c00 = q11 * q22 - q12 * q12;
    const c01 = q02 * q12 - q01 * q22;
    const c02 = q01 * q12 - q02 * q11;
    const c11 = q00 * q22 - q02 * q02;
    const c12 = q01 * q02 - q00 * q12;
    const c22 = q00 * q11 - q01 * q01;
    const determinant = q00 * c00 + q01 * c01 + q02 * c02;

    const next = (step + 1) * STATE_SIZE;
    const d0 = smoothed[next] - pass.predictedStates[next];
    const d1 = smoothed[next + 1] - pass.predictedStates[next + 1];
    const d2 = smoothed[next + 2] - pass.predictedStates[next + 2];
    const e0 = (c00 * d0 + c01 * d1 + c02 * d2) / determinant;
    const e1 = (c01 * d0 + c11 * d1 + c12 * d2) / determinant;
    const e2 = (c02 * d0 + c12 * d1 + c22 * d2) / determinant;

    const current = step * STATE_SIZE;
    smoothed[current] = pass.filteredStates[current] + a00 * e0 + a01 * e1 + a02 * e2;
    smoothed[current + 1] = pass.filteredStates[current + 1] + a10 * e0 + a11 * e1 + a12 * e2;
    smoothed[current + 2] = pass.filteredStates[current + 2] + a20 * e0 + a21 * e1 + a22 * e2;
  }

  return smoothed;
}

function updateRobustWeights(
  plan: StepPlan,
  measurements: ProgressMeasurement[],
  states: Float64Array,
  weights: Float64Array,
): void {
  measurements.forEach((measurement, index) => {
    if (!measurement.robust) {
      return;
    }
    const estimate = states[plan.measurementSteps[index] * STATE_SIZE + measurement.component];
    const normalizedResidual = Math.abs(measurement.value - estimate) / Math.sqrt(measurement.variance);
    weights[index] = normalizedResidual <= HUBER_THRESHOLD ? 1 : HUBER_THRESHOLD / normalizedResidual;
  });
}

export function smoothProgress(measurements: ProgressMeasurement[], stationary: TimeInterval[]): ProgressKnots {
  if (measurements.length === 0) {
    return { times: Float64Array.of(0), distances: Float64Array.of(0), speeds: Float64Array.of(0) };
  }

  const plan = planSteps(measurements, stationary);
  const initial = initialState(measurements);
  const weights = new Float64Array(measurements.length).fill(1);
  let states = smoothBackward(plan, runFilter(plan, measurements, weights, initial));

  for (let pass = 1; pass < ROBUST_PASSES; pass += 1) {
    updateRobustWeights(plan, measurements, states, weights);
    states = smoothBackward(plan, runFilter(plan, measurements, weights, initial));
  }

  const stepCount = plan.times.length;
  const distances = new Float64Array(stepCount);
  const speeds = new Float64Array(stepCount);
  for (let step = 0; step < stepCount; step += 1) {
    distances[step] = states[step * STATE_SIZE + DISTANCE_COMPONENT];
    speeds[step] = states[step * STATE_SIZE + SPEED_COMPONENT];
  }

  return { times: plan.times, distances, speeds };
}
