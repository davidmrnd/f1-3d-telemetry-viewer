import { CrowdAudio } from "../audio/crowd-audio";
import { EngineAudio } from "../audio/engine-audio";
import type { EngineAudioView } from "../types";
import { mustQuery } from "./dom";
import type { RadioPlayer } from "./radio-player";

const SOUND_KEY = "f1-vr-replay:circuit-volume";

function soundPreference(defaultVolume: number) {
  const fallback = { current: defaultVolume, lastAudible: defaultVolume };
  try {
    const stored = localStorage.getItem(SOUND_KEY);
    if (!stored) return fallback;
    const value = JSON.parse(stored) as Partial<typeof fallback> | null;
    const current = value?.current;
    const lastAudible = value?.lastAudible;
    return {
      current: typeof current === "number" && current >= 0 && current <= 100 ? current : defaultVolume,
      lastAudible: typeof lastAudible === "number" && lastAudible > 0 && lastAudible <= 100 ? lastAudible : defaultVolume,
    };
  } catch {
    return fallback;
  }
}

export function bindEngineAudio(radio: RadioPlayer) {
  const mute = mustQuery<HTMLButtonElement>("#engine-mute");
  const icon = mustQuery<SVGUseElement>("#engine-mute use");
  const volume = mustQuery<HTMLInputElement>("#engine-volume");
  const readout = mustQuery<HTMLOutputElement>("#engine-volume-readout");
  const status = mustQuery<HTMLElement>("#engine-status");
  const crowd = new CrowdAudio();
  const engine = new EngineAudio(() => radio.getAudioContext(), () => {
    status.hidden = false;
  });
  const silence = () => {
    engine.silence();
    crowd.silence();
  };

  const preference = soundPreference(Number(volume.defaultValue));
  volume.value = String(preference.current);
  let lastVolume = preference.lastAudible;
  const syncVolume = (persist: boolean) => {
    const value = volume.valueAsNumber;
    const muted = value === 0;
    if (!muted) lastVolume = value;
    engine.setVolume(value / 100);
    if (muted) crowd.silence();
    const label = muted ? "Restaurar sonido del circuito" : "Silenciar circuito";
    mute.setAttribute("aria-label", label);
    mute.setAttribute("aria-pressed", String(muted));
    mute.title = label;
    icon.setAttribute("href", muted ? "#i-volume-off" : "#i-volume");
    readout.value = `${value} %`;
    volume.setAttribute("aria-valuetext", muted ? "Silenciado" : readout.value);
    if (persist) {
      try { localStorage.setItem(SOUND_KEY, JSON.stringify({ current: value, lastAudible: lastVolume })); }
      catch {}
    }
  };
  mute.addEventListener("click", () => {
    volume.value = String(volume.valueAsNumber === 0 ? lastVolume : 0);
    syncVolume(true);
  });
  volume.addEventListener("input", () => syncVolume(true));
  window.addEventListener("pagehide", silence);
  syncVolume(false);
  return {
    silence,
    update(getView: () => EngineAudioView | null, radioPlaying: boolean) {
      const context = radio.getAudioContext();
      if (context?.state !== "running" || volume.valueAsNumber === 0) {
        silence();
        return;
      }
      const view = getView();
      engine.update(() => view, radioPlaying);
      crowd.update(context, view, volume.valueAsNumber / 100, radioPlaying);
    },
  };
}
