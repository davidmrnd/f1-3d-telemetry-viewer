import {
  findRaceInCatalog,
  loadRacesCatalog,
  type RaceCatalogEntry,
} from "../data/races-catalog";
import { loadReplaySegmentFromRace } from "../data/load-replay-segment";
import { ReplayController } from "../replay/replay-controller";
import type { RaceScene } from "../scene/race-scene";
import type { ReplayFrame } from "../types";
import { captureCameraPreviews } from "./camera-previews";
import { populateCameraDriverSelect } from "./camera-controls";
import type { DesktopPlayerView } from "./desktop-player-view";
import { mustQuery } from "./dom";
import type { LoadingView } from "./loading-view";
import type { RacePickerView } from "./race-picker-view";
import type { ReplayElements } from "./replay-elements";
import type { ReplayApp } from "./replay-app";
import { paintSessionMetadata } from "./session-ui";
import type { TimingTowerView } from "./timing-tower-view";

interface RaceLoaderOptions {
  canvas: HTMLCanvasElement;
  appShell: HTMLElement;
  changeRaceButton: HTMLButtonElement;
  racePicker: RacePickerView;
  ui: ReplayElements;
  scene: RaceScene;
  replay: ReplayApp;
  timingTower: TimingTowerView;
  desktopPlayer: DesktopPlayerView;
  loadingView: LoadingView;
  render: (frame: ReplayFrame) => void;
  syncPlayButton: (playing: boolean) => void;
  resetClock: () => void;
}

export function createRaceLoader(options: RaceLoaderOptions) {
  const {
    canvas, appShell, changeRaceButton, racePicker, ui, scene, replay,
    timingTower, desktopPlayer, loadingView, render, syncPlayButton, resetClock,
  } = options;
  let loadingRace = false;

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
    loadingView.show(entry);    try {
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
      await captureCameraPreviews(canvas, scene, desktopPlayer, segment, initialFrame, loadingView);
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
      resetClock();
      loadingRace = false;
      appShell.inert = false;
      loadingView.hide();    }
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
      resetClock();
      if (!appShell.hidden) changeRaceButton.focus({ preventScroll: true });
      return;
    }

    await loadSelectedRace(selected);
  }

  return { chooseAndLoadRace, isLoading: () => loadingRace };
}
