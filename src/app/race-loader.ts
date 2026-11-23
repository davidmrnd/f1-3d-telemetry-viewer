import {
  findRaceInCatalog,
  loadRacesCatalog,
  type RaceCatalogEntry,
  type RacesCatalog,
} from "../data/races-catalog";
import { loadGhostCapture, loadReplayCapture } from "../data/load-replay-segment";
import { ReplayController } from "../replay/replay-controller";
import type { PresentationMode, RaceScene } from "../scene/race-scene";
import { prepareCircuitInWorker } from "../scene/track/prepare-circuit-in-worker";
import type { DriverInfo, GhostCapture, GhostLap, ReplayFrame, ReplaySegment } from "../types";
import type { DesktopPlayerView } from "./desktop-player-view";
import { mustQuery } from "./dom";
import { DrivingSession, takeoverTime } from "./driving-session";
import type { DrivingView } from "./driving-view";
import { createGhostChallenge } from "./ghost-challenge";
import type { LoadingView } from "./loading-view";
import type { RadioPlayer } from "./radio-player";
import type { RacePickerView } from "./race-picker-view";
import { RaceSetupView, type DriverChoice } from "./race-setup-view";
import type { ReplayElements } from "./replay-elements";
import type { ReplayApp } from "./replay-app";
import { paintSessionMetadata, setReplayDocumentTitle } from "./session-ui";
import type { TimingTowerView } from "./timing-tower-view";

interface RaceLoaderOptions {
  appShell: HTMLElement;
  changeRaceButton: HTMLButtonElement;
  racePicker: RacePickerView;
  ui: ReplayElements;
  scene: RaceScene;
  replay: ReplayApp;
  driving: DrivingView;
  timingTower: TimingTowerView;
  desktopPlayer: DesktopPlayerView;
  loadingView: LoadingView;
  radioPlayer: RadioPlayer;
  render: (frame: ReplayFrame) => void;
  syncPlayButton: (playing: boolean) => void;
  resetClock: () => void;
}

type ReplayCapture = Awaited<ReturnType<typeof loadReplayCapture>>;
type RaceSelection = { mode: "replay" }
  | { mode: "race"; driver: DriverInfo; capture: ReplayCapture }
  | { mode: "ghost"; driver: DriverInfo; capture: GhostCapture; lap: GhostLap };

export function createRaceLoader(options: RaceLoaderOptions) {
  const {
    appShell, changeRaceButton, racePicker, ui, scene, replay, driving,
    timingTower, desktopPlayer, loadingView, radioPlayer, render, syncPlayButton, resetClock,
  } = options;
  const raceSetup = new RaceSetupView();
  let loadingRace = false;
  let choosing = false;
  let activeSegment: ReplaySegment | null = null;
  let replayPresentation: PresentationMode = "realistic";

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

  function raceDrivers(segment: ReplaySegment): DriverChoice[] {
    const start = takeoverTime(segment);
    const grid = new Map(segment.startingGrid.map(slot => [slot.driverNumber, slot.position]));
    return segment.drivers.filter(({ driverNumber }) => segment.samples[driverNumber]?.length &&
      !segment.retirements?.some(retirement => retirement.driverNumber === driverNumber && retirement.t <= start))
      .sort((a, b) => (grid.get(a.driverNumber) ?? Infinity) - (grid.get(b.driverNumber) ?? Infinity) ||
        a.fullName.localeCompare(b.fullName))
      .map(driver => ({ driver }));
  }

  function ghostDrivers(capture: GhostCapture): DriverChoice[] {
    const byNumber = new Map(capture.drivers.map(driver => [driver.driverNumber, driver]));
    return capture.ghostLaps.flatMap(lap => {
      const driver = byNumber.get(lap.driverNumber);
      return driver && capture.samples[lap.driverNumber]?.length ? [{ driver, lap }] : [];
    }).sort((a, b) => a.lap.durationMs - b.lap.durationMs);
  }

  async function chooseMode(entry: RaceCatalogEntry, initialError?: string): Promise<RaceSelection | null> {
    let raceRequest: Promise<ReplayCapture> | undefined;
    let ghostRequest: Promise<GhostCapture> | undefined;
    let error = initialError;
    for (;;) {
      const mode = await raceSetup.chooseMode(entry, error);
      error = undefined;
      if (mode === null) return null;
      if (mode === "replay") return { mode };
      if (mode === "race") {
        const request = raceRequest ??= loadReplayCapture(entry).catch(reason => {
          raceRequest = undefined;
          throw reason;
        });
        const choice = await raceSetup.chooseDriver(entry, mode, request.then(({ segment }) => raceDrivers(segment)));
        if (choice) return { mode, driver: choice.driver, capture: await request };
      } else {
        const request = ghostRequest ??= loadGhostCapture(entry).catch(reason => {
          ghostRequest = undefined;
          throw reason;
        });
        const choice = await raceSetup.chooseDriver(entry, mode, request.then(ghostDrivers));
        if (choice?.lap) return { mode, driver: choice.driver, capture: await request, lap: choice.lap };
      }
    }
  }

  async function loadSelectedRace(entry: RaceCatalogEntry, selection: RaceSelection, sceneReady = Promise.resolve()) {
    loadingRace = true;
    appShell.inert = true;
    loadingView.show(entry);
    try {
      ui.statusPill.classList.remove("is-ready");
      ui.statusPill.textContent = "Cargando circuito…";
      const { bytes, segment } = selection.mode === "race" ? selection.capture : await loadReplayCapture(entry, (loaded, total) => {
        if (total) loadingView.update(35 * Math.min(1, loaded / total));
      });
      await loadingView.checkpoint(40, "Preparando trayectorias y circuito…");
      const [circuit, controller] = await Promise.all([
        prepareCircuitInWorker(bytes),
        selection.mode === "ghost" ? null : ReplayController.create(segment, progress => loadingView.checkpoint(40 + 28 * progress)),
        sceneReady,
      ]);
      if (selection.mode !== "replay" && scene.isXrPresenting()) await scene.exitVr();
      const wasDriving = driving.getSession() !== null;
      activeSegment = null;
      replay.setController(null);
      driving.setSession(null);
      if (selection.mode !== "replay") {
        if (!wasDriving) replayPresentation = scene.getPresentationMode();
        scene.setPresentationMode("realistic");
      } else if (wasDriving) {
        scene.setPresentationMode(replayPresentation);
      }
      scene.loadSegment(segment, circuit, selection.mode === "replay" ? undefined
        : { driver: selection.driver, solo: selection.mode === "ghost" });
      if (controller) {
        await loadingView.checkpoint(70, "Preparando el tráfico y los adelantamientos…");
        await scene.prepareTraffic(controller.getDuration(), time => controller.getFrame(time),
          progress => loadingView.checkpoint(70 + 28 * progress));
      }
      if (selection.mode === "replay") {
        replay.setController(controller);
        scene.setCameraMode(scene.getCameraMode() === "onboard" ? "broadcast" : scene.getCameraMode());
        timingTower.setSegment(segment);
        timingTower.clear();
        desktopPlayer.setSegment(segment);
      } else {
        const track = scene.getDrivingTrack();
        if (!track) throw new Error("Este circuito no tiene una superficie preparada para conducir.");
        if (selection.mode === "ghost") {
          await loadingView.checkpoint(85, "Preparando la vuelta fantasma…");
          const challenge = createGhostChallenge(track, selection.capture, selection.lap);
          driving.setSession(new DrivingSession({ mode: "ghost", challenge }, track, selection.driver.driverNumber));
        } else {
          const traffic = scene.getTraffic();
          if (!controller || !traffic) throw new Error("No se ha podido preparar el tráfico de la carrera.");
          driving.setSession(new DrivingSession({ mode: "race", replay: controller, traffic, start: takeoverTime(segment) },
            track, selection.driver.driverNumber));
        }
      }
      replay.playing = false;
      radioPlayer.setSegment(segment);
      paintSessionMetadata(segment, ui);
      mustQuery("#session-season").textContent = `FÓRMULA 1 · TEMPORADA ${segment.sessionRef.year}`;
      appShell.hidden = false;
      appShell.inert = false;
      scene.resize();
      if (selection.mode === "replay" && controller) render(controller.getFrame(0));
      else driving.update(scene, 0);
      syncPlayButton(false);
      ui.statusPill.textContent = "Listo.";
      ui.statusPill.classList.add("is-ready");
      activeSegment = segment;

      const url = new URL(window.location.href);
      url.searchParams.set("id", entry.id);
      url.searchParams.set("year", String(entry.year));
      url.searchParams.set("race", entry.race);
      window.history.replaceState({}, "", url);
    } finally {
      resetClock();
      loadingRace = false;
      appShell.inert = false;
      loadingView.hide();
    }
  }

  async function chooseAndLoadRace(options: {
    allowQueryShortcut?: boolean;
    catalog?: RacesCatalog;
    sceneReady?: Promise<void>;
  } = {}) {
    if (choosing) return;
    choosing = true;
    try {
      radioPlayer.stop();
      driving.pause();
      const wasPlaying = replay.playing;
      replay.playing = false;
      syncPlayButton(false);
      const catalog = options.catalog ?? await loadRacesCatalog();
      const fromQuery = options.allowQueryShortcut === false ? null : raceFromQuery(catalog.races);
      if (fromQuery) {
        await loadSelectedRace(fromQuery, { mode: "replay" }, options.sceneReady);
        return;
      }
      appShell.hidden = true;
      let preferred = catalog.activeId;
      for (;;) {
        const entry = await racePicker.open(catalog.races, preferred, activeSegment !== null);
        if (!entry) break;
        preferred = entry.id;
        let error: string | undefined;
        for (;;) {
          const selection = await chooseMode(entry, error);
          if (!selection) break;
          try {
            await loadSelectedRace(entry, selection, options.sceneReady);
            return;
          } catch (reason) {
            console.error(reason);
            appShell.hidden = true;
            error = reason instanceof Error ? reason.message : "No se pudo cargar el circuito.";
          }
        }
      }
      appShell.hidden = activeSegment === null;
      replay.playing = replay.getController() !== null && wasPlaying;
      syncPlayButton(replay.playing);
      resetClock();
      if (activeSegment) {
        ui.statusPill.textContent = "Listo.";
        ui.statusPill.classList.add("is-ready");
        setReplayDocumentTitle(activeSegment);
        changeRaceButton.focus({ preventScroll: true });
      }
    } finally {
      choosing = false;
    }
  }

  return { chooseAndLoadRace, isLoading: () => loadingRace };
}
