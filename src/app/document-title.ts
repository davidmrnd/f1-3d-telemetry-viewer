const BRAND = "APEX";

export function setAppTitle(page?: string) {
  const label = page?.trim();
  document.title = label ? `${label} · ${BRAND}` : BRAND;
}
