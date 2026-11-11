import { CrowdAudio } from "../audio/crowd-audio";
import { EngineAudio } from "../audio/engine-audio";
import type { EngineAudioView } from "../types";
import { mustQuery } from "./dom";
import type { RadioPlayer } from "./radio-player";

export function bindEngineAudio(radio: RadioPlayer) {
  const mute = mustQuery<HTMLButtonElement>("#engine-mute");
  const icon = mustQuery<SVGUseElement>("#engine-mute use");
  const volume = mustQuery<HTMLInputElement>("#engine-volume");
  const status = mustQuery<HTMLElement>("#engine-status");
  const crowd = new CrowdAudio();
  const engine = new EngineAudio(() => radio.getAudioContext(), () => {
    status.hidden = false;
  });
  const silence = () => {
    engine.silence();
    crowd.silence();
  };

  let lastVolume = Number(volume.defaultValue);
  const syncVolume = () => {
    const value = volume.valueAsNumber;
    const muted = value === 0;
    if (!muted) lastVolume = value;
    engine.setVolume(value / 100);
    if (muted) crowd.silence();
    const label = muted ? "Restaurar sonido del circuito" : "Silenciar circuito";
    mute.setAttribute("aria-label", label);
    mute.title = label;
    icon.setAttribute("href", muted ? "#i-volume-off" : "#i-volume");
  };
  mute.addEventListener("click", () => {
    volume.value = String(volume.valueAsNumber === 0 ? lastVolume : 0);
    syncVolume();
  });
  volume.addEventListener("input", syncVolume);
  window.addEventListener("pagehide", silence);
  syncVolume();
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
