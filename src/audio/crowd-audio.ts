import type { EngineAudioView } from "../types";

const AUDIBLE_RANGE = 205;
const MAX_LEVEL = 0.2;
const FADE_OUT = 0.24;
const CLIP_FADE = 0.45;
const CLIPS = ["crowd1.mp3", "crowd2.mp3", "crowd3.mp3"];

interface CrowdVoice {
  filter: BiquadFilterNode;
  panner: PannerNode;
  gain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  clip: { buffer: AudioBuffer; endsAt: number } | null;
}

export class CrowdAudio {
  private buffers: AudioBuffer[] | null = null;
  private loading: Promise<void> | null = null;
  private readonly voices = new Map<number, CrowdVoice>();

  update(context: AudioContext, view: EngineAudioView | null, volume: number, radioPlaying: boolean) {
    if (!view?.grandstands.length || volume === 0) {
      this.silence();
      return;
    }
    if (!this.buffers) {
      this.loading ??= this.load(context);
      return;
    }
    if (!this.buffers.length) return;

    const weights = view.grandstands.map(({ x, y, z }) => {
      const distance = Math.hypot(x, y, z);
      return Math.max(0, 1 - distance / AUDIBLE_RANGE) ** 2;
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const level = MAX_LEVEL * volume * (radioPlaying ? 0.28 : 1)
      * (view.perspective === "cockpit" ? 0.45 : 1) / Math.max(1, totalWeight);
    const now = context.currentTime;
    for (const [index, voice] of this.voices) {
      if (!weights[index]) this.stop(index, voice);
    }
    for (const [index, { x, y, z }] of view.grandstands.entries()) {
      const weight = weights[index];
      if (!weight) continue;
      const voice = this.voices.get(index) ?? this.start(context, index, x, y, z);
      if (!voice.clip || now + 0.12 >= voice.clip.endsAt - CLIP_FADE) {
        this.playClip(context, index, voice, this.buffers);
      }
      voice.panner.positionX.setTargetAtTime(x, now, 0.04);
      voice.panner.positionY.setTargetAtTime(y, now, 0.04);
      voice.panner.positionZ.setTargetAtTime(z, now, 0.04);
      voice.gain.gain.setTargetAtTime(level * weight, now, 0.16);
    }
  }

  silence() {
    for (const [index, voice] of this.voices) this.stop(index, voice);
  }

  private start(context: AudioContext, index: number, x: number, y: number, z: number) {
    const filter = new BiquadFilterNode(context, { type: "lowpass", frequency: 2100, Q: 0 });
    const panner = new PannerNode(context, {
      panningModel: "HRTF", rolloffFactor: 0, positionX: x, positionY: y, positionZ: z,
    });
    const gain = new GainNode(context, { gain: 0 });
    filter.connect(panner).connect(gain).connect(context.destination);
    const voice: CrowdVoice = { filter, panner, gain, sources: new Set(), clip: null };
    this.voices.set(index, voice);
    return voice;
  }

  private playClip(context: AudioContext, index: number, voice: CrowdVoice, buffers: AudioBuffer[]) {
    const previous = voice.clip;
    const alternatives = buffers.length > 1 ? buffers.filter(buffer => buffer !== previous?.buffer) : buffers;
    const buffer = alternatives[Math.floor(Math.random() * alternatives.length)];
    const offset = previous ? 0 : Math.random() * Math.max(0, buffer.duration - CLIP_FADE * 2);
    const startsAt = Math.max(context.currentTime, (previous?.endsAt ?? 0) - CLIP_FADE);
    const endsAt = startsAt + buffer.duration - offset;
    const fade = Math.min(CLIP_FADE, (endsAt - startsAt) / 2);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const envelope = new GainNode(context, { gain: 0 });
    envelope.gain.setValueAtTime(0, startsAt);
    envelope.gain.linearRampToValueAtTime(1, startsAt + fade);
    envelope.gain.setValueAtTime(1, endsAt - fade);
    envelope.gain.linearRampToValueAtTime(0, endsAt);
    source.connect(envelope).connect(voice.filter);
    voice.sources.add(source);
    voice.clip = { buffer, endsAt };
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      voice.sources.delete(source);
      if (!voice.sources.size && this.voices.get(index) !== voice) {
        voice.filter.disconnect();
        voice.panner.disconnect();
        voice.gain.disconnect();
      }
    };
    source.start(startsAt, offset);
  }

  private stop(index: number, { filter, panner, gain, sources }: CrowdVoice) {
    this.voices.delete(index);
    if (!sources.size) {
      filter.disconnect();
      panner.disconnect();
      gain.disconnect();
      return;
    }
    const now = gain.context.currentTime;
    gain.gain.setTargetAtTime(0, now, FADE_OUT / 5);
    for (const source of sources) source.stop(now + FADE_OUT);
  }

  private async load(context: AudioContext) {
    const results = await Promise.allSettled(CLIPS.map(async clip => {
      const response = await fetch(`${import.meta.env.BASE_URL}audio/${clip}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return context.decodeAudioData(await response.arrayBuffer());
    }));
    this.buffers = results.flatMap((result, index) => {
      if (result.status === "fulfilled") return [result.value];
      console.warn(`No se pudo cargar el sonido del público (${CLIPS[index]}).`, result.reason);
      return [];
    });
  }
}
