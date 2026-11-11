import type { EngineAudioView } from "../types";

const AUDIBLE_RANGE = 205;
const MAX_LEVEL = 0.2;
const MAX_VOICES = 4;
const RETENTION_BIAS = 1.1;
const FADE_OUT = 0.24;
const CLIP_FADE = 0.45;
const CLIPS = ["crowd1.mp3", "crowd2.mp3", "crowd3.mp3"];

interface CrowdVoice {
  filter: BiquadFilterNode;
  panner: PannerNode;
  gain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  clip: { buffer: AudioBuffer; endsAt: number } | null;
  retiring: boolean;
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

    const selected = view.grandstands.flatMap((position, index) => {
      const distance = Math.hypot(position.x, position.y, position.z);
      const weight = Math.max(0, 1 - distance / AUDIBLE_RANGE) ** 2;
      if (!weight) return [];
      const voice = this.voices.get(index);
      const score = voice && !voice.retiring ? weight * RETENTION_BIAS : weight;
      return [{ index, position, weight, score }];
    }).sort((a, b) => b.score - a.score).slice(0, MAX_VOICES);
    const totalWeight = selected.reduce((sum, { weight }) => sum + weight, 0);
    const level = MAX_LEVEL * volume * (radioPlaying ? 0.28 : 1)
      * (view.perspective === "cockpit" ? 0.45 : 1) / Math.max(1, totalWeight);
    const now = context.currentTime;
    for (const [index, voice] of this.voices) {
      if (!selected.some(candidate => candidate.index === index)) this.stop(index, voice);
    }
    for (const { index, position: { x, y, z }, weight } of selected) {
      let voice = this.voices.get(index);
      if (voice?.retiring) continue;
      if (!voice) {
        if (this.voices.size >= MAX_VOICES) continue;
        voice = this.start(context, index, x, y, z);
      }
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
    const voice: CrowdVoice = { filter, panner, gain, sources: new Set(), clip: null, retiring: false };
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
      if (!voice.sources.size && voice.retiring) this.disconnect(index, voice);
    };
    source.start(startsAt, offset);
  }

  private stop(index: number, voice: CrowdVoice) {
    if (voice.retiring) return;
    voice.retiring = true;
    const { gain, sources } = voice;
    if (!sources.size) {
      this.disconnect(index, voice);
      return;
    }
    const now = gain.context.currentTime;
    gain.gain.setTargetAtTime(0, now, FADE_OUT / 5);
    for (const source of sources) source.stop(now + FADE_OUT);
  }

  private disconnect(index: number, { filter, panner, gain }: CrowdVoice) {
    filter.disconnect();
    panner.disconnect();
    gain.disconnect();
    this.voices.delete(index);
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
