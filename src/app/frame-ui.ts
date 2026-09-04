import type { ReplayFrame } from "../types";
import type { DriverListView } from "./driver-list-view";
import { formatReplayTime } from "./format";

export type FrameUiElements = {
  timeline: HTMLInputElement;
  timeReadout: HTMLSpanElement;
  eventPill: HTMLDivElement;
  cameraPill: HTMLDivElement;
};

export function paintFrame(
  frame: ReplayFrame,
  duration: number,
  scene: { update(frame: ReplayFrame): void; getActiveCameraLabel(): string; getCameraMode(): string },
  driverList: DriverListView,
  elements: FrameUiElements,
) {
  scene.update(frame);
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

  if (frame.activeEvent) {
    elements.eventPill.hidden = false;
    elements.eventPill.textContent = frame.activeEvent.label;
  } else {
    elements.eventPill.hidden = true;
    elements.eventPill.textContent = "";
  }
}
