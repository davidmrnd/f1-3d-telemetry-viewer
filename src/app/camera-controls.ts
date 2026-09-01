import type { CameraMode } from "../scene/cameras/types";
import type { DriverInfo } from "../types";

export function populateCameraDriverSelect(
  select: HTMLSelectElement,
  drivers: DriverInfo[],
) {
  select.replaceChildren(
    ...drivers.map((driver) => {
      const option = document.createElement("option");
      option.value = String(driver.driverNumber);
      option.textContent = `${driver.acronym} #${driver.driverNumber}`;
      return option;
    }),
  );
}

export function syncCameraDriverSelectVisibility(mode: CameraMode, wrap: HTMLElement) {
  wrap.hidden = mode !== "onboard";
}
