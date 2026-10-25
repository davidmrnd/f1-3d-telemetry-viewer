import { isImmersiveVrSupported } from "../scene/xr/xr-session";
import type { RaceScene, RaceSceneXrHooks } from "../scene/race-scene";
import type { GraphicsSettingsController } from "./bind-graphics-settings";
import { syncCameraDriverSelectVisibility } from "./camera-controls";
import { loadWristTimingVisible, saveWristTimingVisible } from "./xr-ui-preferences";

export type XrUiElements = {
  enterVrButton: HTMLButtonElement;
  cameraModeSelect: HTMLSelectElement;
  cameraDriverSelect: HTMLSelectElement;
  cameraDriverWrap: HTMLElement;
};

export function bindXr(scene: RaceScene, elements: XrUiElements, graphics: GraphicsSettingsController, onTogglePlay: () => void,
  playback: Pick<RaceSceneXrHooks, "getPlaybackState" | "onJump" | "onSeek" | "onSetSpeed">) {
  const { enterVrButton, cameraModeSelect, cameraDriverSelect, cameraDriverWrap } = elements;
  scene.setXrHooks({
    ...playback,
    getWristVisible: loadWristTimingVisible,
    onWristVisible: saveWristTimingVisible,
    onTogglePlay,
    onCameraModeChange: mode => {
      cameraModeSelect.value = mode;
      syncCameraDriverSelectVisibility(mode, cameraDriverWrap);
    },
    onFollowDriverChange: driver => { cameraDriverSelect.value = String(driver); },
    onSessionStart: () => {
      enterVrButton.textContent = "Salir de VR";
      enterVrButton.classList.add("is-xr-active");
      document.querySelector("#app")?.dispatchEvent(new Event("xrsessionchange"));
    },
    onSessionEnd: () => {
      graphics.activateDefault();
      enterVrButton.textContent = "Entrar en VR";
      enterVrButton.classList.remove("is-xr-active");
      document.querySelector("#app")?.dispatchEvent(new Event("xrsessionchange"));
    },
  });

  enterVrButton.addEventListener("click", () => {
    void (async () => {
      enterVrButton.disabled = true;
      const status = document.querySelector<HTMLElement>("#vr-status");
      if (status) status.hidden = true;
      try {
        if (scene.isXrPresenting()) {
          await scene.exitVr();
        } else {
          graphics.activate("vr");
          await scene.enterVr();
        }
      } catch (error) {
        if (!scene.isXrPresenting()) graphics.activateDefault();
        console.error(error);
        enterVrButton.textContent = "Reintentar VR";
        if (status) {
          const messages: Record<string, string> = {
            NotAllowedError: "No se ha autorizado la sesión VR. Puedes volver a intentarlo.",
            NotSupportedError: "El visor o el navegador no admite esta sesión WebXR.",
            SecurityError: "WebXR necesita una conexión HTTPS y permiso para usar el visor.",
            InvalidStateError: "El visor ya tiene una sesión activa. Ciérrala y vuelve a intentarlo.",
          };
          status.textContent = error instanceof Error
            ? messages[error.name] ?? error.message
            : "No se pudo iniciar VR. Comprueba la conexión del visor y los permisos.";
          status.hidden = false;
        }
      } finally {
        enterVrButton.disabled = false;
      }
    })();
  });

  const refreshAvailability = async () => {
    const supported = await isImmersiveVrSupported();
    enterVrButton.hidden = !supported && !scene.isXrPresenting();
    enterVrButton.title = "Entrar con un visor compatible con WebXR";
  };
  navigator.xr?.addEventListener("devicechange", () => { void refreshAvailability(); });
  window.addEventListener("focus", () => { void refreshAvailability(); });
  void refreshAvailability();
}
