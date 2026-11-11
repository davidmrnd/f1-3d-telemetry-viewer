export interface SessionRef {
  meetingKey: number;
  sessionKey: number;
  totalLaps?: number | null;
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
  pitLane?: { centerline: TrackPoint3D[]; width: number } | null;
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

export type RaceMilestoneKind = "finish" | "overtake" | "off_track" | "pit_entry" | "retirement";

export interface RaceMilestone {
  id: string;
  kind: RaceMilestoneKind;
  time: number;
  drivers: number[];
  label: string;
  detail: string;
  approximate: boolean;
}

export interface RaceMilestoneControls {
  getMilestones(): readonly RaceMilestone[];
  jumpTo(milestone: RaceMilestone, driverNumber?: number): void;
}

export interface PitStop {
  driverNumber: number;
  lapNumber: number;
  entryTime: number;
  exitTime: number;
  stopStart?: number | null;
  stopEnd?: number | null;
}

export interface Retirement {
  driverNumber: number;
  t: number;
  status: "dnf" | "dns";
}

export interface TyreStint {
  driverNumber: number;
  startLap: number;
  lapTimes: number[];
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

export interface TeamRadioClip {
  driverNumber: number;
  time: number;
  audioPath: string;
}

export interface RadioBroadcastState {
  clip: TeamRadioClip;
  driver: DriverInfo | undefined;
  levels: Uint8Array;
  pending: number;
}

export interface TeamRadioControls {
  getClips(driverNumber: number): readonly TeamRadioClip[];
  getAction(clip: TeamRadioClip): string;
  toggle(clip: TeamRadioClip): void;
  jumpTo(clip: TeamRadioClip): void;
  stop(driverNumber?: number): void;
  unlock(): void;
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
  teamRadio?: TeamRadioClip[];
  pitStops?: PitStop[];
  retirements?: Retirement[];
  tyreStints?: TyreStint[];
  circuit: CircuitModel;
  notes: string[];
}

export interface FrameCarState {
  driver: DriverInfo;
  sample: CarSample;
  heading: number;
  pitch: number;
  retirement?: Retirement["status"];
}

export interface EngineAudioView {
  perspective: "trackside" | "free" | "cockpit" | "tabletop";
  subject: number | null;
  sources: readonly { sample: CarSample; position: TrackPoint3D }[];
  grandstands: readonly TrackPoint3D[];
}

export interface ReplayFrame {
  now: number;
  normalized: number;
  cars: FrameCarState[];
  activeEvent: ReplayEvent | null;
  trackStatus: TrackStatusInterval | null;
}

