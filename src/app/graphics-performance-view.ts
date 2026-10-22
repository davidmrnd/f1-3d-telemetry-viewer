import type { RaceScene } from "../scene/race-scene";

export class GraphicsPerformanceView {
  private since = 0;
  private frames = 0;
  private last = 0;

  constructor(private readonly element: HTMLOutputElement) {}

  update(scene: RaceScene, now: number) {
    const enabled = scene.getGraphicsSettings().showStats;
    this.element.hidden = !enabled;
    if (!enabled || now - this.last > 2000) { this.since = now; this.frames = 0; }
    this.last = now;
    if (!enabled) return;
    this.frames++;
    const elapsed = now - this.since;
    if (elapsed < 750) return;
    const renderer = scene.getRenderer();
    const fps = Math.round(this.frames * 1000 / elapsed);
    const triangles = (renderer.info.render.triangles / 1000).toLocaleString("es", { maximumFractionDigits: 0 });
    const mode = scene.isXrPresenting() ? "VR" : "PC";
    this.element.textContent = `${mode} · ${fps} FPS · ${(elapsed / this.frames).toFixed(1)} ms/fotograma\n${renderer.domElement.width} × ${renderer.domElement.height} · ${renderer.info.render.calls} llamadas · ${triangles} mil triángulos`;
    this.since = now; this.frames = 0;
  }
}
