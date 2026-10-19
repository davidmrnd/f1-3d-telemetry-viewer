import "./style.css";

import { bindControls } from "./app/bind-controls";
import {
  bindGraphicsSettings,
  queryGraphicsControlElements,
} from "./app/bind-graphics-settings";
import { bindXr } from "./app/bind-xr";
import { populateCameraDriverSelect } from "./app/camera-controls";
import { mustQuery } from "./app/dom";
import { paintFrame } from "./app/frame-ui";
import { RacePickerView } from "./app/race-picker-view";
import { ReplayApp } from "./app/replay-app";
import { paintSessionMetadata } from "./app/session-ui";
import { TimingTowerView } from "./app/timing-tower-view";
import { loadReplaySegmentFromRace } from "./data/load-replay-segment";
import {
  findRaceInCatalog,
  loadRacesCatalog,
  type RaceCatalogEntry,
} from "./data/races-catalog";
import { ReplayController } from "./replay/replay-controller";
import { preloadCarModels } from "./scene/car-models";
import { preloadTrackEnvironment } from "./scene/track-environment";
import { RaceScene } from "./scene/race-scene";

const canvas = mustQuery<HTMLCanvasElement>("#race-canvas");
const appShell = mustQuery<HTMLElement>("#app");
const changeRaceButton = mustQuery<HTMLButtonElement>("#change-race-button");
const racePicker = new RacePickerView(
  mustQuery<HTMLElement>("#race-picker"),
  mustQuery<HTMLElement>("#race-picker-grid"),
  mustQuery<HTMLElement>("#race-picker-empty"),
);

const ui = {
  statusPill: mustQuery<HTMLDivElement>("#status-pill"),
  eventPill: mustQuery<HTMLDivElement>("#event-pill"),
  cameraPill: mustQuery<HTMLDivElement>("#camera-pill"),
  playToggle: mustQuery<HTMLButtonElement>("#play-toggle"),
  resetButton: mustQuery<HTMLButtonElement>("#reset-button"),
  enterVrButton: mustQuery<HTMLButtonElement>("#enter-vr"),
  speedSelect: mustQuery<HTMLSelectElement>("#speed-select"),
  cameraModeSelect: mustQuery<HTMLSelectElement>("#camera-mode-select"),
  cameraDriverSelect: mustQuery<HTMLSelectElement>("#camera-driver-select"),
  cameraDriverWrap: mustQuery<HTMLElement>("#camera-driver-wrap"),
  fullscreenButton: mustQuery<HTMLButtonElement>("#fullscreen-button"),
  sceneShell: mustQuery<HTMLElement>(".scene-shell"),
  timeline: mustQuery<HTMLInputElement>("#timeline"),
  timeReadout: mustQuery<HTMLSpanElement>("#time-readout"),
  sessionTitle: mustQuery<HTMLElement>("#session-title"),
  sessionCircuit: mustQuery<HTMLElement>("#session-circuit"),
  sessionWindow: mustQuery<HTMLElement>("#session-window"),
  sessionEvent: mustQuery<HTMLElement>("#session-event"),
  carCountTag: mustQuery<HTMLDivElement>("#car-count-tag"),
};

const scene = new RaceScene(canvas);
const replay = new ReplayApp();
const timingTower = new TimingTowerView(
  mustQuery<HTMLDivElement>("#timing-tower"),
  mustQuery<HTMLElement>("#timing-lap-tag"),
);
let lastTick = performance.now();
let bootstrapped = false;

const syncPlayButton = (playing: boolean) => {
  ui.playToggle.textContent = playing ? "Pausar" : "Reproducir";
};

const render = (frame: Parameters<typeof paintFrame>[0]) => {
  const controller = replay.getController();
  if (!controller) return;
  paintFrame(frame, controller.getDuration(), scene, timingTower, ui);
  const duration = controller.getDuration();
  scene.syncVrMenuState({
    normalizedTime: duration > 0 ? frame.now / duration : 0,
    timeLabel: ui.timeReadout.textContent ?? "",
    playing: replay.playing,
    speed: replay.speed,
    cameraMode: scene.getCameraMode(),
    followDriver: scene.getFollowDriver(),
  });
};

function tick(now: number) {
  if (!replay.getController()) {
    scene.update({ now: 0, normalized: 0, cars: [], activeEvent: null, trackStatus: null });
    scene.render();
    return;
  }
  const frame = replay.tick(now - lastTick);
  lastTick = now;
  if (frame) {
    render(frame);
    syncPlayButton(replay.playing);
  } else {
    scene.render();
  }
}

function raceFromQuery(catalogRaces: RaceCatalogEntry[]): RaceCatalogEntry | null {
  const params = new URLSearchParams(window.location.search);
  return findRaceInCatalog(
    { races: catalogRaces, activeId: null },
    {
      id: params.get("id"),
      year: params.get("year"),
      race: params.get("race") ?? params.get("circuit"),
    },
  );
}

async function pickRace(
  races: RaceCatalogEntry[],
  preferredId: string | null,
  options: { allowQueryShortcut?: boolean } = {},
): Promise<RaceCatalogEntry | null> {
  if (races.length === 0) {
    appShell.hidden = true;
    await racePicker.open([], null);
    return null;
  }

  if (options.allowQueryShortcut !== false) {
    const fromQuery = raceFromQuery(races);
    if (fromQuery) {
      return fromQuery;
    }
  }

  appShell.hidden = true;
  return racePicker.open(races, preferredId);
}

async function loadSelectedRace(entry: RaceCatalogEntry) {
  ui.statusPill.textContent = "Cargando datos del replay...";
  const segment = await loadReplaySegmentFromRace(entry);
  const controller = new ReplayController(segment);
  replay.playing = false;
  replay.setController(controller);
  scene.loadSegment(segment);
  populateCameraDriverSelect(ui.cameraDriverSelect, segment.drivers);
  scene.setFollowDriver(Number(ui.cameraDriverSelect.value));
  paintSessionMetadata(segment, ui);
  timingTower.setSegment(segment);
  timingTower.clear();
  lastTick = performance.now();
  render(controller.getFrame(0));
  syncPlayButton(false);
  ui.statusPill.textContent = "Listo.";
  appShell.hidden = false;

  const url = new URL(window.location.href);
  url.searchParams.set("id", entry.id);
  url.searchParams.set("year", String(entry.year));
  url.searchParams.set("race", entry.race);
  window.history.replaceState({}, "", url);
}

async function chooseAndLoadRace(options: { allowQueryShortcut?: boolean } = {}) {
  const catalog = await loadRacesCatalog();
  const selected = await pickRace(catalog.races, catalog.activeId, options);
  if (!selected) {
    appShell.hidden = true;
    syncPlayButton(false);
    return;
  }

  await loadSelectedRace(selected);
}

async function bootstrap() {
  bindControls(replay, scene, ui, render, syncPlayButton);
  window.addEventListener("resize", () => scene.resize());
  changeRaceButton.addEventListener("click", () => {
    void chooseAndLoadRace({ allowQueryShortcut: false });
  });

  try {
    ui.statusPill.textContent = "Cargando modelos 3D...";
    await Promise.all([preloadCarModels(), preloadTrackEnvironment()]);
    scene.initTrackEnvironment();

    if (!bootstrapped) {
      const graphics = bindGraphicsSettings(scene, queryGraphicsControlElements());
      bindXr(replay, scene, ui, render, syncPlayButton, graphics);
      bootstrapped = true;
    }

    await chooseAndLoadRace();
  } catch (error) {
    console.error(error);
    replay.playing = false;
    appShell.hidden = false;
    ui.statusPill.textContent = "Error de carga.";
    ui.sessionTitle.textContent = "Error de carga";
    ui.sessionEvent.textContent =
      error instanceof Error && error.message.includes("coche")
        ? "No se pudo cargar el modelo 3D del coche (f1model.gltf)."
        : "El visualizador necesita el snapshot JSON y el modelo GLTF. Ejecuta npm run sync:data si falta el JSON.";
    syncPlayButton(false);
  }
}

void bootstrap();
scene.setAnimationLoop((time) => {
  scene.pollXrInput();
  tick(time);
});
