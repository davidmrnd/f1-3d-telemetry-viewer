import type { CameraMode } from "../scene/cameras/types";
import type { ReplayFrame } from "../types";
import type { ReplayApp } from "./replay-app";
import type { RaceScene } from "../scene/race-scene";
import { syncCameraDriverSelectVisibility } from "./camera-controls";
import { bindViewportFullscreen } from "./viewport-fullscreen";

export type ControlElements = {
  playToggle: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  timeline: HTMLInputElement;
  speedSelect: HTMLSelectElement;
  cameraModeSelect: HTMLSelectElement;
  cameraDriverSelect: HTMLSelectElement;
  cameraDriverWrap: HTMLElement;
  fullscreenButton: HTMLButtonElement;
  sceneShell: HTMLElement;
};

export function bindControls(
  replay: ReplayApp,
  scene: RaceScene,
  elements: ControlElements,
  onFrame: (frame: ReplayFrame) => void,
  syncPlayButton: (playing: boolean) => void,
) {
  const {
    playToggle,
    resetButton,
    timeline,
    speedSelect,
    cameraModeSelect,
    cameraDriverSelect,
    cameraDriverWrap,
    fullscreenButton,
    sceneShell,
  } = elements;

  bindViewportFullscreen(sceneShell, fullscreenButton);

  const applyCameraMode = (mode: CameraMode) => {
    scene.setCameraMode(mode);
    syncCameraDriverSelectVisibility(mode, cameraDriverWrap);
    const controller = replay.getController();
    if (controller) {
      onFrame(controller.getFrame(replay.currentTime));
    }
  };

  playToggle.addEventListener("click", () => {
    const controller = replay.getController();
    if (!controller) return;
    if (!replay.playing && replay.currentTime >= controller.getDuration()) {
      const frame = replay.seek(0);
      if (frame) onFrame(frame);
    }
    syncPlayButton(replay.togglePlay());
  });

  resetButton.addEventListener("click", () => {
    const frame = replay.reset();
    syncPlayButton(false);
    if (frame) {
      onFrame(frame);
    }
  });

  timeline.addEventListener("input", () => {
    const ratio = Number(timeline.value) / 1000;
    const frame = replay.seek(ratio);
    if (frame) {
      onFrame(frame);
    }
  });

  speedSelect.addEventListener("change", () => {
    replay.setSpeed(Number(speedSelect.value));
  });

  cameraModeSelect.addEventListener("change", () => {
    applyCameraMode(cameraModeSelect.value as CameraMode);
  });

  cameraDriverSelect.addEventListener("change", () => {
    scene.setFollowDriver(Number(cameraDriverSelect.value));
    const controller = replay.getController();
    if (controller) {
      onFrame(controller.getFrame(replay.currentTime));
    }
  });

  applyCameraMode(cameraModeSelect.value as CameraMode);
}
