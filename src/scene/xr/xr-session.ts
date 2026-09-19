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
    if (this.isPresenting() || !navigator.xr) {
      return;
    }

    const supported = await navigator.xr.isSessionSupported("immersive-vr");
    if (!supported) {
      throw new Error("Este dispositivo no soporta immersive-vr.");
    }

    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
    });
    await this.renderer.xr.setSession(session);
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
