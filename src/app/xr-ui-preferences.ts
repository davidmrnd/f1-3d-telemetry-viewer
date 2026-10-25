const KEY = "f1-vr-replay:wrist-timing";

export function loadWristTimingVisible(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; }
  catch { return true; }
}

export function saveWristTimingVisible(visible: boolean): void {
  try { localStorage.setItem(KEY, visible ? "on" : "off"); }
  catch {}
}
