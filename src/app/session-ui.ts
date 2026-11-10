import type { ReplaySegment } from "../types";

export type SessionUiElements = {
  sessionTitle: HTMLElement;
  sessionCircuit: HTMLElement;
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
  ui.carCountTag.textContent = `${segment.drivers.length} pilotos`;
}
