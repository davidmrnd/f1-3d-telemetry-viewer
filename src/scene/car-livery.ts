import type { DriverInfo } from "../types";
import { publicUrl } from "../public-url";

export const LIVERY_BODY_TEXTURE_NAME = "livery-body";

const MANIFEST_URL = publicUrl("models/cars/manifest.json");

export interface CarLiveryAssets {
  body: string;
}

export interface CarsManifest {
  mesh: string;
  defaultLiveryKey: string;
  liveries: Record<string, CarLiveryAssets>;
  byTeam: Record<string, string>;
  byDriverNumber: Record<string, string>;
  byAcronym: Record<string, string>;
}

let manifest: CarsManifest | null = null;
let manifestPromise: Promise<CarsManifest> | null = null;

export function loadCarsManifest(): Promise<CarsManifest> {
  if (manifest) {
    return Promise.resolve(manifest);
  }
  if (manifestPromise) {
    return manifestPromise;
  }

  manifestPromise = fetch(MANIFEST_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`No se pudo cargar ${MANIFEST_URL} (${response.status}).`);
      }
      return response.json() as Promise<CarsManifest>;
    })
    .then((data) => {
      manifest = data;
      return data;
    })
    .catch((error) => {
      manifestPromise = null;
      throw error;
    });

  return manifestPromise;
}

export function getCarsManifest(): CarsManifest {
  if (!manifest) {
    throw new Error("Manifest de coches no cargado. Llama a loadCarsManifest() antes.");
  }
  return manifest;
}

export function resolveLiveryKey(driver: DriverInfo): string {
  const { byDriverNumber, byAcronym, byTeam, defaultLiveryKey } = getCarsManifest();
  const byNumber = byDriverNumber[String(driver.driverNumber)];
  if (byNumber) {
    return byNumber;
  }
  const byAcronymKey = byAcronym[driver.acronym];
  if (byAcronymKey) {
    return byAcronymKey;
  }
  const byTeamKey = byTeam[driver.teamName];
  if (byTeamKey) {
    return byTeamKey;
  }
  return defaultLiveryKey;
}

export function resolveCarLivery(driver: DriverInfo): CarLiveryAssets {
  const key = resolveLiveryKey(driver);
  const livery = getCarsManifest().liveries[key];
  if (!livery) {
    throw new Error(`Livery desconocida: "${key}". Revisa public/models/cars/manifest.json.`);
  }
  return livery;
}

export function getLiveryTextureUrls(): string[] {
  const urls = new Set<string>();
  for (const livery of Object.values(getCarsManifest().liveries)) {
    urls.add(livery.body);
  }
  return [...urls];
}
