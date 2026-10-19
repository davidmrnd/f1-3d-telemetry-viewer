export interface RaceCatalogEntry {
  id: string;
  year: number;
  race: string;
  circuitShortName: string;
  meetingName: string;
  sessionKey: number;
  fileName: string;
  path: string;
  durationSec: number;
  updatedAt: string;
}

export interface RacesCatalog {
  races: RaceCatalogEntry[];
  activeId: string | null;
}

const RACES_CATALOG_URL = "/data/races-catalog.json";

export async function loadRacesCatalog(): Promise<RacesCatalog> {
  const response = await fetch(RACES_CATALOG_URL);
  if (!response.ok) {
    return { races: [], activeId: null };
  }
  const catalog = (await response.json()) as RacesCatalog;
  return {
    races: Array.isArray(catalog.races) ? catalog.races : [],
    activeId: catalog.activeId ?? null,
  };
}

export function findRaceInCatalog(
  catalog: RacesCatalog,
  params: { id?: string | null; year?: string | null; race?: string | null },
): RaceCatalogEntry | null {
  const { races } = catalog;
  if (races.length === 0) {
    return null;
  }

  if (params.id) {
    return races.find((entry) => entry.id === params.id) ?? null;
  }

  if (params.year && params.race) {
    const year = Number(params.year);
    return (
      races.find(
        (entry) => entry.year === year && (entry.race === params.race || entry.circuitShortName === params.race),
      ) ?? null
    );
  }

  if (catalog.activeId) {
    const active = races.find((entry) => entry.id === catalog.activeId);
    if (active) {
      return active;
    }
  }

  return null;
}
