import { ReplayController } from "../replay/replay-controller";
import type { ReplayFrame } from "../types";

export class ReplayApp {
  private controller: ReplayController | null = null;
  playing = true;
  speed = 1;
  currentTime = 0;

  setController(controller: ReplayController) {
    this.controller = controller;
    this.currentTime = 0;
    this.playing = true;
  }

  getController() {
    return this.controller;
  }

  tick(deltaMs: number): ReplayFrame | null {
    if (!this.controller) {
      return null;
    }

    if (this.playing) {
      this.currentTime += deltaMs * this.speed;
      if (this.currentTime >= this.controller.getDuration()) {
        this.currentTime = this.controller.getDuration();
        this.playing = false;
      }
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
    if (this.controller) this.currentTime = this.controller.getDuration() * Math.max(0, Math.min(1, ratio));
  }

  reset(): ReplayFrame | null {
    this.currentTime = 0;
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
