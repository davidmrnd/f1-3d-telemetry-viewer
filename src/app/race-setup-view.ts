import type { RaceCatalogEntry } from "../data/races-catalog";
import type { DriverInfo, GhostLap } from "../types";
import { setAppTitle } from "./document-title";
import { mustQuery } from "./dom";
import type { DrivingMode } from "./driving-session";
import { driverPortrait } from "./driver-portrait";
import { formatLapTime } from "./format";

export type RaceMode = "replay" | DrivingMode;
export type DriverChoice = { driver: DriverInfo; lap?: GhostLap };

export class RaceSetupView {
  private readonly root = mustQuery<HTMLElement>("#race-setup");
  private readonly title = mustQuery<HTMLElement>("#race-setup-title");
  private readonly circuit = mustQuery<HTMLElement>("#race-setup-circuit");
  private readonly hint = mustQuery<HTMLElement>("#race-setup-hint");
  private readonly modes = mustQuery<HTMLElement>("#race-mode-options");
  private readonly drivers = mustQuery<HTMLElement>("#race-driver-options");
  private readonly status = mustQuery<HTMLElement>("#race-setup-status");
  private readonly back = mustQuery<HTMLButtonElement>("#race-setup-back");

  chooseMode(entry: RaceCatalogEntry, error?: string) {
    this.open(entry, "Elige un modo", "Puedes ver el replay o ponerte al volante con el teclado.");
    this.back.textContent = "Volver a carreras";
    this.modes.hidden = false;
    this.drivers.hidden = true;
    this.setStatus(error ?? "");
    return this.waitForChoice<RaceMode>(target => {
      const choice = target.closest<HTMLButtonElement>("[data-mode]");
      return choice?.dataset.mode as RaceMode | undefined;
    });
  }

  chooseDriver(entry: RaceCatalogEntry, mode: DrivingMode, choices: Promise<DriverChoice[]>) {
    const ghost = mode === "ghost";
    this.open(entry, ghost ? "Elige tu fantasma" : "Elige tu coche",
      ghost ? "Cada piloto aparece con su mejor vuelta válida de la carrera."
        : "Tomarás el control de su coche al comenzar el tramo.");
    this.back.textContent = "Volver a modos";
    this.modes.hidden = true;
    this.drivers.hidden = false;
    this.drivers.replaceChildren();
    this.setStatus(ghost ? "Cargando vueltas fantasma…" : "Cargando pilotos…");
    const byDriver = new Map<number, DriverChoice>();
    return this.waitForChoice(target => {
      const button = target.closest<HTMLButtonElement>("[data-driver-choice]");
      return byDriver.get(Number(button?.dataset.driverChoice));
    }, signal => {
      void choices.then(entries => {
        if (signal.aborted) return;
        this.setStatus(entries.length ? "" : "No hay pilotos disponibles para este modo.");
        for (const entry of entries) {
          byDriver.set(entry.driver.driverNumber, entry);
          this.drivers.append(this.driverButton(entry));
        }
      }).catch(error => {
        if (!signal.aborted) this.setStatus(error instanceof Error ? error.message : "No se pudo cargar la lista de pilotos.");
      });
    });
  }

  private open(entry: RaceCatalogEntry, title: string, hint: string) {
    this.circuit.textContent = `${entry.circuitShortName} · ${entry.year}`;
    this.title.textContent = title;
    this.hint.textContent = hint;
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.title.focus({ preventScroll: true });
    setAppTitle(`${entry.circuitShortName} · ${title}`);
  }

  private setStatus(message: string) {
    this.status.textContent = message;
    this.status.hidden = !message;
  }

  private waitForChoice<T>(pick: (target: Element) => T | undefined, prepare?: (signal: AbortSignal) => void) {
    return new Promise<T | null>(resolve => {
      const controller = new AbortController();
      const { signal } = controller;
      const finish = (value: T | null) => {
        controller.abort();
        this.root.hidden = true;
        resolve(value);
      };
      this.back.addEventListener("click", () => finish(null), { signal });
      this.root.addEventListener("keydown", event => {
        if (event.key === "Escape") finish(null);
      }, { signal });
      this.root.addEventListener("click", event => {
        const choice = event.target instanceof Element ? pick(event.target) : undefined;
        if (choice !== undefined) finish(choice);
      }, { signal });
      prepare?.(signal);
    });
  }

  private driverButton({ driver, lap }: DriverChoice) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "race-driver-choice";
    button.dataset.driverChoice = String(driver.driverNumber);
    button.style.setProperty("--team-color", `#${driver.teamColor.replace(/^#/, "")}`);
    const number = document.createElement("span");
    number.className = "race-driver-number";
    number.textContent = String(driver.driverNumber);
    const portrait = document.createElement("span");
    portrait.className = "race-driver-portrait";
    portrait.append(driverPortrait(driver), number);
    const identity = document.createElement("span");
    identity.className = "race-driver-identity";
    const name = document.createElement("strong");
    name.textContent = driver.fullName;
    const team = document.createElement("small");
    team.textContent = driver.teamName;
    identity.append(name, team);
    button.append(portrait, identity);
    if (lap) {
      const record = document.createElement("span");
      record.className = "race-driver-record";
      const time = document.createElement("span");
      time.className = "race-driver-time";
      time.textContent = formatLapTime(lap.durationMs);
      const reference = document.createElement("small");
      reference.textContent = `Vuelta ${lap.lapNumber}`;
      record.append(time, reference);
      button.append(record);
    }
    return button;
  }
}
