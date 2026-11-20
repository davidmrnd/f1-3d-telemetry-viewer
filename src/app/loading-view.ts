import type { RaceCatalogEntry } from "../data/races-catalog";
import type { AnimationFrames } from "./animation-frames";
import { setAppTitle } from "./document-title";
import { mustQuery } from "./dom";
import { grandPrixName } from "./session-ui";

export class LoadingView {
  private readonly root = mustQuery<HTMLElement>("#race-loading");
  private readonly title = mustQuery<HTMLElement>("#loading-title");
  private readonly subtitle = mustQuery<HTMLElement>("#loading-subtitle");
  private readonly track = mustQuery<HTMLImageElement>("#loading-track");
  private readonly stage = mustQuery<HTMLElement>("#loading-stage");
  private readonly percentage = mustQuery<HTMLElement>("#loading-percentage");
  private readonly progress = mustQuery<HTMLElement>("#loading-progress");
  private value = 0;
  private target = 0;
  private lastFrame = 0;
  private animationId = 0;
  private lastYield = 0;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private readonly frames: AnimationFrames) {
    this.track.addEventListener("error", () => { this.track.hidden = true; });
  }

  show(race: RaceCatalogEntry) {
    this.stopAnimation();
    this.value = 0;
    this.target = 0;
    this.lastYield = 0;
    this.paint(0);
    this.title.textContent = race.circuitShortName;
    this.subtitle.textContent = `${grandPrixName(race.meetingName)} · ${race.year}`;
    setAppTitle(race.circuitShortName);
    this.track.hidden = false;
    this.track.src = `/images/circuits/${encodeURIComponent(race.race)}.svg`;
    this.update(0, "Cargando datos del replay…");
    this.root.hidden = false;
  }

  update(percentage: number, stage?: string) {
    const next = Math.max(this.target, Math.min(100, percentage));
    if (next > this.target) {
      this.target = next;
      if (this.reducedMotion.matches) {
        this.stopAnimation();
        this.paint(this.target);
      } else if (!this.animationId) {
        this.lastFrame = performance.now();
        this.animationId = this.frames.request(this.animate);
      }
    }
    if (stage && this.stage.textContent !== stage) this.stage.textContent = stage;
  }

  async checkpoint(percentage: number, stage?: string) {
    this.update(percentage, stage);
    if (!stage && performance.now() - this.lastYield < 24) return;
    this.lastYield = performance.now();
    await new Promise<void>((resolve) => {
      this.frames.request(() => { setTimeout(resolve, 0); });
    });
    this.lastYield = performance.now();
  }

  hide() {
    this.stopAnimation();
    this.root.hidden = true;
  }

  private readonly animate = (now: number) => {
    this.animationId = 0;
    const elapsed = Math.min(32, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    const gap = this.target - this.value;
    const advance = Math.min(gap, elapsed * 0.18, Math.max(elapsed * 0.012, gap * (1 - Math.exp(-elapsed / 90))));
    this.paint(this.value + advance);
    if (this.value < this.target) {
      this.animationId = this.frames.request(this.animate);
    } else {
      this.stopAnimation();
    }
  };

  private paint(value: number) {
    this.value = value;
    const rounded = Math.round(value);
    this.percentage.textContent = `${rounded} %`;
    this.progress.setAttribute("aria-valuenow", String(rounded));
    this.progress.style.setProperty("--loading-progress", `${value.toFixed(3)}%`);
  }

  private stopAnimation() {
    this.frames.cancel(this.animationId);
    this.animationId = 0;
  }
}
