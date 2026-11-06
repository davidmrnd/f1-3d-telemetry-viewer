import type { RaceMilestone, RaceMilestoneControls, RaceMilestoneKind } from "../types";
import { formatReplayTime } from "./format";

const PAGE_SIZE = 8;
const KINDS: Record<RaceMilestoneKind, { label: string; icon: string }> = {
  finish: { label: "Paso por meta", icon: "flag" },
  overtake: { label: "Adelantamiento", icon: "overtake" },
  off_track: { label: "Salida de pista", icon: "off-track" },
  pit_entry: { label: "Entrada a boxes", icon: "pit" },
};

function element(tag: string, className: string, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function icon(name: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export class MilestoneListView {
  private items: readonly RaceMilestone[] = [];
  private driver: number | undefined;
  private page = 0;
  private filter = "all";
  private readonly summary = element("p", "milestone-summary");
  private readonly filters = new Map<string, { button: HTMLButtonElement; count: HTMLElement }>();
  private readonly results = element("div", "milestone-results");
  private readonly list = element("div", "milestone-list");
  private readonly pagination = element("div", "milestone-pagination");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private readonly pageLabel = document.createElement("span");

  constructor(container: HTMLElement, private readonly controls: RaceMilestoneControls, private readonly driverMode = false) {
    container.classList.toggle("milestones--driver", driverMode);
    const toolbar = element("div", "milestone-toolbar");
    const filters = element("div", "milestone-filters");
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", driverMode ? "Filtrar adelantamientos" : "Filtrar hitos del circuito");
    const options = driverMode
      ? [["all", "Todos"], ["made", "Realizados"], ["received", "Recibidos"]]
      : [["all", "Todos"], ["overtake", "Adelantamientos"], ["finish", "Meta"], ["off_track", "Fuera de pista"], ["pit_entry", "Boxes"]];
    for (const [value, text] of options) {
      const button = document.createElement("button");
      const count = element("span", "milestone-filter__count", "0");
      button.type = "button";
      button.className = "milestone-filter";
      button.append(element("span", "", text), count);
      button.addEventListener("click", () => { this.filter = value; this.page = 0; this.paint(); });
      filters.append(button);
      this.filters.set(value, { button, count });
    }
    this.results.setAttribute("role", "status");
    this.previous.type = this.next.type = "button";
    this.previous.append(icon("chevron"), document.createTextNode("Anterior"));
    this.next.append(document.createTextNode("Siguiente"), icon("chevron"));
    this.previous.addEventListener("click", () => { this.page--; this.paint(); });
    this.next.addEventListener("click", () => { this.page++; this.paint(); });
    this.pagination.append(this.previous, this.pageLabel, this.next);
    toolbar.append(this.summary, filters);
    container.append(toolbar, this.results, this.list, this.pagination);
  }

  setItems(items: readonly RaceMilestone[], driver?: number) {
    this.items = items;
    this.driver = driver;
    this.page = 0;
    this.filter = "all";
    const overtakes = items.filter(item => item.kind === "overtake" && item.drivers.includes(driver ?? -1));
    const made = overtakes.filter(item => item.drivers[0] === driver).length;
    const received = overtakes.length - made;
    this.summary.replaceChildren();
    if (this.driverMode) {
      this.summary.append(element("span", "", `${made} ${made === 1 ? "realizado" : "realizados"}`),
        element("span", "", `${received} ${received === 1 ? "recibido" : "recibidos"}`));
    } else {
      this.summary.append(element("strong", "", String(items.length)), document.createTextNode("momentos en este tramo"));
    }
    this.paint();
  }

  private matches(item: RaceMilestone, filter: string) {
    return this.driverMode
      ? item.kind === "overtake" && item.drivers.includes(this.driver ?? -1)
        && (filter === "all" || (filter === "made" ? item.drivers[0] === this.driver : item.drivers[1] === this.driver))
      : filter === "all" || item.kind === filter;
  }

  private paint() {
    const items = this.items.filter(item => this.matches(item, this.filter));
    for (const [value, { button, count }] of this.filters) {
      button.setAttribute("aria-pressed", String(value === this.filter));
      count.textContent = String(this.items.filter(item => this.matches(item, value)).length);
    }
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    this.results.replaceChildren(element("span", "", `${items.length} ${items.length === 1 ? "MOMENTO" : "MOMENTOS"}`), element("span", "", "POR TIEMPO"));
    this.list.replaceChildren();
    if (!items.length) {
      const empty = element("div", "milestone-empty");
      empty.append(icon("flag"), element("strong", "", "Sin momentos registrados"),
        element("p", "", "No hay eventos de este tipo en el tramo. Prueba con otro filtro."));
      this.list.append(empty);
    }
    for (const item of items.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "milestone-row";
      button.dataset.kind = item.kind;
      button.title = item.detail;
      const kind = KINDS[item.kind];
      const marker = element("span", "milestone-row__marker");
      marker.append(icon(kind.icon));
      const copy = element("span", "milestone-row__copy");
      const meta = element("span", "milestone-row__meta");
      const type = this.driverMode ? item.drivers[0] === this.driver ? "Realizado" : "Recibido" : kind.label;
      button.setAttribute("aria-label", `${this.driverMode ? `${type} · ` : ""}${item.label}. ${formatReplayTime(item.time)}${item.approximate ? " (aproximado)" : ""}. ${this.driverMode ? "Revivir a bordo" : "Revivir instante"}`);
      meta.append(element("span", "milestone-row__type", `${type}${!this.driverMode && item.approximate ? " · aprox." : ""}`),
        element("span", "milestone-row__time", formatReplayTime(item.time)));
      const foot = element("span", "milestone-row__foot");
      foot.append(element("span", "milestone-row__action", this.driverMode ? "Revivir a bordo" : "Revivir instante"));
      if (item.approximate) foot.append(element("span", "milestone-row__approx", "aprox."));
      copy.append(meta, element("strong", "milestone-row__title", item.label));
      if (item.kind !== "overtake") copy.append(element("span", "milestone-row__detail", item.detail));
      copy.append(foot);
      const play = element("span", "milestone-row__play");
      play.append(icon("play"));
      button.append(marker, copy, play);
      button.addEventListener("click", () => this.controls.jumpTo(item, this.driver));
      this.list.append(button);
    }
    this.pagination.hidden = pages <= 1;
    this.previous.disabled = this.page === 0;
    this.next.disabled = this.page === pages - 1;
    this.pageLabel.textContent = `${String(this.page + 1).padStart(2, "0")} / ${String(pages).padStart(2, "0")}`;
  }
}
