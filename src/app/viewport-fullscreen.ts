/** Pantalla completa del viewport (estilo YouTube: botón + Esc para salir). */

export type ViewportFullscreenApi = {
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  toggle: () => Promise<void>;
  isActive: () => boolean;
  dispose: () => void;
};

export function bindViewportFullscreen(
  shell: HTMLElement,
  button: HTMLButtonElement,
  options?: {
    onChange?: (active: boolean) => void;
  },
): ViewportFullscreenApi {
  const sync = () => {
    const active = document.fullscreenElement === shell;
    shell.classList.toggle("is-fullscreen", active);
    button.setAttribute("aria-pressed", String(active));
    button.title = active ? "Salir de pantalla completa (Esc)" : "Pantalla completa";
    button.setAttribute("aria-label", active ? "Salir de pantalla completa" : "Pantalla completa");
    button.querySelector("use")?.setAttribute("href", active ? "#i-minimize" : "#i-fullscreen");
    options?.onChange?.(active);
  };

  const enter = async () => {
    if (document.fullscreenElement === shell) return;
    await shell.requestFullscreen();
  };

  const exit = async () => {
    if (document.fullscreenElement !== shell) return;
    await document.exitFullscreen();
  };

  const toggle = async () => {
    if (document.fullscreenElement === shell) {
      await exit();
    } else {
      await enter();
    }
  };

  const onButtonClick = () => {
    void toggle().catch(() => {
      /* el usuario puede rechazar el permiso de fullscreen */
    });
  };

  const onFullscreenChange = () => {
    sync();
  };

  /** Un Esc sale del modo inmersivo (fullscreen), como en YouTube. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== "Escape" || shell.querySelector("dialog[open]")) return;
    if (document.fullscreenElement !== shell) return;
    event.preventDefault();
    void exit();
  };

  /**
   * Con pointer lock, el primer Esc libera el ratón; al desbloquear
   * también salimos de fullscreen para un solo Esc (estilo YouTube).
   */
  const onPointerLockChange = () => {
    if (document.pointerLockElement) return;
    if (document.fullscreenElement !== shell) return;
    void exit();
  };

  button.addEventListener("click", onButtonClick);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  window.addEventListener("keydown", onKeyDown);
  sync();

  return {
    enter,
    exit,
    toggle,
    isActive: () => document.fullscreenElement === shell,
    dispose: () => {
      button.removeEventListener("click", onButtonClick);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
