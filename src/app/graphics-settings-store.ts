import {
  DEFAULT_GRAPHICS_SETTINGS,
  detectPreset,
  type CarMaterialQuality,
  type GraphicsSettings,
  type ShadowQuality,
  PIXEL_RATIO_OPTIONS,
  XR_SCALE_OPTIONS,
} from "../scene/graphics-settings";

const STORAGE_KEY = "f1-vr-replay:graphics";

const SHADOW_VALUES: ShadowQuality[] = ["off", "low", "high"];
const CAR_MATERIAL_VALUES: CarMaterialQuality[] = ["pbr", "simple"];

function isShadowQuality(value: unknown): value is ShadowQuality {
  return typeof value === "string" && SHADOW_VALUES.includes(value as ShadowQuality);
}

function isCarMaterialQuality(value: unknown): value is CarMaterialQuality {
  return typeof value === "string" && CAR_MATERIAL_VALUES.includes(value as CarMaterialQuality);
}

function isValidPixelRatio(value: unknown): value is number {
  return (
    typeof value === "number" &&
    PIXEL_RATIO_OPTIONS.includes(value as (typeof PIXEL_RATIO_OPTIONS)[number])
  );
}

function isValidXrScale(value: unknown): value is number {
  return (
    typeof value === "number" && XR_SCALE_OPTIONS.includes(value as (typeof XR_SCALE_OPTIONS)[number])
  );
}

export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_GRAPHICS_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<GraphicsSettings>;
    if (
      !isValidPixelRatio(parsed.maxPixelRatio) ||
      !isShadowQuality(parsed.shadows) ||
      typeof parsed.environment !== "boolean" ||
      typeof parsed.fog !== "boolean"
    ) {
      return { ...DEFAULT_GRAPHICS_SETTINGS };
    }

    const values = {
      maxPixelRatio: parsed.maxPixelRatio,
      shadows: parsed.shadows,
      environment: parsed.environment,
      fog: parsed.fog,
      xrScale: isValidXrScale(parsed.xrScale)
        ? parsed.xrScale
        : DEFAULT_GRAPHICS_SETTINGS.xrScale,
      carMaterials: isCarMaterialQuality(parsed.carMaterials)
        ? parsed.carMaterials
        : DEFAULT_GRAPHICS_SETTINGS.carMaterials,
      carShadows:
        typeof parsed.carShadows === "boolean"
          ? parsed.carShadows
          : DEFAULT_GRAPHICS_SETTINGS.carShadows,
    };

    return {
      ...values,
      preset: detectPreset(values),
    };
  } catch {
    return { ...DEFAULT_GRAPHICS_SETTINGS };
  }
}

export function saveGraphicsSettings(settings: GraphicsSettings): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      maxPixelRatio: settings.maxPixelRatio,
      shadows: settings.shadows,
      environment: settings.environment,
      fog: settings.fog,
      xrScale: settings.xrScale,
      carMaterials: settings.carMaterials,
      carShadows: settings.carShadows,
    }),
  );
}
