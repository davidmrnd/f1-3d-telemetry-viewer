import { EngineAudio } from "../audio/engine-audio";
import { mustQuery } from "./dom";
import type { RadioPlayer } from "./radio-player";

export function bindEngineAudio(radio: RadioPlayer) {
  const enabled = mustQuery<HTMLInputElement>("#engine-enabled");
  const volume = mustQuery<HTMLInputElement>("#engine-volume");
  const status = mustQuery<HTMLElement>("#engine-status");
  const engine = new EngineAudio(() => radio.getAudioContext(), () => {
    enabled.checked = false;
    status.hidden = false;
  });

  const syncEnabled = () => engine.setEnabled(enabled.checked);
  const syncVolume = () => engine.setVolume(volume.valueAsNumber / 100);
  enabled.addEventListener("change", () => {
    status.hidden = true;
    syncEnabled();
  });
  volume.addEventListener("input", syncVolume);
  window.addEventListener("pagehide", () => engine.silence());
  syncEnabled();
  syncVolume();
  return engine;
}
