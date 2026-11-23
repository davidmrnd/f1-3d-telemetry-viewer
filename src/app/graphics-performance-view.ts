import type { RaceScene } from "../scene/race-scene";
import { mustQuery } from "./dom";

export class GraphicsPerformanceView {
  private readonly mode = mustQuery<HTMLSpanElement>("#graphics-stats-mode");
  private readonly fps = mustQuery("#graphics-stats-fps");
  private readonly frameTime = mustQuery("#graphics-stats-frame-time");
  private readonly resolution = mustQuery("#graphics-stats-resolution");
  private readonly calls = mustQuery("#graphics-stats-calls");
  private readonly triangles = mustQuery("#graphics-stats-triangles");
  private readonly integerFormat = new Intl.NumberFormat("es", { maximumFractionDigits: 0 });
  private readonly frameTimeFormat = new Intl.NumberFormat("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  private since = 0;
  private frames = 0;
  private last = 0;

  constructor(private readonly element: HTMLElement) {}

  update(scene: RaceScene, now: number) {
    const enabled = scene.getGraphicsSettings().showStats;
    if (this.element.hidden === enabled) this.element.hidden = !enabled;
    if (!enabled || now - this.last > 2000) { this.since = now; this.frames = 0; }
    this.last = now;
    if (!enabled) return;
    this.frames++;
    const elapsed = now - this.since;
    if (elapsed < 750) return;
    const renderer = scene.getRenderer();
    const { width, height } = renderer.domElement;
    const mode = scene.isArPresenting() ? "AR" : scene.isXrPresenting() ? "VR" : "";
    this.mode.textContent = mode;
    this.mode.hidden = !mode;
    this.fps.textContent = this.integerFormat.format(this.frames * 1000 / elapsed);
    this.frameTime.textContent = this.frameTimeFormat.format(elapsed / this.frames);
    this.resolution.textContent = `${width} × ${height}`;
    this.calls.textContent = this.integerFormat.format(renderer.info.render.calls);
    this.triangles.textContent = `${this.integerFormat.format(renderer.info.render.triangles / 1000)} mil`;
    this.since = now; this.frames = 0;
  }
}
