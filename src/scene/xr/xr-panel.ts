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
