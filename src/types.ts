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

export interface ReplaySegment {
  sessionRef: SessionRef;
  drivers: DriverInfo[];
  timeRange: ReplayTimeRange;
  samples: Record<number, CarSample[]>;
  events: ReplayEvent[];
  circuit: CircuitModel;
  notes: string[];
}

export interface FrameCarState {
  driver: DriverInfo;
  sample: CarSample;
  heading: number;
}

export interface ReplayFrame {
  now: number;
  normalized: number;
  cars: FrameCarState[];
  activeEvent: ReplayEvent | null;
}

