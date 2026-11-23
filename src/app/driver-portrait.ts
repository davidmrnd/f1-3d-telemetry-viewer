import type { DriverInfo } from "../types";

const COLAPINTO_HEADSHOT = "https://media.formula1.com/image/upload/c_fit,w_128/q_auto/v1740000001/common/f1/2025/alpine/fracol01/2025alpinefracol01right.webp";

export function driverPortrait(driver: DriverInfo) {
  const portrait = document.createElement("span");
  portrait.className = "driver-portrait";
  portrait.textContent = driver.acronym;
  portrait.setAttribute("aria-hidden", "true");
  const url = driver.headshotUrl || (driver.driverNumber === 43 && driver.acronym === "COL" ? COLAPINTO_HEADSHOT : "");
  if (url) {
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.loading = "lazy";
    image.addEventListener("load", () => { image.classList.add("is-loaded"); }, { once: true });
    image.src = url;
    portrait.append(image);
  }
  return portrait;
}
