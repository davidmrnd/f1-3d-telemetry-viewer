import type { ReplaySegment } from "../types";

export type SessionUiElements = {
  sessionTitle: HTMLElement;
  sessionCircuit: HTMLElement;
  sessionWindow: HTMLElement;
  sessionEvent: HTMLElement;
  carCountTag: HTMLDivElement;
};

export function paintSessionMetadata(segment: ReplaySegment, ui: SessionUiElements) {
  ui.sessionTitle.textContent = `${segment.sessionRef.meetingName} / ${segment.sessionRef.year}`;
  ui.sessionCircuit.textContent = `${segment.sessionRef.circuitShortName} · session_key ${segment.sessionRef.sessionKey}`;
  ui.sessionWindow.textContent = `${segment.timeRange.startIso.slice(11, 19)} -> ${segment.timeRange.endIso.slice(11, 19)} UTC`;
  ui.sessionEvent.textContent =
    segment.events[0]?.label ?? "No se detecto un evento principal en esta ventana.";
  ui.carCountTag.textContent = `${segment.drivers.length} coches`;
}
