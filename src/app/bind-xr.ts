import { isImmersiveArSupported, isImmersiveVrSupported } from "../scene/xr/xr-session";
import type { RaceScene, RaceSceneXrHooks } from "../scene/race-scene";
import type { GraphicsSettingsController } from "./bind-graphics-settings";
import { syncCameraDriverSelectVisibility } from "./camera-controls";
import { loadWristTimingVisible, saveWristTimingVisible } from "./xr-ui-preferences";

export type XrUiElements = {
  enterVrButton: HTMLButtonElement;
  enterArButton: HTMLButtonElement;
  cameraModeSelect: HTMLSelectElement;
  cameraDriverSelect: HTMLSelectElement;
  cameraDriverWrap: HTMLElement;
};

export function bindXr(scene: RaceScene, elements: XrUiElements, graphics: GraphicsSettingsController, onTogglePlay: () => void,
  playback: Pick<RaceSceneXrHooks, "getPlaybackState" | "onJump" | "onSeek" | "onSetSpeed">) {
  const { enterVrButton, enterArButton, cameraModeSelect, cameraDriverSelect, cameraDriverWrap } = elements;
  let vrSupported = false;
  let arSupported = false;
  let pending = false;
  const syncButtons = () => {
    const presenting = scene.isXrPresenting();
    const ar = scene.isArPresenting();
    enterVrButton.textContent = presenting && !ar ? "Salir de VR" : "Entrar en VR";
    enterArButton.textContent = ar ? "Salir de AR" : "Entrar en AR";
    enterVrButton.hidden = !vrSupported && !(presenting && !ar);
    enterVrButton.disabled = pending || (presenting && ar);
    enterArButton.disabled = pending || (!arSupported && !ar) || (presenting && !ar);
    enterVrButton.classList.toggle("is-xr-active", presenting && !ar);
    enterArButton.classList.toggle("is-xr-active", ar);
  };
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
      syncButtons();
      document.querySelector("#app")?.dispatchEvent(new Event("xrsessionchange"));
    },
    onSessionEnd: () => {
      graphics.activateDefault();
      syncButtons();
      document.querySelector("#app")?.dispatchEvent(new Event("xrsessionchange"));
    },
  });

  const enter = (mode: "vr" | "ar") => {
    void (async () => {
      if (pending) return;
      pending = true;
      syncButtons();
      const status = document.querySelector<HTMLElement>("#vr-status");
      if (status) status.hidden = true;
      try {
        if (scene.isXrPresenting()) {
          await scene.exitVr();
        } else if (mode === "vr") {
          graphics.activate("vr");
          await scene.enterVr();
        } else {
          await scene.enterAr();
        }
      } catch (error) {
        if (!scene.isXrPresenting()) graphics.activateDefault();
        console.error(error);
        if (status) {
          const messages: Record<string, string> = {
            NotAllowedError: "No se ha autorizado la sesión del visor. Puedes volver a intentarlo.",
            NotSupportedError: "El visor o el navegador no admite esta sesión WebXR.",
            SecurityError: "WebXR necesita una conexión HTTPS y permiso para usar el visor.",
            InvalidStateError: "El visor ya tiene una sesión activa. Ciérrala y vuelve a intentarlo.",
          };
          status.textContent = error instanceof Error
            ? messages[error.name] ?? error.message
            : "No se pudo iniciar la sesión. Comprueba la conexión del visor y los permisos.";
          status.hidden = false;
        }
      } finally {
        pending = false;
        syncButtons();
      }
    })();
  };
  enterVrButton.addEventListener("click", () => enter("vr"));
  enterArButton.addEventListener("click", () => enter("ar"));

  const refreshAvailability = async () => {
    [vrSupported, arSupported] = await Promise.all([isImmersiveVrSupported(), isImmersiveArSupported()]);
    syncButtons();
    enterVrButton.title = "Entrar con un visor compatible con WebXR";
    enterArButton.title = arSupported ? "Circuito ligero sobre tu mesa con passthrough"
      : "AR requiere HTTPS y un visor y navegador compatibles con WebXR immersive-ar. Puedes previsualizar la maqueta en Ajustes.";
  };
  navigator.xr?.addEventListener("devicechange", () => { void refreshAvailability(); });
  window.addEventListener("focus", () => { void refreshAvailability(); });
  void refreshAvailability();
}
