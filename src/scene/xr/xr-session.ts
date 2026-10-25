import type { WebGLRenderer } from "three";

export type XrSessionCallbacks = {
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
};

export class XrSessionController {
  private readonly renderer: WebGLRenderer;
  private readonly callbacks: XrSessionCallbacks;
  private ending = false;
  private mode: "immersive-vr" | "immersive-ar" | null = null;

  constructor(renderer: WebGLRenderer, callbacks: XrSessionCallbacks = {}) {
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.renderer.xr.enabled = true;

    this.renderer.xr.addEventListener("sessionstart", this.handleSessionStart);
    this.renderer.xr.addEventListener("sessionend", this.handleSessionEnd);
  }

  isPresenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  async enterVr(): Promise<void> {
    await this.enter("immersive-vr");
  }

  async enterAr(): Promise<void> {
    await this.enter("immersive-ar");
  }

  getMode() { return this.mode; }

  private async enter(mode: "immersive-vr" | "immersive-ar"): Promise<void> {
    if (this.isPresenting()) return;
    if (!window.isSecureContext || !navigator.xr) throw new Error("Abre la página con HTTPS en un navegador compatible con WebXR.");

    const session = await navigator.xr.requestSession(mode, {
      optionalFeatures: mode === "immersive-ar"
        ? ["local-floor", "hand-tracking"]
        : ["local-floor", "bounded-floor", "hand-tracking", "layers"],
    });
    try {
      this.mode = mode;
      this.renderer.xr.setReferenceSpaceType(session.enabledFeatures?.includes("local-floor") ? "local-floor" : "local");
      await this.renderer.xr.setSession(session);
    } catch (error) {
      this.mode = null;
      await session.end().catch(() => {});
      throw error;
    }
  }

  async exitVr(): Promise<void> {
    const session = this.renderer.xr.getSession();
    if (!session || this.ending) {
      return;
    }
    this.ending = true;
    try {
      await session.end();
    } finally {
      this.ending = false;
    }
  }

  dispose() {
    this.renderer.xr.removeEventListener("sessionstart", this.handleSessionStart);
    this.renderer.xr.removeEventListener("sessionend", this.handleSessionEnd);
  }

  private readonly handleSessionStart = () => {
    this.callbacks.onSessionStart?.();
  };

  private readonly handleSessionEnd = () => {
    this.callbacks.onSessionEnd?.();
    this.mode = null;
  };
}

export async function isImmersiveVrSupported(): Promise<boolean> {
  return isImmersiveModeSupported("immersive-vr");
}

export async function isImmersiveArSupported(): Promise<boolean> {
  return isImmersiveModeSupported("immersive-ar");
}

async function isImmersiveModeSupported(mode: "immersive-vr" | "immersive-ar"): Promise<boolean> {
  if (!navigator.xr) {
    return false;
  }
  try {
    return await navigator.xr.isSessionSupported(mode);
  } catch {
    return false;
  }
}
