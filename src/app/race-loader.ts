import {
  findRaceInCatalog,
  loadRacesCatalog,
  type RaceCatalogEntry,
} from "../data/races-catalog";
import { loadReplaySegmentFromRace } from "../data/load-replay-segment";
import { ReplayController } from "../replay/replay-controller";
import type { RaceScene } from "../scene/race-scene";
import type { ReplayFrame } from "../types";
import type { DesktopPlayerView } from "./desktop-player-view";
import { mustQuery } from "./dom";
import type { LoadingView } from "./loading-view";
import type { RadioPlayer } from "./radio-player";
import type { RacePickerView } from "./race-picker-view";
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
  timingTower: TimingTowerView;
  desktopPlayer: DesktopPlayerView;
  loadingView: LoadingView;
  radioPlayer: RadioPlayer;
  render: (frame: ReplayFrame) => void;
  syncPlayButton: (playing: boolean) => void;
  resetClock: () => void;
}

export function createRaceLoader(options: RaceLoaderOptions) {
  const {
    appShell, changeRaceButton, racePicker, ui, scene, replay,
    timingTower, desktopPlayer, loadingView, radioPlayer, render, syncPlayButton, resetClock,
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
        loadingView.checkpoint(40 + 14 * progress),
      );
      await loadingView.checkpoint(55, "Construyendo el circuito…");
      scene.loadSegment(segment);
      await loadingView.checkpoint(70, "Preparando el tráfico y los adelantamientos…");
      await scene.prepareTraffic(controller.getDuration(), time => controller.getFrame(time),
        progress => loadingView.checkpoint(70 + 28 * progress));
      replay.setController(controller);
      replay.playing = false;
      radioPlayer.setSegment(segment);
      if (scene.getCameraMode() === "onboard") scene.setCameraMode("broadcast");
      paintSessionMetadata(segment, ui);
      timingTower.setSegment(segment);
      timingTower.clear();
      desktopPlayer.setSegment(segment);
      mustQuery("#session-season").textContent = `FÓRMULA 1 · TEMPORADA ${segment.sessionRef.year}`;
      appShell.hidden = false;
      scene.resize();
      const initialFrame = controller.getFrame(0);
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
      loadingView.hide();
    }
  }

  async function chooseAndLoadRace(options: { allowQueryShortcut?: boolean } = {}) {
    radioPlayer.stop();
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
      const segment = replay.getController()?.getSegment();
      if (segment) setReplayDocumentTitle(segment);
      if (!appShell.hidden) changeRaceButton.focus({ preventScroll: true });
      return;
    }

    await loadSelectedRace(selected);
  }

  return { chooseAndLoadRace, isLoading: () => loadingRace };
}
