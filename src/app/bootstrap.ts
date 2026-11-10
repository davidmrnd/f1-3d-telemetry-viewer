import { bindControls } from "./bind-controls";
import { bindEngineAudio } from "./bind-engine-audio";
import { bindPlayerChrome } from "./bind-player-chrome";
import {
  bindGraphicsSettings,
  queryGraphicsControlElements,
} from "./bind-graphics-settings";
import { bindXr } from "./bind-xr";
import { bindTabletop } from "./bind-tabletop";
import { mustQuery } from "./dom";
import { DesktopPlayerView } from "./desktop-player-view";
import { paintFrame } from "./frame-ui";
import { formatReplayTime } from "./format";
import { LoadingView } from "./loading-view";
import { AnimationFrames } from "./animation-frames";
import { RacePickerView } from "./race-picker-view";
import { RadioBroadcastView } from "./radio-broadcast-view";
import { RadioPlayer } from "./radio-player";
import { ReplayApp } from "./replay-app";
import { TimingTowerView } from "./timing-tower-view";
import { preloadCarModels } from "../scene/car-models";
import { preloadTrackEnvironment } from "../scene/track-environment";
import { preloadTrackModels } from "../scene/track/track-models";
import { RaceScene } from "../scene/race-scene";
import { GraphicsPerformanceView } from "./graphics-performance-view";

import { queryReplayElements } from "./replay-elements";
import { createRaceLoader } from "./race-loader";
import type { RaceMilestoneControls } from "../types";

export function startReplayApplication() {
  const canvas = mustQuery<HTMLCanvasElement>("#race-canvas");
  const appShell = mustQuery<HTMLElement>("#app");
  const changeRaceButton = mustQuery<HTMLButtonElement>("#change-race-button");
  const racePicker = new RacePickerView(
    mustQuery<HTMLElement>("#race-picker"),
    mustQuery<HTMLElement>("#race-picker-grid"),
    mustQuery<HTMLElement>("#race-picker-empty"),
  );

  const ui = queryReplayElements();

  const radioPlayer = new RadioPlayer(clip => {
    const duration = replay.getController()?.getDuration() ?? 0;
    if (duration <= 0) return;
    const frame = replay.seek(Math.max(0, clip.time - 1000) / duration);
    if (frame && !scene.isXrPresenting()) render(frame);
  });
  const engine = bindEngineAudio(radioPlayer);
  const radioBroadcast = new RadioBroadcastView();
  const milestones: RaceMilestoneControls = {
    getMilestones: () => replay.getController()?.milestones ?? [],
    jumpTo: (milestone, driverNumber) => {
      const controller = replay.getController();
      if (!controller || controller.getDuration() <= 0) return;
      radioPlayer.stop();
      if (!scene.isXrPresenting() && scene.getPresentationMode() === "tabletop") {
        scene.setPresentationMode("realistic");
        appShell.dispatchEvent(new Event("presentationchange"));
      }
      const driver = driverNumber ?? milestone.drivers[0];
      if (driver != null) {
        scene.setFollowDriver(driver);
        scene.setCameraMode("onboard");
      }
      replay.playing = true;
      const frame = replay.seek(Math.max(0, milestone.time - 4000) / controller.getDuration());
      resetClock();
      syncPlayButton(true);
      if (frame && !scene.isXrPresenting()) render(frame);
    },
  };
  const scene = new RaceScene(canvas, radioPlayer, milestones);
  const graphicsPerformance = new GraphicsPerformanceView(mustQuery<HTMLOutputElement>("#graphics-stats"));
  const replay = new ReplayApp(radioPlayer, () => engine.silence());
  const timingTower = new TimingTowerView(
    mustQuery<HTMLDivElement>("#timing-tower"),
    mustQuery<HTMLElement>("#timing-lap-tag"),
  );
  let lastTick = performance.now();
  const resetClock = () => { lastTick = performance.now(); };
  appShell.addEventListener("xrsessionchange", resetClock);
  const loadingFrames = new AnimationFrames();
  const loadingView = new LoadingView(undefined, loadingFrames);
  const syncPlayButton = (playing: boolean) => {
    if (!playing) engine.silence();
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
    const broadcast = radioPlayer.getBroadcast();
    const mode = scene.getCameraMode();
    if (scene.isXrPresenting()) {
      radioBroadcast.update(null);
      scene.update(frame);
      scene.updateRadioBroadcast(broadcast);
      scene.render();
    } else {
      radioBroadcast.update(broadcast);
      paintFrame(frame, controller.getDuration(), scene, timingTower, ui);
      desktopPlayer.update(frame, mode, scene.getFollowDriver());
    }
    if (replay.playing) {
      engine.update(() => scene.getEngineAudioView(), Boolean(broadcast));
    }
  };
  const { showInspector } = bindPlayerChrome(replay, render);
  const desktopPlayer = new DesktopPlayerView((mode, driver) => {
    if (scene.isXrPresenting() || scene.getPresentationMode() === "tabletop") return;
    if (driver != null) scene.setFollowDriver(driver);
    if (mode !== scene.getCameraMode()) scene.setCameraMode(mode);
    const controller = replay.getController();
    if (controller) render(controller.getFrame(replay.currentTime));
  }, showInspector, radioPlayer, milestones);

  const raceLoader = createRaceLoader({
    appShell, changeRaceButton, racePicker, ui, scene, replay,
    timingTower, desktopPlayer, loadingView, radioPlayer, render, syncPlayButton, resetClock,
  });

  function tick(now: number) {
    if (raceLoader.isLoading()) { scene.render(); return; }
    if (!replay.getController()) {
      scene.update({ now: 0, normalized: 0, cars: [], activeEvent: null, trackStatus: null });
      scene.render();
      return;
    }
    const frame = replay.tick(scene.isXrPresenting() ? Math.min(100, Math.max(0, now - lastTick)) : now - lastTick);
    lastTick = now;
    if (frame) {
      render(frame);
      syncPlayButton(replay.playing);
    } else {
      scene.render();
    }
  }

  async function bootstrap() {
    bindControls(replay, ui, render, syncPlayButton);
    window.addEventListener("resize", () => scene.resize());
    changeRaceButton.addEventListener("click", () => {
      void raceLoader.chooseAndLoadRace({ allowQueryShortcut: false }).catch((error) => {
        appShell.hidden = false;
        ui.statusPill.classList.remove("is-ready");
        ui.statusPill.textContent = error instanceof Error ? error.message : "No se pudo cargar la carrera.";
      });
    });

    try {
      ui.statusPill.textContent = "Cargando modelos 3D...";
      await Promise.all([preloadCarModels(), preloadTrackEnvironment(), preloadTrackModels()]);
      scene.initTrackEnvironment();

      const graphics = bindGraphicsSettings(scene, queryGraphicsControlElements());
      bindTabletop(scene);
      bindXr(scene, ui, graphics, () => syncPlayButton(replay.togglePlay()), {
        getPlaybackState: () => {
          const duration = replay.getController()?.getDuration() ?? 0;
          return { playing: replay.playing, speed: replay.speed, normalizedTime: duration ? replay.currentTime / duration : 0,
            timeLabel: `${formatReplayTime(replay.currentTime)} / ${formatReplayTime(duration)}` };
        },
        onSeek: ratio => replay.setTimeRatio(ratio),
        onJump: seconds => {
          const duration = replay.getController()?.getDuration() ?? 0;
          if (duration > 0) replay.setTimeRatio((replay.currentTime + seconds * 1000) / duration);
        },
        onSetSpeed: speed => { replay.setSpeed(speed); ui.speedSelect.value = String(speed); },
      });

      await raceLoader.chooseAndLoadRace();
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
  scene.setAnimationLoop((time, frame) => {
    loadingFrames.flush(time);
    scene.pollXrInput(frame);
    tick(time);
    if (!raceLoader.isLoading()) graphicsPerformance.update(scene, time);
  });
}
