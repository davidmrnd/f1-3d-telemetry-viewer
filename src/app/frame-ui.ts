import type { ReplayFrame } from "../types";
import type { DriverListView } from "./driver-list-view";
import { formatReplayTime } from "./format";

export type FrameUiElements = {
  timeline: HTMLInputElement;
  timeReadout: HTMLSpanElement;
  eventPill: HTMLDivElement;
  cameraPill: HTMLDivElement;
};

function trackPhaseLabel(frame: ReplayFrame) {
  const phase = frame.trackStatus?.phase;
  switch (phase) {
    case "formation":
      return "Vuelta de formación";
    case "standing_start":
      return "Parrilla de salida";
    case "pre_session": {
      const stationary =
        frame.cars.length > 0 && frame.cars.every((car) => car.sample.speed <= 5);
      return stationary ? "Parrilla de salida" : null;
    }
    case "yellow":
      return "Bandera amarilla";
    case "safety_car":
      return "Safety car";
    case "red":
      return "Bandera roja";
    case "finished":
      return "Finalizada";
    default:
      return null;
  }
}

export function paintFrame(
  frame: ReplayFrame,
  duration: number,
  scene: {
    update(frame: ReplayFrame): void;
    render(): void;
    getActiveCameraLabel(): string;
    getCameraMode(): string;
  },
  driverList: DriverListView,
  elements: FrameUiElements,
) {
  scene.update(frame);
  scene.render();
  driverList.update(frame);
  elements.timeline.value = String(Math.round(frame.normalized * 1000));
  elements.timeReadout.textContent = `${formatReplayTime(frame.now)} / ${formatReplayTime(duration)}`;

  const cameraLabel = scene.getActiveCameraLabel();
  const mode = scene.getCameraMode();
  if ((mode === "broadcast" || mode === "onboard" || mode === "orbit") && cameraLabel) {
    elements.cameraPill.hidden = false;
    elements.cameraPill.textContent = cameraLabel;
  } else {
    elements.cameraPill.hidden = true;
    elements.cameraPill.textContent = "";
  }

  const phaseLabel = trackPhaseLabel(frame);
  elements.eventPill.hidden = !phaseLabel;
  elements.eventPill.textContent = phaseLabel ?? "";
}
