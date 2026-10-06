import type {
  CarMaterialQuality,
  GraphicsSettings,
  ShadowQuality,
} from "../scene/graphics-settings";
import { settingsFromPreset, withDetectedPreset } from "../scene/graphics-settings";
import type { RaceScene } from "../scene/race-scene";
import { mustQuery } from "./dom";
import { loadGraphicsSettings, saveGraphicsSettings } from "./graphics-settings-store";

export type GraphicsControlElements = {
  presetSelect: HTMLSelectElement;
  advancedToggle: HTMLButtonElement;
  advancedPanel: HTMLElement;
  pixelRatioSelect: HTMLSelectElement;
  shadowsSelect: HTMLSelectElement;
  environmentSelect: HTMLSelectElement;
  fogSelect: HTMLSelectElement;
  xrScaleSelect: HTMLSelectElement;
  carMaterialsSelect: HTMLSelectElement;
  carShadowsSelect: HTMLSelectElement;
};

export type GraphicsSettingsController = {
  get: () => GraphicsSettings;
  set: (settings: GraphicsSettings) => void;
  syncUi: (settings: GraphicsSettings) => void;
};

function syncSelects(elements: GraphicsControlElements, settings: GraphicsSettings) {
  elements.presetSelect.value = settings.preset;
  elements.pixelRatioSelect.value = String(settings.maxPixelRatio);
  elements.shadowsSelect.value = settings.shadows;
  elements.environmentSelect.value = settings.environment ? "on" : "off";
  elements.fogSelect.value = settings.fog ? "on" : "off";
  elements.xrScaleSelect.value = String(settings.xrScale);
  elements.carMaterialsSelect.value = settings.carMaterials;
  elements.carShadowsSelect.value = settings.carShadows ? "on" : "off";
}

export function bindGraphicsSettings(
  scene: RaceScene,
  elements: GraphicsControlElements,
): GraphicsSettingsController {
  let current = loadGraphicsSettings();

  const apply = (settings: GraphicsSettings) => {
    current = settings;
    saveGraphicsSettings(settings);
    scene.applyGraphicsSettings(settings);
    syncSelects(elements, settings);
  };

  apply(current);

  elements.presetSelect.addEventListener("change", () => {
    const value = elements.presetSelect.value;
    if (value === "low" || value === "medium" || value === "high") {
      apply(settingsFromPreset(value));
    }
  });

  elements.advancedToggle.addEventListener("click", () => {
    const open = elements.advancedPanel.hidden;
    elements.advancedPanel.hidden = !open;
    elements.advancedToggle.setAttribute("aria-expanded", open ? "true" : "false");
    elements.advancedToggle.textContent = open ? "Ocultar avanzado" : "Avanzado";
  });

  const applyAdvanced = () => {
    apply(
      withDetectedPreset({
        maxPixelRatio: Number(elements.pixelRatioSelect.value),
        shadows: elements.shadowsSelect.value as ShadowQuality,
        environment: elements.environmentSelect.value === "on",
        fog: elements.fogSelect.value === "on",
        xrScale: Number(elements.xrScaleSelect.value),
        carMaterials: elements.carMaterialsSelect.value as CarMaterialQuality,
        carShadows: elements.carShadowsSelect.value === "on",
      }),
    );
  };

  elements.pixelRatioSelect.addEventListener("change", applyAdvanced);
  elements.shadowsSelect.addEventListener("change", applyAdvanced);
  elements.environmentSelect.addEventListener("change", applyAdvanced);
  elements.fogSelect.addEventListener("change", applyAdvanced);
  elements.xrScaleSelect.addEventListener("change", applyAdvanced);
  elements.carMaterialsSelect.addEventListener("change", applyAdvanced);
  elements.carShadowsSelect.addEventListener("change", applyAdvanced);

  return {
    get: () => ({ ...current }),
    set: (settings) => apply(settings),
    syncUi: (settings) => {
      current = settings;
      syncSelects(elements, settings);
    },
  };
}

export function queryGraphicsControlElements(): GraphicsControlElements {
  return {
    presetSelect: mustQuery<HTMLSelectElement>("#graphics-preset-select"),
    advancedToggle: mustQuery<HTMLButtonElement>("#graphics-advanced-toggle"),
    advancedPanel: mustQuery<HTMLElement>("#graphics-advanced-panel"),
    pixelRatioSelect: mustQuery<HTMLSelectElement>("#graphics-pixel-ratio-select"),
    shadowsSelect: mustQuery<HTMLSelectElement>("#graphics-shadows-select"),
    environmentSelect: mustQuery<HTMLSelectElement>("#graphics-environment-select"),
    fogSelect: mustQuery<HTMLSelectElement>("#graphics-fog-select"),
    xrScaleSelect: mustQuery<HTMLSelectElement>("#graphics-xr-scale-select"),
    carMaterialsSelect: mustQuery<HTMLSelectElement>("#graphics-car-materials-select"),
    carShadowsSelect: mustQuery<HTMLSelectElement>("#graphics-car-shadows-select"),
  };
}
