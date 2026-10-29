import * as THREE from "three";

export function createXrPanel(width: number, height: number, meters: number, name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear el panel VR.");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(meters, meters * height / width),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  mesh.name = name;
  mesh.renderOrder = 1000;
  mesh.visible = false;
  return { canvas, context, texture, mesh };
}

export function panelText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 20, color = "#f2f2f5", weight = 500, maxWidth?: number) {
  ctx.font = `${weight} ${size}px Inter, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y, maxWidth);
}

export function panelBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, active = false) {
  ctx.fillStyle = active ? "#341014" : "#16171c";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = active ? "#e50914" : "#303138";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
}

export function panelWindowBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "rgba(54, 59, 68, .97)");
  background.addColorStop(1, "rgba(22, 26, 33, .95)");
  ctx.fillStyle = background;
  ctx.beginPath(); ctx.roundRect(0, 0, width, height, 28); ctx.fill();
  ctx.strokeStyle = "rgba(224, 234, 249, .18)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(1, 1, width - 2, height - 2, 27); ctx.stroke();
}

export function panelRoundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, active = false) {
  ctx.fillStyle = active ? "rgba(255, 255, 255, .15)" : "rgba(0, 0, 0, .19)";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill();
}

export function createXrWindowBar(surface: ReturnType<typeof createXrPanel>, width: number, height: number, meters: number, name: string) {
  const bar = createXrPanel(720, 88, .36, name);
  bar.mesh.position.y = -(meters * height / width) / 2 - .018 - (.36 * 88 / 720) / 2;
  bar.mesh.visible = true;
  bar.mesh.renderOrder = surface.mesh.renderOrder + 1;
  surface.mesh.add(bar.mesh);
  const ctx = bar.context;
  ctx.fillStyle = "rgba(43, 48, 58, .96)";
  ctx.beginPath(); ctx.roundRect(112, 8, 596, 72, 36); ctx.fill();
  ctx.fillStyle = "rgba(255, 84, 94, .18)";
  ctx.beginPath(); ctx.roundRect(8, 8, 80, 72, 36); ctx.fill();
  panelText(ctx, "×", 31, 44, 40, "#ff545e");
  ctx.fillStyle = "#d5dce7";
  ctx.beginPath(); ctx.roundRect(250, 25, 316, 6, 3); ctx.fill();
  panelText(ctx, "Mantén para mover", 282, 57, 19, "#d5dce7");
  bar.texture.needsUpdate = true;
  return bar;
}
