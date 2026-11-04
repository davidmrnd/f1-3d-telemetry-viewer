import type { ReplayFrame } from "../types";
import type { ReplayApp } from "./replay-app";
import { bindViewportFullscreen } from "./viewport-fullscreen";

export type ControlElements = {
  playToggle: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  timeline: HTMLInputElement;
  speedSelect: HTMLSelectElement;
  fullscreenButton: HTMLButtonElement;
  sceneShell: HTMLElement;
};

export function bindControls(
  replay: ReplayApp,
  elements: ControlElements,
  onFrame: (frame: ReplayFrame) => void,
  syncPlayButton: (playing: boolean) => void,
) {
  const {
    playToggle,
    resetButton,
    timeline,
    speedSelect,
    fullscreenButton,
    sceneShell,
  } = elements;

  bindViewportFullscreen(sceneShell, fullscreenButton);

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
}
