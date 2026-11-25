import { angleDelta, carMotion, interpolatePose, motionsConflict, type CarMotion, type TrafficPose } from "./car-footprint";

const LANE_SPACING = 2.55;
const MAX_LANE_SHIFT = 5;
const LOOKAHEAD_SECONDS = 1;
export const SIDE_BY_SIDE_DISTANCE = 6.7;
const MAX_SIDE_SPEED = 3.8;
const MAX_SPEED = 105;

export interface TrafficTarget extends TrafficPose {
  id: number;
}

type LaneLimits = (pose: TrafficPose) => readonly [number, number];
export type TrafficPace = "adaptive" | "steady";
type RouteKnot = { distance: number; pose: TrafficPose };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shift(pose: TrafficPose, along: number, side: number): TrafficPose {
  const fx = Math.cos(pose.heading), fz = Math.sin(pose.heading);
  return {
    ...pose,
    x: pose.x + fx * along - fz * side,
    y: pose.y + Math.sin(pose.pitch) * along,
    z: pose.z + fz * along + fx * side,
  };
}

class CarRoute {
  private readonly knots: RouteKnot[];

  constructor(pose: TrafficPose) {
    this.knots = [{ distance: 0, pose }];
  }

  get end(): number {
    return this.knots.at(-1)!.distance;
  }

  append(pose: TrafficPose): number {
    const previous = this.knots.at(-1)!;
    const travel = Math.hypot(pose.x - previous.pose.x, pose.z - previous.pose.z);
    if (travel < 1e-5) previous.pose = pose;
    else this.knots.push({ distance: previous.distance + travel, pose });
    return travel;
  }

  sample(distance: number): TrafficPose {
    const first = this.knots[0], last = this.knots.at(-1)!;
    if (distance <= first.distance) return shift(first.pose, distance - first.distance, 0);
    if (distance >= last.distance) return last.pose;
    const index = this.indexAt(distance);
    const a = this.knots[index], b = this.knots[index + 1];
    return interpolatePose(a.pose, b.pose, (distance - a.distance) / (b.distance - a.distance));
  }

  discardBefore(distance: number) {
    if (this.knots.length <= 256 || this.knots[128].distance >= distance) return;
    this.knots.splice(0, this.indexAt(distance) - 1);
  }

  private indexAt(distance: number): number {
    let lo = 0, hi = this.knots.length - 1;
    while (hi - lo > 1) {
      const mid = (hi + lo) >> 1;
      if (this.knots[mid].distance <= distance) lo = mid;
      else hi = mid;
    }
    return lo;
  }
}

interface DriverMotion {
  route: CarRoute;
  progress: number;
  lane: number;
  motion: CarMotion;
  fx: number;
  fz: number;
  advance: number;
  speed: number;
  blockedFor: number;
  visited: boolean;
}

export class TrafficPlanner {
  private readonly drivers = new Map<number, DriverMotion>();
  private readonly maxLaneShift: number;

  constructor(
    private readonly getLaneLimits: LaneLimits = () => [-MAX_LANE_SHIFT, MAX_LANE_SHIFT],
    private readonly pace: TrafficPace = "adaptive",
  ) {
    this.maxLaneShift = pace === "steady" ? 4 : MAX_LANE_SHIFT;
  }

  private laneCandidates([left, right]: readonly [number, number]): number[] {
    const limit = this.maxLaneShift;
    return [...new Set([0, -LANE_SPACING, LANE_SPACING, -limit, limit]
      .map(side => clamp(side, Math.min(0, left), Math.max(0, right))))];
  }

  step(targets: TrafficTarget[], dt: number): Map<number, TrafficPose> {
    const entries = new Map<number, DriverMotion>();
    for (const target of targets) {
      let entry = this.drivers.get(target.id);
      if (entry) {
        const from = entry.motion.to;
        const travel = entry.route.append(target);
        const remaining = entry.route.end - entry.progress;
        const catchUp = this.pace === "steady" ? 8 : clamp(remaining * 0.65, 5, 28);
        entry.advance = Math.min(remaining, travel + catchUp * dt, MAX_SPEED * dt);
        entry.speed = dt > 0 ? travel / dt : 0;
        entry.motion = carMotion(from, from);
        const forward = entry.route.sample(entry.progress).heading;
        entry.fx = Math.cos(forward);
        entry.fz = Math.sin(forward);
        entry.visited = false;
      } else {
        entry = this.placeInitial(target, this.drivers.values());
        this.drivers.set(target.id, entry);
      }
      entries.set(target.id, entry);
    }
    for (const id of this.drivers.keys()) if (!entries.has(id)) this.drivers.delete(id);

    const pack = [...entries.values()];
    const visit = (entry: DriverMotion) => {
      if (entry.visited) return;
      entry.visited = true;
      for (const other of pack) {
        if (other.visited || entry.fx * other.fx + entry.fz * other.fz < 0.6) continue;
        const dx = other.motion.from.x - entry.motion.from.x, dz = other.motion.from.z - entry.motion.from.z;
        const along = dx * entry.fx + dz * entry.fz;
        if (along > 0.1 && along < 18 && Math.abs(dz * entry.fx - dx * entry.fz) < 5) visit(other);
      }
      this.plan(entry, pack, dt);
      entry.route.discardBefore(entry.progress - 2);
    };
    if (dt > 0) for (const entry of pack) visit(entry);
    return new Map([...entries].map(([id, entry]) => [id, entry.motion.to]));
  }

  private placeInitial(target: TrafficTarget, others: Iterable<DriverMotion>): DriverMotion {
    const occupied = [...others].map(other => other.motion);
    const lanes = this.laneCandidates(this.getLaneLimits(target));
    for (let back = 0; ; back += 1.5) {
      for (const lane of lanes) {
        const pose = shift(target, -back, lane);
        const motion = carMotion(pose, pose);
        if (occupied.some(other => motionsConflict(motion, other))) continue;
        return {
          route: new CarRoute(target), progress: -back, lane, motion,
          fx: motion.ax, fz: motion.az, speed: 0, advance: 0, blockedFor: 0, visited: false,
        };
      }
    }
  }

  private plan(entry: DriverMotion, pack: DriverMotion[], dt: number) {
    const { route, fx, fz, progress, advance, speed } = entry;
    const from = entry.motion.from;
    const next = route.sample(progress + advance);
    const clear = (motion: CarMotion) => pack.every(other => other === entry || !motionsConflict(motion, other.motion));
    const threats: { side: number; weight: number }[] = [];
    if (speed > 1 || advance > dt) {
      for (const other of pack) {
        if (other === entry || Math.abs(from.y - other.motion.from.y) > 2) continue;
        const alignment = fx * other.fx + fz * other.fz;
        if (this.pace === "steady" && alignment < 0.7) continue;
        const obstacle = other.motion.to;
        const dx = obstacle.x - next.x, dz = obstacle.z - next.z;
        const along = dx * fx + dz * fz;
        const side = dz * fx - dx * fz;
        if (Math.abs(side) > 8 || along < -SIDE_BY_SIDE_DISTANCE || along > 35) continue;
        const closing = speed - other.speed * alignment;
        const seconds = along <= SIDE_BY_SIDE_DISTANCE ? 0 : (along - SIDE_BY_SIDE_DISTANCE) / Math.max(0.01, closing);
        if (seconds < LOOKAHEAD_SECONDS) threats.push({ side, weight: 1 - seconds / LOOKAHEAD_SECONDS });
      }
    }

    const tryPose = (base: TrafficPose, lane: number, nextProgress: number, travel: number, side: number) => {
      const pose = shift(base, 0, lane);
      const steering = clamp(Math.atan2(side, Math.max(6 * dt, Math.abs(travel))), -0.09, 0.09);
      pose.heading = from.heading + clamp(angleDelta(from.heading, base.heading + steering), -4 * dt, 4 * dt);
      const turn = pose.heading - from.heading;
      for (const fraction of turn === 0 ? [1] : [1, 0.25, 0]) {
        pose.heading = from.heading + turn * fraction;
        const motion = carMotion(from, pose);
        if (!clear(motion)) continue;
        entry.motion = motion;
        entry.progress = nextProgress;
        entry.lane = lane;
        entry.blockedFor = advance > dt && travel < 2 * dt ? entry.blockedFor + dt : 0;
        return true;
      }
      return false;
    };
    const tryLane = (base: TrafficPose, targetLane: number, travel: number) => {
      const limit = MAX_SIDE_SPEED * dt;
      const side = clamp((targetLane - entry.lane) * dt / 0.26, -limit, limit);
      if (travel <= 0 && Math.abs(side) < 0.002 && advance > dt) return false;
      return tryPose(base, entry.lane + side, progress + travel, travel, side);
    };

    if (!threats.some(threat => Math.abs(threat.side) < LANE_SPACING) && tryLane(next, 0, advance)) return;
    const [minLane, maxLane] = this.getLaneLimits(next);
    const limit = this.maxLaneShift;
    const left = clamp(minLane, -limit, 0), right = clamp(maxLane, 0, limit);
    const lanes = [...this.laneCandidates([left, right]), entry.lane];
    for (const threat of threats) {
      lanes.push(clamp(threat.side - LANE_SPACING, left, right), clamp(threat.side + LANE_SPACING, left, right));
    }
    const score = (lane: number) => Math.abs(lane) * 0.45 + Math.abs(lane - entry.lane) * 0.85 +
      threats.reduce((cost, threat) => cost + Math.max(0, LANE_SPACING - Math.abs(lane - threat.side)) * 3 * threat.weight, 0);
    const options = [...new Set(lanes)].map(lane => ({ lane, cost: score(lane) })).sort((a, b) => a.cost - b.cost);
    if (this.pace === "adaptive" && entry.blockedFor > 0.35) {
      const reach = Math.min(advance, 1.5);
      const end = Math.min(route.end, progress + 80);
      for (let distance = end; distance > progress + advance + 4; distance -= 0.7) {
        const base = route.sample(distance);
        if (Math.abs(base.y - from.y) > 0.35 || Math.hypot(base.x - from.x, base.z - from.z) > limit + reach ||
          Math.abs(angleDelta(from.heading, base.heading)) > 0.65) continue;
        const dx = base.x - from.x, dz = base.z - from.z;
        const x = Math.cos(base.heading), z = Math.sin(base.heading);
        const travel = dx * x + dz * z;
        if (travel < 0.05 || travel > reach) continue;
        const lane = dx * z - dz * x;
        const [min, max] = this.getLaneLimits(base);
        if (lane < Math.max(-limit, Math.min(0, min)) || lane > Math.min(limit, Math.max(0, max))) continue;
        if (tryPose(base, lane, distance, travel, 0)) return;
      }
    }
    for (const fraction of [1, 0.75, 0.5, 0.25, 0.125, 0.0625, 0]) {
      const travel = advance * fraction;
      const base = fraction === 1 ? next : route.sample(progress + travel);
      for (const { lane } of options) if (tryLane(base, lane, travel)) return;
      if (entry.blockedFor > 0.15 && travel <= 2 * dt) {
        const back = -1.2 * dt;
        const base = route.sample(progress + back);
        for (const { lane } of options) {
          if (Math.abs(lane - entry.lane) >= 0.3 && tryLane(base, lane, back)) return;
        }
      }
    }
    if (advance > dt) entry.blockedFor += dt;
  }
}
