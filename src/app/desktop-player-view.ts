import type { CameraMode } from "../scene/cameras/types";
import type { DriverInfo, ReplayFrame, ReplaySegment, TeamRadioClip, TeamRadioControls } from "../types";
import { projectCircuit } from "./circuit-map";
import { mustQuery } from "./dom";
import { formatDelta, formatReplayTime } from "./format";

const SVG_NS = "http://www.w3.org/2000/svg";
const COMPOUNDS: Record<string, string> = {
  SOFT: "Blando", MEDIUM: "Medio", HARD: "Duro", INTERMEDIATE: "Intermedio", INTER: "Intermedio", WET: "Lluvia",
};

function label(tag: string, className: string, text: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function driverName(name: string) {
  return name.toLocaleLowerCase("es").replace(/(^|[ '-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("es"));
}

function driverPortrait(driver: DriverInfo) {
  const portrait = label("span", "driver-portrait", driver.acronym);
  portrait.setAttribute("aria-hidden", "true");
  if (driver.headshotUrl) {
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.loading = "lazy";
    image.addEventListener("load", () => { image.classList.add("is-loaded"); }, { once: true });
    image.src = driver.headshotUrl;
    portrait.append(image);
  }
  return portrait;
}

export class DesktopPlayerView {
  private readonly drivers = new Map<number, DriverInfo>();
  private readonly panel = mustQuery<HTMLElement>("#panel-drivers");
  private readonly driversTab = mustQuery<HTMLButtonElement>("#tab-drivers");
  private readonly gallery = mustQuery<HTMLElement>("#driver-gallery");
  private readonly grid = mustQuery<HTMLElement>("#driver-grid");
  private readonly detail = mustQuery<HTMLElement>("#driver-detail");
  private readonly portrait = mustQuery<HTMLElement>("#driver-portrait");
  private readonly code = mustQuery<HTMLElement>("#driver-code");
  private readonly onboard = mustQuery<HTMLButtonElement>("#driver-onboard");
  private readonly onboardLabel = mustQuery<HTMLElement>("#driver-onboard span");
  private readonly radioList = mustQuery<HTMLElement>("#driver-radios");
  private readonly radioButtons = new Map<TeamRadioClip, HTMLElement>();
  private readonly auto = mustQuery<HTMLButtonElement>("#camera-auto");
  private readonly free = mustQuery<HTMLButtonElement>("#camera-free");
  private readonly timingTower = mustQuery<HTMLElement>("#timing-tower");
  private readonly mapDrivers = mustQuery<SVGGElement>("#map-drivers");
  private readonly driverCards = new Map<number, HTMLButtonElement>();
  private readonly mapDots = new Map<number, SVGCircleElement>();
  private projection: ReturnType<typeof projectCircuit> = null;
  private selectedDriver: number | null = null;
  private galleryScroll = 0;
  private cameraKey = "";
  private lastUpdate = -Infinity;
  private selectedTab = "drivers";
  private readonly telemetry = {
    driver: mustQuery<HTMLElement>("#telemetry-driver"),
    team: mustQuery<HTMLElement>("#telemetry-team"),
    position: mustQuery<HTMLElement>("#telemetry-position"),
    tyre: mustQuery<HTMLElement>("#telemetry-tyre"),
    gap: mustQuery<HTMLElement>("#telemetry-gap"),
    speed: mustQuery<HTMLElement>("#telemetry-speed"),
    gear: mustQuery<HTMLElement>("#telemetry-gear"),
    rpm: mustQuery<HTMLElement>("#telemetry-rpm"),
    drs: mustQuery<HTMLElement>("#telemetry-drs"),
    throttle: mustQuery<HTMLElement>("#throttle-value"),
    brake: mustQuery<HTMLElement>("#brake-value"),
    throttleBar: mustQuery<HTMLElement>("#throttle-bar"),
    brakeBar: mustQuery<HTMLElement>("#brake-bar"),
  };

  constructor(
    private readonly onCamera: (mode: CameraMode, driver?: number) => void,
    private readonly showInspector: () => void,
    private readonly radio: TeamRadioControls,
  ) {
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab]"));
    const activateTab = (tab: HTMLButtonElement, focus = false) => {
      this.selectedTab = tab.dataset.tab!;
      this.lastUpdate = -Infinity;
      for (const item of tabs) {
        const active = item === tab;
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
        mustQuery<HTMLElement>(`#panel-${item.dataset.tab}`).hidden = !active;
      }
      if (focus) tab.focus();
    };
    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener("click", () => activateTab(tab));
      tab.addEventListener("keydown", (event) => {
        let target: number | null = null;
        if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") target = (index + tabs.length - 1) % tabs.length;
        if (event.key === "Home") target = 0;
        if (event.key === "End") target = tabs.length - 1;
        if (target == null) return;
        event.preventDefault();
        activateTab(tabs[target], true);
      });
    }
    this.auto.addEventListener("click", () => this.onCamera("broadcast"));
    this.free.addEventListener("click", () => this.onCamera("orbit"));
    this.onboard.addEventListener("click", () => {
      if (this.selectedDriver != null) this.onCamera("onboard", this.selectedDriver);
    });
    mustQuery("#driver-back").addEventListener("click", () => {
      this.showGallery();
      if (this.selectedDriver != null) this.driverCards.get(this.selectedDriver)?.focus({ preventScroll: true });
    });
    this.timingTower.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-driver]");
      const driver = row && this.drivers.get(Number(row.dataset.driver));
      if (driver) this.inspectDriver(driver);
    });
  }

  setSegment(segment: ReplaySegment) {
    this.selectedDriver = null;
    this.galleryScroll = 0;
    this.cameraKey = "";
    this.lastUpdate = -Infinity;
    this.drivers.clear();
    this.driverCards.clear();
    this.mapDots.clear();
    this.radioButtons.clear();
    this.radioList.replaceChildren();
    this.grid.replaceChildren();
    this.mapDrivers.replaceChildren();
    this.driversTab.click();
    this.showGallery();

    for (const driver of segment.drivers) {
      const number = driver.driverNumber;
      const name = driverName(driver.fullName);
      const surname = name.split(" ").slice(1).join(" ") || name;
      this.drivers.set(number, driver);

      const card = document.createElement("button");
      card.type = "button";
      card.className = "driver-card";
      card.style.setProperty("--team-color", driver.teamColor);
      card.setAttribute("aria-label", `Ver ficha de ${name}`);
      card.title = `${name} · ${driver.teamName}`;
      card.append(driverPortrait(driver), label("span", "driver-card__number", `#${number}`), label("strong", "", surname));
      card.addEventListener("click", () => this.inspectDriver(driver));
      this.grid.append(card);
      this.driverCards.set(number, card);

      const dot = document.createElementNS(SVG_NS, "circle");
      dot.classList.add("map-driver");
      dot.setAttribute("r", "3.5");
      dot.setAttribute("fill", driver.teamColor);
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = driver.fullName;
      dot.append(title);
      this.mapDrivers.append(dot);
      this.mapDots.set(number, dot);
    }
    this.projection = projectCircuit(segment.circuit.centerline);
    for (const id of ["#map-track", "#map-track-outline"]) {
      mustQuery(id).setAttribute("d", this.projection?.path ?? "");
    }
    mustQuery("#map-circuit-name").textContent = segment.sessionRef.circuitShortName;
    mustQuery("#circuit-map").setAttribute("aria-label", `Mapa de ${segment.sessionRef.circuitShortName} con posiciones de pilotos`);
  }

  update(frame: ReplayFrame, mode: CameraMode, followDriver: number | null) {
    const cameraKey = `${mode}:${followDriver}`;
    if (cameraKey !== this.cameraKey) {
      this.cameraKey = cameraKey;
      this.auto.setAttribute("aria-pressed", String(mode === "broadcast"));
      this.free.setAttribute("aria-pressed", String(mode === "orbit"));
      this.lastUpdate = -Infinity;
    }

    const now = performance.now();
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;

    const onboard = mode === "onboard" && followDriver === this.selectedDriver && this.selectedDriver != null;
    this.onboard.setAttribute("aria-pressed", String(onboard));
    this.onboardLabel.textContent = onboard ? "A bordo ahora" : "Ver a bordo";

    for (const row of this.timingTower.querySelectorAll<HTMLElement>(".timing-row")) {
      const selected = Number(row.dataset.driver) === this.selectedDriver;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-pressed", String(selected));
    }

    if (this.selectedTab === "drivers" && !this.detail.hidden) {
      this.updateTelemetry(frame);
      this.updateRadioButtons();
    }
    if (this.selectedTab === "map" && this.projection) {
      for (const car of frame.cars) {
        const dot = this.mapDots.get(car.driver.driverNumber);
        if (!dot) continue;
        const point = this.projection.project(car.sample.x, car.sample.z);
        dot.setAttribute("cx", point.x.toFixed(1));
        dot.setAttribute("cy", point.y.toFixed(1));
        const selected = car.driver.driverNumber === this.selectedDriver;
        dot.classList.toggle("is-selected", selected);
        dot.setAttribute("r", selected ? "5" : "3.5");
        if (selected) this.mapDrivers.append(dot);
      }
    }
  }

  private inspectDriver(driver: DriverInfo) {
    this.showInspector();
    this.driversTab.click();
    this.selectDriver(driver);
    this.telemetry.driver.focus({ preventScroll: true });
  }

  private selectDriver(driver: DriverInfo) {
    if (!this.gallery.hidden && !this.panel.hidden) this.galleryScroll = this.panel.scrollTop;
    const resetScroll = !this.gallery.hidden || this.selectedDriver !== driver.driverNumber;
    if (this.selectedDriver !== driver.driverNumber) {
      if (this.selectedDriver !== null) this.radio.stop(this.selectedDriver);
      this.selectedDriver = driver.driverNumber;
      this.detail.style.setProperty("--team-color", driver.teamColor);
      this.portrait.replaceChildren(driverPortrait(driver));
      this.code.textContent = `#${driver.driverNumber} · ${driver.acronym}`;
      this.telemetry.driver.textContent = driverName(driver.fullName);
      this.telemetry.team.textContent = driver.teamName;
      this.showRadios(driver.driverNumber);
    }
    this.gallery.hidden = true;
    this.detail.hidden = false;
    if (resetScroll) this.panel.scrollTop = 0;
    this.lastUpdate = -Infinity;
  }

  private showGallery() {
    if (this.selectedDriver !== null) this.radio.stop(this.selectedDriver);
    this.gallery.hidden = false;
    this.detail.hidden = true;
    this.panel.scrollTop = this.galleryScroll;
  }

  private showRadios(driverNumber: number) {
    this.radioButtons.clear();
    this.radioList.replaceChildren();
    const clips = this.radio.getClips(driverNumber);
    if (!clips.length) this.radioList.append(label("p", "data-note", "Sin radios disponibles en este tramo."));
    for (const clip of clips) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "driver-onboard";
      const action = label("span", "", "");
      button.append(label("span", "", formatReplayTime(clip.time)), action);
      button.addEventListener("click", () => {
        this.radio.toggle(clip);
        this.updateRadioButtons();
      });
      this.radioButtons.set(clip, action);
      this.radioList.append(button);
    }
    this.updateRadioButtons();
  }

  private updateRadioButtons() {
    for (const [clip, action] of this.radioButtons) {
      const text = this.radio.getAction(clip);
      if (action.textContent !== text) action.textContent = text;
    }
  }

  private updateTelemetry(frame: ReplayFrame) {
    const sample = frame.cars.find((car) => car.driver.driverNumber === this.selectedDriver)?.sample;
    const { position, tyre, gap, speed, gear, rpm, drs, throttle, brake, throttleBar, brakeBar } = this.telemetry;
    position.textContent = sample?.position != null ? `P${sample.position}` : "—";
    const compound = sample?.compound?.toUpperCase() ?? "";
    tyre.textContent = COMPOUNDS[compound] ?? "—";
    tyre.dataset.compound = compound.toLowerCase();
    gap.textContent = sample?.position === 1 ? "Líder" : sample?.gapToLeader != null ? formatDelta(sample.gapToLeader) : "—";
    speed.textContent = sample ? String(Math.round(sample.speed)) : "—";
    gear.textContent = sample ? (sample.gear === 0 ? "N" : String(sample.gear)) : "—";
    rpm.textContent = sample ? Math.round(sample.rpm).toLocaleString("es") : "—";
    drs.textContent = sample ? ([10, 12, 14].includes(sample.drs) ? "Abierto" : "Cerrado") : "—";
    const throttleValue = sample ? Math.max(0, Math.min(100, sample.throttle)) : 0;
    const brakeValue = sample ? Math.max(0, Math.min(100, sample.brake)) : 0;
    throttle.textContent = sample ? `${Math.round(throttleValue)} %` : "—";
    brake.textContent = sample ? `${Math.round(brakeValue)} %` : "—";
    throttleBar.style.width = `${throttleValue}%`;
    brakeBar.style.width = `${brakeValue}%`;
  }
}
