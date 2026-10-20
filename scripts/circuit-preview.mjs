import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function createCircuitPreviewSvg(centerline) {
  const points = Array.isArray(centerline)
    ? centerline.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.z))
    : [];
  if (points.length < 2) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  if (minX === maxX && minZ === maxZ) return null;

  const scale = Math.min(240 / Math.max(1, maxX - minX), 94 / Math.max(1, maxZ - minZ));
  const path = points.map((point, index) => {
    const x = 140 + (point.x - (minX + maxX) / 2) * scale;
    const y = 55 - (point.z - (minZ + maxZ) / 2) * scale;
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 110"><path d="${path}" fill="none" stroke="#b9bec9" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>\n`;
}

export async function writeCircuitPreview(publicRoot, raceSlug, centerline) {
  const svg = createCircuitPreviewSvg(centerline);
  if (!svg) return null;
  const outputDir = join(publicRoot, "images", "circuits");
  await mkdir(outputDir, { recursive: true });
  const outputFile = join(outputDir, `${raceSlug}.svg`);
  await writeFile(outputFile, svg, "utf8");
  return outputFile;
}
