import { mustQuery } from "./dom";

export function queryReplayElements() {
  return {
    statusPill: mustQuery<HTMLDivElement>("#status-pill"),
    eventPill: mustQuery<HTMLDivElement>("#event-pill"),
    cameraPill: mustQuery<HTMLDivElement>("#camera-pill"),
    playToggle: mustQuery<HTMLButtonElement>("#play-toggle"),
    resetButton: mustQuery<HTMLButtonElement>("#reset-button"),
    enterVrButton: mustQuery<HTMLButtonElement>("#enter-vr"),
    enterArButton: mustQuery<HTMLButtonElement>("#enter-ar"),
    speedSelect: mustQuery<HTMLSelectElement>("#speed-select"),
    fullscreenButton: mustQuery<HTMLButtonElement>("#fullscreen-button"),
    sceneShell: mustQuery<HTMLElement>(".scene-shell"),
    timeline: mustQuery<HTMLInputElement>("#timeline"),
    timeReadout: mustQuery<HTMLSpanElement>("#time-readout"),
    sessionTitle: mustQuery<HTMLElement>("#session-title"),
    sessionCircuit: mustQuery<HTMLElement>("#session-circuit"),
    sessionWindow: mustQuery<HTMLElement>("#session-window"),
    sessionEvent: mustQuery<HTMLElement>("#session-event"),
    carCountTag: mustQuery<HTMLDivElement>("#car-count-tag"),
  };
}

export type ReplayElements = ReturnType<typeof queryReplayElements>;
