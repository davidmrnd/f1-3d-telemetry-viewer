import workletUrl from "./engine-processor.ts?worker&url";
import type { CarSample } from "../types";
import { getEngineTarget, type EngineCommand } from "./engine-telemetry";

export class EngineAudio {
  private unavailable = false;
  private volume = .5;
  private ducked = false;
  private graph: { source: AudioWorkletNode; gain: GainNode } | null = null;
  private loading: Promise<void> | null = null;
  private previous: { driver: number; gear: number } | null = null;

  constructor(
    private readonly getContext: () => AudioContext | null,
    private readonly onError: () => void,
  ) {}

  setVolume(volume: number) {
    this.volume = volume;
    this.updateGain(.04);
    if (volume === 0) this.silence();
  }

  update(sample: CarSample | undefined, radioPlaying: boolean) {
    const context = this.getContext();
    if (this.unavailable || this.volume === 0 || !sample || context?.state !== "running") {
      this.silence();
      return;
    }

    if (this.ducked !== radioPlaying) {
      this.ducked = radioPlaying;
      this.updateGain(radioPlaying ? .045 : .19);
    }
    if (!this.graph) {
      this.loading ??= this.connect(context).finally(() => { this.loading = null; });
      return;
    }

    const { gear, ...target } = getEngineTarget(sample);
    const previous = this.previous;
    const reset = previous?.driver !== sample.driverNumber;
    const shift = previous && !reset ? Math.sign(gear - previous.gear) : 0;
    this.send({ ...target, shift, reset });
    this.previous = { driver: sample.driverNumber, gear };
  }

  silence() {
    if (!this.previous) return;
    this.previous = null;
    this.send(null);
  }

  private send(command: EngineCommand) {
    this.graph?.source.port.postMessage(command);
  }

  private updateGain(seconds: number) {
    const gain = this.graph?.gain;
    gain?.gain.setTargetAtTime(this.volume * (this.ducked ? .3 : 1), gain.context.currentTime, seconds);
  }

  private async connect(context: AudioContext) {
    try {
      await context.audioWorklet.addModule(workletUrl);
      const source = new AudioWorkletNode(context, "f1-engine", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const gain = context.createGain();
      gain.gain.value = this.volume * (this.ducked ? .3 : 1);
      source.connect(gain).connect(context.destination);
      this.graph = { source, gain };
      source.onprocessorerror = () => this.fail(new Error("Error en el procesador de audio."));
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown) {
    this.unavailable = true;
    this.silence();
    this.graph?.source.disconnect();
    this.graph?.source.port.close();
    this.graph?.gain.disconnect();
    this.graph = null;
    console.warn("No se pudo activar el sonido del motor.", error);
    this.onError();
  }
}
