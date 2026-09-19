import type { CameraMode } from "../scene/cameras/types";
import { isImmersiveVrSupported } from "../scene/xr/xr-session";
import type { RaceScene } from "../scene/race-scene";
import type { ReplayFrame } from "../types";
import type { ReplayApp } from "./replay-app";
import { formatReplayTime } from "./format";
import { syncCameraDriverSelectVisibility } from "./camera-controls";

export type XrUiElements = {
  enterVrButton: HTMLButtonElement;
  playToggle: HTMLButtonElement;
  speedSelect: HTMLSelectElement;
  cameraModeSelect: HTMLSelectElement;
  cameraDriverSelect: HTMLSelectElement;
  cameraDriverWrap: HTMLElement;
  timeline: HTMLInputElement;
};

export function bindXr(
  replay: ReplayApp,
  scene: RaceScene,
  elements: XrUiElements,
  onFrame: (frame: ReplayFrame) => void,
  syncPlayButton: (playing: boolean) => void,
) {
  const {
    enterVrButton,
    speedSelect,
    cameraModeSelect,
    cameraDriverSelect,
    cameraDriverWrap,
    timeline,
  } = elements;

  const applyCameraModeFromVr = (mode: CameraMode) => {
    scene.setCameraMode(mode);
    cameraModeSelect.value = mode;
    syncCameraDriverSelectVisibility(mode, cameraDriverWrap);
    const controller = replay.getController();
    if (controller) {
      onFrame(controller.getFrame(replay.currentTime));
    }
  };

  scene.setXrHooks({
    getMenuState: () => {
      const controller = replay.getController();
      const duration = controller?.getDuration() ?? 0;
      const normalized = duration > 0 ? replay.currentTime / duration : 0;
      return {
        playing: replay.playing,
        normalizedTime: normalized,
        timeLabel: `${formatReplayTime(replay.currentTime)} / ${formatReplayTime(duration)}`,
        speed: replay.speed,
        cameraMode: scene.getCameraMode(),
        followDriver: scene.getFollowDriver(),
        drivers: Array.from(cameraDriverSelect.options).map((option) => ({
          driverNumber: Number(option.value),
          label: option.textContent || option.value,
        })),
      };
    },
    onTogglePlay: () => {
      syncPlayButton(replay.togglePlay());
      scene.syncVrMenuState({ playing: replay.playing });
    },
    onReset: () => {
      const frame = replay.reset();
      syncPlayButton(false);
      scene.syncVrMenuState({
        playing: false,
        normalizedTime: 0,
        timeLabel: `00:00.0 / ${formatReplayTime(replay.getController()?.getDuration() ?? 0)}`,
      });
      if (frame) {
        onFrame(frame);
      }
    },
    onSeek: (ratio) => {
      const frame = replay.seek(ratio);
      timeline.value = String(Math.round(ratio * 1000));
      if (frame) {
        onFrame(frame);
        const duration = replay.getController()?.getDuration() ?? 0;
        scene.syncVrMenuState({
          normalizedTime: ratio,
          timeLabel: `${formatReplayTime(replay.currentTime)} / ${formatReplayTime(duration)}`,
        });
      }
    },
    onSetSpeed: (speed) => {
      replay.setSpeed(speed);
      speedSelect.value = String(speed);
      scene.syncVrMenuState({ speed });
    },
    onSetCameraMode: (mode) => {
      applyCameraModeFromVr(mode);
      scene.syncVrMenuState({ cameraMode: mode });
    },
    onSetFollowDriver: (driverNumber) => {
      scene.setFollowDriver(driverNumber);
      cameraDriverSelect.value = String(driverNumber);
      const controller = replay.getController();
      if (controller) {
        onFrame(controller.getFrame(replay.currentTime));
      }
      scene.syncVrMenuState({ followDriver: driverNumber });
    },
    onSessionStart: () => {
      enterVrButton.textContent = "Salir de VR";
      enterVrButton.classList.add("is-xr-active");
    },
    onSessionEnd: () => {
      enterVrButton.textContent = "Entrar en VR";
      enterVrButton.classList.remove("is-xr-active");
    },
  });

  enterVrButton.addEventListener("click", () => {
    void (async () => {
      try {
        if (scene.isXrPresenting()) {
          await scene.exitVr();
        } else {
          await scene.enterVr();
        }
      } catch (error) {
        console.error(error);
        enterVrButton.textContent = "VR no disponible";
        enterVrButton.disabled = true;
      }
    })();
  });

  void isImmersiveVrSupported().then((supported) => {
    enterVrButton.hidden = !supported;
    if (!supported) {
      return;
    }
    enterVrButton.title = "Inicia una sesión WebXR immersive-vr (Meta Quest)";
  });
}
