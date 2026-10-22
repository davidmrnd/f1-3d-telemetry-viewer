import {
  DEFAULT_GRAPHICS_SETTINGS, GRAPHICS_PRESETS, normalizeGraphicsSettings, settingsFromPreset,
  type GraphicsPreset, type GraphicsSettings, type GraphicsSettingsValues,
} from "../scene/graphics-settings";
import type { RaceScene } from "../scene/race-scene";
import { mustQuery } from "./dom";
import { loadGraphicsSettings, saveGraphicsSettings } from "./graphics-settings-store";

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
  set: (settings: GraphicsSettings) => void;
  syncUi: (settings: GraphicsSettings) => void;
};

export function bindGraphicsSettings(scene: RaceScene, elements: GraphicsControlElements): GraphicsSettingsController {
  let current = loadGraphicsSettings();
  const syncUi = (settings: GraphicsSettings) => {
    current = settings;
    elements.presetSelect.value = settings.preset;
    for (const field of elements.fields) {
      const key = field.dataset.graphics as keyof GraphicsSettingsValues;
      const value = settings[key];
      field.value = typeof value === "boolean" ? (value ? "on" : "off") : String(value);
    }
  };
  const apply = (settings: GraphicsSettings) => {
    const normalized = normalizeGraphicsSettings(settings);
    scene.applyGraphicsSettings(normalized);
    saveGraphicsSettings(normalized);
    syncUi(normalized);
    elements.xrNote.hidden = !scene.isXrPresenting();
  };
  apply(current);
  elements.presetSelect.addEventListener("change", () => {
    const preset = elements.presetSelect.value as GraphicsPreset;
    if (GRAPHICS_PRESETS.includes(preset)) apply({ ...settingsFromPreset(preset), showStats: current.showStats });
  });
  elements.resetButton.addEventListener("click", () => apply({ ...DEFAULT_GRAPHICS_SETTINGS }));
  elements.advancedToggle.addEventListener("click", () => {
    const open = elements.advancedPanel.hidden;
    elements.advancedPanel.hidden = !open;
    elements.advancedToggle.setAttribute("aria-expanded", String(open));
    elements.advancedToggle.textContent = open ? "Ocultar ajustes detallados" : "Personalizar gráficos";
  });
  for (const field of elements.fields) {
    field.addEventListener("change", () => {
      const key = field.dataset.graphics as keyof GraphicsSettingsValues;
      const value = typeof current[key] === "boolean" ? field.value === "on"
        : typeof current[key] === "number" ? Number(field.value) : field.value;
      apply({ ...current, [key]: value });
    });
  }
  return { get: () => ({ ...current }), set: apply, syncUi };
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
