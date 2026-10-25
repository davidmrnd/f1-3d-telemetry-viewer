import { DEFAULT_GRAPHICS_SETTINGS, normalizeGraphicsSettings, settingsFromPreset, type GraphicsSettings } from "../scene/graphics-settings";

export type GraphicsMode = "desktop" | "vr";
const LEGACY_KEY = "f1-vr-replay:graphics";
const keyFor = (mode: GraphicsMode) => `f1-vr-replay:graphics:v2:${mode}`;

export function deviceGraphicsMode(): GraphicsMode {
  return typeof navigator !== "undefined" && /OculusBrowser|Meta Quest|Quest 2/i.test(navigator.userAgent) ? "vr" : "desktop";
}

export function loadGraphicsSettings(mode: GraphicsMode = "desktop"): GraphicsSettings {
  const standalone = typeof navigator !== "undefined" && /OculusBrowser|Meta Quest|Quest 2/i.test(navigator.userAgent);
  const fallback = mode === "vr" ? settingsFromPreset("vr") : standalone ? settingsFromPreset("low") : { ...DEFAULT_GRAPHICS_SETTINGS };
  if (mode === "vr" && typeof navigator !== "undefined" && /Quest 2/i.test(navigator.userAgent)) fallback.xrScale = 0.65;
  const defaults = normalizeGraphicsSettings(fallback);
  try {
    const raw = localStorage.getItem(keyFor(mode)) ?? (mode === "desktop" ? localStorage.getItem(LEGACY_KEY) : null);
    if (!raw) return defaults;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    return normalizeGraphicsSettings({ ...defaults, ...value });
  } catch { return defaults; }
}

export function saveGraphicsSettings(settings: GraphicsSettings, mode: GraphicsMode = "desktop"): boolean {
  try { localStorage.setItem(keyFor(mode), JSON.stringify(settings)); return true; }
  catch { return false; }
}
