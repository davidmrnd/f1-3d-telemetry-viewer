import { DEFAULT_GRAPHICS_SETTINGS, normalizeGraphicsSettings, type GraphicsSettings } from "../scene/graphics-settings";

const STORAGE_KEY = "f1-vr-replay:graphics";

export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeGraphicsSettings(JSON.parse(raw)) : { ...DEFAULT_GRAPHICS_SETTINGS };
  } catch {
    return { ...DEFAULT_GRAPHICS_SETTINGS };
  }
}

export function saveGraphicsSettings(settings: GraphicsSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}
