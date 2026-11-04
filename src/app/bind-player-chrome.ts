import type { ReplayFrame } from "../types";
import { mustQuery } from "./dom";
import type { ReplayApp } from "./replay-app";

export function bindPlayerChrome(replay: ReplayApp, onFrame: (frame: ReplayFrame) => void) {
  const shell = mustQuery<HTMLElement>("#app");
  const settings = mustQuery<HTMLElement>("#settings-panel");
  const settingsButton = mustQuery<HTMLButtonElement>("#settings-button");
  const theaterButton = mustQuery<HTMLButtonElement>("#theater-button");
  const help = mustQuery<HTMLDialogElement>("#help-dialog");
  const panels = {
    classification: mustQuery<HTMLElement>("#classification-panel"),
    inspector: mustQuery<HTMLElement>("#inspector-panel"),
  };
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-toggle-panel]"));
  const compact = window.matchMedia("(max-width: 600px)");
  const medium = window.matchMedia("(max-width: 1000px)");
  let theater = false;
  let idleTimer = 0;

  const syncPanelButtons = () => {
    for (const button of toggles) {
      const name = button.dataset.togglePanel as keyof typeof panels;
      button.setAttribute("aria-expanded", String(!panels[name].hidden && !theater));
    }
  };
  const setTheater = (active: boolean) => {
    theater = active;
    shell.classList.toggle("is-theater", active);
    theaterButton.setAttribute("aria-pressed", String(active));
    theaterButton.setAttribute("aria-label", active ? "Salir del modo cine" : "Modo cine");
    theaterButton.title = active ? "Salir del modo cine (T)" : "Modo cine (T)";
    for (const panel of Object.values(panels)) panel.inert = active;
    syncPanelButtons();
  };
  const setPanel = (name: keyof typeof panels, open: boolean) => {
    if (theater) setTheater(false);
    panels[name].hidden = !open;
    if (open && compact.matches) {
      const other = name === "classification" ? "inspector" : "classification";
      panels[other].hidden = true;
    }
    syncPanelButtons();
  };
  const togglePanel = (name: keyof typeof panels) => setPanel(name, theater || panels[name].hidden);
  const applyResponsivePanels = () => {
    panels.classification.hidden = compact.matches;
    panels.inspector.hidden = medium.matches;
    syncPanelButtons();
  };
  applyResponsivePanels();
  compact.addEventListener("change", applyResponsivePanels);
  medium.addEventListener("change", applyResponsivePanels);
  for (const button of toggles) {
    button.addEventListener("click", () => {
      const name = button.dataset.togglePanel as keyof typeof panels;
      const closingFromPanel = panels[name].contains(button);
      togglePanel(name);
      if (closingFromPanel) {
        document.querySelector<HTMLButtonElement>(`.panel-toggle[data-toggle-panel="${name}"]`)?.focus({ preventScroll: true });
      }
    });
  }

  const setSettings = (open: boolean, restoreFocus = false) => {
    settings.hidden = !open;
    settingsButton.setAttribute("aria-expanded", String(open));
    if (restoreFocus) settingsButton.focus({ preventScroll: true });
  };
  settingsButton.addEventListener("click", () => setSettings(settings.hidden));
  mustQuery("#settings-close").addEventListener("click", () => setSettings(false, true));
  shell.addEventListener("pointerdown", (event) => {
    if (!settings.hidden && !settings.contains(event.target as Node) && !settingsButton.contains(event.target as Node)) setSettings(false);
  });
  theaterButton.addEventListener("click", () => {
    setTheater(!theater);
    setSettings(false);
  });
  mustQuery("#help-button").addEventListener("click", () => help.showModal());
  mustQuery("#help-close").addEventListener("click", () => help.close());
  help.addEventListener("click", (event) => {
    if (event.target !== help) return;
    const bounds = help.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) help.close();
  });

  const wake = () => {
    shell.classList.remove("is-idle");
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      const focused = document.activeElement;
      if (replay.playing && !shell.hidden && settings.hidden && !help.open
        && !shell.querySelector(".player-controls:hover, .topbar:hover")
        && !focused?.matches(":focus-visible")) {
        shell.classList.add("is-idle");
      }
    }, 4000);
  };
  shell.addEventListener("pointermove", wake);
  shell.addEventListener("pointerdown", wake);
  shell.addEventListener("focusin", wake);
  shell.addEventListener("playbackchange", wake);
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || shell.hidden || shell.inert || !replay.getController() || document.pointerLockElement || event.altKey || event.ctrlKey || event.metaKey) return;
    wake();
    if (help.open) return;
    if (event.key === "Escape") {
      if (!settings.hidden) setSettings(false, true);
      else if (theater) setTheater(false);
      return;
    }
    if ((event.target as HTMLElement).closest("input, select, textarea, [contenteditable], [role=tab]")) return;
    const key = event.key.toLowerCase();
    if (key === " " && (event.target as HTMLElement).closest("button, a")) return;
    const buttons: Record<string, string> = {
      " ": "#play-toggle", k: "#play-toggle", r: "#reset-button",
      t: "#theater-button", f: "#fullscreen-button", "?": "#help-button",
    };
    if (buttons[key]) {
      event.preventDefault();
      mustQuery<HTMLButtonElement>(buttons[key]).click();
    } else if (key === "c" || key === "p") {
      event.preventDefault();
      togglePanel(key === "c" ? "classification" : "inspector");
    } else if (key === "arrowleft" || key === "arrowright") {
      event.preventDefault();
      const duration = replay.getController()!.getDuration();
      const frame = replay.seek((replay.currentTime + (key === "arrowleft" ? -10000 : 10000)) / Math.max(1, duration));
      if (frame) onFrame(frame);
    }
  });
  wake();
  return { showInspector: () => setPanel("inspector", true) };
}
