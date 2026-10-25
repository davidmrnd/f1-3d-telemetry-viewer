import type { PresentationMode, RaceScene } from "../scene/race-scene";
import { mustQuery } from "./dom";

export function bindTabletop(scene: RaceScene) {
  const mode = mustQuery<HTMLSelectElement>("#presentation-mode");
  const panel = mustQuery<HTMLElement>("#tabletop-settings");
  const width = mustQuery<HTMLInputElement>("#tabletop-width");
  const rotation = mustQuery<HTMLInputElement>("#tabletop-rotation");
  const readout = mustQuery<HTMLOutputElement>("#tabletop-width-value");
  const sync = () => {
    const tabletop = scene.getPresentationMode() === "tabletop";
    mode.value = scene.getPresentationMode();
    mode.disabled = scene.isXrPresenting();
    panel.hidden = !tabletop;
    width.value = String(scene.getTabletopWidth());
    readout.value = `${scene.getTabletopWidth().toFixed(2)} m`;
    for (const field of [width, rotation]) field.disabled = scene.isXrPresenting();
    mustQuery<HTMLSelectElement>("#camera-mode-select").disabled = tabletop;
    mustQuery<HTMLElement>("#app").classList.toggle("is-tabletop", tabletop);
    mustQuery<HTMLElement>(".view-caption-detail").textContent = tabletop ? "MAQUETA · AR" : "ESCALA REAL · 3D";
  };
  mode.addEventListener("change", () => { scene.setPresentationMode(mode.value as PresentationMode); sync(); });
  width.addEventListener("input", () => { scene.setTabletopWidth(Number(width.value)); sync(); });
  rotation.addEventListener("input", () => scene.setTabletopRotation(Number(rotation.value)));
  mustQuery("#app").addEventListener("xrsessionchange", sync);
  sync();
}
