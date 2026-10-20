import type { CameraMode } from "../scene/cameras/types";
import type { DriverInfo, ReplayFrame, ReplaySegment } from "../types";
import { projectCircuit } from "./circuit-map";
import { mustQuery } from "./dom";

const SVG_NS = "http://www.w3.org/2000/svg";

function label(tag: string, className: string, text: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function driverSurname(driver: DriverInfo) {
  return driver.fullName.split(" ").slice(1).join(" ").toLocaleLowerCase("es").replace(/(^|[ -])\p{L}/gu, (letter) => letter.toLocaleUpperCase("es"));
}

function makeIcon(name: string) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("icon");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function onboardPreview(color: string, number: number) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 140 90");
  const shapes = [
    ["path", { d: "M0 0h140v90H0z", fill: "#303a43" }],
    ["path", { d: "M0 45 55 20h30l55 25v45H0z", fill: "#575c60" }],
    ["path", { d: "m20 90 42-68m58 68L78 22", stroke: "#c6c5bb", "stroke-width": "2", fill: "none" }],
    ["path", { d: "M0 76Q70 32 140 76M70 51v33", fill: "none", stroke: "#0a0b0e", "stroke-width": "12" }],
    ["path", { d: "m42 90 10-28h36l10 28", fill: color }],
    ["ellipse", { cx: "70", cy: "86", rx: "19", ry: "13", fill: "#111319", stroke: "#c5c7cf", "stroke-width": "1" }],
  ] as const;
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  const preview = label("span", "camera-card__preview", "");
  preview.append(svg, label("span", "camera-card__number", String(number)));
  return preview;
}

export class DesktopPlayerView {
  private readonly cameraList = mustQuery<HTMLElement>("#camera-list");
  private readonly quickDrivers = mustQuery<HTMLElement>("#quick-drivers");
  private readonly mapDrivers = mustQuery<SVGGElement>("#map-drivers");
  private readonly cameraCards = new Map<string, HTMLButtonElement>();
  private readonly driverButtons = new Map<number, HTMLButtonElement>();
  private readonly mapDots = new Map<number, SVGCircleElement>();
  private projection: ReturnType<typeof projectCircuit> = null;
  private selectionKey = "";
  private lastUpdate = -Infinity;
  private selectedTab = "cameras";
  private readonly telemetry = {
    driver: mustQuery<HTMLElement>("#telemetry-driver"),
    team: mustQuery<HTMLElement>("#telemetry-team"),
    speed: mustQuery<HTMLElement>("#telemetry-speed"),
    gear: mustQuery<HTMLElement>("#telemetry-gear"),
    rpm: mustQuery<HTMLElement>("#telemetry-rpm"),
    drs: mustQuery<HTMLElement>("#telemetry-drs"),
    throttle: mustQuery<HTMLElement>("#throttle-value"),
    brake: mustQuery<HTMLElement>("#brake-value"),
    throttleBar: mustQuery<HTMLElement>("#throttle-bar"),
    brakeBar: mustQuery<HTMLElement>("#brake-bar"),
  };

  constructor(private readonly onCamera: (mode: CameraMode, driver?: number) => void) {
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
    mustQuery("#drivers-previous").addEventListener("click", () => this.scrollDrivers(-1));
    mustQuery("#drivers-next").addEventListener("click", () => this.scrollDrivers(1));
    mustQuery("#timing-tower").addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-driver]");
      if (row) this.onCamera("onboard", Number(row.dataset.driver));
    });
  }

  setSegment(segment: ReplaySegment) {
    this.selectionKey = "";
    this.lastUpdate = -Infinity;
    this.cameraCards.clear();
    this.driverButtons.clear();
    this.mapDots.clear();
    this.cameraList.replaceChildren();
    this.quickDrivers.replaceChildren();
    this.quickDrivers.scrollLeft = 0;
    this.mapDrivers.replaceChildren();
    this.addCamera("broadcast", "Cámara principal", "Realización automática", makeIcon("camera"));
    this.addCamera("orbit", "Cámara libre", "Explora el circuito · WASD + ratón", makeIcon("orbit"));
    this.cameraList.append(label("p", "camera-group-label", "A BORDO · TODOS LOS PILOTOS"));
    for (const driver of segment.drivers) {
      const surname = driverSurname(driver);
      this.addCamera("onboard", `A bordo · ${surname}`, driver.teamName, onboardPreview(driver.teamColor, driver.driverNumber), driver.driverNumber);
      const quick = document.createElement("button");
      quick.type = "button";
      quick.className = "quick-driver";
      quick.style.setProperty("--team-color", driver.teamColor);
      quick.setAttribute("aria-label", `Cámara a bordo de ${driver.fullName}`);
      quick.title = `${driver.fullName} · ${driver.teamName}`;
      const copy = label("span", "quick-driver__copy", "");
      copy.append(label("strong", "", driver.acronym), label("span", "", surname));
      quick.append(label("span", "quick-driver__number", String(driver.driverNumber)), copy);
      quick.addEventListener("click", () => this.onCamera("onboard", driver.driverNumber));
      this.quickDrivers.append(quick);
      this.driverButtons.set(driver.driverNumber, quick);

      const dot = document.createElementNS(SVG_NS, "circle");
      dot.classList.add("map-driver");
      dot.setAttribute("r", "3.5");
      dot.setAttribute("fill", driver.teamColor);
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = driver.fullName;
      dot.append(title);
      this.mapDrivers.append(dot);
      this.mapDots.set(driver.driverNumber, dot);
    }
    mustQuery("#camera-count").textContent = String(segment.drivers.length + 2).padStart(2, "0");
    this.projection = projectCircuit(segment.circuit.centerline);
    for (const id of ["#map-track", "#map-track-outline"]) {
      mustQuery(id).setAttribute("d", this.projection?.path ?? "");
    }
    mustQuery("#map-circuit-name").textContent = segment.sessionRef.circuitShortName;
    mustQuery("#circuit-map").setAttribute("aria-label", `Mapa de ${segment.sessionRef.circuitShortName} con posiciones de pilotos`);
  }

  update(frame: ReplayFrame, mode: CameraMode, driverNumber: number | null) {
    const key = `${mode}:${driverNumber}`;
    if (key !== this.selectionKey) {
      this.selectionKey = key;
      this.lastUpdate = -Infinity;
      for (const [cardKey, card] of this.cameraCards) {
        const active = cardKey === (mode === "onboard" ? `onboard:${driverNumber}` : mode);
        card.classList.toggle("is-active", active);
        card.setAttribute("aria-pressed", String(active));
      }
      for (const [number, button] of this.driverButtons) {
        const active = mode === "onboard" && number === driverNumber;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
        if (active) {
          const left = button.offsetLeft - this.quickDrivers.offsetLeft;
          this.quickDrivers.scrollTo({ left: Math.max(0, left - this.quickDrivers.clientWidth / 2 + button.clientWidth / 2), behavior: "smooth" });
        }
      }
      document.querySelectorAll<HTMLElement>(".timing-row").forEach((row) => {
        const active = mode === "onboard" && Number(row.dataset.driver) === driverNumber;
        row.classList.toggle("is-selected", active);
        row.setAttribute("aria-pressed", String(active));
      });
    }
    const now = performance.now();
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    if (this.selectedTab === "data") {
      const car = frame.cars.find((car) => car.driver.driverNumber === driverNumber) ?? frame.cars[0];
      if (car) {
        const { driver, sample } = car;
        this.telemetry.driver.textContent = driver.fullName.toLocaleLowerCase("es").replace(/(^|[ -])\p{L}/gu, (letter) => letter.toLocaleUpperCase("es"));
        this.telemetry.driver.style.setProperty("--team-color", driver.teamColor);
        this.telemetry.team.textContent = driver.teamName;
        this.telemetry.speed.textContent = String(Math.round(sample.speed));
        this.telemetry.gear.textContent = sample.gear === 0 ? "N" : String(sample.gear);
        this.telemetry.rpm.textContent = Math.round(sample.rpm).toLocaleString("es");
        this.telemetry.drs.textContent = [10, 12, 14].includes(sample.drs) ? "ABIERTO" : "CERRADO";
        const throttle = Math.max(0, Math.min(100, sample.throttle));
        const brake = Math.max(0, Math.min(100, sample.brake));
        this.telemetry.throttle.textContent = `${Math.round(throttle)} %`;
        this.telemetry.brake.textContent = `${Math.round(brake)} %`;
        this.telemetry.throttleBar.style.width = `${throttle}%`;
        this.telemetry.brakeBar.style.width = `${brake}%`;
      }
    }
    if (this.selectedTab === "map" && this.projection) {
      for (const car of frame.cars) {
        const dot = this.mapDots.get(car.driver.driverNumber);
        if (!dot) continue;
        const point = this.projection.project(car.sample.x, car.sample.z);
        dot.setAttribute("cx", point.x.toFixed(1));
        dot.setAttribute("cy", point.y.toFixed(1));
        const selected = car.driver.driverNumber === driverNumber;
        dot.classList.toggle("is-selected", selected);
        dot.setAttribute("r", selected ? "5" : "3.5");
        if (selected) this.mapDrivers.append(dot);
      }
    }
  }

  capturePreview(canvas: HTMLCanvasElement, mode: CameraMode, driverNumber?: number) {
    const key = mode === "onboard" ? `onboard:${driverNumber}` : mode;
    const card = this.cameraCards.get(key);
    const preview = card?.querySelector<HTMLElement>(".camera-card__preview");
    if (!preview || !canvas.width || !canvas.height) return;
    const small = document.createElement("canvas");
    small.width = 160;
    small.height = 90;
    const context = small.getContext("2d");
    if (!context) return;
    const cropWidth = Math.min(canvas.width, canvas.height * 16 / 9);
    const cropHeight = cropWidth * 9 / 16;
    context.drawImage(canvas, (canvas.width - cropWidth) / 2, (canvas.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, 160, 90);
    const image = document.createElement("img");
    image.alt = "";
    image.width = 160;
    image.height = 90;
    image.src = small.toDataURL("image/jpeg", 0.75);
    preview.replaceChildren(image);
  }

  private addCamera(mode: CameraMode, title: string, subtitle: string, visual: Element, driver?: number) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-card";
    button.setAttribute("aria-pressed", "false");
    const preview = visual.classList.contains("camera-card__preview") ? visual : label("span", "camera-card__preview", "");
    if (preview !== visual) preview.append(visual);
    const copy = label("span", "camera-card__copy", "");
    copy.append(label("span", "camera-card__title", title), label("span", "camera-card__subtitle", subtitle));
    button.append(preview, copy, label("span", "camera-card__indicator", ""));
    button.addEventListener("click", () => this.onCamera(mode, driver));
    this.cameraList.append(button);
    this.cameraCards.set(mode === "onboard" ? `onboard:${driver}` : mode, button);
  }

  private scrollDrivers(direction: number) {
    this.quickDrivers.scrollBy({ left: direction * this.quickDrivers.clientWidth * 0.8, behavior: "smooth" });
  }
}
