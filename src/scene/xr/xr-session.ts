import type { WebGLRenderer } from "three";

export type XrSessionCallbacks = {
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
};

export class XrSessionController {
  private readonly renderer: WebGLRenderer;
  private readonly callbacks: XrSessionCallbacks;
  private ending = false;

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
    if (this.isPresenting()) return;
    if (!window.isSecureContext || !navigator.xr) throw new Error("Abre la página con HTTPS en un navegador compatible con WebXR.");

    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
    });
    try {
      this.renderer.xr.setReferenceSpaceType(session.enabledFeatures?.includes("local-floor") ? "local-floor" : "local");
      await this.renderer.xr.setSession(session);
    } catch (error) {
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
  };
}

export async function isImmersiveVrSupported(): Promise<boolean> {
  if (!navigator.xr) {
    return false;
  }
  try {
    return await navigator.xr.isSessionSupported("immersive-vr");
  } catch {
    return false;
  }
}
