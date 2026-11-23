import type { DriverInfo, RadioBroadcastState, ReplaySegment, TeamRadioClip, TeamRadioControls } from "../types";
import { publicUrl } from "../public-url";

type RadioJob = {
  clip: TeamRadioClip;
  automatic: boolean;
  buffer?: AudioBuffer;
  offset: number;
};

type ActiveRadio = {
  job: RadioJob;
  abort: AbortController;
  source: AudioBufferSourceNode | null;
  openingSource: AudioBufferSourceNode | null;
  startedAt: number;
};

export class RadioPlayer implements TeamRadioControls {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private openingBuffer: Promise<AudioBuffer | null> | null = null;
  private readonly levels = new Uint8Array(1024);
  private readonly clipsByDriver = new Map<number, TeamRadioClip[]>();
  private readonly drivers = new Map<number, DriverInfo>();
  private timeline: TeamRadioClip[] = [];
  private cursor = 0;
  private readonly queue: RadioJob[] = [];
  private active: ActiveRadio | null = null;
  private paused: RadioJob | null = null;
  private readonly failed = new Set<TeamRadioClip>();

  constructor(readonly jumpTo: (clip: TeamRadioClip) => void) {
    window.addEventListener("click", this.unlock, { capture: true });
    window.addEventListener("pagehide", () => this.stop());
  }

  readonly unlock = () => {
    try {
      if (!this.context) {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = this.levels.length * 2;
        analyser.smoothingTimeConstant = .65;
        analyser.connect(context.destination);
        this.context = context;
        this.analyser = analyser;
      }
      if (this.context.state !== "running") {
        void this.context.resume().then(() => this.playNext(), () => {});
      } else if (this.queue.length) queueMicrotask(() => this.playNext());
    } catch (error) {
      console.warn("No se pudo activar el audio de las radios.", error);
    }
  };

  getAudioContext() {
    return this.context;
  }

  setSegment(segment: ReplaySegment) {
    this.stop();
    this.cursor = 0;
    this.timeline = [...(segment.teamRadio ?? [])].sort((a, b) => a.time - b.time);
    this.clipsByDriver.clear();
    this.drivers.clear();
    this.failed.clear();
    for (const driver of segment.drivers) this.drivers.set(driver.driverNumber, driver);
    for (const clip of this.timeline) {
      const clips = this.clipsByDriver.get(clip.driverNumber) ?? [];
      clips.push(clip);
      this.clipsByDriver.set(clip.driverNumber, clips);
    }
  }

  advance(time: number) {
    while (this.cursor < this.timeline.length && this.timeline[this.cursor].time <= time) {
      const clip = this.timeline[this.cursor++];
      if (this.active?.job.clip !== clip) this.queue.push({ clip, automatic: true, offset: 0 });
    }
    this.playNext();
  }

  seek(time: number) {
    const cursor = this.timeline.findIndex(clip => clip.time >= time);
    this.cursor = cursor < 0 ? this.timeline.length : cursor;
    this.queue.length = 0;
    if (this.active?.job.automatic) this.detach();
  }

  getClips(driverNumber: number): readonly TeamRadioClip[] {
    return this.clipsByDriver.get(driverNumber) ?? [];
  }

  getAction(clip: TeamRadioClip) {
    if (this.active?.job.clip === clip) return "Pausar";
    return this.failed.has(clip) ? "Reintentar" : "Reproducir";
  }

  getBroadcast(): RadioBroadcastState | null {
    if (!this.active?.source || !this.analyser || this.context?.state !== "running") return null;
    const { clip } = this.active.job;
    this.analyser.getByteFrequencyData(this.levels);
    return { clip, driver: this.drivers.get(clip.driverNumber), levels: this.levels, pending: this.queue.length };
  }

  toggle(clip: TeamRadioClip) {
    if (this.active?.job.clip === clip) {
      this.paused = this.detach();
      if (this.paused) this.paused.automatic = false;
      this.playNext();
      return;
    }

    const interrupted = this.detach();
    if (interrupted?.automatic) this.queue.unshift(interrupted);
    const queued = this.queue.findIndex(job => job.clip === clip);
    if (queued >= 0) this.queue.splice(queued, 1);
    const job = this.paused?.clip === clip ? this.paused : { clip, automatic: false, offset: 0 };
    this.paused = null;
    this.unlock();
    if (this.context) this.start(job, this.context);
    else this.failed.add(clip);
  }

  stop(driverNumber?: number) {
    if (driverNumber === undefined) {
      this.queue.length = 0;
      this.paused = null;
      this.detach();
      return;
    }
    if (this.paused?.clip.driverNumber === driverNumber) this.paused = null;
    if (this.active?.job.clip.driverNumber === driverNumber && !this.active.job.automatic) {
      this.detach();
      this.playNext();
    }
  }

  private playNext() {
    if (this.active || this.context?.state !== "running") return;
    const job = this.queue.shift();
    if (job) this.start(job, this.context);
  }

  private start(job: RadioJob, context: AudioContext) {
    const active: ActiveRadio = { job, abort: new AbortController(), source: null, openingSource: null, startedAt: 0 };
    this.active = active;
    this.failed.delete(job.clip);
    void this.play(active, context);
  }

  private async play(active: ActiveRadio, context: AudioContext) {
    const { job, abort } = active;
    try {
      const openingPromise = this.loadOpening(context);
      if (!job.buffer) {
        const response = await fetch(publicUrl(job.clip.audioPath), { signal: abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        job.buffer = await context.decodeAudioData(await response.arrayBuffer());
      }
      const openingBuffer = await openingPromise;
      if (this.active !== active) return;

      const source = context.createBufferSource();
      source.buffer = job.buffer;
      source.connect(this.analyser!);
      source.onended = () => {
        source.disconnect();
        active.openingSource?.stop();
        active.openingSource?.disconnect();
        if (this.active !== active) return;
        this.active = null;
        this.playNext();
      };
      active.startedAt = context.currentTime;
      if (openingBuffer && job.offset < openingBuffer.duration) {
        const openingSource = context.createBufferSource();
        openingSource.buffer = openingBuffer;
        openingSource.connect(this.analyser!);
        openingSource.onended = () => openingSource.disconnect();
        openingSource.start(active.startedAt, job.offset);
        active.openingSource = openingSource;
      }
      source.start(active.startedAt, Math.min(job.offset, job.buffer.duration));
      active.source = source;
    } catch (error) {
      if (this.active !== active) return;
      this.active = null;
      this.failed.add(job.clip);
      console.warn(`No se pudo reproducir la radio ${job.clip.audioPath}.`, error);
      this.playNext();
    }
  }

  private loadOpening(context: AudioContext) {
    this.openingBuffer ??= fetch(`${import.meta.env.BASE_URL}audio/radio-opening.mp3`)
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return context.decodeAudioData(await response.arrayBuffer());
      })
      .catch(error => {
        this.openingBuffer = null;
        console.warn("No se pudo cargar el sonido de apertura de la radio.", error);
        return null;
      });
    return this.openingBuffer;
  }

  private detach() {
    const active = this.active;
    if (!active) return null;
    this.active = null;
    active.abort.abort();
    active.openingSource?.stop();
    active.openingSource?.disconnect();
    if (active.source) {
      active.job.offset += this.context!.currentTime - active.startedAt;
      active.source.onended = null;
      active.source.stop();
      active.source.disconnect();
    }
    return active.job;
  }
}
