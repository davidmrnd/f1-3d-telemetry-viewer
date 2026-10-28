import type { RaceScene } from "../scene/race-scene";
import type { ReplayFrame, ReplaySegment } from "../types";
import type { DesktopPlayerView } from "./desktop-player-view";
import type { LoadingView } from "./loading-view";

export async function captureCameraPreviews(
  canvas: HTMLCanvasElement,
  scene: RaceScene,
  desktopPlayer: DesktopPlayerView,
  segment: ReplaySegment,
  initialFrame: ReplayFrame,
  loadingView: LoadingView,
) {
  const initialMode = scene.getCameraMode();
  const initialDriver = scene.getFollowDriver();
  await loadingView.checkpoint(75, "Preparando cámaras…");
  if (!scene.isXrPresenting()) {
    const initialPresentation = scene.getPresentationMode();
    scene.setPresentationMode("realistic");
    scene.setCameraMode("onboard");
    for (const [index, driver] of segment.drivers.entries()) {
      scene.setFollowDriver(driver.driverNumber);
      scene.update(initialFrame);
      scene.render();
      desktopPlayer.capturePreview(canvas, "onboard", driver.driverNumber);
      await loadingView.checkpoint(75 + 23 * (index + 1) / segment.drivers.length);
    }
    scene.setCameraMode("broadcast");
    scene.update(initialFrame);
    scene.render();
    desktopPlayer.capturePreview(canvas, "broadcast");
    if (initialDriver != null) scene.setFollowDriver(initialDriver);
    scene.setCameraMode(initialMode);
    scene.setPresentationMode(initialPresentation);
  }
}
