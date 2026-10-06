export type GraphicsPreset = "low" | "medium" | "high";
export type ShadowQuality = "off" | "low" | "high";
export type CarMaterialQuality = "pbr" | "simple";

export type GraphicsSettings = {
  preset: GraphicsPreset | "custom";
  maxPixelRatio: number;
  shadows: ShadowQuality;
  environment: boolean;
  fog: boolean;
  xrScale: number;
  carMaterials: CarMaterialQuality;
  carShadows: boolean;
};

export const PIXEL_RATIO_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
export const XR_SCALE_OPTIONS = [0.5, 0.75, 1] as const;

export const GRAPHICS_PRESET_LABELS: Record<GraphicsPreset | "custom", string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  custom: "Personalizado",
};

export const SHADOW_QUALITY_LABELS: Record<ShadowQuality, string> = {
  off: "Off",
  low: "Baja",
  high: "Alta",
};

export const CAR_MATERIAL_LABELS: Record<CarMaterialQuality, string> = {
  pbr: "PBR",
  simple: "Simple",
};

export type GraphicsSettingsValues = Omit<GraphicsSettings, "preset">;

export function settingsFromPreset(preset: GraphicsPreset): GraphicsSettings {
  switch (preset) {
    case "low":
      return {
        preset: "low",
        maxPixelRatio: 1,
        shadows: "off",
        environment: false,
        fog: true,
        xrScale: 0.5,
        carMaterials: "simple",
        carShadows: false,
      };
    case "medium":
      return {
        preset: "medium",
        maxPixelRatio: 1.25,
        shadows: "low",
        environment: true,
        fog: true,
        xrScale: 0.75,
        carMaterials: "simple",
        carShadows: false,
      };
    case "high":
      return {
        preset: "high",
        maxPixelRatio: 2,
        shadows: "high",
        environment: true,
        fog: true,
        xrScale: 1,
        carMaterials: "pbr",
        carShadows: true,
      };
  }
}

export function detectPreset(settings: GraphicsSettingsValues): GraphicsPreset | "custom" {
  for (const preset of ["low", "medium", "high"] as const) {
    const fromPreset = settingsFromPreset(preset);
    if (
      fromPreset.maxPixelRatio === settings.maxPixelRatio &&
      fromPreset.shadows === settings.shadows &&
      fromPreset.environment === settings.environment &&
      fromPreset.fog === settings.fog &&
      fromPreset.xrScale === settings.xrScale &&
      fromPreset.carMaterials === settings.carMaterials &&
      fromPreset.carShadows === settings.carShadows
    ) {
      return preset;
    }
  }
  return "custom";
}

export function withDetectedPreset(settings: GraphicsSettingsValues): GraphicsSettings {
  return {
    ...settings,
    preset: detectPreset(settings),
  };
}

export const DEFAULT_GRAPHICS_SETTINGS = settingsFromPreset("high");
