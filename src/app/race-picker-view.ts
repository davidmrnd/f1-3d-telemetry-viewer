import type { RaceCatalogEntry } from "../data/races-catalog";

function formatDuration(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return "—";
  }
  if (durationSec < 60) {
    return `${Math.round(durationSec)} s`;
  }
  const minutes = Math.round(durationSec / 60);
  return `${minutes} min`;
}

export class RacePickerView {
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly empty: HTMLElement;
  private resolvePick: ((entry: RaceCatalogEntry | null) => void) | null = null;

  constructor(root: HTMLElement, grid: HTMLElement, empty: HTMLElement) {
    this.root = root;
    this.grid = grid;
    this.empty = empty;
  }

  open(races: RaceCatalogEntry[], preferredId: string | null = null): Promise<RaceCatalogEntry | null> {
    this.grid.replaceChildren();
    this.empty.hidden = races.length > 0;
    this.root.hidden = false;

    if (races.length === 0) {
      this.resolvePick = null;
      return Promise.resolve(null);
    }

    for (const entry of races) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "race-picker-card";
      if (preferredId && entry.id === preferredId) {
        card.classList.add("is-preferred");
      }
      card.dataset.raceId = entry.id;

      const year = document.createElement("span");
      year.className = "race-picker-card-year";
      year.textContent = String(entry.year);

      const title = document.createElement("strong");
      title.className = "race-picker-card-title";
      title.textContent = entry.circuitShortName;

      const meeting = document.createElement("span");
      meeting.className = "race-picker-card-meeting";
      meeting.textContent = entry.meetingName;

      const meta = document.createElement("span");
      meta.className = "race-picker-card-meta";
      meta.textContent = `${formatDuration(entry.durationSec)} · session ${entry.sessionKey}`;

      card.append(year, title, meeting, meta);
      card.addEventListener("click", () => this.finish(entry));
      this.grid.append(card);
    }

    return new Promise((resolve) => {
      this.resolvePick = resolve;
    });
  }

  close() {
    this.root.hidden = true;
    this.resolvePick = null;
  }

  private finish(entry: RaceCatalogEntry) {
    const resolve = this.resolvePick;
    this.close();
    resolve?.(entry);
  }
}
