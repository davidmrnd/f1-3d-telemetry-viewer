import workletUrl from "./engine-processor.ts?worker&url";
import type { EngineAudioView } from "../types";
import { getEngineTarget } from "./engine-telemetry";

const VOICE_COUNT = 3;
const VIEW_MIX = {
  trackside: { range: 260, reference: 18, cutoff: 8200, absorption: 55 },
  free: { range: 220, reference: 14, cutoff: 7600, absorption: 42 },
  cockpit: { range: 120, reference: 16, cutoff: 3000, absorption: 38 },
  tabletop: { range: 12, reference: 2.4, cutoff: 5500, absorption: 3 },
};

interface EngineVoice {
  source: AudioWorkletNode;
  lowpass: BiquadFilterNode;
  panner: PannerNode;
  gain: GainNode;
  previous: { driver: number; gear: number } | null;
}

function createVoice(context: AudioContext, mix: AudioNode): EngineVoice {
  const source = new AudioWorkletNode(context, "f1-engine", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.Q.value = 0;
  const panner = new PannerNode(context, { panningModel: "HRTF", rolloffFactor: 0, positionZ: -1 });
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(lowpass).connect(panner).connect(gain).connect(mix);
  return { source, lowpass, panner, gain, previous: null };
}

function releaseVoice(voice: EngineVoice) {
  if (!voice.previous) return;
  voice.previous = null;
  voice.source.port.postMessage(null);
}

export class EngineAudio {
  private unavailable = false;
  private volume = .5;
  private ducked = false;
  private graph: { voices: EngineVoice[]; compressor: DynamicsCompressorNode; gain: GainNode } | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly getContext: () => AudioContext | null,
    private readonly onError: () => void,
  ) {}

  setVolume(volume: number) {
    this.volume = volume;
    this.updateGain(.04);
    if (volume === 0) this.silence();
  }

  update(getView: () => EngineAudioView | null, radioPlaying: boolean) {
    const context = this.getContext();
    if (this.unavailable || this.volume === 0 || context?.state !== "running") {
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

    const view = getView();
    if (view) this.updateVoices(view, this.graph.voices, context.currentTime);
    else this.silence();
  }

  silence() {
    this.graph?.voices.forEach(releaseVoice);
  }

  private updateVoices(view: EngineAudioView, voices: EngineVoice[], now: number) {
    const mix = VIEW_MIX[view.perspective];
    const cockpit = view.perspective === "cockpit";
    const candidates = view.sources.flatMap(({ sample, position }) => {
      const driver = sample.driverNumber;
      const distance = Math.hypot(position.x, position.y, position.z);
      const subject = driver === view.subject;
      const ownCar = cockpit && subject;
      if (!Number.isFinite(distance) || (distance >= mix.range && !ownCar)) return [];
      const retained = voices.some(voice => voice.previous?.driver === driver);
      const score = ownCar ? -1 : distance * (retained ? .8 : 1) * (subject ? .75 : 1);
      return [{ sample, position, distance, ownCar, score }];
    }).sort((a, b) => a.score - b.score).slice(0, VOICE_COUNT);

    for (const voice of voices) {
      if (!candidates.some(({ sample }) => sample.driverNumber === voice.previous?.driver)) releaseVoice(voice);
    }

    for (const { sample, position, distance, ownCar } of candidates) {
      const driver = sample.driverNumber;
      const voice = voices.find(item => item.previous?.driver === driver) ?? voices.find(item => item.previous === null);
      if (!voice) continue;

      const { gear, ...target } = getEngineTarget(sample);
      const shift = voice.previous ? Math.sign(gear - voice.previous.gear) : 0;
      voice.source.port.postMessage({ ...target, shift, reset: !voice.previous });
      voice.previous = { driver, gear };

      const { panner, lowpass, gain } = voice;
      panner.positionX.setTargetAtTime(position.x, now, .025);
      panner.positionY.setTargetAtTime(position.y, now, .025);
      panner.positionZ.setTargetAtTime(position.z, now, .025);
      const normalized = distance / mix.reference;
      const distanceGain = Math.max(0, 1 - distance / mix.range) / (1 + normalized * normalized);
      const level = ownCar ? .95 : distanceGain * (cockpit ? .48 : .9);
      const cutoff = ownCar ? 4700 : mix.cutoff / (1 + distance / mix.absorption);
      gain.gain.setTargetAtTime(level, now, .045);
      lowpass.frequency.setTargetAtTime(Math.max(480, cutoff), now, .045);
    }
  }

  private updateGain(seconds: number) {
    const gain = this.graph?.gain;
    gain?.gain.setTargetAtTime(this.volume * (this.ducked ? .3 : 1), gain.context.currentTime, seconds);
  }

  private async connect(context: AudioContext) {
    try {
      await context.audioWorklet.addModule(workletUrl);
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 12;
      compressor.ratio.value = 3.2;
      compressor.attack.value = .006;
      compressor.release.value = .18;
      const gain = context.createGain();
      gain.gain.value = this.volume * (this.ducked ? .3 : 1);
      compressor.connect(gain).connect(context.destination);
      const voices: EngineVoice[] = [];
      this.graph = { voices, compressor, gain };
      for (let i = 0; i < VOICE_COUNT; i++) {
        const voice = createVoice(context, compressor);
        voice.source.onprocessorerror = () => this.fail(new Error("Error en el procesador de audio."));
        voices.push(voice);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown) {
    if (this.unavailable) return;
    this.unavailable = true;
    this.silence();
    if (this.graph) {
      for (const { source, lowpass, panner, gain } of this.graph.voices) {
        source.disconnect();
        source.port.close();
        lowpass.disconnect();
        panner.disconnect();
        gain.disconnect();
      }
      this.graph.compressor.disconnect();
      this.graph.gain.disconnect();
    }
    this.graph = null;
    console.warn("No se pudo activar el sonido del motor.", error);
    this.onError();
  }
}
