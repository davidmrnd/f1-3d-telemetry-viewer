import "./style.css";
import "./app/player.css";

import { bindControls } from "./app/bind-controls";
import { bindPlayerChrome } from "./app/bind-player-chrome";
import {
  bindGraphicsSettings,
  queryGraphicsControlElements,
} from "./app/bind-graphics-settings";
import { bindXr } from "./app/bind-xr";
import { populateCameraDriverSelect } from "./app/camera-controls";
import { mustQuery } from "./app/dom";
import { DesktopPlayerView } from "./app/desktop-player-view";
import { paintFrame } from "./app/frame-ui";
import { LoadingView } from "./app/loading-view";
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
let loadingRace = false;
const loadingView = new LoadingView();
const desktopPlayer = new DesktopPlayerView((mode, driver) => {
  if (driver != null) {
    ui.cameraDriverSelect.value = String(driver);
    ui.cameraDriverSelect.dispatchEvent(new Event("change"));
  }
  ui.cameraModeSelect.value = mode;
  ui.cameraModeSelect.dispatchEvent(new Event("change"));
});

const syncPlayButton = (playing: boolean) => {
  const label = playing ? "Pausar" : "Reproducir";
  if (ui.playToggle.getAttribute("aria-label") === label) return;
  ui.playToggle.setAttribute("aria-label", label);
  ui.playToggle.title = `${label} (Espacio)`;
  ui.playToggle.querySelector("use")?.setAttribute("href", playing ? "#i-pause" : "#i-play");
  mustQuery("#playback-state").textContent = playing ? "REPRODUCIENDO" : "EN PAUSA";
  appShell.dispatchEvent(new Event("playbackchange"));
};

const render = (frame: Parameters<typeof paintFrame>[0]) => {
  const controller = replay.getController();
  if (!controller) return;
  paintFrame(frame, controller.getDuration(), scene, timingTower, ui);
  desktopPlayer.update(frame, scene.getCameraMode(), scene.getFollowDriver());
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
  if (loadingRace) return;
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
  return racePicker.open(races, preferredId, replay.getController() != null);
}

async function loadSelectedRace(entry: RaceCatalogEntry) {
  loadingRace = true;
  appShell.inert = true;
  loadingView.show(entry);
  try {
    ui.statusPill.classList.remove("is-ready");
    ui.statusPill.textContent = "Cargando datos del replay...";
    await loadingView.checkpoint(0);
    const segment = await loadReplaySegmentFromRace(entry, (loaded, total) => {
      if (total) loadingView.update(35 * Math.min(1, loaded / total));
    });
    await loadingView.checkpoint(40, "Preparando trayectorias…");
    const controller = await ReplayController.create(segment, (progress) =>
      loadingView.checkpoint(40 + 19 * progress),
    );
    replay.setController(controller);
    replay.playing = false;
    await loadingView.checkpoint(60, "Construyendo el circuito…");
    scene.loadSegment(segment);
    populateCameraDriverSelect(ui.cameraDriverSelect, segment.drivers);
    scene.setFollowDriver(Number(ui.cameraDriverSelect.value));
    paintSessionMetadata(segment, ui);
    timingTower.setSegment(segment);
    timingTower.clear();
    desktopPlayer.setSegment(segment);
    mustQuery("#session-season").textContent = `FÓRMULA 1 · TEMPORADA ${segment.sessionRef.year}`;
    appShell.hidden = false;
    scene.resize();
    const initialFrame = controller.getFrame(0);
    const initialMode = scene.getCameraMode();
    const initialDriver = scene.getFollowDriver();
    await loadingView.checkpoint(75, "Preparando cámaras…");
    scene.setCameraMode("onboard");
    for (const [index, driver] of segment.drivers.entries()) {
      scene.setFollowDriver(driver.driverNumber);
      scene.update(initialFrame);
      scene.render();
      desktopPlayer.capturePreview(canvas, "onboard", driver.driverNumber);
      await loadingView.checkpoint(75 + 23 * (index + 1) / segment.drivers.length);
    }
    scene.setCameraMode("broadcast");
    scene.update(initialFrame);
    scene.render();
    desktopPlayer.capturePreview(canvas, "broadcast");
    if (initialDriver != null) scene.setFollowDriver(initialDriver);
    scene.setCameraMode(initialMode);
    await loadingView.checkpoint(99, "Últimos detalles…");
    render(initialFrame);
    syncPlayButton(false);
    ui.statusPill.textContent = "Listo.";
    ui.statusPill.classList.add("is-ready");

    const url = new URL(window.location.href);
    url.searchParams.set("id", entry.id);
    url.searchParams.set("year", String(entry.year));
    url.searchParams.set("race", entry.race);
    window.history.replaceState({}, "", url);
    await loadingView.checkpoint(100, "Finalizando…");
  } finally {
    lastTick = performance.now();
    loadingRace = false;
    appShell.inert = false;
    loadingView.hide();
  }
}

async function chooseAndLoadRace(options: { allowQueryShortcut?: boolean } = {}) {
  const wasPlaying = replay.playing;
  replay.playing = false;
  syncPlayButton(false);
  const catalog = await loadRacesCatalog();
  const selected = await pickRace(catalog.races, catalog.activeId, options);
  if (!selected) {
    appShell.hidden = replay.getController() == null;
    replay.playing = replay.getController() != null && wasPlaying;
    syncPlayButton(replay.playing);
    lastTick = performance.now();
    if (!appShell.hidden) changeRaceButton.focus({ preventScroll: true });
    return;
  }

  await loadSelectedRace(selected);
}

async function bootstrap() {
  bindControls(replay, scene, ui, render, syncPlayButton);
  bindPlayerChrome(replay, render);
  window.addEventListener("resize", () => scene.resize());
  changeRaceButton.addEventListener("click", () => {
    void chooseAndLoadRace({ allowQueryShortcut: false }).catch((error) => {
      appShell.hidden = false;
      ui.statusPill.classList.remove("is-ready");
      ui.statusPill.textContent = error instanceof Error ? error.message : "No se pudo cargar la carrera.";
    });
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
    ui.statusPill.classList.remove("is-ready");
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
