import type { DrivingInput } from "../driving/vehicle";
import { DrivingXrInput } from "../driving/xr-input";
import type { RaceScene } from "../scene/race-scene";
import { mustQuery } from "./dom";
import type { DrivingReadout, DrivingSession } from "./driving-session";
import { formatLapTime, formatReplayTime } from "./format";

const DRIVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const NEUTRAL_INPUT: DrivingInput = { throttle: 0, brake: 0, steer: 0 };

function paint(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}

function formatDrivingDelta(ms: number) {
  return `${ms < 0 ? "−" : "+"}${(Math.abs(ms) / 1000).toFixed(3)} s`;
}

function formatRacePosition(position: NonNullable<DrivingReadout["position"]>) {
  return `P${position.rank} / ${position.total}`;
}

export class DrivingView {
  private readonly hud = mustQuery<HTMLElement>("#driving-hud");
  private readonly actions = mustQuery<HTMLElement>("#driving-actions");
  private readonly overlay = mustQuery<HTMLElement>("#driving-overlay");
  private readonly overlayTitle = mustQuery<HTMLElement>("#driving-overlay-title");
  private readonly overlayDetail = mustQuery<HTMLElement>("#driving-overlay-detail");
  private readonly keyboard = mustQuery<HTMLElement>("#driving-keys");
  private readonly start = mustQuery<HTMLButtonElement>("#driving-start");
  private readonly cameraButton = mustQuery<HTMLButtonElement>("#driving-camera");
  private readonly pauseButton = mustQuery<HTMLButtonElement>("#driving-pause");
  private readonly restart = mustQuery<HTMLButtonElement>("#driving-restart");
  private readonly pilot = mustQuery<HTMLElement>("#driving-driver");
  private readonly positionPanel = mustQuery<HTMLElement>("#driving-position-panel");
  private readonly position = mustQuery<HTMLElement>("#driving-position");
  private readonly time = mustQuery<HTMLElement>("#driving-time");
  private readonly timeLabel = mustQuery<HTMLElement>("#driving-time-label");
  private readonly reference = mustQuery<HTMLElement>("#driving-reference");
  private readonly referenceLabel = mustQuery<HTMLElement>("#driving-reference-label");
  private readonly referenceTime = mustQuery<HTMLElement>("#driving-reference-time");
  private readonly deltaPanel = mustQuery<HTMLElement>("#driving-delta-panel");
  private readonly delta = mustQuery<HTMLElement>("#driving-delta");
  private readonly progress = mustQuery<HTMLElement>("#driving-progress");
  private readonly note = mustQuery<HTMLElement>("#driving-note");
  private readonly speed = mustQuery<HTMLElement>("#driving-speed");
  private readonly gear = mustQuery<HTMLElement>("#driving-gear");
  private readonly original = mustQuery<HTMLElement>("#driving-original");
  private readonly ghostToggle = mustQuery<HTMLInputElement>("#driving-ghost-toggle");
  private readonly navMode = mustQuery<HTMLElement>("#active-race-mode");
  private readonly modeBadge = mustQuery<HTMLElement>("#race-mode-badge");
  private readonly keys = new Set<string>();
  private readonly xrInput = new DrivingXrInput();
  private xrSession: XRSession | null = null;
  private cockpit = false;
  private session: DrivingSession | null = null;
  private lastPhase: DrivingReadout["phase"] | null = null;

  constructor(
    private readonly shell: HTMLElement, private readonly canvas: HTMLCanvasElement,
    private readonly onChange: () => void, onHome: () => void,
  ) {
    this.start.addEventListener("click", () => this.resume());
    this.cameraButton.addEventListener("click", () => this.toggleCamera());
    this.pauseButton.addEventListener("click", () => this.pause());
    this.restart.addEventListener("click", () => this.reset());
    mustQuery("#driving-home").addEventListener("click", onHome);
    this.ghostToggle.addEventListener("change", () => {
      this.session?.setRaceGhost(this.ghostToggle.checked);
      if (this.session?.isRunning) this.canvas.focus({ preventScroll: true });
    });
    mustQuery("#settings-button").addEventListener("click", () => this.pause());
    window.addEventListener("blur", () => {
      this.keys.clear();
      if (!this.xrSession) this.pause();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.keys.clear();
        if (!this.xrSession) this.pause();
      }
    });
    window.addEventListener("keydown", event => this.onKeyDown(event));
    window.addEventListener("keyup", event => this.keys.delete(event.code));
    canvas.tabIndex = -1;
  }

  setSession(session: DrivingSession | null) {
    this.session = session;
    this.lastPhase = null;
    this.keys.clear();
    this.shell.classList.toggle("is-driving", Boolean(session));
    this.hud.hidden = !session;
    this.actions.hidden = !session;
    this.overlay.hidden = true;
    this.ghostToggle.checked = false;
    this.original.hidden = session?.mode !== "race";
    this.positionPanel.hidden = session?.mode !== "race";
    const mode = session?.mode === "ghost" ? "CONTRARRELOJ" : session ? "CARRERA" : "REPLAY";
    paint(this.navMode, session ? mode : "REPLAY 3D");
    paint(this.modeBadge, mode);
    if (session) {
      const { driver, reference } = session;
      paint(this.pilot, `#${driver.driverNumber} · ${driver.fullName}`);
      this.reference.hidden = !reference;
      this.deltaPanel.hidden = !reference;
      paint(this.timeLabel, reference ? "Tu tiempo" : "Tiempo");
      if (reference) {
        paint(this.referenceLabel, `Fantasma · vuelta ${reference.lapNumber}`);
        paint(this.referenceTime, formatLapTime(reference.durationMs));
      }
    }
    this.shell.dispatchEvent(new Event("presentationchange"));
  }

  getSession() { return this.session; }

  setXrSession(session: XRSession | null) {
    if (session === this.xrSession) return;
    this.xrSession?.removeEventListener("visibilitychange", this.onVrVisibility);
    this.xrSession = session;
    this.xrSession?.addEventListener("visibilitychange", this.onVrVisibility);
    this.xrInput.reset();
    this.pause();
    this.syncCameraButton();
  }

  private readonly onVrVisibility = () => {
    if (this.xrSession?.visibilityState !== "visible") {
      this.xrInput.reset();
      this.pause();
    }
  };

  pause() {
    this.keys.clear();
    if (!this.session?.isRunning) return;
    this.session.pause();
    this.onChange();
  }

  update(scene: RaceScene, deltaMs: number) {
    if (!this.session) return;
    const input = this.input(scene);
    this.session.tick(deltaMs, input);
    const state = this.session.render(scene, input, this.cockpit);
    const gear = state.gear < 0 ? "R" : String(state.gear);
    const time = state.duration === null ? formatLapTime(state.elapsed) : formatReplayTime(state.elapsed);
    const delta = state.delta === null ? "—" : formatDrivingDelta(state.delta);
    const position = state.position ? formatRacePosition(state.position) : "—";
    paint(this.position, position);
    paint(this.speed, String(Math.round(state.speed)));
    paint(this.gear, gear);
    paint(this.time, time);
    paint(this.progress, state.duration === null ? `Puntos de control ${Math.min(state.passed, state.checkpoints - 1)} / ${state.checkpoints - 1}`
      : `Tramo disponible · ${formatReplayTime(state.duration)}`);
    paint(this.delta, delta);
    const ahead = state.delta === null ? "" : String(state.delta <= 0);
    if (this.delta.dataset.ahead !== ahead) this.delta.dataset.ahead = ahead;
    const note = !state.valid ? "Vuelta invalidada por límites de pista" : state.contact ? "Contacto con otro coche"
      : !state.asphalt ? "Fuera del asfalto" : "";
    paint(this.note, note);
    this.note.hidden = !note;
    if (this.lastPhase !== state.phase) this.updateOverlay(state);
    if (this.xrSession) {
      const reference = this.session.reference;
      scene.updateDrivingVrHud({
        speed: state.speed, gear, time,
        comparison: reference ? `Fantasma ${formatLapTime(reference.durationMs)} · Diferencia ${delta}`
          : `Posición ${position} · Tramo disponible ${formatReplayTime(state.duration ?? 0)}`,
        note,
        overlay: state.phase === "running" ? null : {
          title: this.overlayTitle.textContent ?? "",
          detail: state.position && state.phase !== "finished" ? `${this.overlayDetail.textContent} · ${position}`
            : this.overlayDetail.textContent ?? "",
          action: `A / clic del stick para ${this.start.textContent?.toLowerCase()}`,
        },
      });
    }
    scene.render();
  }

  private input(scene: RaceScene): DrivingInput {
    const held = (code: string, arrow: string) => this.keys.has(code) || this.keys.has(arrow);
    const keyboard = {
      throttle: Number(held("KeyW", "ArrowUp")),
      brake: Number(held("KeyS", "ArrowDown")),
      steer: Number(held("KeyD", "ArrowRight")) - Number(held("KeyA", "ArrowLeft")),
    };
    if (!this.xrSession) return keyboard;
    if (this.xrSession.visibilityState !== "visible" || !scene.hasXrHeadPose()
      || this.shell.querySelector("dialog[open]")) {
      this.pause();
      this.xrInput.reset();
      return NEUTRAL_INPUT;
    }
    const vr = this.xrInput.read(this.xrSession.inputSources);
    if (vr.recenter) scene.recenterDrivingVr();
    if (vr.restart) this.reset();
    else if (vr.toggle) this.togglePlay();
    return { throttle: Math.max(vr.throttle, keyboard.throttle), brake: Math.max(vr.brake, keyboard.brake),
      steer: keyboard.steer || vr.steer };
  }

  private syncCameraButton() {
    this.cameraButton.disabled = this.xrSession !== null;
    this.cameraButton.setAttribute("aria-pressed", String(this.cockpit || this.xrSession !== null));
  }

  private toggleCamera() {
    if (!this.session || this.xrSession) return;
    this.cockpit = !this.cockpit;
    this.syncCameraButton();
    if (this.session.isRunning) this.canvas.focus({ preventScroll: true });
  }

  private togglePlay() {
    if (this.session?.isRunning) this.pause();
    else this.resume();
  }

  private resume() {
    if (!this.session) return;
    if (this.lastPhase === "finished") this.session.reset();
    this.session.start();
    this.overlay.hidden = true;
    if (!this.xrSession) this.canvas.focus({ preventScroll: true });
    this.onChange();
  }

  private reset() {
    this.keys.clear();
    this.session?.reset();
    this.onChange();
  }

  private onKeyDown(event: KeyboardEvent) {
    if (!this.session || this.shell.hidden || this.shell.inert || event.defaultPrevented
      || event.altKey || event.ctrlKey || event.metaKey || this.shell.querySelector("dialog[open]")) return;
    if (event.code === "Escape" && !event.repeat && this.session.isRunning) {
      event.preventDefault();
      this.pause();
      return;
    }
    if (event.target instanceof Element && event.target.closest("input, select, textarea, [contenteditable]")) return;
    if (event.code === "KeyV" && !event.repeat && !this.xrSession) {
      event.preventDefault();
      this.toggleCamera();
    } else if (event.code === "Space" && this.xrSession && !event.repeat
      && !(event.target instanceof Element && event.target.closest("button, a"))) {
      event.preventDefault();
      this.togglePlay();
    } else if (event.code === "KeyR" && !event.repeat) {
      event.preventDefault();
      this.reset();
    } else if (this.session.isRunning && DRIVE_KEYS.has(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
    }
  }

  private updateOverlay(state: DrivingReadout) {
    this.lastPhase = state.phase;
    const running = state.phase === "running";
    this.pauseButton.disabled = !running;
    this.overlay.hidden = running;
    if (running) return;
    const finished = state.phase === "finished";
    const ghost = this.session?.reference;
    this.keyboard.hidden = finished;
    if (finished && ghost) {
      paint(this.overlayTitle, state.valid ? "Vuelta completada" : "Vuelta invalidada");
      const time = formatLapTime(state.elapsed);
      const difference = formatDrivingDelta(state.elapsed - ghost.durationMs);
      paint(this.overlayDetail, `Tu tiempo ${time} · Fantasma ${formatLapTime(ghost.durationMs)} · ${difference}`);
    } else if (finished) {
      paint(this.overlayTitle, "Fin del tramo");
      paint(this.overlayDetail, state.position
        ? `Puesto final ${formatRacePosition(state.position)}.` : "Has llegado al final de la grabación.");
    } else if (state.phase === "paused") {
      paint(this.overlayTitle, "En pausa");
      paint(this.overlayDetail, "Puedes continuar desde este punto o reiniciar.");
    } else {
      paint(this.overlayTitle, ghost ? "Listo para la vuelta" : "Listo para conducir");
      paint(this.overlayDetail, ghost ? "Salida lanzada. Pasa los puntos de control y cruza la meta para registrar tu tiempo."
        : `Tomarás el control del coche de ${this.session?.driver.fullName}.`);
    }
    paint(this.start, finished ? "Reintentar" : state.phase === "paused" ? "Continuar" : "Empezar");
    if (!this.xrSession && !this.shell.querySelector("dialog[open]")) this.start.focus({ preventScroll: true });
  }
}
