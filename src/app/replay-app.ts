import { ReplayController } from "../replay/replay-controller";
import type { ReplayFrame } from "../types";

export class ReplayApp {
  private controller: ReplayController | null = null;
  playing = true;
  speed = 1;
  currentTime = 0;

  constructor(
    private readonly radio: { advance(time: number): void; seek(time: number): void },
    private readonly onDiscontinuity: () => void,
  ) {}

  setController(controller: ReplayController | null) {
    this.onDiscontinuity();
    this.controller = controller;
    this.currentTime = 0;
    this.playing = controller !== null;
  }

  getController() {
    return this.controller;
  }

  tick(deltaMs: number): ReplayFrame | null {
    if (!this.controller) {
      return null;
    }

    if (this.playing) {
      const previous = this.currentTime;
      this.currentTime += Math.max(0, deltaMs) * this.speed;
      if (this.currentTime >= this.controller.getDuration()) {
        this.currentTime = this.controller.getDuration();
        this.playing = false;
      }
      if (this.currentTime > previous) this.radio.advance(this.currentTime);
    }

    return this.controller.getFrame(this.currentTime);
  }

  togglePlay(): boolean {
    this.playing = !this.playing;
    return this.playing;
  }

  seek(ratio: number): ReplayFrame | null {
    if (!this.controller) {
      return null;
    }
    this.setTimeRatio(ratio);
    return this.controller.getFrame(this.currentTime);
  }

  setTimeRatio(ratio: number): void {
    if (!this.controller) return;
    this.onDiscontinuity();
    this.currentTime = this.controller.getDuration() * Math.max(0, Math.min(1, ratio));
    this.radio.seek(this.currentTime);
  }

  reset(): ReplayFrame | null {
    this.setTimeRatio(0);
    this.playing = false;
    if (!this.controller) {
      return null;
    }
    return this.controller.getFrame(0);
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }
}
