export interface SessionRef {
  meetingKey: number;
  sessionKey: number;
  meetingName: string;
  circuitShortName: string;
  circuitInfoUrl: string | null;
  dateStart: string;
  dateEnd: string;
  year: number;
}

export interface DriverInfo {
  driverNumber: number;
  broadcastName: string;
  fullName: string;
  acronym: string;
  teamName: string;
  teamColor: string;
  headshotUrl: string;
}

export interface TrackPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface CircuitCorner {
  number: number;
  angle: number;
  x: number;
  y: number;
}

export interface CircuitModel {
  centerline: TrackPoint3D[];
  corners: CircuitCorner[];
  rotation: number;
}

export interface CarSample {
  t: number;
  isoTime: string;
  driverNumber: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  throttle: number;
  brake: number;
  rpm: number;
  gear: number;
  drs: number;
  position: number | null;
  gapToLeader: number | null;
  intervalToAhead: number | null;
  compound: string | null;
  tyreAge: number | null;
}

export interface ReplayEvent {
  type: "overtake";
  startTime: number;
  endTime: number;
  drivers: number[];
  label: string;
  metadata?: Record<string, unknown>;
}

export interface ReplayTimeRange {
  start: number;
  end: number;
  startIso: string;
  endIso: string;
}

export interface RaceControlEvent {
  t: number;
  isoTime: string;
  category: string;
  flag: string | null;
  message: string;
  scope: string | null;
  lapNumber: number | null;
  driverNumber: number | null;
}

export interface StartingGridSlot {
  driverNumber: number;
  position: number;
}

export type TrackPhase =
  | "pre_session"
  | "formation"
  | "standing_start"
  | "racing"
  | "yellow"
  | "safety_car"
  | "red"
  | "finished";

export interface TrackStatusInterval {
  start: number;
  end: number;
  phase: TrackPhase;
  flag: string | null;
}

export interface ReplaySegment {
  sessionRef: SessionRef;
  drivers: DriverInfo[];
  timeRange: ReplayTimeRange;
  samples: Record<number, CarSample[]>;
  events: ReplayEvent[];
  raceControl: RaceControlEvent[];
  startingGrid: StartingGridSlot[];
  trackStatus: TrackStatusInterval[];
  circuit: CircuitModel;
  notes: string[];
}

export interface FrameCarState {
  driver: DriverInfo;
  sample: CarSample;
  heading: number;
  pitch: number;
}

export interface ReplayFrame {
  now: number;
  normalized: number;
  cars: FrameCarState[];
  activeEvent: ReplayEvent | null;
  trackStatus: TrackStatusInterval | null;
}

