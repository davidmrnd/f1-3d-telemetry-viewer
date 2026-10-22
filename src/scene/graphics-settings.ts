export type GraphicsPreset = "low" | "medium" | "high" | "ultra" | "vr";
export type ShadowQuality = "off" | "low" | "medium" | "high";
export type CarMaterialQuality = "pbr" | "simple";
export type LightingStyle = "day" | "warm" | "overcast";

export type GraphicsSettingsValues = {
  maxPixelRatio: number;
  shadows: ShadowQuality;
  shadowDistance: number;
  environment: boolean;
  environmentIntensity: number;
  fog: boolean;
  drawDistance: number;
  xrScale: number;
  xrFoveation: number;
  carMaterials: CarMaterialQuality;
  carShadows: boolean;
  detailedCarDistance: number;
  contactShadows: boolean;
  surfaceDetail: boolean;
  anisotropy: number;
  sky: boolean;
  skyStyle: "clear" | "hdri";
  exposure: number;
  lighting: LightingStyle;
  runoffs: boolean;
  trackside: boolean;
  tyreMarks: boolean;
  showStats: boolean;
};

export type GraphicsSettings = GraphicsSettingsValues & { preset: GraphicsPreset | "custom" };

export const PIXEL_RATIO_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
export const XR_SCALE_OPTIONS = [0.5, 0.65, 0.75, 1, 1.25] as const;
export const GRAPHICS_PRESETS: GraphicsPreset[] = ["low", "medium", "high", "ultra", "vr"];

export const GRAPHICS_PRESET_LABELS: Record<GraphicsPreset | "custom", string> = {
  low: "Rendimiento", medium: "Equilibrado", high: "Calidad", ultra: "Ultra", vr: "VR fluida", custom: "Personalizado",
};
export const SHADOW_QUALITY_LABELS: Record<ShadowQuality, string> = {
  off: "Sin sombras", low: "Baja", medium: "Media", high: "Alta",
};
export const CAR_MATERIAL_LABELS: Record<CarMaterialQuality, string> = {
  pbr: "Detallados", simple: "Ligeros",
};

const BASE: GraphicsSettingsValues = {
  maxPixelRatio: 1.25, shadows: "medium", shadowDistance: 120,
  environment: true, environmentIntensity: 0.6, fog: true, drawDistance: 3200,
  xrScale: 0.75, xrFoveation: 0.5, carMaterials: "pbr", carShadows: true,
  detailedCarDistance: 120, contactShadows: true, surfaceDetail: true, anisotropy: 8, sky: true, skyStyle: "clear",
  exposure: 1, lighting: "day", runoffs: true,
  trackside: true, tyreMarks: true, showStats: false,
};

export function settingsFromPreset(preset: GraphicsPreset): GraphicsSettings {
  switch (preset) {
    case "low": return { ...BASE, preset, maxPixelRatio: 0.75, shadows: "off", environment: false,
      carMaterials: "simple", carShadows: false, surfaceDetail: false, anisotropy: 1,
      detailedCarDistance: 60, drawDistance: 1600, sky: false, trackside: false, tyreMarks: false, xrScale: 0.5, xrFoveation: 1 };
    case "medium": return { ...BASE, preset };
    case "high": return { ...BASE, preset, maxPixelRatio: 1.5, shadows: "high", anisotropy: 16,
      detailedCarDistance: 240, xrScale: 1 };
    case "ultra": return { ...BASE, preset, maxPixelRatio: 2, shadows: "high", shadowDistance: 240,
      detailedCarDistance: 6000, anisotropy: 16, drawDistance: 6000, xrScale: 1.25, xrFoveation: 0 };
    case "vr": return { ...BASE, preset, maxPixelRatio: 1, shadows: "off", carMaterials: "simple",
      carShadows: false, surfaceDetail: false, anisotropy: 4, drawDistance: 1600,
      detailedCarDistance: 60, trackside: false, tyreMarks: false, xrScale: 0.75, xrFoveation: 1 };
  }
}

export const GRAPHICS_OPTIONS: { [K in keyof GraphicsSettingsValues]: readonly GraphicsSettingsValues[K][] } = {
  maxPixelRatio: PIXEL_RATIO_OPTIONS, shadows: ["off", "low", "medium", "high"], shadowDistance: [60, 120, 240],
  environment: [true, false], environmentIntensity: [0.3, 0.6, 1], fog: [true, false], drawDistance: [800, 1600, 3200, 6000],
  xrScale: XR_SCALE_OPTIONS, xrFoveation: [0, 0.5, 1], carMaterials: ["pbr", "simple"], carShadows: [true, false],
  detailedCarDistance: [60, 120, 240, 6000],
  contactShadows: [true, false], surfaceDetail: [true, false], anisotropy: [1, 4, 8, 16], sky: [true, false],
  skyStyle: ["clear", "hdri"],
  exposure: [0.8, 1, 1.2], lighting: ["day", "warm", "overcast"], runoffs: [true, false],
  trackside: [true, false], tyreMarks: [true, false], showStats: [true, false],
};

export function detectPreset(settings: GraphicsSettingsValues): GraphicsPreset | "custom" {
  return GRAPHICS_PRESETS.find((preset) => {
    const values = settingsFromPreset(preset);
    return (Object.keys(BASE) as (keyof GraphicsSettingsValues)[])
      .every((key) => key === "showStats" || settings[key] === values[key]);
  }) ?? "custom";
}

export function withDetectedPreset(settings: GraphicsSettingsValues): GraphicsSettings {
  return { ...settings, preset: detectPreset(settings) };
}

export function normalizeGraphicsSettings(value: unknown): GraphicsSettings {
  const settings = { ...BASE };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    for (const key of Object.keys(GRAPHICS_OPTIONS) as (keyof GraphicsSettingsValues)[]) {
      const options = GRAPHICS_OPTIONS[key] as readonly unknown[];
      if (options.includes(source[key])) Object.assign(settings, { [key]: source[key] });
    }
  }
  return withDetectedPreset(settings);
}

export const DEFAULT_GRAPHICS_SETTINGS = settingsFromPreset("medium");
