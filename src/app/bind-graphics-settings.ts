import {
  DEFAULT_GRAPHICS_SETTINGS, GRAPHICS_PRESETS, normalizeGraphicsSettings, settingsFromPreset,
  type GraphicsPreset, type GraphicsSettings, type GraphicsSettingsValues,
} from "../scene/graphics-settings";
import type { RaceScene } from "../scene/race-scene";
import { mustQuery } from "./dom";
import { deviceGraphicsMode, loadGraphicsSettings, saveGraphicsSettings, type GraphicsMode } from "./graphics-settings-store";

export type GraphicsControlElements = {
  presetSelect: HTMLSelectElement;
  advancedToggle: HTMLButtonElement;
  advancedPanel: HTMLElement;
  resetButton: HTMLButtonElement;
  xrNote: HTMLElement;
  fields: HTMLSelectElement[];
};

export type GraphicsSettingsController = {
  get: () => GraphicsSettings;
  set: (settings: GraphicsSettings) => boolean;
  activate: (mode: GraphicsMode) => void;
  activateDefault: () => void;
  syncUi: (settings: GraphicsSettings) => void;
};

export function bindGraphicsSettings(scene: RaceScene, elements: GraphicsControlElements): GraphicsSettingsController {
  let mode = deviceGraphicsMode();
  let current = loadGraphicsSettings(mode);
  const syncUi = (settings: GraphicsSettings) => {
    current = settings;
    elements.presetSelect.value = settings.preset;
    for (const field of elements.fields) {
      const key = field.dataset.graphics as keyof GraphicsSettingsValues;
      const value = settings[key];
      field.value = typeof value === "boolean" ? (value ? "on" : "off") : String(value);
    }
  };
  const apply = (settings: GraphicsSettings, persist = true) => {
    const normalized = normalizeGraphicsSettings(settings);
    scene.applyGraphicsSettings(normalized);
    const saved = !persist || saveGraphicsSettings(normalized, mode);
    syncUi(normalized);
    elements.xrNote.hidden = !scene.isXrPresenting();
    return saved;
  };
  apply(current, false);
  elements.presetSelect.addEventListener("change", () => {
    const preset = elements.presetSelect.value as GraphicsPreset;
    if (GRAPHICS_PRESETS.includes(preset)) apply({ ...settingsFromPreset(preset), showStats: current.showStats });
  });
  elements.resetButton.addEventListener("click", () => apply(mode === "vr" ? settingsFromPreset("vr") : { ...DEFAULT_GRAPHICS_SETTINGS }));
  elements.advancedToggle.addEventListener("click", () => {
    const open = elements.advancedPanel.hidden;
    elements.advancedPanel.hidden = !open;
    elements.advancedToggle.setAttribute("aria-expanded", String(open));
    elements.advancedToggle.textContent = open ? "Ocultar ajustes detallados" : "Personalizar gráficos";
  });
  for (const field of elements.fields) {
    field.addEventListener("change", () => {
      const key = field.dataset.graphics as keyof GraphicsSettingsValues;
      const raw = field.value;
      const value = typeof current[key] === "boolean" ? raw === "on"
        : key === "detailedCarDistance" && raw === "lowpoly" ? "lowpoly"
        : typeof current[key] === "number" || key === "detailedCarDistance" ? Number(raw) : raw;
      apply({ ...current, [key]: value });
    });
  }
  const activate = (next: GraphicsMode) => {
    if (mode === next) return;
    mode = next;
    apply(loadGraphicsSettings(mode), false);
  };
  return {
    get: () => ({ ...current }), set: apply, syncUi,
    activate,
    activateDefault: () => activate(deviceGraphicsMode()),
  };
}

export function queryGraphicsControlElements(): GraphicsControlElements {
  return {
    presetSelect: mustQuery("#graphics-preset-select"),
    advancedToggle: mustQuery("#graphics-advanced-toggle"),
    advancedPanel: mustQuery("#graphics-advanced-panel"),
    resetButton: mustQuery("#graphics-reset"),
    xrNote: mustQuery("#graphics-xr-note"),
    fields: Array.from(document.querySelectorAll<HTMLSelectElement>("[data-graphics]")),
  };
}
