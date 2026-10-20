import type { ReplaySegment } from "../types";

export type SessionUiElements = {
  sessionTitle: HTMLElement;
  sessionCircuit: HTMLElement;
  sessionWindow: HTMLElement;
  sessionEvent: HTMLElement;
  carCountTag: HTMLDivElement;
};

export function grandPrixName(meetingName: string) {
  const names: Record<string, string> = {
    "Spanish Grand Prix": "Gran Premio de España",
    "Monaco Grand Prix": "Gran Premio de Mónaco",
    "British Grand Prix": "Gran Premio de Gran Bretaña",
    "Belgian Grand Prix": "Gran Premio de Bélgica",
  };
  return names[meetingName] ?? meetingName;
}

export function paintSessionMetadata(segment: ReplaySegment, ui: SessionUiElements) {
  ui.sessionTitle.textContent = grandPrixName(segment.sessionRef.meetingName);
  ui.sessionCircuit.textContent = segment.sessionRef.circuitShortName;
  ui.sessionWindow.textContent = `${segment.timeRange.startIso.slice(11, 19)} – ${segment.timeRange.endIso.slice(11, 19)} UTC`;
  ui.sessionEvent.textContent =
    segment.events[0]?.label ?? "Replay de la sesión con datos registrados.";
  ui.carCountTag.textContent = `${segment.drivers.length} pilotos`;
}
