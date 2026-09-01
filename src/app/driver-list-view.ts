import type { FrameCarState, ReplayFrame } from "../types";
import { formatDelta } from "./format";

type DriverCardNodes = {
  root: HTMLElement;
  color: HTMLElement;
  name: HTMLElement;
  numberSpan: HTMLSpanElement;
  team: HTMLElement;
  position: HTMLElement;
  speed: HTMLElement;
  throttle: HTMLElement;
  brake: HTMLElement;
  gear: HTMLElement;
  gap: HTMLElement;
  compound: HTMLElement;
};

function statRow(label: string): { row: HTMLDivElement; dd: HTMLElement } {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  row.append(dt, dd);
  return { row, dd };
}

function createCard(driver: FrameCarState): DriverCardNodes {
  const root = document.createElement("article");
  root.className = "driver-card";
  root.dataset.driver = String(driver.driver.driverNumber);

  const head = document.createElement("div");
  head.className = "driver-card__head";

  const color = document.createElement("div");
  color.className = "driver-color";
  color.style.background = driver.driver.teamColor;

  const identity = document.createElement("div");
  const name = document.createElement("p");
  name.className = "driver-name";
  const numberSpan = document.createElement("span");
  name.append(document.createTextNode(`${driver.driver.acronym} `), numberSpan);

  const team = document.createElement("p");
  team.className = "driver-team";
  team.textContent = driver.driver.teamName;
  identity.append(name, team);

  const position = document.createElement("div");
  position.className = "driver-position";

  head.append(color, identity, position);

  const stats = document.createElement("dl");
  stats.className = "driver-stats";
  const vel = statRow("Vel");
  const throttle = statRow("Throttle");
  const brake = statRow("Brake");
  const gear = statRow("Gear");
  const gap = statRow("Gap");
  const compound = statRow("Compound");
  stats.append(vel.row, throttle.row, brake.row, gear.row, gap.row, compound.row);
  root.append(head, stats);

  return {
    root,
    color,
    name,
    numberSpan,
    team,
    position,
    speed: vel.dd,
    throttle: throttle.dd,
    brake: brake.dd,
    gear: gear.dd,
    gap: gap.dd,
    compound: compound.dd,
  };
}

function fillCard(nodes: DriverCardNodes, car: FrameCarState) {
  nodes.root.style.borderColor = `${car.driver.teamColor}66`;
  nodes.color.style.background = car.driver.teamColor;
  nodes.name.firstChild!.textContent = `${car.driver.acronym} `;
  nodes.numberSpan.textContent = `#${car.driver.driverNumber}`;
  nodes.team.textContent = car.driver.teamName;
  nodes.position.textContent = `P${car.sample.position ?? "-"}`;
  nodes.speed.textContent = `${Math.round(car.sample.speed)} km/h`;
  nodes.throttle.textContent = `${Math.round(car.sample.throttle)}%`;
  nodes.brake.textContent = `${Math.round(car.sample.brake)}%`;
  nodes.gear.textContent = String(car.sample.gear);
  nodes.gap.textContent = formatDelta(car.sample.gapToLeader);
  nodes.compound.textContent = car.sample.compound ?? "N/D";
}

export class DriverListView {
  private readonly cards = new Map<number, DriverCardNodes>();

  constructor(private readonly container: HTMLElement) {}

  clear() {
    this.container.replaceChildren();
    this.cards.clear();
  }

  update(frame: ReplayFrame) {
    for (const car of frame.cars) {
      const key = car.driver.driverNumber;
      let nodes = this.cards.get(key);
      if (!nodes) {
        nodes = createCard(car);
        this.cards.set(key, nodes);
        this.container.append(nodes.root);
      }
      fillCard(nodes, car);
    }
  }
}
