import type { FrameCarState, RaceControlEvent, ReplayFrame, ReplaySegment } from "../types";
import { compoundLetter, formatCompoundAge, formatInterval } from "./format";

type TowerRowNodes = {
  root: HTMLElement;
  position: HTMLElement;
  teamColor: HTMLElement;
  acronym: HTMLElement;
  compound: HTMLElement;
  tyreAge: HTMLElement;
  interval: HTMLElement;
};

function createRow(car: FrameCarState): TowerRowNodes {
  const root = document.createElement("button");
  root.type = "button";
  root.className = "timing-row";
  root.dataset.driver = String(car.driver.driverNumber);
  root.title = `Ver cámara a bordo de ${car.driver.fullName} · ${car.driver.teamName}`;
  root.setAttribute("aria-label", `Cámara a bordo de ${car.driver.fullName}`);

  const position = document.createElement("span");
  position.className = "timing-row__pos";

  const teamColor = document.createElement("span");
  teamColor.className = "timing-row__team";
  teamColor.style.background = car.driver.teamColor;

  const acronym = document.createElement("span");
  acronym.className = "timing-row__acronym";

  const tyre = document.createElement("span");
  tyre.className = "timing-row__tyre";

  const compound = document.createElement("span");
  compound.className = "timing-row__compound";

  const tyreAge = document.createElement("span");
  tyreAge.className = "timing-row__age";

  tyre.append(compound, tyreAge);

  const interval = document.createElement("span");
  interval.className = "timing-row__interval";

  root.append(position, teamColor, acronym, tyre, interval);

  return { root, position, teamColor, acronym, compound, tyreAge, interval };
}

function fillRow(nodes: TowerRowNodes, car: FrameCarState, isLeader: boolean) {
  nodes.teamColor.style.background = car.driver.teamColor;
  nodes.position.textContent = car.sample.position != null ? String(car.sample.position) : "-";
  nodes.acronym.textContent = car.driver.acronym;
  nodes.compound.textContent = compoundLetter(car.sample.compound);
  nodes.compound.dataset.compound = (car.sample.compound ?? "unknown").toLowerCase();
  nodes.tyreAge.textContent = formatCompoundAge(car.sample.tyreAge);
  nodes.interval.textContent = isLeader
    ? "LÍDER"
    : formatInterval(car.sample.intervalToAhead, car.sample.gapToLeader);
  nodes.root.classList.toggle("timing-row--leader", isLeader);
}

function sessionLapAt(events: RaceControlEvent[], now: number): number | null {
  let lap: number | null = null;
  for (const event of events) {
    if (event.t > now) {
      break;
    }
    if (event.lapNumber != null && (lap == null || event.lapNumber > lap)) {
      lap = event.lapNumber;
    }
  }
  return lap;
}

export class TimingTowerView {
  private readonly rows = new Map<number, TowerRowNodes>();
  private raceControl: RaceControlEvent[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly lapLabel: HTMLElement | null = null,
  ) {}

  setSegment(segment: ReplaySegment) {
    this.raceControl = segment.raceControl ?? [];
  }

  clear() {
    this.container.replaceChildren();
    this.rows.clear();
    if (this.lapLabel) {
      this.lapLabel.hidden = true;
      this.lapLabel.textContent = "";
    }
  }

  update(frame: ReplayFrame) {
    const order: HTMLElement[] = [];

    for (const [index, car] of frame.cars.entries()) {
      const key = car.driver.driverNumber;
      let nodes = this.rows.get(key);
      if (!nodes) {
        nodes = createRow(car);
        this.rows.set(key, nodes);
      }
      fillRow(nodes, car, index === 0);
      order.push(nodes.root);
    }

    let needsReorder = this.container.childElementCount !== order.length;
    if (!needsReorder) {
      for (let i = 0; i < order.length; i += 1) {
        if (this.container.children[i] !== order[i]) {
          needsReorder = true;
          break;
        }
      }
    }
    if (needsReorder) {
      this.container.replaceChildren(...order);
    }

    if (this.lapLabel) {
      const lap = sessionLapAt(this.raceControl, frame.now);
      if (lap != null) {
        this.lapLabel.hidden = false;
        this.lapLabel.textContent = `Vuelta ${lap}`;
      } else {
        this.lapLabel.hidden = true;
        this.lapLabel.textContent = "";
      }
    }
  }
}
