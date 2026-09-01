import "./style.css";

import { bindControls } from "./app/bind-controls";
import { populateCameraDriverSelect } from "./app/camera-controls";
import { mustQuery } from "./app/dom";
import { DriverListView } from "./app/driver-list-view";
import { paintFrame } from "./app/frame-ui";
import { ReplayApp } from "./app/replay-app";
import { paintSessionMetadata } from "./app/session-ui";
import { loadReplaySegment } from "./data/load-replay-segment";
import { ReplayController } from "./replay/replay-controller";
import { preloadCarModels } from "./scene/car-models";
import { preloadTrackEnvironment } from "./scene/track-environment";
import { RaceScene } from "./scene/race-scene";

const canvas = mustQuery<HTMLCanvasElement>("#race-canvas");
const ui = {
  statusPill: mustQuery<HTMLDivElement>("#status-pill"),
  eventPill: mustQuery<HTMLDivElement>("#event-pill"),
  cameraPill: mustQuery<HTMLDivElement>("#camera-pill"),
  playToggle: mustQuery<HTMLButtonElement>("#play-toggle"),
  resetButton: mustQuery<HTMLButtonElement>("#reset-button"),
  speedSelect: mustQuery<HTMLSelectElement>("#speed-select"),
  cameraModeSelect: mustQuery<HTMLSelectElement>("#camera-mode-select"),
  cameraDriverSelect: mustQuery<HTMLSelectElement>("#camera-driver-select"),
  cameraDriverWrap: mustQuery<HTMLElement>("#camera-driver-wrap"),
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
const driverList = new DriverListView(mustQuery<HTMLDivElement>("#driver-list"));
let lastTick = performance.now();

const syncPlayButton = (playing: boolean) => {
  ui.playToggle.textContent = playing ? "Pausar" : "Reproducir";
};

const render = (frame: Parameters<typeof paintFrame>[0]) => {
  const controller = replay.getController();
  if (!controller) return;
  paintFrame(frame, controller.getDuration(), scene, driverList, ui);
};

function loop(now: number) {
  requestAnimationFrame(loop);
  if (!replay.getController()) {
    scene.update({ now: 0, normalized: 0, cars: [], activeEvent: null });
    return;
  }
  const frame = replay.tick(now - lastTick);
  lastTick = now;
  if (frame) {
    render(frame);
    syncPlayButton(replay.playing);
  }
}

async function bootstrap() {
  bindControls(replay, scene, ui, render, syncPlayButton);
  window.addEventListener("resize", () => scene.resize());
  ui.statusPill.textContent = "Cargando datos del replay...";

  try {
    ui.statusPill.textContent = "Cargando modelos 3D...";
    await Promise.all([preloadCarModels(), preloadTrackEnvironment()]);
    scene.initTrackEnvironment();

    const segment = await loadReplaySegment();
    const controller = new ReplayController(segment);
    replay.setController(controller);
    scene.loadSegment(segment);
    populateCameraDriverSelect(ui.cameraDriverSelect, segment.drivers);
    scene.setFollowDriver(Number(ui.cameraDriverSelect.value));
    paintSessionMetadata(segment, ui);
    driverList.clear();
    render(controller.getFrame(0));
    ui.statusPill.textContent = "Listo.";
  } catch (error) {
    console.error(error);
    replay.playing = false;
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
requestAnimationFrame(loop);
