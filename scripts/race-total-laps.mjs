function racePageSlug(meeting) {
  const circuit = String(meeting.circuit_short_name).toLowerCase();
  if (circuit === "miami") return "miami";
  if (circuit === "las vegas") return "las-vegas";
  const country = String(meeting.country_name).toLowerCase().trim();
  const aliases = {
    uk: "great-britain",
    "united kingdom": "great-britain",
    usa: "united-states",
    "united states of america": "united-states",
    uae: "united-arab-emirates",
  };
  return aliases[country] ?? country.replace(/\s+/g, "-");
}

export async function fetchRaceTotalLaps(meeting, fetchPage = fetch) {
  const url = `https://www.formula1.com/en/racing/${meeting.year}/${racePageSlug(meeting)}`;
  const response = await fetchPage(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`No se pudo consultar el total de vueltas: ${url} (${response.status}).`);
  const html = await response.text();
  const match = html.match(/Number of Laps\s*<\/dt>\s*<dd\b[^>]*>\s*(\d+)\s*<\/dd>/i);
  const totalLaps = match ? Number(match[1]) : null;
  if (!Number.isInteger(totalLaps) || totalLaps <= 0) {
    throw new Error(`La ficha oficial no contiene un total de vueltas válido: ${url}.`);
  }
  return totalLaps;
}
