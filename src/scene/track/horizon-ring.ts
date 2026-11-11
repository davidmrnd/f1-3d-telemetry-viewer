import * as THREE from "three";
import { HORIZON_CLEARANCE_METERS, TRACK_GROUND_PADDING_METERS } from "../track-environment";

const HORIZON_ROOT = "/textures/horizon";
const SKYLINE_URLS = [
  `${HORIZON_ROOT}/skyline-city-a.svg`,
  `${HORIZON_ROOT}/skyline-city-b.svg`,
  `${HORIZON_ROOT}/skyline-montreal.svg`,
] as const;

const SEGMENT_WIDTH = 1536;
const BAND_HEIGHT = 384;
const PANORAMA_REPEATS = 2;
const SILHOUETTE_COLOR = "#8fa0a8";
const RING_OPACITY = 0.52;

export interface HorizonRing {
  group: THREE.Group;
  dispose: () => void;
}

function parseViewBox(svg: string) {
  const match = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!match) return { width: 2048, height: 512 };
  const parts = match[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value) || value === 0)) {
    return { width: 2048, height: 512 };
  }
  return { width: Math.abs(parts[2]), height: Math.abs(parts[3]) };
}

function tintSvg(svg: string, color: string) {
  return svg
    .replace(/fill="#000000"/gi, `fill="${color}"`)
    .replace(/fill:#000000/gi, `fill:${color}`)
    .replace(/fill="black"/gi, `fill="${color}"`)
    .replace(/fill:black/gi, `fill:${color}`)
    .replace(/<path(?![^>]*\bfill=)/gi, `<path fill="${color}"`);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`No se pudo cargar el horizonte: ${url}`));
    image.src = url;
  });
}

function alphaBounds(imageData: ImageData) {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 10) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

async function rasterizeSkyline(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo cargar el horizonte: ${url}`);
  const source = await response.text();
  const viewBox = parseViewBox(source);
  const aspect = viewBox.width / Math.max(viewBox.height, 1);
  const width = Math.round(SEGMENT_WIDTH * 1.15);
  const height = Math.max(160, Math.round(width / aspect));
  const blob = new Blob([tintSvg(source, "#ffffff")], { type: "image/svg+xml" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const bounds = alphaBounds(ctx.getImageData(0, 0, width, height));
    if (!bounds) throw new Error(`Silueta vacía en ${url}`);
    const cropWidth = bounds.maxX - bounds.minX + 1;
    const cropHeight = bounds.maxY - bounds.minY + 1;
    const cropped = document.createElement("canvas");
    cropped.width = cropWidth;
    cropped.height = cropHeight;
    cropped.getContext("2d")!.drawImage(
      canvas,
      bounds.minX, bounds.minY, cropWidth, cropHeight,
      0, 0, cropWidth, cropHeight,
    );
    return cropped;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawFeathered(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const feather = Math.max(28, Math.round(width * 0.1));
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const layerCtx = layer.getContext("2d")!;
  layerCtx.drawImage(source, 0, 0, width, height);
  const fade = layerCtx.createLinearGradient(0, 0, width, 0);
  fade.addColorStop(0, "rgba(255,255,255,0)");
  fade.addColorStop(Math.min(0.35, feather / width), "rgba(255,255,255,1)");
  fade.addColorStop(Math.max(0.65, 1 - feather / width), "rgba(255,255,255,1)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  layerCtx.globalCompositeOperation = "destination-in";
  layerCtx.fillStyle = fade;
  layerCtx.fillRect(0, 0, width, height);
  ctx.drawImage(layer, x, y);
}

function buildPanorama(segments: HTMLCanvasElement[]) {
  const segmentCount = segments.length * PANORAMA_REPEATS;
  const width = SEGMENT_WIDTH * segmentCount;
  const height = BAND_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);

  const stride = SEGMENT_WIDTH * 0.78;
  const drawHeight = height * 0.82;
  const baseY = height - drawHeight;
  for (let i = 0; i < segmentCount + 1; i++) {
    const source = segments[i % segments.length];
    const x = i * stride - SEGMENT_WIDTH * 0.12;
    drawFeathered(ctx, source, x, baseY, SEGMENT_WIDTH, drawHeight);
  }

  const pixels = ctx.getImageData(0, 0, width, height);
  const color = new THREE.Color(SILHOUETTE_COLOR);
  const fadeTop = Math.round(height * 0.42);
  const fadeBottom = Math.round(height * 0.18);
  for (let y = 0; y < height; y++) {
    const top = y < fadeTop ? y / fadeTop : 1;
    const bottom = y > height - fadeBottom ? (height - y) / fadeBottom : 1;
    const alphaScale = Math.pow(Math.min(1, top), 1.35) * Math.min(1, bottom);
    const haze = 0.35 + 0.65 * (y / height);
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const alpha = pixels.data[index + 3];
      if (alpha < 1) continue;
      pixels.data[index] = Math.round(color.r * 255 * haze + (1 - haze) * 198);
      pixels.data[index + 1] = Math.round(color.g * 255 * haze + (1 - haze) * 211);
      pixels.data[index + 2] = Math.round(color.b * 255 * haze + (1 - haze) * 214);
      pixels.data[index + 3] = Math.round(alpha * alphaScale * 0.85);
    }
  }
  ctx.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function ringLayout(points: THREE.Vector3[]) {
  const center = new THREE.Vector3();
  let minY = Infinity;
  for (const point of points) {
    center.x += point.x;
    center.z += point.z;
    minY = Math.min(minY, point.y);
  }
  center.x /= points.length;
  center.z /= points.length;
  center.y = Number.isFinite(minY) ? minY : 0;

  let maxRadius = 0;
  for (const point of points) {
    maxRadius = Math.max(maxRadius, Math.hypot(point.x - center.x, point.z - center.z));
  }
  const radius = THREE.MathUtils.clamp(
    maxRadius + TRACK_GROUND_PADDING_METERS + HORIZON_CLEARANCE_METERS,
    620,
    1600,
  );
  const height = THREE.MathUtils.clamp(radius * 0.068, 72, 118);
  return { center, radius, height };
}

export function createHorizonRing(points: THREE.Vector3[]): HorizonRing {
  const group = new THREE.Group();
  group.name = "horizon-ring";
  group.renderOrder = -2;

  const textures: THREE.CanvasTexture[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  let disposed = false;
  const generation = { id: 0 };

  const build = async () => {
    const current = ++generation.id;
    const layout = ringLayout(points);
    const segments = await Promise.all(SKYLINE_URLS.map((url) => rasterizeSkyline(url)));
    if (disposed || current !== generation.id) return;

    const texture = buildPanorama(segments);
    textures.push(texture);

    const geometry = new THREE.CylinderGeometry(
      layout.radius,
      layout.radius,
      layout.height,
      96,
      1,
      true,
    );
    geometries.push(geometry);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: "#cfd8dc",
      transparent: true,
      opacity: RING_OPACITY,
      depthWrite: false,
      fog: true,
      side: THREE.BackSide,
      toneMapped: false,
    });
    materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(layout.center.x, layout.center.y + layout.height * 0.28, layout.center.z);
    mesh.frustumCulled = false;
    mesh.name = "horizon-cylinder";
    group.add(mesh);
  };

  void build().catch((error) => {
    console.warn(error);
  });

  return {
    group,
    dispose: () => {
      disposed = true;
      generation.id += 1;
      group.removeFromParent();
      group.clear();
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      materials.length = 0;
      textures.length = 0;
      geometries.length = 0;
    },
  };
}
