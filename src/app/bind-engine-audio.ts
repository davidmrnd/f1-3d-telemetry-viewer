import { EngineAudio } from "../audio/engine-audio";
import { mustQuery } from "./dom";
import type { RadioPlayer } from "./radio-player";

export function bindEngineAudio(radio: RadioPlayer) {
  const mute = mustQuery<HTMLButtonElement>("#engine-mute");
  const icon = mustQuery<SVGUseElement>("#engine-mute use");
  const volume = mustQuery<HTMLInputElement>("#engine-volume");
  const status = mustQuery<HTMLElement>("#engine-status");
  const engine = new EngineAudio(() => radio.getAudioContext(), () => {
    mute.disabled = true;
    volume.disabled = true;
    status.hidden = false;
  });

  let lastVolume = Number(volume.defaultValue);
  const syncVolume = () => {
    const value = volume.valueAsNumber;
    const muted = value === 0;
    if (!muted) lastVolume = value;
    engine.setVolume(value / 100);
    const label = muted ? "Restaurar sonido del motor" : "Silenciar motor";
    mute.setAttribute("aria-label", label);
    mute.title = label;
    icon.setAttribute("href", muted ? "#i-volume-off" : "#i-volume");
  };
  mute.addEventListener("click", () => {
    volume.value = String(volume.valueAsNumber === 0 ? lastVolume : 0);
    syncVolume();
  });
  volume.addEventListener("input", syncVolume);
  window.addEventListener("pagehide", () => engine.silence());
  syncVolume();
  return engine;
}
